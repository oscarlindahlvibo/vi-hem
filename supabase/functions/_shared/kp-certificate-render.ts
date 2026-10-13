// Renderar och lagrar certifikat-PDF i privat lagring. Återanvänder befintlig PDF om den finns (oföränderlig efter utfärdande).
import { renderCertificatePdf } from "./kp-certificate-pdf.ts";
import type { KpContext } from "./kp-common.ts";
import { ID06_LOGO_JPEG } from "./kp-id06-logo.ts";

const sv = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("sv-SE", { year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Stockholm" }) : "");

export async function ensureCertificatePdf(admin: any, ctx: KpContext, certificateId: string, force = false): Promise<string> {
  const { data: cert } = await admin.from("vihem_kp_certificates").select("*").eq("id", certificateId).eq("organisation_id", ctx.organisationId).single();
  if (cert.pdf_path && !force) return cert.pdf_path;
  const { data: tpl } = cert.template_id ? await admin.from("vihem_kp_certificate_templates").select("*").eq("id", cert.template_id).maybeSingle() : { data: null };
  let logo: Uint8Array | null = null;
  if (tpl?.logo_asset_id) {
    const { data: asset } = await admin.from("vihem_kp_media_assets").select("bucket,storage_path,mime_type").eq("id", tpl.logo_asset_id).maybeSingle();
    if (asset && /jpe?g/i.test(asset.mime_type || asset.storage_path)) { const { data } = await admin.storage.from(asset.bucket).download(asset.storage_path); if (data) logo = new Uint8Array(await data.arrayBuffer()); }
  }
  const { data: reg } = await admin.from("vihem_kp_external_registrations").select("status,external_reference").eq("certificate_id", cert.id).eq("kind", "id06").maybeSingle();
  const { data: courseRow } = await admin.from("vihem_kp_courses").select("id06_enabled").eq("id", cert.course_id).maybeSingle();
  const exam = cert.exam_summary ?? {};
  const statusNote = cert.status === "revoked" ? "ÅTERKALLAT – intyget är inte längre giltigt" : cert.status === "superseded" ? "ERSATT av ett nyare intyg" : "";
  const bytes = await renderCertificatePdf({
    title: tpl?.title ?? (cert.kind === "competence_proof" ? "Kompetensbevis" : "Utbildningsintyg"), bodyText: tpl?.body_text ?? "har genomfört och blivit godkänd i utbildningen", footerText: tpl?.footer_text ?? "",
    accent: tpl?.accent_color ?? "#0b6b4c", signerName: tpl?.signer_name ?? "", signerTitle: tpl?.signer_title ?? "", holderName: cert.holder_name, courseTitle: cert.course_title, courseCode: cert.course_code,
    certificateNumber: cert.certificate_number, verificationUrl: `${ctx.baseUrl}/verifiera?kod=${cert.verification_code}`, issuerName: cert.issuer_name, completedOn: sv(cert.completed_on), validUntil: cert.valid_until ? sv(cert.valid_until) : null,
    issuedAt: sv(cert.issued_at), resultText: exam.percent != null ? `Godkänd (${Math.round(Number(exam.percent))} %)` : "Godkänd", kind: cert.kind,
    id06Reference: reg?.status === "registered" ? reg.external_reference : null, logoJpeg: logo, id06LogoJpeg: courseRow?.id06_enabled ? ID06_LOGO_JPEG : null, statusNote,
  });
  const path = `certificates/${cert.organisation_id}/${cert.id}${force ? `-${Date.now()}` : ""}.pdf`;
  const { error } = await admin.storage.from("vihem-kp-private").upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`Kunde inte spara PDF: ${error.message}`);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await admin.rpc("vihem_kp_set_certificate_pdf", { p_cert: cert.id, p_path: path, p_sha: digest });
  return path;
}
