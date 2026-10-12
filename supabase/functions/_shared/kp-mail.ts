// Utskick ur Kompetensportalens utkö. Först Google Workspace (om avsändaradress är satt), därefter SMTP som reserv. Misslyckanden returneras – aldrig tyst.
import { sendGmailMessage } from "./google-workspace-mailer.ts";
import { readSmtpConfigFromEnv, sendMail } from "./smtp-mailer.ts";

export interface OutboxRow { id: string; organisation_id: string; to_email: string; to_name: string; subject: string; body: string; attachment: { bucket: string; path: string; file_name: string; content_type?: string } | null }

export async function deliverOutboxRow(admin: any, settings: Record<string, any>, row: OutboxRow): Promise<{ ok: boolean; error?: string }> {
  let attachment: { fileName: string; contentType: string; bytes: Uint8Array } | undefined;
  if (row.attachment) {
    const { data, error } = await admin.storage.from(row.attachment.bucket).download(row.attachment.path);
    if (error || !data) return { ok: false, error: `Bilagan kunde inte läsas: ${error?.message || "saknas"}` };
    attachment = { fileName: row.attachment.file_name, contentType: row.attachment.content_type || "application/pdf", bytes: new Uint8Array(await data.arrayBuffer()) };
  }
  const errors: string[] = [];
  const from = String(settings.sender_email || "").trim();
  if (from) {
    try { await sendGmailMessage(admin, row.organisation_id, { fromEmail: from, fromName: settings.sender_name || "Kompetensportalen", toEmail: row.to_email, toName: row.to_name || undefined, subject: row.subject, text: row.body, attachment }); return { ok: true }; }
    catch (e) { errors.push(`gmail: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
  }
  if (Deno.env.get("SMTP_HOST")) {
    try {
      const cfg = readSmtpConfigFromEnv();
      if (from) cfg.fromEmail = cfg.fromEmail || from;
      cfg.fromName = settings.sender_name || cfg.fromName;
      await sendMail(cfg, { toEmail: row.to_email, toName: row.to_name || undefined, subject: row.subject, text: row.body, attachment } as any);
      return { ok: true };
    } catch (e) { errors.push(`smtp: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
  }
  return { ok: false, error: errors.join(" | ") || "Ingen e-postleverantör är konfigurerad." };
}
