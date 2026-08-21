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
import { supabase } from '../../lib/supabase';
import type {
  AccountedApiErrorBody,
  AccountedCompanyLink,
  AccountedCustomerLink,
  AccountedCustomerSourceType,
  AccountedInvoiceLink,
  AccountedInvoiceSourceType,
} from './types';

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
}): Promise<AccountedCompanyLink> {
  return invoke<{ data: AccountedCompanyLink }>('vihem-accounted-admin', {
    action: 'save_company_link',
    company_id: params.companyId,
    accounted_base_url: params.accountedBaseUrl,
    accounted_company_id: params.accountedCompanyId,
    api_key: params.apiKey,
    enabled: params.enabled,
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
