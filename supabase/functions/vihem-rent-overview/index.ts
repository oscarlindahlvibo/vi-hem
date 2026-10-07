import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, corsHeaders, errorJson, isAuthContext, json, requireCompanyAccess } from '../_shared/vihem-auth.ts';
import { previewRent, filterRentInvoices } from '../_shared/rent-overview.ts';
import { loadAccountedCompanyContext } from '../_shared/accounted-company-context.ts';
import { createAccountedClient } from '../_shared/accounted-rest-client.ts';

// Paginate every collection: invoice/customer history must not silently stop
// at PostgREST's server row limit. Queries have a stable unique ordering.
async function all(query: () => any): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query().order('id').range(offset, offset + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if ((data || []).length < 500) return rows;
  }
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return errorJson('METHOD_NOT_ALLOWED', 'Endast POST stöds.', 405);
  const auth = await authenticate(req);
  if (!isAuthContext(auth)) return auth;
  let body: any;
  try { body = await req.json(); } catch { return errorJson('VALIDATION_ERROR', 'Ogiltig JSON.', 400); }
  const companyId = String(body.company_id || '');
  if (!companyId) return errorJson('VALIDATION_ERROR', 'Välj bolag.', 400);
  const denied = await requireCompanyAccess(auth, companyId, 'viewer');
  if (denied) return denied;
  const db = auth.adminClient;
  try {
    const { data: company, error: companyError } = await db.from('vihem_companies').select('id, organisation_id, name').eq('id', companyId).maybeSingle();
    if (companyError || !company) return errorJson('NOT_FOUND', 'Bolaget hittades inte.', 404);
    const { data: companyLink, error: linkError } = await db.from('vihem_accounted_company_links').select('id, company_id, enabled').eq('company_id', companyId).maybeSingle();
    if (linkError) throw linkError;
    if (body.action === 'invoice_customers') {
      if (!companyLink) return json({ data: [] });
      const ids = Array.isArray(body.invoice_link_ids) ? body.invoice_link_ids.map(String) : [];
      if (ids.length > 20 || ids.some((id: string) => !/^[a-f0-9-]{36}$/i.test(id))) return errorJson('VALIDATION_ERROR', 'Högst 20 giltiga fakturor per begäran.', 400);
      if (!ids.length) return json({ data: [] });
      const { data: links, error } = await db.from('vihem_accounted_invoice_links').select('id,accounted_invoice_id').eq('company_link_id', companyLink.id).eq('source_type', 'rental_billing').in('id', ids);
      if (error) throw error;
      const context = await loadAccountedCompanyContext(db, companyId);
      const client = createAccountedClient({ baseUrl: context.link.accounted_base_url, apiKey: context.apiKey });
      const data = [];
      // Small batches avoid exhausting the runtime or overwhelming Accounted.
      for (let offset = 0; offset < (links || []).length; offset += 4) {
        const batch = await Promise.all((links || []).slice(offset, offset + 4).map(async link => {
          const invoice = await client.get<any>(`/api/v1/companies/${encodeURIComponent(context.link.accounted_company_id)}/invoices/${encodeURIComponent(link.accounted_invoice_id)}`);
          return { id: link.id, accounted_customer_id: String(invoice.customer_id || invoice.customer?.id || '') };
        }));
        data.push(...batch);
      }
      return json({ data });
    }
    if (body.action === 'invoice_pdf') {
      if (!companyLink) return errorJson('NOT_FOUND', 'Bolaget saknar fakturakoppling.', 404);
      const { data: invoice, error } = await db.from('vihem_accounted_invoice_links').select('accounted_invoice_id').eq('id', String(body.invoice_link_id || '')).eq('company_link_id', companyLink.id).eq('source_type', 'rental_billing').maybeSingle();
      if (error || !invoice) return errorJson('NOT_FOUND', 'Fakturan hittades inte.', 404);
      const context = await loadAccountedCompanyContext(db, companyId);
      const client = createAccountedClient({ baseUrl: context.link.accounted_base_url, apiKey: context.apiKey });
      const pdf = await client.getBinary(`/api/v1/companies/${encodeURIComponent(context.link.accounted_company_id)}/invoices/${encodeURIComponent(invoice.accounted_invoice_id)}/pdf`);
      return new Response(pdf.bytes, { headers: { ...corsHeaders, 'Content-Type': pdf.contentType, 'Cache-Control': 'private, no-store' } });
    }
    if (body.action && body.action !== 'overview') return errorJson('VALIDATION_ERROR', 'Okänd åtgärd.', 400);
    const period = String(body.rent_period || '');
    if (!/^\d{4}-\d{2}-01$/.test(period) || !Number.isFinite(Date.parse(period)) || new Date(period).toISOString().slice(0, 10) !== period) return errorJson('VALIDATION_ERROR', 'Välj en giltig hyresmånad.', 400);
    const results = await Promise.all([
      all(() => db.from('vihem_tenancies').select('id,tenant_id,apartment_id,company_id,start_date,end_date,status,monthly_rent,rent_vat_rate,tenant:tenant_id(id,name,email,phone),apartment:apartment_id(apartment_number,company_id,rent),property:property_id(name,address)').eq('organisation_id', company.organisation_id)),
      all(() => db.from('vihem_finance_customers').select('id,company_id,customer_type,name,email,phone,invoice_email,active').eq('organisation_id', company.organisation_id).or(`company_id.eq.${companyId},company_id.is.null`)),
      all(() => db.from('vihem_invoices').select('id,customer_id,tenancy_id,invoice_number,invoice_date,due_date,currency,status,payment_status,total_amount,paid_amount,balance_due,source_type,source_id,original_invoice_id').eq('company_id', companyId)),
      all(() => db.from('vihem_rent_billing_items').select('id,tenancy_id,tenant_id,finance_customer_id,rent_period,run_id,base_rent_amount,adjustment_amount,amount,vat_rate,total_amount,status,invoice_id,accounted_invoice_link_id').eq('company_id', companyId)),
      all(() => db.from('vihem_rent_adjustments').select('*').eq('company_id', companyId)),
      all(() => db.from('vihem_billing_adjustments').select('*').eq('company_id', companyId).eq('target_type', 'tenancy')),
      companyLink ? all(() => db.from('vihem_accounted_invoice_links').select('*').eq('company_link_id', companyLink.id)) : Promise.resolve([]),
      all(() => db.from('vihem_rent_billing_runs').select('id,rent_period,status,due_date').eq('company_id', companyId).eq('rent_period', period)),
      companyLink ? all(() => db.from('vihem_accounted_customer_links').select('id,source_type,source_id,accounted_customer_id').eq('company_link_id', companyLink.id)) : Promise.resolve([]),
    ]);
    const [allTenancies, allCustomers, allInvoices, items, rentChanges, billingChanges, allAccountedInvoices, runs, customerLinks] = results;
    const tenancies = allTenancies.filter(t => (t.company_id || t.apartment?.company_id || companyId) === companyId || items.some(i => i.tenancy_id === t.id));
    const invoices = filterRentInvoices(allInvoices);
    const accountedInvoices = allAccountedInvoices.filter(i => i.source_type === 'rental_billing');
    const customerIds = new Set([...invoices.map(i => i.customer_id), ...items.map(i => i.finance_customer_id)].filter(Boolean));
    const tenantEmails = new Set(tenancies.map(t => t.tenant?.email).filter(Boolean));
    const customers = allCustomers.filter(c => customerIds.has(c.id) || (c.customer_type === 'private' && c.email && tenantEmails.has(c.email)));
    const preview = previewRent({ companyId, period, tenancies, items, rentChanges, billingChanges, accountedEnabled: Boolean(companyLink?.enabled) });
    // Source links (one row per source) preserve collection invoices. Dedupe
    // only in the customer UI after resolving every linked rent item.
    return json({ data: { companyId, period, tenancies, customers, invoices, items, rentChanges, billingChanges, accountedInvoices, customerLinks, runs, companyLink, preview, fetchedAt: new Date().toISOString() } });
  } catch (error) { return errorJson('RENT_OVERVIEW_FAILED', error instanceof Error ? error.message : 'Kunde inte läsa hyresunderlaget.', 500); }
});
