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
  ExistingPartyOption,
  PublicSignView,
  PublicVerificationResult,
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
/** Admin/superadmin only, any status -- deliberately more permissive than
 * vihem_agreements' own RLS (draft-only client deletes). Permanently
 * removes the agreement and everything under it (blocks, parties,
 * signers, versions, signatures, audit trail, attachments, and any
 * final-signed PDF copy mirrored into a tenant's Dokument page). */
export function deleteAgreement(id: string): Promise<{ ok: boolean }> {
  return invokeAdmin('delete_agreement', { id });
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

/**
 * Tenant-facing "my agreements" read. Deliberately NOT routed through
 * vihem-agreements-admin (staff/admin only) -- goes straight through
 * supabase-js so RLS does the access control (the signer-self-read policy
 * added in 20260822150000_agreements_v2_signer_self_read.sql), matching
 * how TenantInvoicesPage.tsx reads vihem_accounted_invoice_links directly
 * rather than through an edge function.
 */
/**
 * Existing tenants, finance customers, and staff -- offered as one-click
 * "pick instead of retype" options when adding a party, per the explicit
 * request that creating a manual party should stay available but not be
 * the only path. Direct RLS-backed reads (same pattern as
 * listMyAgreements above), not an edge function: staff/admin already have
 * SELECT access to these tables within their own organisation via
 * existing RLS (AdminTenantsPage.tsx already reads vihem_profiles the
 * same way).
 */
export async function listExistingPartyOptions(organisationId: string): Promise<ExistingPartyOption[]> {
  const [tenants, customers, staff] = await Promise.all([
    supabase.from('vihem_profiles').select('id, name, email, phone').eq('organisation_id', organisationId).eq('role', 'tenant').eq('active', true).order('name'),
    supabase.from('vihem_finance_customers').select('id, name, email, phone, address_line1, city, organisation_number, customer_type').eq('organisation_id', organisationId).eq('active', true).order('name'),
    supabase.from('vihem_profiles').select('id, name, email, phone').eq('organisation_id', organisationId).in('role', ['staff', 'admin']).eq('active', true).order('name'),
  ]);
  const options: ExistingPartyOption[] = [];
  for (const t of tenants.data || []) {
    options.push({ source_type: 'tenant', source_id: t.id, display_name: t.name, email: t.email || '', phone: t.phone || '', address: '', org_number: '', party_type: 'contact', profile_id: t.id });
  }
  for (const c of customers.data || []) {
    options.push({
      source_type: 'finance_customer',
      source_id: c.id,
      display_name: c.name,
      email: c.email || '',
      phone: c.phone || '',
      address: [c.address_line1, c.city].filter(Boolean).join(', '),
      org_number: c.organisation_number || '',
      party_type: c.customer_type === 'private' ? 'contact' : 'company',
      profile_id: null,
    });
  }
  for (const s of staff.data || []) {
    options.push({ source_type: 'staff', source_id: s.id, display_name: s.name, email: s.email || '', phone: s.phone || '', address: '', org_number: '', party_type: 'internal_org', profile_id: s.id });
  }
  return options;
}

/**
 * Resolves a tenancy/tenant/apartment id (passed via the `agreements-v2/new/
 * <kind>/<id>` deep link, see App.tsx) into everything a new hyresavtal
 * needs to start pre-linked: entity links for {{tenant.x}}/{{apartment.x}}/
 * {{property.x}} dynamic-field resolution (matching the exact field set
 * `mergeLinkedEntity` in vihem-agreements-workflow/index.ts actually reads,
 * so what's previewed here is what the document will really resolve to), a
 * suggested title/template, and -- when a tenant is known -- a ready-made
 * party+signer so the admin doesn't have to re-add them by hand. Direct
 * RLS-backed reads, same pattern as listExistingPartyOptions above.
 */
export interface AgreementPrefillContext {
  title: string;
  templateId: string;
  summary: string;
  entityLinks: AgreementEntityLink[];
  party?: AgreementParty;
  signer?: AgreementSigner;
}

export async function resolveAgreementPrefill(
  kind: 'tenancy' | 'tenant' | 'apartment',
  id: string,
  organisationId: string,
): Promise<AgreementPrefillContext> {
  type TenantRow = { id: string; name: string; email: string | null; phone: string | null; bankid_personal_number: string | null };
  type ApartmentRow = { id: string; apartment_number: string; unit_type: string; property_id: string };
  type PropertyRow = { id: string; name: string };

  let tenant: TenantRow | null = null;
  let apartment: ApartmentRow | null = null;
  let property: PropertyRow | null = null;

  if (kind === 'tenancy') {
    const { data: tenancy, error } = await supabase
      .from('vihem_tenancies')
      .select('tenant_id, apartment_id')
      .eq('id', id)
      .eq('organisation_id', organisationId)
      .maybeSingle();
    if (error) throw new AgreementApiError('DB_READ_FAILED', error.message);
    if (!tenancy) throw new AgreementApiError('NOT_FOUND', 'Hyresförhållandet hittades inte.');
    const [{ data: t }, { data: a }] = await Promise.all([
      supabase.from('vihem_profiles').select('id, name, email, phone, bankid_personal_number').eq('id', tenancy.tenant_id).maybeSingle(),
      supabase.from('vihem_apartments').select('id, apartment_number, unit_type, property_id').eq('id', tenancy.apartment_id).maybeSingle(),
    ]);
    tenant = t as TenantRow | null;
    apartment = a as ApartmentRow | null;
  } else if (kind === 'tenant') {
    const { data: t } = await supabase.from('vihem_profiles').select('id, name, email, phone, bankid_personal_number').eq('id', id).eq('organisation_id', organisationId).maybeSingle();
    tenant = t as TenantRow | null;
  } else {
    const { data: a } = await supabase.from('vihem_apartments').select('id, apartment_number, unit_type, property_id').eq('id', id).eq('organisation_id', organisationId).maybeSingle();
    apartment = a as ApartmentRow | null;
  }

  if (apartment?.property_id) {
    const { data: p } = await supabase.from('vihem_properties').select('id, name').eq('id', apartment.property_id).maybeSingle();
    property = p as PropertyRow | null;
  }

  const entityLinks: AgreementEntityLink[] = [];
  if (tenant) entityLinks.push({ entity_type: 'tenant', entity_id: tenant.id, label: tenant.name });
  if (apartment) entityLinks.push({ entity_type: 'apartment', entity_id: apartment.id, label: `Lgh ${apartment.apartment_number}` });
  if (property) entityLinks.push({ entity_type: 'property', entity_id: property.id, label: property.name });

  let templateId = '';
  if (apartment) {
    const wantName = apartment.unit_type === 'apartment' ? 'Hyresavtal - Lägenhet' : apartment.unit_type === 'commercial' ? 'Hyresavtal - Lokal' : null;
    if (wantName) {
      const templates = await listTemplates({ status: 'active' });
      templateId = templates.find((t) => t.name === wantName)?.id || '';
    }
  }

  const titleParts = [apartment ? `Lgh ${apartment.apartment_number}` : null, tenant ? tenant.name : null].filter(Boolean);
  const title = titleParts.length > 0 ? `Hyresavtal — ${titleParts.join(', ')}` : 'Hyresavtal';
  const summary = [tenant?.name, apartment ? `Lgh ${apartment.apartment_number}` : null, property?.name].filter(Boolean).join(' · ') || 'Inget objekt kunde slås upp.';

  const party: AgreementParty | undefined = tenant
    ? { party_type: 'contact', display_name: tenant.name, org_number: '', email: tenant.email || '', phone: tenant.phone || '', address: '', source_type: 'tenant', source_id: tenant.id }
    : undefined;
  const signer: AgreementSigner | undefined = tenant
    ? {
        party_id: null,
        profile_id: tenant.id,
        name: tenant.name,
        email: tenant.email || '',
        phone: tenant.phone || '',
        personal_number: '',
        role_title: '',
        signing_method: tenant.bankid_personal_number ? 'bankid' : 'handwritten',
        signing_required: true,
        sign_order: null,
      }
    : undefined;

  return { title, templateId, summary, entityLinks, party, signer };
}

/** Options for the "Länka objekt" picker in the editor's Parter step --
 * tenants, apartments (with their property name as context), and
 * properties, so linking one is a search-and-click rather than typing a
 * raw id. Same direct-RLS-read pattern as listExistingPartyOptions. */
export interface ExistingEntityLinkOption {
  entity_type: AgreementEntityType;
  entity_id: string;
  label: string;
  sublabel: string;
}

export async function listExistingEntityLinkOptions(organisationId: string): Promise<ExistingEntityLinkOption[]> {
  const [tenants, apartments, properties] = await Promise.all([
    supabase.from('vihem_profiles').select('id, name').eq('organisation_id', organisationId).eq('role', 'tenant').eq('active', true).order('name'),
    supabase.from('vihem_apartments').select('id, apartment_number, property:property_id(name)').eq('organisation_id', organisationId).order('apartment_number'),
    supabase.from('vihem_properties').select('id, name').eq('organisation_id', organisationId).order('name'),
  ]);
  const options: ExistingEntityLinkOption[] = [];
  for (const t of tenants.data || []) {
    options.push({ entity_type: 'tenant', entity_id: t.id, label: t.name, sublabel: 'Hyresgäst' });
  }
  for (const a of (apartments.data || []) as any[]) {
    const propName = Array.isArray(a.property) ? a.property[0]?.name : a.property?.name;
    options.push({ entity_type: 'apartment', entity_id: a.id, label: `Lgh ${a.apartment_number}`, sublabel: propName || 'Lägenhet/lokal' });
  }
  for (const p of properties.data || []) {
    options.push({ entity_type: 'property', entity_id: p.id, label: p.name, sublabel: 'Fastighet' });
  }
  return options;
}

export async function listMyAgreements(): Promise<AgreementListItem[]> {
  const [{ data, error }, { data: userData }] = await Promise.all([
    supabase
      .from('vihem_agreements')
      .select('id, document_number, document_type, category, title, status, created_at, updated_at, sent_at, completed_at, valid_until')
      .order('created_at', { ascending: false }),
    supabase.auth.getUser(),
  ]);
  if (error) throw new AgreementApiError('DB_READ_FAILED', error.message);
  const agreements = (data ?? []) as Array<Omit<AgreementListItem, 'my_signer_status'>>;
  if (!userData.user || agreements.length === 0) {
    return agreements.map((a) => ({ ...a, my_signer_status: null }));
  }
  // A second, separate query rather than a join -- the agreement's own
  // "signer self read" RLS policy and the signers table's are two
  // different policies (see vihem_agreement_signers/vihem_agreements
  // policies), and PostgREST embeds don't re-evaluate RLS per embedded
  // row the way two plain selects reliably do.
  const { data: signers } = await supabase
    .from('vihem_agreement_signers')
    .select('agreement_id, status')
    .eq('profile_id', userData.user.id)
    .in('agreement_id', agreements.map((a) => a.id));
  const statusByAgreement = new Map((signers ?? []).map((s: any) => [s.agreement_id, s.status]));
  return agreements.map((a) => ({ ...a, my_signer_status: statusByAgreement.get(a.id) ?? null }));
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
export function resendFinalPdf(agreementId: string): Promise<{ ok: boolean; deliveries?: { party: string; email: string; ok: boolean; error?: string }[] }> {
  return invokeWorkflow('resend_final_pdf', { agreement_id: agreementId });
}
/**
 * For an already logged-in signer (e.g. a tenant) opening their own
 * pending document from inside the portal instead of an emailed/texted
 * link -- mints a fresh signing-link URL (same /sign?token=... page as
 * every other signer uses) scoped to whichever of THEIR OWN signer rows
 * matches this agreement. Not staff-only, unlike every other function in
 * this section -- see vihem-agreements-workflow/index.ts's early
 * get_my_signing_link branch.
 */
export function getMySigningLink(agreementId: string): Promise<{ url: string }> {
  return invokeWorkflow('get_my_signing_link', { agreement_id: agreementId });
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
export function updatePackageSelection(token: string, selectedPackageIds: string[]): Promise<{ ok: boolean; selected_package_ids: string[] }> {
  return invokePublic('update_package_selection', { token, selected_package_ids: selectedPackageIds });
}

// ── Public verification (used by PublicAgreementVerifyPage) ─────────────
// A separate edge function/token scheme from signing on purpose -- the
// verification code is printed on the final PDF and meant to be shared
// with third parties (a bank, a court), so it must never grant the signing
// powers a per-signer token has. See vihem-agreements-verify/index.ts.

export async function verifyDocument(documentNumber: string, code: string): Promise<PublicVerificationResult> {
  const { data, error } = await supabase.functions.invoke('vihem-agreements-verify', { body: { document_number: documentNumber, code } });
  return unwrap<PublicVerificationResult>(data, error);
}
