// Creates the real customer invoice in Accounted from a VI-HEM billing
// source (rent run, customer-project billing basis, manual charge), and
// refreshes the local read-model row from Accounted's current state.
//
// VI-HEM computes WHAT to bill (the items array below) and hands it to
// Accounted, which owns invoice numbering, VAT computation, PDF, sending and
// payment status from here on. This function does not implement rent or
// project pricing logic itself (that lives in the caller / future Finance V2
// billing modules) -- it only knows how to turn an already-assembled line
// list into an Accounted invoice safely (idempotent, dry-run first).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, type AuthContext, corsHeaders, errorJson, isAuthContext, json, requireCompanyAccess } from "../_shared/vihem-auth.ts";
import { decryptAccountedSecret } from "../_shared/accounted-crypto.ts";
import { AccountedApiError, createAccountedClient, deriveIdempotencyKey } from "../_shared/accounted-rest-client.ts";

const SOURCE_TYPES = ["rental_billing", "customer_project", "manual_charge"] as const;

interface CompanyLinkRow {
  id: string;
  organisation_id: string;
  accounted_base_url: string;
  accounted_company_id: string;
  enabled: boolean;
}

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

  const action = String(body?.action || "create");
  const companyId = String(body?.company_id || "");
  if (!companyId) return errorJson("VALIDATION_ERROR", "company_id krävs.", 400);

  const accessError = await requireCompanyAccess(auth, companyId, "seller");
  if (accessError) return accessError;

  const { data: link, error: linkErr } = await auth.adminClient
    .from("vihem_accounted_company_links")
    .select("id, organisation_id, accounted_base_url, accounted_company_id, enabled")
    .eq("company_id", companyId)
    .maybeSingle();
  if (linkErr || !link) return errorJson("ACCOUNTED_NOT_LINKED", "Bolaget är inte kopplat till Accounted ännu.", 400);
  if (!link.enabled) return errorJson("ACCOUNTED_LINK_DISABLED", "Accounted-kopplingen är inaktiverad för bolaget.", 400);

  const { data: secret, error: secretErr } = await auth.adminClient
    .from("vihem_accounted_secrets")
    .select("encrypted_secret")
    .eq("company_link_id", link.id)
    .eq("secret_type", "api_key")
    .is("webhook_subscription_id", null)
    .maybeSingle();
  if (secretErr || !secret) return errorJson("ACCOUNTED_NO_API_KEY", "Ingen Accounted API-nyckel sparad för bolaget.", 400);

  let apiKey: string;
  try {
    apiKey = await decryptAccountedSecret(secret.encrypted_secret);
  } catch (err) {
    return errorJson("SECRET_DECRYPTION_FAILED", err instanceof Error ? err.message : String(err), 500);
  }
  const client = createAccountedClient({ baseUrl: link.accounted_base_url, apiKey });

  if (action === "refresh_status") return handleRefreshStatus(auth, link, client, body);
  if (action === "create") return handleCreate(auth, link, client, body);
  return errorJson("VALIDATION_ERROR", `Okänd action: ${action}`, 400);
});

