// Avtal V2 (BETA) types. Mirrors the Supabase schema in
// supabase/migrations/20260822100000_agreements_v2_foundation.sql and the
// three migrations after it. See docs/agreements-v2.md for the full
// architecture write-up.

export type AgreementDocumentType = 'agreement' | 'offer' | 'other';

export type AgreementStatus =
  | 'draft'
  | 'ready'
  | 'sent'
  | 'viewed'
  | 'partially_signed'
  | 'signed'
  | 'declined'
  | 'expired'
  | 'cancelled'
  | 'archived'
  | 'accepted'
  | 'rejected';

export interface Agreement {
  id: string;
  organisation_id: string;
  document_number: string;
  document_type: AgreementDocumentType;
  category: string;
  title: string;
  template_id: string | null;
  status: AgreementStatus;
  current_version_id: string | null;
  valid_until: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  final_pdf_storage_path: string | null;
  final_pdf_generated_at: string | null;
  /** Block ids of the `package_option` blocks the signer(s) have currently
   * chosen to include -- one shared choice for the whole document (a
   * tenant picks once, not per signer), kept on the agreement itself
   * rather than per-signature. See docs/agreements-v2.md for why. */
  selected_package_ids: string[];
}

export interface AgreementListItem {
  id: string;
  document_number: string;
  document_type: AgreementDocumentType;
  category: string;
  title: string;
  status: AgreementStatus;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  completed_at: string | null;
  valid_until: string | null;
}

// ── Blocks ────────────────────────────────────────────────────────────────

export type BlockType =
  | 'heading'
  | 'subheading'
  | 'paragraph'
  | 'callout'
  | 'party'
  | 'contact_info'
  | 'date'
  | 'dynamic_field'
  | 'price'
  | 'price_table'
  | 'package_option'
  | 'table'
  | 'bullet_list'
  | 'checklist'
  | 'image'
  | 'divider'
  | 'page_break'
  | 'terms'
  | 'signature_block'
  | 'attachment_ref'
  | 'fillable_text'
  | 'checkbox_consent';

export interface AgreementBlock {
  id: string;
  block_type: BlockType;
  content: Record<string, any>;
}

// ── Templates ────────────────────────────────────────────────────────────

export type AgreementTemplateStatus = 'draft' | 'active' | 'archived';

export interface AgreementTemplate {
  id: string;
  organisation_id: string;
  name: string;
  description: string;
  document_type: AgreementDocumentType;
  category: string;
  status: AgreementTemplateStatus;
  updated_at: string;
}

// ── Parties & signers ────────────────────────────────────────────────────

export type PartyType = 'internal_org' | 'contact' | 'company' | 'manual';

export interface AgreementParty {
  id?: string;
  party_type: PartyType;
  display_name: string;
  org_number: string;
  email: string;
  phone: string;
  address: string;
  source_type: string | null;
  source_id: string | null;
}

/** One selectable row in the "pick an existing party" list -- a VI-HEM
 * tenant, finance customer, or staff member, pre-shaped into the fields an
 * AgreementParty needs so adding one is a single click rather than
 * retyping data that's already in the system. */
export type ExistingEntitySourceType = 'tenant' | 'finance_customer' | 'staff';

export interface ExistingPartyOption {
  source_type: ExistingEntitySourceType;
  source_id: string;
  display_name: string;
  email: string;
  phone: string;
  address: string;
  org_number: string;
  party_type: PartyType;
  /** Set for tenant/staff (both are vihem_profiles rows) so a signer
   * created from this party can be linked back to a real VI-HEM login via
   * AgreementSigner.profile_id -- null for finance customers, who don't
   * necessarily have one. */
  profile_id: string | null;
}

export type SigningMethod = 'handwritten' | 'bankid';
export type SignerStatus = 'pending' | 'sent' | 'viewed' | 'signed' | 'declined';

export interface AgreementSigner {
  id?: string;
  party_id: string | null;
  profile_id: string | null;
  name: string;
  email: string;
  phone: string;
  personal_number: string;
  role_title: string;
  signing_method: SigningMethod;
  signing_required: boolean;
  sign_order: number | null;
  status?: SignerStatus;
}

// ── Attachments ──────────────────────────────────────────────────────────

export interface AgreementAttachment {
  id: string;
  agreement_id: string;
  name: string;
  description: string;
  position: number;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  content_type: string;
  file_size: number;
  content_hash: string;
  included_in_version_id: string | null;
  created_at: string;
}

// ── Entity links ─────────────────────────────────────────────────────────

export type AgreementEntityType =
  | 'apartment'
  | 'property'
  | 'tenancy'
  | 'tenant'
  | 'finance_customer'
  | 'customer_project'
  | 'supplier'
  | 'organisation';

export interface AgreementEntityLink {
  id?: string;
  entity_type: AgreementEntityType;
  entity_id: string;
  label: string;
}

// ── Versions & audit ─────────────────────────────────────────────────────

export interface AgreementVersion {
  id: string;
  version_number: number;
  content_hash: string;
  frozen_at: string;
  blocks?: AgreementBlock[];
}

export interface AgreementAuditEvent {
  id: string;
  agreement_id: string;
  signer_id: string | null;
  event_type: string;
  actor_type: 'staff' | 'signer' | 'system';
  created_at: string;
  channel?: 'email' | 'sms' | null;
  metadata?: Record<string, unknown>;
}

/** One completed signature's evidence -- the same data the final PDF's
 * "Signaturer och verifiering" section renders (see
 * _shared/agreement-pdf.ts), surfaced to staff in-app too. */
export interface AgreementSignature {
  id: string;
  signer_id: string;
  method: SigningMethod;
  signature_name: string;
  bankid_personal_number: string | null;
  bankid_reference: string | null;
  ip_address: string | null;
  user_agent: string;
  signed_at: string;
}

// ── Detail payload ───────────────────────────────────────────────────────

export interface AgreementDetail {
  agreement: Agreement;
  blocks: AgreementBlock[];
  parties: AgreementParty[];
  signers: AgreementSigner[];
  attachments: AgreementAttachment[];
  entity_links: AgreementEntityLink[];
  versions: AgreementVersion[];
  audit_events: AgreementAuditEvent[];
  signatures: AgreementSignature[];
}

// ── Public signing view ──────────────────────────────────────────────────

export interface PublicSignView {
  agreement: { title: string; document_number: string; document_type: AgreementDocumentType };
  version: { blocks: AgreementBlock[]; content_hash: string; frozen_at: string };
  signer: { name: string; role_title: string; signing_method: SigningMethod; status: SignerStatus };
  parties: { display_name: string; party_type: PartyType }[];
  attachments: { id: string; name: string; description: string; content_type: string; file_size: number }[];
  already_signed: boolean;
  /** Current shared package-add-on selection for this document -- see
   * Agreement.selected_package_ids. */
  selected_package_ids: string[];
}

// ── Public verification view ─────────────────────────────────────────────

export interface PublicVerificationResult {
  document_number: string;
  title: string;
  document_type: AgreementDocumentType;
  status: AgreementStatus;
  completed_at: string | null;
  content_hash: string | null;
  signers: { name: string; role_title: string; method: SigningMethod; status: SignerStatus; signed_at: string | null }[];
}
