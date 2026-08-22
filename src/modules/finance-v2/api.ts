// Finance V2 data-access layer. This is the ONLY place in the frontend that
// is allowed to know about the Accounted-integration Edge Functions -- pages
///components must go through these calls, never call
// supabase.functions.invoke('vihem-accounted-*') directly. That keeps the
// "no separate implementation per page" mistake (see legacy FinancePage)
// from recurring in V2, and gives us one place to fix error handling if the
// Edge Function response shape changes.
//
// The Accounted API key never reaches this file or the browser: every write
// here goes through a server-side Edge Function that decrypts the key from
// vihem_accounted_secrets (service-role only, RLS blocks all client access).
import { supabase, supabaseAnonKey, supabaseUrl } from '../../lib/supabase';
import type {
  AccountedApiErrorBody,
  AccountedCompanyLink,
  AccountedCustomerLink,
  AccountedCustomerSourceType,
  AccountedInvoiceLink,
  AccountedInvoiceSourceType,
  AccountedScannerUpload,
  BillingAdjustment,
  BillingAdjustmentApplication,
  BillingAdjustmentKind,
  BillingAdjustmentTargetType,
  ProjectInvoiceBasis,
  RentBillingItem,
  RentBillingItemResult,
  RentBillingRun,
  TenancyOption,
} from './types';
import type { FinanceCompany, FinanceCustomer, Invoice } from '../../types';

export class AccountedIntegrationError extends Error {
  code: string;
  recoveryHint?: string;
  details?: unknown;

  constructor(code: string, message: string, recoveryHint?: string, details?: unknown) {
    super(message);
    this.name = 'AccountedIntegrationError';
    this.code = code;
    this.recoveryHint = recoveryHint;
    this.details = details;
  }
}

async function invoke<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) {
    // supabase-js exposes the raw Response on `error.context` for non-2xx
    // function responses; our functions always return the structured
    // { error: { code, message, ... } } envelope, so extract that instead
    // of surfacing the generic "Edge Function returned a non-2xx status".
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const body = (await context.clone().json()) as AccountedApiErrorBody;
        if (body?.error?.code) {
          throw new AccountedIntegrationError(
            body.error.code,
            body.error.message_en || body.error.message,
            body.error.recovery_hint,
            body.error.details,
          );
        }
      } catch (parseErr) {
        if (parseErr instanceof AccountedIntegrationError) throw parseErr;
        // fall through to generic error below
      }
    }
    throw new AccountedIntegrationError('EDGE_FUNCTION_ERROR', error.message || 'Okänt fel.');
  }
  return data as T;
}

// ── Company link (bolagskoppling) ──────────────────────────────────────

export async function getCompanyLink(companyId: string): Promise<AccountedCompanyLink | null> {
  const { data, error } = await supabase
    .from('vihem_accounted_company_links')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw new AccountedIntegrationError('DB_READ_FAILED', error.message);
  return data as AccountedCompanyLink | null;
}

export async function saveCompanyLink(params: {
  companyId: string;
  accountedBaseUrl: string;
  accountedCompanyId: string;
  apiKey?: string;
  enabled: boolean;
  invoiceInboxEmail?: string;
}): Promise<AccountedCompanyLink> {
  return invoke<{ data: AccountedCompanyLink }>('vihem-accounted-admin', {
    action: 'save_company_link',
    company_id: params.companyId,
    accounted_base_url: params.accountedBaseUrl,
    accounted_company_id: params.accountedCompanyId,
    api_key: params.apiKey,
    enabled: params.enabled,
    invoice_inbox_email: params.invoiceInboxEmail,
  }).then((res) => res.data);
}

export async function testConnection(companyId: string): Promise<{ ok: true }> {
  return invoke<{ data: { ok: true } }>('vihem-accounted-admin', {
    action: 'test_connection',
    company_id: companyId,
  }).then((res) => res.data);
}

export async function registerWebhooks(
  companyId: string,
): Promise<Record<string, { ok: boolean; error?: string }>> {
  return invoke<{ data: { results: Record<string, { ok: boolean; error?: string }> } }>(
    'vihem-accounted-admin',
    { action: 'register_webhooks', company_id: companyId },
  ).then((res) => res.data.results);
}

// ── Customer link ───────────────────────────────────────────────────────

export interface VihemCustomerInput {
  name: string;
  customer_type?: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  postal_code?: string;
  city?: string;
  country_code?: string;
  organisation_number?: string;
  personal_number?: string;
  payment_terms_days?: number;
}