async function handleCreate(auth: AuthContext, link: CompanyLinkRow, client: ReturnType<typeof createAccountedClient>, body: any) {
  const sourceType = String(body?.source_type || "");
  const sourceId = String(body?.source_id || "");
  const dryRun = Boolean(body?.dry_run);
  const invoice = body?.invoice || {};

  if (!SOURCE_TYPES.includes(sourceType as any)) {
    return errorJson("VALIDATION_ERROR", `source_type måste vara en av: ${SOURCE_TYPES.join(", ")}`, 400);
  }
  if (!sourceId) return errorJson("VALIDATION_ERROR", "source_id krävs.", 400);
  if (!Array.isArray(invoice.items) || invoice.items.length === 0) {
    return errorJson("VALIDATION_ERROR", "invoice.items måste innehålla minst en rad.", 400);
  }

  // Already invoiced for this source? Return the existing link instead of
  // risking a second invoice (the DB unique constraint would also catch
  // this on insert, but checking first avoids burning an Accounted call).
  const { data: existingLink } = await auth.adminClient
    .from("vihem_accounted_invoice_links")
    .select("id, accounted_invoice_id, accounted_invoice_number, status, total, remaining_amount")
    .eq("company_link_id", link.id)
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .maybeSingle();
  if (existingLink && !dryRun) {
    return json({ data: { already_invoiced: true, ...existingLink } });
  }

  let accountedCustomerId = String(invoice.accounted_customer_id || "");
  if (!accountedCustomerId && invoice.customer_source_type && invoice.customer_source_id) {
    const { data: customerLink } = await auth.adminClient
      .from("vihem_accounted_customer_links")
      .select("accounted_customer_id")
      .eq("company_link_id", link.id)
      .eq("source_type", invoice.customer_source_type)
      .eq("source_id", invoice.customer_source_id)
      .maybeSingle();
    accountedCustomerId = customerLink?.accounted_customer_id || "";
  }
  if (!accountedCustomerId) {
    return errorJson(
      "ACCOUNTED_CUSTOMER_NOT_LINKED",
      "Ingen Accounted-kund angiven. Länka/skapa kunden via vihem-accounted-customers först.",
      400,
    );
  }

  const accountedPayload = {
    customer_id: accountedCustomerId,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date,
    currency: invoice.currency || "SEK",
    your_reference: invoice.your_reference || undefined,
    our_reference: invoice.our_reference || undefined,
    notes: invoice.notes || undefined,
    items: invoice.items.map((item: any) => ({
      description: item.description,
      quantity: item.quantity,
      unit: item.unit || "st",
      unit_price: item.unit_price,
      vat_rate: item.vat_rate,
    })),
  };

  const idempotencyKey = await deriveIdempotencyKey(["invoice", link.id, sourceType, sourceId]);

  try {
    const result = await client.post<any>(
      `/api/v1/companies/${encodeURIComponent(link.accounted_company_id)}/invoices`,
      accountedPayload,
      { idempotencyKey, dryRun },
    );

    if (dryRun) return json({ data: { dry_run: true, preview: result } });

    const { data: inserted, error: insertErr } = await auth.adminClient
      .from("vihem_accounted_invoice_links")
      .upsert(
        {
          organisation_id: link.organisation_id,
          company_link_id: link.id,
          source_type: sourceType,
          source_id: sourceId,
          accounted_invoice_id: result.id,
          accounted_invoice_number: result.invoice_number,
          accounted_document_type: result.document_type || "invoice",
          status: result.status || "draft",
          currency: result.currency || "SEK",
          total: result.total,
          remaining_amount: result.remaining_amount,
          last_sync_source: "create",
          last_synced_at: new Date().toISOString(),
          created_by: auth.callerId,
        },
        { onConflict: "company_link_id,source_type,source_id" },
      )
      .select("id, accounted_invoice_id, accounted_invoice_number, status, total, remaining_amount")
      .single();
    if (insertErr) {
      // The invoice WAS created in Accounted at this point; a local insert
      // failure must not look like nothing happened. Surface the Accounted
      // id so an operator can reconcile manually, and log loudly.
      console.error("vihem-accounted-invoices: invoice created in Accounted but local link insert failed", {
        accountedInvoiceId: result.id,
        companyLinkId: link.id,
        sourceType,
        sourceId,
        error: insertErr.message,
      });
      return errorJson(
        "ACCOUNTED_INVOICE_LINK_SAVE_FAILED",
        `Fakturan skapades i Accounted (id ${result.id}) men kunde inte sparas lokalt. Kontakta support med detta id.`,
        500,
        { accounted_invoice_id: result.id },
      );
    }

    return json({ data: inserted }, 201);
  } catch (err) {
    if (err instanceof AccountedApiError) {
      return errorJson(err.code, err.message, err.httpStatus >= 400 ? err.httpStatus : 502, {
        recovery_hint: err.recoveryHint,
        details: err.details,
        request_id: err.requestId,
      });
    }
    return errorJson("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), 500);
  }
}

async function handleRefreshStatus(auth: AuthContext, link: CompanyLinkRow, client: ReturnType<typeof createAccountedClient>, body: any) {
  const invoiceLinkId = String(body?.invoice_link_id || "");
  if (!invoiceLinkId) return errorJson("VALIDATION_ERROR", "invoice_link_id krävs.", 400);

  const { data: existing, error: existingErr } = await auth.adminClient
    .from("vihem_accounted_invoice_links")
    .select("id, accounted_invoice_id")
    .eq("id", invoiceLinkId)
    .eq("company_link_id", link.id)
    .maybeSingle();
  if (existingErr || !existing) return errorJson("NOT_FOUND", "Fakturakopplingen hittades inte.", 404);

  try {
    const result = await client.get<any>(
      `/api/v1/companies/${encodeURIComponent(link.accounted_company_id)}/invoices/${encodeURIComponent(existing.accounted_invoice_id)}`,
    );

    const { data: updated, error: updateErr } = await auth.adminClient
      .from("vihem_accounted_invoice_links")
      .update({
        accounted_invoice_number: result.invoice_number,
        status: result.status,
        total: result.total,
        remaining_amount: result.remaining_amount,
        paid_at: result.paid_at,
        last_sync_source: "manual_refresh",
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id, accounted_invoice_id, accounted_invoice_number, status, total, remaining_amount, paid_at")
      .single();
    if (updateErr) return errorJson("INTERNAL_ERROR", "Kunde inte uppdatera fakturakopplingen.", 500, { details: updateErr.message });

    return json({ data: updated });
  } catch (err) {
    if (err instanceof AccountedApiError) {
      return errorJson(err.code, err.message, err.httpStatus >= 400 ? err.httpStatus : 502, {
        recovery_hint: err.recoveryHint,
        details: err.details,
        request_id: err.requestId,
      });
    }
    return errorJson("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), 500);
  }
}
