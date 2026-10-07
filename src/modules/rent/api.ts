import { invoke } from '../finance-v2/api';
import { supabase, supabaseAnonKey, supabaseUrl } from '../../lib/supabase';
import type { FinanceCompany, Invoice, InvoiceLine } from '../../types';
import type { RentOverview, RentChange } from './types';
import { buildInvoicePdfBlob } from '../../lib/invoicePdf';
import { rentMoney as formatCurrency } from './money';

export const loadRentOverview = (companyId: string, period: string) => invoke<{ data: RentOverview }>('vihem-rent-overview', { action: 'overview', company_id: companyId, rent_period: period }).then(r => r.data);
export async function loadRentCompanies(organisationId: string): Promise<FinanceCompany[]> {
  const { data, error } = await supabase.from('vihem_companies').select('*').eq('organisation_id', organisationId).eq('active', true).order('name');
  if (error) throw error;
  return data || [];
}
export async function loadInvoiceCustomers(companyId: string, ids: string[]) {
  const result: { id: string; accounted_customer_id: string }[] = [];
  for (let offset = 0; offset < ids.length; offset += 20) {
    const response = await invoke<{ data: typeof result }>('vihem-rent-overview', { action: 'invoice_customers', company_id: companyId, invoice_link_ids: ids.slice(offset, offset + 20) });
    result.push(...response.data);
  }
  return result;
}
export async function saveRentChange(params: { organisationId: string; companyId: string; userId: string; tenancyId: string; kind: 'one_time' | 'recurring'; amount: number; description: string; startPeriod: string; endPeriod: string | null }): Promise<void> {
  const { error } = await supabase.from('vihem_rent_adjustments').insert({
    organisation_id: params.organisationId, company_id: params.companyId, tenancy_id: params.tenancyId,
    rent_period: params.startPeriod, adjustment_type: params.kind, start_period: params.startPeriod,
    end_period: params.kind === 'one_time' ? params.startPeriod : params.endPeriod,
    amount: params.amount, percentage_rate: 0, vat_rate: 0, description: params.description, status: 'active', created_by: params.userId,
  });
  if (error) throw error;
}
export async function cancelRentChange(companyId: string, change: RentChange) {
  const { error } = await supabase.from('vihem_rent_adjustments').update({ status: 'cancelled' }).eq('id', change.id).eq('company_id', companyId).eq('status', 'active');
  if (error) throw error;
}
export async function getRentInvoicePdf(companyId: string, invoiceId: string, accounted: boolean): Promise<Blob> {
  if (accounted) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Logga in igen för att öppna fakturan.');
    const response = await fetch(`${supabaseUrl}/functions/v1/vihem-rent-overview`, { method: 'POST', headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'invoice_pdf', company_id: companyId, invoice_link_id: invoiceId }) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error?.message || 'Kunde inte öppna fakturan.'); }
    return response.blob();
  }
  const { data, error } = await supabase.from('vihem_invoices').select('*,company:company_id(*),customer:customer_id(*)').eq('company_id', companyId).eq('id', invoiceId).single();
  if (error) throw error;
  const { data: lines, error: linesError } = await supabase.from('vihem_invoice_lines').select('*').eq('invoice_id', invoiceId).order('line_no');
  if (linesError) throw linesError;
  return buildInvoicePdfBlob({ invoice: data as Invoice, lines: (lines || []) as InvoiceLine[], formatCurrency });
}
