import { supabase } from '../../../lib/supabase';
import { base64UrlToBlob, mailApi } from '../lib/api';
import type { MailAttachment } from '../lib/types';

export async function fetchAttachmentBlob(accountId: string, a: MailAttachment): Promise<Blob> {
  const r = await mailApi<{ data: string }>('attachment_get', { account_id: accountId, message_id: a.messageId, attachment_id: a.id });
  return base64UrlToBlob(r.data, a.mimeType);
}
export async function downloadAttachment(accountId: string, a: MailAttachment) {
  const blob = await fetchAttachmentBlob(accountId, a); const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = a.filename || 'bilaga'; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function previewAttachment(accountId: string, a: MailAttachment) {
  const blob = await fetchAttachmentBlob(accountId, a); const url = URL.createObjectURL(blob); window.open(url, '_blank', 'noopener'); window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
const safeName = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'bilaga';

/** Sparar en mejlbilaga i VI-HEM:s befintliga dokumenthantering (bucket vihem-documents + vihem_documents) och kopplar tråden till dokumentet. */
export async function saveAttachmentToDocuments(accountId: string, threadId: string, a: MailAttachment, ctx: { organisationId: string; userId: string; subject: string }): Promise<string> {
  const blob = await fetchAttachmentBlob(accountId, a);
  if (blob.size > 25 * 1024 * 1024) throw new Error('Bilagan är större än 25 MB.');
  const path = `${ctx.organisationId}/mail/${crypto.randomUUID()}-${safeName(a.filename)}`;
  const up = await supabase.storage.from('vihem-documents').upload(path, blob, { contentType: a.mimeType, upsert: false }); if (up.error) throw up.error;
  const { data, error } = await supabase.from('vihem_documents').insert({ organisation_id: ctx.organisationId, title: a.filename.slice(0, 200), description: `Sparad från e-post: ${ctx.subject}`.slice(0, 500), document_type: 'other', document_category: 'other', visibility: 'staff', file_name: a.filename, file_size: blob.size, storage_bucket: 'vihem-documents', storage_path: path, storage_provider: 'supabase', created_by: ctx.userId }).select('id').single();
  if (error) { await supabase.storage.from('vihem-documents').remove([path]); throw error; }
  await mailApi('link_create', { account_id: accountId, thread_id: threadId, object_type: 'document', object_id: data.id, label: a.filename });
  return data.id as string;
}
