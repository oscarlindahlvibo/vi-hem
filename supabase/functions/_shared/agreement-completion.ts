// Generates the final signed PDF for a completed Avtal V2 document,
// stores it, and emails it to every party with an email address (not just
// the signers -- a party who wasn't required to sign still gets the final
// document, per the explicit requirement). Called once from
// vihem-agreements-public when the last required signer signs, and again
// on-demand from vihem-agreements-workflow's "resend" action (regenerating
// is cheap and always reflects the current, immutable version -- there is
// nothing to go stale).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildAgreementPdf, type SignatureForPdf } from "./agreement-pdf.ts";
import { readSmtpConfigFromEnv, sendMail } from "./smtp-mailer.ts";

function randomVerificationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface FinalPdfResult {
  ok: boolean;
  storagePath?: string;
  deliveries?: { party: string; email: string; ok: boolean; error?: string }[];
  error?: string;
}

export async function generateAndDeliverFinalPdf(db: SupabaseClient, agreementId: string): Promise<FinalPdfResult> {
  try {
    const { data: agreement, error: agreementErr } = await db
      .from("vihem_agreements")
      .select("id, organisation_id, document_number, title, document_type, current_version_id, completed_at, verification_code, selected_package_ids")
      .eq("id", agreementId)
      .maybeSingle();
    if (agreementErr || !agreement) return { ok: false, error: "Avtalet hittades inte." };
    if (!agreement.current_version_id) return { ok: false, error: "Ingen fryst version finns för avtalet." };

    const [{ data: version }, { data: parties }, { data: signers }, { data: org }] = await Promise.all([
      db.from("vihem_agreement_versions").select("blocks, content_hash").eq("id", agreement.current_version_id).maybeSingle(),
      db.from("vihem_agreement_parties").select("display_name, party_type, email").eq("agreement_id", agreementId).order("position"),
      db.from("vihem_agreement_signers").select("id, name, email, role_title, signing_required").eq("agreement_id", agreementId),
      db.from("vihem_organisations").select("name").eq("id", agreement.organisation_id).maybeSingle(),
    ]);
    if (!version) return { ok: false, error: "Dokumentversionen hittades inte." };

    const requiredSignerIds = (signers || []).filter((s: any) => s.signing_required).map((s: any) => s.id);
    const { data: signatureRows } = requiredSignerIds.length
      ? await db.from("vihem_agreement_signatures").select("signer_id, method, signature_image, bankid_personal_number, bankid_reference, signed_at").in("signer_id", requiredSignerIds)
      : { data: [] };

    const signerById = new Map<string, any>((signers || []).map((s: any) => [s.id, s]));
    const signatures: SignatureForPdf[] = (signatureRows || []).map((row: any) => {
      const signer = signerById.get(row.signer_id);
      return {
        name: signer?.name || "Okänd signatär",
        roleTitle: signer?.role_title || "",
        method: row.method,
        signedAt: row.signed_at,
        signatureImageDataUrl: row.signature_image || null,
        bankidPersonalNumber: row.bankid_personal_number || null,
        bankidReference: row.bankid_reference || null,
      };
    });

    let verificationCode = agreement.verification_code as string | null;
    if (!verificationCode) {
      verificationCode = randomVerificationCode();
      await db.from("vihem_agreements").update({ verification_code: verificationCode }).eq("id", agreementId);
    }
    const appUrl = (Deno.env.get("VIHEM_PUBLIC_APP_URL") || "https://app.vi-hem.se").replace(/\/$/, "");
    const verificationUrl = `${appUrl}/verify?doc=${encodeURIComponent(agreement.document_number)}&code=${verificationCode}`;

    const pdfBytes = await buildAgreementPdf({
      documentNumber: agreement.document_number,
      title: agreement.title || agreement.document_number,
      organisationName: org?.name || "VI-HEM",
      organisationLogoDataUrl: null,
      blocks: version.blocks,
      parties: (parties || []).map((p: any) => ({ display_name: p.display_name, party_type: p.party_type })),
      signatures,
      contentHash: version.content_hash,
      completedAt: agreement.completed_at || new Date().toISOString(),
      verificationUrl,
      selectedPackageIds: Array.isArray(agreement.selected_package_ids) ? agreement.selected_package_ids : [],
    });

    const storagePath = `${agreement.organisation_id}/${agreementId}/final-signed.pdf`;
    const { error: uploadErr } = await db.storage.from("vihem-agreements").upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (uploadErr) return { ok: false, error: `Kunde inte spara PDF:en: ${uploadErr.message}` };

    await db.from("vihem_agreements").update({ final_pdf_storage_path: storagePath, final_pdf_generated_at: new Date().toISOString() }).eq("id", agreementId);
    await db.from("vihem_agreement_audit_events").insert({ agreement_id: agreementId, event_type: "final_pdf_generated", actor_type: "system", document_hash: version.content_hash });

    const deliveries: { party: string; email: string; ok: boolean; error?: string }[] = [];
    const recipientParties = (parties || []).filter((p: any) => p.email);
    if (recipientParties.length > 0) {
      let smtpConfig;
      try {
        smtpConfig = readSmtpConfigFromEnv();
      } catch (err) {
        for (const p of recipientParties) deliveries.push({ party: p.display_name, email: p.email, ok: false, error: err instanceof Error ? err.message : String(err) });
        await db.from("vihem_agreement_audit_events").insert({ agreement_id: agreementId, event_type: "pdf_delivery_failed", actor_type: "system", channel: "email", metadata: { error: "SMTP not configured" } });
        return { ok: true, storagePath, deliveries };
      }
      for (const party of recipientParties) {
        try {
          await sendMail(smtpConfig, {
            toEmail: party.email,
            toName: party.display_name,
            subject: `Signerat dokument: ${agreement.title || agreement.document_number}`,
            text: [
              `${agreement.title || agreement.document_number} (${agreement.document_number}) har signerats av samtliga parter.`,
              "",
              "Det signerade dokumentet bifogas som PDF.",
              "",
              verificationUrl ? `Verifiera dokumentet: ${verificationUrl}` : "",
            ].filter(Boolean).join("\n"),
            attachment: { fileName: `${agreement.document_number}.pdf`, contentType: "application/pdf", bytes: pdfBytes },
          });
          deliveries.push({ party: party.display_name, email: party.email, ok: true });
          await db.from("vihem_agreement_audit_events").insert({ agreement_id: agreementId, event_type: "pdf_sent_email", actor_type: "system", channel: "email", metadata: { to: maskEmail(party.email) } });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          deliveries.push({ party: party.display_name, email: party.email, ok: false, error: message });
          await db.from("vihem_agreement_audit_events").insert({ agreement_id: agreementId, event_type: "pdf_delivery_failed", actor_type: "system", channel: "email", metadata: { to: maskEmail(party.email), error: message } });
        }
      }
    }

    return { ok: true, storagePath, deliveries };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}
