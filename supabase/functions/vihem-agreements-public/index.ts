// Public, unauthenticated signing surface for Avtal V2 (BETA). The signer
// never gets a Supabase session -- every action here is authorized purely
// by presenting a valid signing token (see _shared/agreement-tokens.ts and
// the migration header on vihem_agreement_signature_requests for why only
// the token's hash is ever stored). Must be deployed with verify_jwt=false
// (see supabase/config.toml), matching vihem-accounted-webhook and
// vihem-accounted-healthcheck's existing pattern for this repo.
//
// BankID signing is NOT implemented here yet -- see docs/agreements-v2.md
// "BankID" section for exactly what's needed. A signer whose
// signing_method is 'bankid' gets a clear "not available yet" response
// rather than a broken/fake flow.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { hashSigningToken } from "../_shared/agreement-tokens.ts";
import { generateAndDeliverFinalPdf } from "../_shared/agreement-completion.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function errorJson(code: string, message: string, status = 400) {
  return json({ error: { code, message } }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return errorJson("METHOD_NOT_ALLOWED", "Endast POST stöds.", 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorJson("VALIDATION_ERROR", "Ogiltig JSON.", 400);
  }
  const action = String(body?.action || "");
  const token = String(body?.token || "");
  if (!token) return errorJson("VALIDATION_ERROR", "token krävs.", 400);

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  const userAgent = req.headers.get("user-agent") || "";

  async function resolveRequest() {
    const tokenHash = await hashSigningToken(token);
    const { data: request, error } = await db
      .from("vihem_agreement_signature_requests")
      .select("id, agreement_id, signer_id, agreement_version_id, expires_at, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (error || !request) return { error: errorJson("LINK_INVALID", "Länken är ogiltig.", 404) };
    if (request.revoked_at) return { error: errorJson("LINK_REVOKED", "Länken har återkallats.", 410) };
    if (new Date(request.expires_at) < new Date()) return { error: errorJson("LINK_EXPIRED", "Länken har gått ut. Be avsändaren skicka en ny.", 410) };
    return { request };
  }

  try {
    switch (action) {
      case "get": {
        const resolved = await resolveRequest();
        if (resolved.error) return resolved.error;
        const { request } = resolved;

        const [{ data: agreement }, { data: version }, { data: signer }, { data: parties }, { data: attachments }, { data: existingSignature }] = await Promise.all([
          db.from("vihem_agreements").select("title, document_number, document_type, status, selected_package_ids").eq("id", request.agreement_id).single(),
          db.from("vihem_agreement_versions").select("id, blocks, content_hash, frozen_at").eq("id", request.agreement_version_id).single(),
          db.from("vihem_agreement_signers").select("id, name, role_title, signing_method, status").eq("id", request.signer_id).single(),
          db.from("vihem_agreement_parties").select("display_name, party_type").eq("agreement_id", request.agreement_id).order("position"),
          db.from("vihem_agreement_attachments").select("id, name, description, content_type, file_size").eq("included_in_version_id", request.agreement_version_id).order("position"),
          db.from("vihem_agreement_signatures").select("id, signed_at, method").eq("signature_request_id", request.id).maybeSingle(),
        ]);

        if (!existingSignature && signer?.status !== "signed" && signer?.status !== "declined") {
          await db.from("vihem_agreement_signature_requests").update({ last_viewed_at: new Date().toISOString() }).eq("id", request.id);
          if (signer?.status === "sent" || signer?.status === "pending") {
            await db.from("vihem_agreement_signers").update({ status: "viewed" }).eq("id", request.signer_id);
          }
          // Only the agreement's FIRST view flips draft-adjacent "sent" to
          // "viewed" -- once any signer has signed (partially_signed etc.)
          // this no-ops via the .eq("status","sent") guard, so a later
          // viewer can never regress the agreement's overall status.
          await db.from("vihem_agreements").update({ status: "viewed" }).eq("id", request.agreement_id).eq("status", "sent");
          await writeAudit(db, request.agreement_id, request.signer_id, "viewed", request.agreement_version_id, version?.content_hash, ip, userAgent);
        }

        return json({
          data: {
            agreement: { title: agreement?.title, document_number: agreement?.document_number, document_type: agreement?.document_type },
            version: { blocks: version?.blocks, content_hash: version?.content_hash, frozen_at: version?.frozen_at },
            signer: { name: signer?.name, role_title: signer?.role_title, signing_method: signer?.signing_method, status: signer?.status },
            parties: (parties || []).map((p: any) => ({ display_name: p.display_name, party_type: p.party_type })),
            attachments: attachments || [],
            already_signed: Boolean(existingSignature),
            selected_package_ids: Array.isArray(agreement?.selected_package_ids) ? agreement.selected_package_ids : [],
          },
        });
      }

      case "update_package_selection": {
        const resolved = await resolveRequest();
        if (resolved.error) return resolved.error;
        const { request } = resolved;
        const { data: signer } = await db.from("vihem_agreement_signers").select("status").eq("id", request.signer_id).maybeSingle();
        if (!signer) return errorJson("NOT_FOUND", "Signatären hittades inte.", 404);
        if (signer.status === "signed" || signer.status === "declined") return errorJson("ALREADY_SIGNED", "Dokumentet är redan avgjort och kan inte längre ändras.", 409);
        const selectedPackageIds = Array.isArray(body?.selected_package_ids) ? body.selected_package_ids.map((v: unknown) => String(v)) : [];
        const { error: updateErr } = await db.from("vihem_agreements").update({ selected_package_ids: selectedPackageIds }).eq("id", request.agreement_id);
        if (updateErr) return errorJson("INTERNAL_ERROR", `Kunde inte spara valet: ${updateErr.message}`, 500);
        return json({ data: { ok: true, selected_package_ids: selectedPackageIds } });
      }

      case "get_attachment_url": {
        const resolved = await resolveRequest();
        if (resolved.error) return resolved.error;
        const { request } = resolved;
        const attachmentId = String(body?.attachment_id || "");
        const { data: attachment } = await db
          .from("vihem_agreement_attachments")
          .select("storage_bucket, storage_path")
          .eq("id", attachmentId)
          .eq("agreement_id", request.agreement_id)
          .eq("included_in_version_id", request.agreement_version_id)
          .maybeSingle();
        if (!attachment) return errorJson("NOT_FOUND", "Bilagan hittades inte.", 404);
        const { data: signed, error } = await db.storage.from(attachment.storage_bucket).createSignedUrl(attachment.storage_path, 300);
        if (error || !signed) return errorJson("INTERNAL_ERROR", "Kunde inte skapa nedladdningslänk.", 500);
        return json({ data: { url: signed.signedUrl } });
      }

      case "sign": {
        const resolved = await resolveRequest();
        if (resolved.error) return resolved.error;
        const { request } = resolved;

        const { data: signer } = await db.from("vihem_agreement_signers").select("*").eq("id", request.signer_id).single();
        if (!signer) return errorJson("NOT_FOUND", "Signatären hittades inte.", 404);
        if (signer.status === "signed") return errorJson("ALREADY_SIGNED", "Du har redan signerat detta dokument.", 409);
        if (signer.status === "declined") return errorJson("ALREADY_DECLINED", "Du har redan avböjt detta dokument.", 409);

        const method = String(body?.method || "handwritten");
        if (method !== signer.signing_method) return errorJson("METHOD_MISMATCH", "Fel signeringsmetod för denna signatär.", 400);
        if (method === "bankid") {
          // See module header + docs/agreements-v2.md: BankID for Avtal V2
          // needs a token-authenticated extension to vihem-bankid that does
          // not exist yet. Never fake a signature here.
          return errorJson("NOT_IMPLEMENTED", "BankID-signering för Avtal V2 är inte kopplad ännu. Kontakta avsändaren.", 501);
        }

        const signatureImage = String(body?.signature_image || "");
        const signatureName = String(body?.signature_name || signer.name || "");
        if (!signatureImage) return errorJson("VALIDATION_ERROR", "Signatur saknas.", 400);
        if (!signatureName.trim()) return errorJson("VALIDATION_ERROR", "Namn krävs.", 400);

        const { data: signature, error: sigErr } = await db
          .from("vihem_agreement_signatures")
          .insert({
            agreement_id: request.agreement_id,
            signer_id: request.signer_id,
            signature_request_id: request.id,
            agreement_version_id: request.agreement_version_id,
            method: "handwritten",
            signature_image: signatureImage,
            signature_name: signatureName,
            ip_address: ip,
            user_agent: userAgent,
          })
          .select("id, signed_at")
          .single();
        if (sigErr) return errorJson("INTERNAL_ERROR", `Kunde inte spara signaturen: ${sigErr.message}`, 500);

        await db.from("vihem_agreement_signers").update({ status: "signed" }).eq("id", request.signer_id);

        const { data: version } = await db.from("vihem_agreement_versions").select("content_hash").eq("id", request.agreement_version_id).maybeSingle();
        await writeAudit(db, request.agreement_id, request.signer_id, "signed", request.agreement_version_id, version?.content_hash, ip, userAgent, { method: "handwritten" });

        await maybeCompleteAgreement(db, request.agreement_id);

        return json({ data: { ok: true, signed_at: signature.signed_at } });
      }

      case "decline": {
        const resolved = await resolveRequest();
        if (resolved.error) return resolved.error;
        const { request } = resolved;
        const { data: signer } = await db.from("vihem_agreement_signers").select("status").eq("id", request.signer_id).maybeSingle();
        if (!signer) return errorJson("NOT_FOUND", "Signatären hittades inte.", 404);
        if (signer.status === "signed" || signer.status === "declined") return errorJson("INVALID_STATUS", "Detta dokument kan inte längre avböjas.", 409);

        await db.from("vihem_agreement_signers").update({ status: "declined" }).eq("id", request.signer_id);
        const { data: agreement } = await db.from("vihem_agreements").select("document_type").eq("id", request.agreement_id).maybeSingle();
        await db
          .from("vihem_agreements")
          .update({ status: agreement?.document_type === "offer" ? "rejected" : "declined" })
          .eq("id", request.agreement_id);
        await writeAudit(db, request.agreement_id, request.signer_id, "declined", request.agreement_version_id, null, ip, userAgent, { reason: String(body?.reason || "") });
        return json({ data: { ok: true } });
      }

      default:
        return errorJson("VALIDATION_ERROR", `Okänd action: ${action}`, 400);
    }
  } catch (err) {
    console.error("vihem-agreements-public", err);
    return errorJson("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), 500);
  }
});

async function maybeCompleteAgreement(db: any, agreementId: string) {
  const { data: signers } = await db.from("vihem_agreement_signers").select("status, signing_required").eq("agreement_id", agreementId);
  const required = (signers || []).filter((s: any) => s.signing_required);
  const allSigned = required.length > 0 && required.every((s: any) => s.status === "signed");
  const anySigned = required.some((s: any) => s.status === "signed");

  if (allSigned) {
    const { data: agreement } = await db.from("vihem_agreements").select("document_type").eq("id", agreementId).maybeSingle();
    await db
      .from("vihem_agreements")
      .update({ status: agreement?.document_type === "offer" ? "accepted" : "signed", completed_at: new Date().toISOString() })
      .eq("id", agreementId);
    await db.from("vihem_agreement_audit_events").insert({ agreement_id: agreementId, event_type: "completed", actor_type: "system" });

    // Best-effort: the agreement is already correctly marked signed/
    // accepted above regardless of whether PDF generation or delivery
    // succeeds -- a signer's confirmation of their own signature must
    // never fail because of a downstream PDF/email problem. Failures are
    // captured in the audit trail by generateAndDeliverFinalPdf itself,
    // not re-thrown here.
    await generateAndDeliverFinalPdf(db, agreementId);
  } else if (anySigned) {
    await db.from("vihem_agreements").update({ status: "partially_signed" }).eq("id", agreementId).in("status", ["sent", "viewed", "partially_signed"]);
  }
}

async function writeAudit(
  db: any,
  agreementId: string,
  signerId: string | null,
  eventType: string,
  versionId: string | null,
  documentHash: string | null | undefined,
  ip: string | null,
  userAgent: string,
  metadata: Record<string, unknown> = {},
) {
  await db.from("vihem_agreement_audit_events").insert({
    agreement_id: agreementId,
    signer_id: signerId,
    event_type: eventType,
    actor_type: "signer",
    agreement_version_id: versionId,
    document_hash: documentHash || null,
    ip_address: ip,
    user_agent: userAgent,
    metadata,
  });
}