export async function linkOrCreateCustomer(params: {
  companyId: string;
  sourceType: AccountedCustomerSourceType;
  sourceId: string;
  customer: VihemCustomerInput;
  dryRun?: boolean;
}): Promise<AccountedCustomerLink> {
  return invoke<{ data: AccountedCustomerLink }>('vihem-accounted-customers', {
    company_id: params.companyId,
    source_type: params.sourceType,
    source_id: params.sourceId,
    customer: params.customer,
    dry_run: params.dryRun ?? false,
  }).then((res) => res.data);
}

// ── Invoice link ─────────────────────────────────────────────────────────

export interface AccountedInvoiceItemInput {
  description: string;
  quantity: number;
  unit?: string;
  unit_price: number;
  vat_rate?: number;
}

export async function createAccountedInvoice(params: {
  companyId: string;
  sourceType: AccountedInvoiceSourceType;
  sourceId: string;
  accountedCustomerId?: string;
  customerSourceType?: AccountedCustomerSourceType;
  customerSourceId?: string;
  invoiceDate: string;
  dueDate: string;
  currency?: string;
  items: AccountedInvoiceItemInput[];
  yourReference?: string;
  ourReference?: string;
  notes?: string;
  dryRun?: boolean;
}): Promise<unknown> {
  return invoke('vihem-accounted-invoices', {
    action: 'create',
    company_id: params.companyId,
    source_type: params.sourceType,
    source_id: params.sourceId,
    invoice: {
      accounted_customer_id: params.accountedCustomerId,
      customer_source_type: params.customerSourceType,
      customer_source_id: params.customerSourceId,
      invoice_date: params.invoiceDate,
      due_date: params.dueDate,
      currency: params.currency,
      items: params.items,
      your_reference: params.yourReference,
      our_reference: params.ourReference,
      notes: params.notes,
    },
    dry_run: params.dryRun ?? false,
  });
}

export async function refreshInvoiceStatus(companyId: string, invoiceLinkId: string): Promise<AccountedInvoiceLink> {
  return invoke<{ data: AccountedInvoiceLink }>('vihem-accounted-invoices', {
    action: 'refresh_status',
    company_id: companyId,
    invoice_link_id: invoiceLinkId,
  }).then((res) => res.data);
}

