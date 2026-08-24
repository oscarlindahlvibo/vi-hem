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
    await generateAndDeliverFinalPdf(db, agreementId);
  } else if (anySigned) {
    await db.from("vihem_agreements").update({ status: "partially_signed" }).eq("id", agreementId).in("status", ["sent", "viewed", "partially_signed"]);
  }
}
