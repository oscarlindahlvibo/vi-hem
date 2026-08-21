// Finance V2 types. VI-HEM stays the source of truth for WHAT to bill;
// Accounted (self-hosted, github.com/erp-mafia/accounted) owns the real
// customer invoice from the moment it's created. These types describe
// VI-HEM's local link/read-model tables, not Accounted's own domain model.

export interface AccountedCompanyLink {
  id: string;
  organisation_id: string;
  company_id: string;
  accounted_base_url: string;
  accounted_company_id: string;
  enabled: boolean;
  last_health_status: 'unknown' | 'ok' | 'error';
  last_health_check_at: string | null;
  last_health_error?: string;
  last_sync_at: string | null;
  /** Free-form per-company config bag. Today just invoice_inbox_email
   * (Accounted's invoice-inbox address for scanner forwarding). */
  settings: { invoice_inbox_email?: string } & Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ScannerUploadStatus = 'queued' | 'sent' | 'failed';

export interface AccountedScannerUpload {
  id: string;
  company_link_id: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  content_type: string;
  status: ScannerUploadStatus;
  error_message: string;
  sent_at: string | null;
  created_at: string;
}

export type AccountedCustomerSourceType =
  | 'tenancy'
  | 'finance_customer'
  | 'customer_project_customer'
  | 'short_stay_guest';

export interface AccountedCustomerLink {
  id: string;
  organisation_id: string;
  company_link_id: string;
  source_type: AccountedCustomerSourceType;
  source_id: string;
  accounted_customer_id: string;
  accounted_customer_number: string;
  sync_status: 'linked' | 'stale' | 'error';
  last_synced_at: string;
}

export type AccountedInvoiceSourceType = 'rental_billing' | 'customer_project' | 'manual_charge';

export type AccountedInvoiceStatus =
  | 'draft'
  | 'sent'
  | 'paid'
  | 'partially_paid'
  | 'overdue'
  | 'cancelled'
  | 'credited';

export interface AccountedInvoiceLink {
  id: string;
  organisation_id: string;
  company_link_id: string;
  source_type: AccountedInvoiceSourceType;
  source_id: string;
  accounted_invoice_id: string;
  accounted_invoice_number: string | null;
  status: AccountedInvoiceStatus;
  currency: string;
  total: number | null;
  remaining_amount: number | null;
  invoice_date: string | null;
  due_date: string | null;
  paid_at: string | null;
  last_synced_at: string;
  last_sync_source: 'create' | 'webhook' | 'manual_refresh';
  created_at: string;
}

export interface AccountedWebhookSubscription {
  id: string;
  company_link_id: string;
  event_type: string;
  accounted_webhook_id: string;
  active: boolean;
  last_delivery_at: string | null;
}

// ── Rent billing (hyresfakturering) ─────────────────────────────────────
// The run/item computation itself is existing VI-HEM logic
// (vihem_create_rent_billing_run + the rent-adjustments triggers); Finance
// V2 only adds the "push a draft item to Accounted" step on top.

export type RentBillingRunStatus = 'draft' | 'generated' | 'approved' | 'sent' | 'cancelled';

export interface RentBillingRun {
  id: string;
  organisation_id: string;
  company_id: string;
  rent_period: string;
  due_date: string;
  status: RentBillingRunStatus;
  invoice_count: number;
  total_amount: number;
  created_at: string;
}

export type RentBillingItemStatus = 'draft' | 'invoiced' | 'skipped' | 'cancelled';

export interface RentBillingItem {
  id: string;
  run_id: string;
  tenancy_id: string;
  tenant_id: string;
  finance_customer_id: string | null;
  rent_period: string;
  due_date: string;
  description: string;
  base_rent_amount: number;
  adjustment_amount: number;
  amount: number;
  vat_amount: number;
  total_amount: number;
  status: RentBillingItemStatus;
  invoice_id: string | null;
  accounted_invoice_link_id: string | null;
  tenant?: { name: string } | null;
}

export interface RentBillingItemResult {
  item_id: string;
  ok: boolean;
  dry_run?: boolean;
  already_invoiced?: boolean;
  accounted_invoice_id?: string;
  error?: { code: string; message: string };
}

// ── Customer project billing (kundprojektfakturering) ───────────────────

export type ProjectInvoiceBasisStatus = 'draft' | 'ready_for_invoicing' | 'invoiced' | 'do_not_invoice';

export interface ProjectInvoiceBasis {
  id: string;
  project_id: string;
  basis_number: string;
  invoice_type: 'partial' | 'final' | 'credit' | 'internal';
  status: ProjectInvoiceBasisStatus;
  title: string;
  description: string;
  total_amount: number;
  vat_amount: number;
  finance_invoice_id: string | null;
  accounted_invoice_link_id: string | null;
  created_at: string;
  project?: { title?: string; name?: string } | null;
}

// ── Billing adjustments (avdrag & tillägg) ───────────────────────────────
// Amount sign is the model: positive = tillägg, negative = avdrag.

export type BillingAdjustmentTargetType = 'tenancy' | 'customer_project' | 'finance_customer';
export type BillingAdjustmentKind = 'one_time' | 'recurring';
export type BillingAdjustmentStatus = 'active' | 'paused' | 'cancelled' | 'completed';

export interface BillingAdjustment {
  id: string;
  organisation_id: string;
  company_id: string;
  target_type: BillingAdjustmentTargetType;
  target_id: string;
  adjustment_type: BillingAdjustmentKind;
  amount: number;
  vat_rate: number;
  description: string;
  status: BillingAdjustmentStatus;
  start_period: string;
  end_period: string | null;
  max_occurrences: number | null;
  applied_count: number;
  last_applied_period: string | null;
  created_at: string;
}

export interface BillingAdjustmentApplication {
  id: string;
  adjustment_id: string;
  billing_period: string | null;
  source_type: string;
  source_id: string;
  accounted_invoice_link_id: string;
  amount: number;
  applied_at: string;
}

export interface TenancyOption {
  id: string;
  tenant: { name: string } | null;
  apartment: { apartment_number: string } | null;
}

/** Structured error shape shared with Accounted's own v1 error envelope
 * (`{ error: { code, message, recovery_hint, details } }`), so the UI can
 * render one consistent error component for both local and upstream
 * failures. See docs/accounted-v2-integration.md "Felhantering". */
export interface AccountedApiErrorBody {
  error: {
    code: string;
    message: string;
    message_en?: string;
    recovery_hint?: string;
    details?: unknown;
    request_id?: string;
  };
}
