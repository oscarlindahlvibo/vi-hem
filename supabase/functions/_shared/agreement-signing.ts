// Shared signature-completion bookkeeping for Avtal V2 -- used by every
// path that can record a signature: the handwritten flow in
// vihem-agreements-public/index.ts's "sign" action, and the BankID flow in
// vihem-bankid/index.ts's "collect" action (see that module's flow==="sign"
// + agreement_signature_request_id branch). Kept in one shared module
// rather than duplicated, unlike e.g. the price/VAT arithmetic duplicated
// across the browser/edge-function boundary in agreement-pdf.ts -- this is
// Deno-to-Deno with no such boundary, and it's stateful multi-step
// bookkeeping (signer status transition rules + audit trail + completion
// trigger), not small pure arithmetic safe to fork.
import { generateAndDeliverFinalPdf } from "./agreement-completion.ts";

export async function writeAgreementAudit(
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

/** Re-evaluates the agreement's overall status after a signer's status
 * just changed -- moves it to partially_signed/signed(or accepted for
 * offers) and, once every REQUIRED signer has signed, triggers the final
 * PDF. Safe to call after every individual signature, regardless of
 * method (handwritten or bankid). */
export async function maybeCompleteAgreement(db: any, agreementId: string) {
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
    const pdfResult = await generateAndDeliverFinalPdf(db, agreementId);
    if (pdfResult.ok && pdfResult.storagePath) {
      await linkFinalPdfToTenantDocuments(db, agreementId, pdfResult.storagePath);
    }
  } else if (anySigned) {
    await db.from("vihem_agreements").update({ status: "partially_signed" }).eq("id", agreementId).in("status", ["sent", "viewed", "partially_signed"]);
  }
}

/**
 * When a completed agreement is linked to a tenant (vihem_agreement_entity_links,
 * entity_type='tenant' -- set when staff link the agreement to a specific
 * tenant while building it), mirrors the final signed PDF into
 * vihem_documents so it shows up under the tenant's own "Dokument" page
 * (DocumentsPage.tsx), the same table/page V1's contract flow already
 * uses -- not a second, disconnected place to look for a signed lease.
 * Best-effort: an agreement with no tenant link (e.g. a B2B/customer-project
 * agreement) simply has nothing to mirror, not an error.
 */
async function linkFinalPdfToTenantDocuments(db: any, agreementId: string, storagePath: string) {
  try {
    const [{ data: agreement }, { data: links }] = await Promise.all([
      db.from("vihem_agreements").select("organisation_id, title, document_number, category").eq("id", agreementId).maybeSingle(),
      db.from("vihem_agreement_entity_links").select("entity_type, entity_id").eq("agreement_id", agreementId),
    ]);
    if (!agreement) return;
    const tenantLink = (links || []).find((l: any) => l.entity_type === "tenant");
    if (!tenantLink) return;

    const apartmentLink = (links || []).find((l: any) => l.entity_type === "apartment");
    let apartmentId: string | null = null;
    let propertyId: string | null = null;
    if (apartmentLink) {
      const { data: apartment } = await db.from("vihem_apartments").select("id, property_id").eq("id", apartmentLink.entity_id).maybeSingle();
      if (apartment) { apartmentId = apartment.id; propertyId = apartment.property_id; }
    }

    // Copied into vihem-documents rather than referenced in place in
    // vihem-agreements: that bucket's storage policies are staff-only
    // (see the "VIHEM agreements staff read files" policy), by design --
    // a signer's own copy of a signed contract PDF and a tenant's general
    // read access to their own documents are two different access
    // grants. vihem-documents already has a working, tenant-readable
    // policy (any active profile can read it), so DocumentsPage.tsx's
    // existing download path just works unmodified.
    const { data: pdfBlob, error: downloadErr } = await db.storage.from("vihem-agreements").download(storagePath);
    if (downloadErr || !pdfBlob) { console.error("linkFinalPdfToTenantDocuments: download failed", downloadErr); return; }
    const mirrorPath = `${agreement.organisation_id}/agreements/${agreementId}/final-signed.pdf`;
    const { error: uploadErr } = await db.storage.from("vihem-documents").upload(mirrorPath, pdfBlob, { contentType: "application/pdf", upsert: true });
    if (uploadErr) { console.error("linkFinalPdfToTenantDocuments: upload failed", uploadErr); return; }

    const category = /lokal/i.test(String(agreement.category || "")) ? "premises_lease" : "residential_lease";
    await db.from("vihem_documents").insert({
      title: agreement.title || agreement.document_number,
      document_type: "contract",
      document_category: category,
      contract_status: "signed",
      visibility: "tenant",
      tenant_id: tenantLink.entity_id,
      property_id: propertyId,
      apartment_id: apartmentId,
      organisation_id: agreement.organisation_id,
      storage_bucket: "vihem-documents",
      storage_path: mirrorPath,
      description: `Signerat via Avtal V2 (${agreement.document_number}).`,
    });
  } catch (err) {
    // Never let this block the agreement's own completion -- the
    // signature and final PDF are already safely recorded regardless of
    // whether the vihem_documents mirror succeeds.
    console.error("linkFinalPdfToTenantDocuments", err);
  }
}