export async function listInvoiceLinks(companyLinkId: string): Promise<AccountedInvoiceLink[]> {
  const { data, error } = await supabase
    .from('vihem_accounted_invoice_links')
    .select('*')
    .eq('company_link_id', companyLinkId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new AccountedIntegrationError('DB_READ_FAILED', error.message);
  return (data ?? []) as AccountedInvoiceLink[];
}

// ── Rent billing (hyresfakturering) ─────────────────────────────────────
// Run/item generation reuses the existing vihem_create_rent_billing_run RPC
// (base rent + adjustments, computed entirely in VI-HEM) -- only invoice
// creation goes through the new Accounted integration.

export async function createOrGetRentBillingRun(
  companyId: string,
  rentPeriod: string,
): Promise<RentBillingRun> {
  const { data, error } = await supabase.rpc('vihem_create_rent_billing_run', {
    target_company_id: companyId,
    target_rent_period: rentPeriod,
    include_existing: false,
  });
  if (error) throw new AccountedIntegrationError('RENT_RUN_CREATE_FAILED', error.message);
  return data as RentBillingRun;
}

export async function listRentBillingItems(runId: string): Promise<RentBillingItem[]> {
  const { data, error } = await supabase
    .from('vihem_rent_billing_items')
    .select('*, tenant:tenant_id(name)')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  if (error) throw new AccountedIntegrationError('DB_READ_FAILED', error.message);
  return (data ?? []) as unknown as RentBillingItem[];
}

export async function createRentBillingInvoices(params: {
  companyId: string;
  runId: string;
  dryRun?: boolean;
}): Promise<{ results: RentBillingItemResult[]; summary: { total: number; succeeded: number; failed: number } }> {
  return invoke('vihem-accounted-rent-billing', {
    company_id: params.companyId,
    run_id: params.runId,
    dry_run: params.dryRun ?? false,
  }).then((res: any) => res.data);
}

// ── Customer project billing (kundprojektfakturering) ───────────────────
// Reads the invoice basis directly (same table CustomerProjectsPage.tsx
// writes to, untouched) -- only invoice creation goes through Accounted.

export async function listInvoiceableProjectBases(companyId: string): Promise<ProjectInvoiceBasis[]> {
  const { data, error } = await supabase
    .from('vihem_project_invoice_basis')
    .select('*, project:project_id(title, name, company_id)')
    .eq('status', 'ready_for_invoicing')
    .is('finance_invoice_id', null)
    .is('accounted_invoice_link_id', null)
    .order('created_at', { ascending: true });
  if (error) throw new AccountedIntegrationError('DB_READ_FAILED', error.message);
  // project_invoice_basis has no direct company_id column (only via its
  // project), so the company filter happens client-side on the joined row.
  return ((data ?? []) as unknown as (ProjectInvoiceBasis & { project: { company_id?: string } | null })[])
    .filter((row) => row.project?.company_id === companyId);
}

export async function createProjectBasisInvoice(params: {
  companyId: string;
  basisId: string;
  dryRun?: boolean;
}): Promise<unknown> {
  return invoke('vihem-accounted-project-billing', {
    company_id: params.companyId,
    basis_id: params.basisId,
    dry_run: params.dryRun ?? false,
  });
}

// ── Billing adjustments (avdrag & tillägg) ───────────────────────────────
// Writes always go through vihem-billing-adjustments (RLS blocks direct
// client writes on this table); reads go straight to the table since it's
// non-sensitive and company-scoped by RLS.

export async function listBillingAdjustments(companyId: string): Promise<BillingAdjustment[]> {
  const { data, error } = await supabase
    .from('vihem_billing_adjustments')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw new AccountedIntegrationError('DB_READ_FAILED', error.message);
  return (data ?? []) as BillingAdjustment[];
}

export async function listBillingAdjustmentApplications(adjustmentIds: string[]): Promise<BillingAdjustmentApplication[]> {
  if (adjustmentIds.length === 0) return [];
  const { data, error } = await supabase
    .from('vihem_billing_adjustment_applications')
    .select('*')
    .in('adjustment_id', adjustmentIds)
    .order('applied_at', { ascending: false });
  if (error) throw new AccountedIntegrationError('DB_READ_FAILED', error.message);
  return (data ?? []) as BillingAdjustmentApplication[];
}

export async function createBillingAdjustment(params: {
  companyId: string;
  targetType: BillingAdjustmentTargetType;
  targetId: string;
  adjustmentType: BillingAdjustmentKind;
  amount: number;
  vatRate?: number;
  description?: string;
  startPeriod?: string;
  endPeriod?: string | null;
  maxOccurrences?: number | null;
}): Promise<BillingAdjustment> {
  return invoke<{ data: BillingAdjustment }>('vihem-billing-adjustments', {
    action: 'create',
    company_id: params.companyId,
    target_type: params.targetType,
    target_id: params.targetId,
    adjustment_type: params.adjustmentType,
    amount: params.amount,
    vat_rate: params.vatRate ?? 0,
    description: params.description ?? '',
    start_period: params.startPeriod,
    end_period: params.endPeriod,
    max_occurrences: params.maxOccurrences,
  }).then((res) => res.data);
}

export async function updateBillingAdjustmentStatus(params: {
  companyId: string;
  id: string;
  status: 'active' | 'paused' | 'cancelled';
}): Promise<BillingAdjustment> {
  return invoke<{ data: BillingAdjustment }>('vihem-billing-adjustments', {
    action: 'update',
    company_id: params.companyId,
    id: params.id,
    status: params.status,
  }).then((res) => res.data);
}

export async function listActiveTenancies(companyId: string): Promise<TenancyOption[]> {
  const { data, error } = await supabase
    .from('vihem_tenancies')
    .select('id, tenant:tenant_id(name), apartment:apartment_id(apartment_number)')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw new AccountedIntegrationError('DB_READ_FAILED', error.message);
  return (data ?? []) as unknown as TenancyOption[];
}

// ── Tenant portal invoice view ────────────────────────────────────────────
// Accounted is the source of truth; this reads the same local cache table
// Finance V2's admin "Fakturor" tab reads, just scoped to the caller's own
// rows via the tenant-self-access RLS policy added in
// 20260821160000_accounted_v2_tenant_invoice_view.sql. No company selection
// needed -- RLS already limits rows to the tenant's own billing items.

export async function listMyRentInvoices(): Promise<AccountedInvoiceLink[]> {
  const { data, error } = await supabase
    .from('vihem_accounted_invoice_links')
    .select('*')
    .eq('source_type', 'rental_billing')
    .order('invoice_date', { ascending: false, nullsFirst: false });
  if (error) throw new AccountedIntegrationError('DB_READ_FAILED', error.message);
  return (data ?? []) as AccountedInvoiceLink[];
}

/**
 * Fetches the invoice PDF via vihem-accounted-tenant-invoices (the Accounted
 * API key never reaches the browser) and returns a blob: URL the caller can
 * open in a new tab or set as a download link's href. The caller is
 * responsible for revoking it (URL.revokeObjectURL) once no longer needed.
 */
export async function fetchMyInvoicePdfUrl(invoiceLinkId: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new AccountedIntegrationError('UNAUTHORIZED', 'Din inloggning kunde inte verifieras. Ladda om sidan och försök igen.');
  }

  const response = await fetch(
    `${supabaseUrl}/functions/v1/vihem-accounted-tenant-invoices?invoice_link_id=${encodeURIComponent(invoiceLinkId)}`,
    { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${session.access_token}` } },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new AccountedIntegrationError(
      body?.error?.code || 'PDF_FETCH_FAILED',
      body?.error?.message || 'Kunde inte hämta fakturan från Accounted.',
    );
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

// ── Scanner → Accounted (underlag) ───────────────────────────────────────
// VI-HEM's own scanner UI/OCR (legacy, in FinancePage.tsx) is untouched.
// This forwards a document to Accounted's invoice-inbox extension via email
// instead, so Accounted's own AI extraction handles it -- see
// docs/accounted-v2-integration.md "Scanner → Accounted".

/**
 * Uploads the file to the same vihem-documents bucket the legacy scanner
 * uses, then asks vihem-accounted-scanner-forward to email it to the
 * company's Accounted invoice-inbox address.
 */
export async function forwardScannedDocument(params: {
  organisationId: string;
  companyId: string;
  file: File;
}): Promise<AccountedScannerUpload> {
  const safeName = params.file.name.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'underlag';
  const storagePath = `${params.organisationId}/accounted-scanner/${crypto.randomUUID()}/${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from('vihem-documents')
    .upload(storagePath, params.file, { contentType: params.file.type || 'application/octet-stream' });
  if (uploadError) {
    throw new AccountedIntegrationError(
      'STORAGE_UPLOAD_FAILED',
      uploadError.message.toLowerCase().includes('bucket')
        ? 'Storage-bucketen vihem-documents saknas. Kör senaste Supabase-migreringarna först.'
        : uploadError.message,
    );
  }

  return invoke<{ data: AccountedScannerUpload }>('vihem-accounted-scanner-forward', {
    company_id: params.companyId,
    storage_path: storagePath,
    file_name: safeName,
    content_type: params.file.type || 'application/octet-stream',
  }).then((res) => res.data);
}

export async function listScannerUploads(companyLinkId: string): Promise<AccountedScannerUpload[]> {
  const { data, error } = await supabase
    .from('vihem_accounted_scanner_uploads')
    .select('*')
    .eq('company_link_id', companyLinkId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new AccountedIntegrationError('DB_READ_FAILED', error.message);
  return (data ?? []) as AccountedScannerUpload[];
}

// ── Avbetalningsplaner (legacy workflow, relocated into Finance V2) ─────
// InstallmentPlansPanel itself (src/components/InstallmentPlansPanel.tsx)
// is untouched -- it's shared with legacy FinancePage.tsx, still generates
// its own administrative "delfaktura" PDFs against legacy vihem_invoices
// (accounting_exportable is hard-locked to false at the DB level, so none
// of this ever reaches bookkeeping), and that mechanism is intentionally
// NOT being rewired to Accounted: per the original brief, an installment
// plan is a payment-tracking layer on top of already-existing debt, not a
// new invoice source. These three reads just reproduce the exact query
// shapes FinancePage.tsx already feeds the panel, so it renders identically
// from Finance V2.

export async function listCompaniesForInstallmentPlans(organisationId: string): Promise<FinanceCompany[]> {
  const { data, error } = await supabase
    .from('vihem_companies')
    .select('*')
    .eq('organisation_id', organisationId)
    .order('name', { ascending: true });
  if (error) throw new AccountedIntegrationError('DB_READ_FAILED', error.message);
  return (data ?? []) as FinanceCompany[];
}

export async function listFinanceCustomersForInstallmentPlans(organisationId: string): Promise<FinanceCustomer[]> {
  const { data, error } = await supabase
    .from('vihem_finance_customers')
    .select('*, company:company_id(*)')
    .eq('organisation_id', organisationId)
    .order('name', { ascending: true });
  if (error) throw new AccountedIntegrationError('DB_READ_FAILED', error.message);
  return (data ?? []) as unknown as FinanceCustomer[];
}

export async function listLegacyInvoicesForInstallmentPlans(organisationId: string): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('vihem_invoices')
    .select('*, company:company_id(*), customer:customer_id(*)')
    .eq('organisation_id', organisationId)
    .order('created_at', { ascending: false });
  if (error) throw new AccountedIntegrationError('DB_READ_FAILED', error.message);
  return (data ?? []) as unknown as Invoice[];
}
