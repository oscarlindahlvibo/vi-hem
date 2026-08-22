// Avtal V2 (BETA) frontend API. The only place in the frontend that knows
// about the vihem-agreements-* edge functions -- pages/components call
// these, never `supabase.functions.invoke` directly.
import { supabase } from '../../lib/supabase';
import type {
  Agreement,
  AgreementAttachment,
  AgreementDetail,
  AgreementEntityLink,
  AgreementEntityType,
  AgreementListItem,
  AgreementParty,
  AgreementSigner,
  AgreementTemplate,
  AgreementBlock,
  AgreementDocumentType,
  AgreementStatus,
  PublicSignView,
} from './types';

export class AgreementApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AgreementApiError';
  }
}

async function invokeAdmin<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('vihem-agreements-admin', { body: { action, ...body } });
  return unwrap<T>(data, error);
}
async function invokeWorkflow<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('vihem-agreements-workflow', { body: { action, ...body } });
  return unwrap<T>(data, error);
}
export async function invokePublic<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('vihem-agreements-public', { body: { action, ...body } });
  return unwrap<T>(data, error);
}

async function unwrap<T>(data: any, error: any): Promise<T> {
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const body = await context.clone().json();
        if (body?.error?.code) throw new AgreementApiError(body.error.code, body.error.message);
      } catch (parseErr) {
        if (parseErr instanceof AgreementApiError) throw parseErr;
      }
    }
    throw new AgreementApiError('EDGE_FUNCTION_ERROR', error.message || 'Okänt fel.');
  }
  if (data?.error) throw new AgreementApiError(data.error.code || 'ERROR', data.error.message || 'Okänt fel.');
  return data.data as T;
}

// ── Agreements ───────────────────────────────────────────────────────────

export function listAgreements(params: { status?: AgreementStatus; document_type?: AgreementDocumentType; search?: string } = {}): Promise<AgreementListItem[]> {
  return invokeAdmin('list_agreements', params);
}
export function getAgreement(id: string): Promise<AgreementDetail> {
  return invokeAdmin('get_agreement', { id });
}
export function createAgreement(params: { document_type: AgreementDocumentType; title?: string; category?: string; template_id?: string }): Promise<Agreement> {
  return invokeAdmin('create_agreement', params);
}
export function updateAgreement(params: { id: string; title?: string; category?: string; notes?: string; valid_until?: string | null; status?: 'draft' | 'ready' }): Promise<Agreement> {
  return invokeAdmin('update_agreement', params);
}
export function saveBlocks(agreementId: string, blocks: AgreementBlock[]): Promise<{ ok: boolean; count: number }> {
  return invokeAdmin('save_blocks', { agreement_id: agreementId, blocks: blocks.map((b) => ({ block_type: b.block_type, content: b.content })) });
}
export function saveParties(agreementId: string, parties: AgreementParty[]): Promise<{ ok: boolean }> {
  return invokeAdmin('save_parties', { agreement_id: agreementId, parties });
}
export function saveSigners(agreementId: string, signers: AgreementSigner[]): Promise<{ ok: boolean }> {
  return invokeAdmin('save_signers', { agreement_id: agreementId, signers });
}
export function saveEntityLinks(agreementId: string, links: AgreementEntityLink[]): Promise<{ ok: boolean }> {
  return invokeAdmin('save_entity_links', { agreement_id: agreementId, links });
}
export function listEntityAgreements(entityType: AgreementEntityType, entityId: string): Promise<AgreementListItem[]> {
  return invokeAdmin('list_entity_agreements', { entity_type: entityType, entity_id: entityId });
}

// ── Attachments ──────────────────────────────────────────────────────────

async function sha256HexOfFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function uploadAttachment(params: {
  organisationId: string;
  agreementId: string;
  file: File;
  name?: string;
  description?: string;
}): Promise<AgreementAttachment> {
  const contentHash = await sha256HexOfFile(params.file);
  const storagePath = `${params.organisationId}/${params.agreementId}/${crypto.randomUUID()}-${params.file.name}`;
  const { error: uploadErr } = await supabase.storage.from('vihem-agreements').upload(storagePath, params.file, { contentType: params.file.type || 'application/pdf' });
  if (uploadErr) throw new AgreementApiError('UPLOAD_FAILED', uploadErr.message);
  return invokeAdmin<AgreementAttachment>('register_attachment', {
    agreement_id: params.agreementId,
    name: params.name || params.file.name,
    description: params.description || '',
    storage_path: storagePath,
    file_name: params.file.name,
    content_type: params.file.type || 'application/pdf',
    file_size: params.file.size,
    content_hash: contentHash,
  });
}
export function removeAttachment(id: string): Promise<{ ok: boolean }> {
  return invokeAdmin('remove_attachment', { id });
}

// ── Templates ────────────────────────────────────────────────────────────

export function listTemplates(params: { status?: string } = {}): Promise<AgreementTemplate[]> {
  return invokeAdmin('list_templates', params);
}
export function getTemplate(id: string): Promise<{ template: AgreementTemplate; blocks: AgreementBlock[] }> {
  return invokeAdmin('get_template', { id });
}
export function createTemplate(params: { name: string; description?: string; document_type: AgreementDocumentType; category?: string }): Promise<AgreementTemplate> {
  return invokeAdmin('create_template', params);
}
export function updateTemplate(params: { id: string; name?: string; description?: string; category?: string; status?: string }): Promise<AgreementTemplate> {
  return invokeAdmin('update_template', params);
}
export function saveTemplateBlocks(templateId: string, blocks: AgreementBlock[]): Promise<{ ok: boolean; count: number }> {
  return invokeAdmin('save_template_blocks', { template_id: templateId, blocks: blocks.map((b) => ({ block_type: b.block_type, content: b.content })) });
}
export function duplicateTemplate(id: string): Promise<AgreementTemplate> {
  return invokeAdmin('duplicate_template', { id });
}

// ── Workflow (send / remind / cancel) ───────────────────────────────────

export function sendAgreement(agreementId: string, channels: { email: boolean; sms: boolean }): Promise<{ version_id: string; version_number: number; content_hash: string; delivery: { signer_id: string; ok: boolean; channels_used: string[]; error?: string }[] }> {
  return invokeWorkflow('send', { agreement_id: agreementId, channels });
}
export function remindSigner(agreementId: string, signerId: string, alsoSms = false): Promise<{ ok: boolean; channels_used: string[] }> {
  return invokeWorkflow('remind', { agreement_id: agreementId, signer_id: signerId, also_sms: alsoSms });
}
export function cancelAgreement(agreementId: string): Promise<{ ok: boolean }> {
  return invokeWorkflow('cancel', { agreement_id: agreementId });
}

// ── Public signing (used by PublicAgreementSignPage) ────────────────────

export function getSignView(token: string): Promise<PublicSignView> {
  return invokePublic('get', { token });
}
export function getAttachmentDownloadUrl(token: string, attachmentId: string): Promise<{ url: string }> {
  return invokePublic('get_attachment_url', { token, attachment_id: attachmentId });
}
export function submitSignature(token: string, params: { signature_image: string; signature_name: string }): Promise<{ ok: boolean; signed_at: string }> {
  return invokePublic('sign', { token, method: 'handwritten', ...params });
}
export function declineSigning(token: string, reason?: string): Promise<{ ok: boolean }> {
  return invokePublic('decline', { token, reason });
}
