// Forwards a scanned supplier invoice / receipt to Accounted's invoice-inbox
// extension via email, instead of running it through VI-HEM's own OCR/AI
// pipeline. See docs/accounted-v2-integration.md "Scanner -> Accounted" for
// why this is the email channel and not a direct API call: invoice-inbox's
// manual upload route needs a browser session cookie, not a Bearer API key,
// so it can't be called server-to-server the way the rest of this
// integration works.
//
// The file itself is uploaded to Supabase Storage by the frontend first
// (same vihem-documents bucket / client-side upload pattern the legacy
// supplier-invoice scanner already uses); this function only downloads it
// server-side to attach it to the outbound email, so the storage upload
// step doesn't need new bucket policies of its own.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, corsHeaders, errorJson, isAuthContext, json, requireCompanyAccess } from "../_shared/vihem-auth.ts";
import { sendGmailMessage, googleMailerErrorCode, googleMailerFriendlyMessage } from "../_shared/google-workspace-mailer.ts";

// Same designated sender as vihem-send-installment-plan-email -- sent via
// the Gmail API (Domain-Wide Delegation impersonates this address), not
// SMTP, since the edge-function container has no SMTP relay configured.
const SENDER_EMAIL = "faktura@vibogruppen.se";
const SENDER_NAME = "VI-HEM";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return errorJson("METHOD_NOT_ALLOWED", "Endast POST stöds.", 405);

  const auth = await authenticate(req);
  if (!isAuthContext(auth)) return auth;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorJson("VALIDATION_ERROR", "Ogiltig JSON.", 400);
  }

  const companyId = String(body?.company_id || "");
  const storagePath = String(body?.storage_path || "");
  const fileName = String(body?.file_name || "").trim();
  const contentType = String(body?.content_type || "application/pdf");
  const storageBucket = "vihem-documents";

  if (!companyId) return errorJson("VALIDATION_ERROR", "company_id krävs.", 400);
  if (!storagePath) return errorJson("VALIDATION_ERROR", "storage_path krävs.", 400);
  if (!fileName) return errorJson("VALIDATION_ERROR", "file_name krävs.", 400);

  const accessError = await requireCompanyAccess(auth, companyId, "seller");
  if (accessError) return accessError;

  const { data: company, error: companyErr } = await auth.adminClient
    .from("vihem_companies")
    .select("id, organisation_id, name")
    .eq("id", companyId)
    .maybeSingle();
  if (companyErr || !company) return errorJson("NOT_FOUND", "Bolaget hittades inte.", 404);

  const { data: link, error: linkErr } = await auth.adminClient
    .from("vihem_accounted_company_links")
    .select("id, settings")
    .eq("company_id", companyId)
    .maybeSingle();
  if (linkErr || !link) return errorJson("ACCOUNTED_NOT_LINKED", "Bolaget är inte kopplat till Accounted ännu.", 400);

  const invoiceInboxEmail = String((link.settings as Record<string, unknown> | null)?.invoice_inbox_email || "").trim();
  if (!invoiceInboxEmail) {
    return errorJson(
      "ACCOUNTED_INVOICE_INBOX_NOT_CONFIGURED",
      "Ingen Accounted-inkorgsadress är sparad för bolaget. Ange den under Bolagskoppling.",
      400,
    );
  }

  // Insert the tracking row BEFORE attempting to send: "queued" is a real,
  // durable state even if the function crashes mid-send, so a stuck upload
  // is always visible in the Underlag tab rather than silently vanishing.
  const { data: uploadRow, error: insertErr } = await auth.adminClient
    .from("vihem_accounted_scanner_uploads")
    .insert({
      organisation_id: company.organisation_id,
      company_link_id: link.id,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      file_name: fileName,
      content_type: contentType,
      status: "queued",
      uploaded_by: auth.callerId,
    })
    .select("id")
    .single();
  if (insertErr || !uploadRow) {
    return errorJson("INTERNAL_ERROR", "Kunde inte spara underlagsposten.", 500, { details: insertErr?.message });
  }

  try {
    const { data: fileBlob, error: downloadErr } = await auth.adminClient.storage
      .from(storageBucket)
      .download(storagePath);
    if (downloadErr || !fileBlob) throw new Error(downloadErr?.message || "Kunde inte hämta den uppladdade filen.");

    const bytes = new Uint8Array(await fileBlob.arrayBuffer());

    try {
      await sendGmailMessage(auth.adminClient, company.organisation_id, {
        fromEmail: SENDER_EMAIL,
        fromName: SENDER_NAME,
        toEmail: invoiceInboxEmail,
        subject: `Underlag från VI-HEM – ${company.name}`,
        text: `Skickat automatiskt från VI-HEM-scannern för ${company.name}. Bifogad fil: ${fileName}.`,
        attachment: { fileName, contentType, bytes },
      });
    } catch (sendErr) {
      throw new Error(googleMailerFriendlyMessage(googleMailerErrorCode(sendErr)));
    }

    const { error: updateErr } = await auth.adminClient
      .from("vihem_accounted_scanner_uploads")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", uploadRow.id);
    if (updateErr) {
      console.error("vihem-accounted-scanner-forward: mail sent but status update failed", updateErr.message);
    }

    return json({ data: { id: uploadRow.id, status: "sent" } }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await auth.adminClient
      .from("vihem_accounted_scanner_uploads")
      .update({ status: "failed", error_message: message })
      .eq("id", uploadRow.id);
    return errorJson("SCANNER_FORWARD_FAILED", message, 502);
  }
});
