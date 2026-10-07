import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
async function actualModule(path) {
  const text = await readFile(new URL(path, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  if (path.endsWith('/customers.ts')) {
    const core = await readFile(new URL('../supabase/functions/_shared/rent-overview.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(core, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    outputText = outputText.replace('../../../supabase/functions/_shared/rent-overview', `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { previewRent, rentChangeEligible, filterRentInvoices } = await actualModule('../supabase/functions/_shared/rent-overview.ts');
const { rentMoney } = await actualModule('../src/modules/rent/money.ts');
assert.ok(rentMoney(-500.5).includes('500,50'));
const { buildRentCustomers } = await actualModule('../src/modules/rent/customers.ts');
const tenant = { id: 'lease', tenant_id: 'tenant', company_id: 'company', start_date: '2026-01-01', end_date: null, status: 'active', monthly_rent: 8550, rent_vat_rate: 0, tenant: { id: 'tenant', name: 'Exempel', email: 'tenant@example.test' }, apartment: { apartment_number: '1004', company_id: 'company', rent: 8550 }, property: { name: 'Fastighet' } };
const base = { companyId: 'company', period: '2026-12-01', tenancies: [tenant], items: [], rentChanges: [], billingChanges: [], accountedEnabled: true };
const rentChange = { id: 'change', company_id: 'company', tenancy_id: 'lease', adjustment_type: 'recurring', amount: 350, status: 'active', start_period: '2026-12-01', end_period: null, description: 'Internet', vat_rate: 0 };
const billingChange = { ...rentChange, id: 'v2', tenancy_id: undefined, target_type: 'tenancy', target_id: 'lease', adjustment_type: 'one_time', amount: -500, max_occurrences: 1, applied_count: 0, last_applied_period: null };
const input = { ...base, rentChanges: [rentChange, { ...rentChange, id: 'washer', amount: 500 }, { ...rentChange, id: 'tv', amount: 250 }], billingChanges: [billingChange] };
const unchanged = JSON.stringify(input);
const projected = previewRent(input)[0];
assert.equal(projected.base, 8550); assert.equal(projected.additions, 1100); assert.equal(projected.deductions, -500); assert.equal(projected.total, 9150);
assert.equal(JSON.stringify(input), unchanged, 'Preview consumed or mutated input');
assert.equal(previewRent({ ...base, tenancies: [{ ...tenant, status: 'terminated', end_date: '2026-12-31' }] }).length, 1);
assert.equal(previewRent({ ...base, tenancies: [{ ...tenant, status: 'terminated', end_date: '2026-11-30' }] }).length, 0);
assert.equal(previewRent({ ...base, tenancies: [{ ...tenant, start_date: '2026-12-14' }] }).length, 0);
assert.equal(previewRent({ ...base, tenancies: [{ ...tenant, company_id: 'other' }] }).length, 0);
assert.equal(previewRent({ ...base, tenancies: [{ ...tenant, company_id: null, apartment: { ...tenant.apartment, company_id: null } }] })[0].company_missing, true);
for (const change of [{ ...billingChange, status: 'completed' }, { ...billingChange, status: 'paused' }, { ...billingChange, last_applied_period: '2026-12-01' }, { ...billingChange, applied_count: 1 }, { ...billingChange, start_period: '2027-01-01' }, { ...billingChange, end_period: '2026-11-01' }]) assert.equal(rentChangeEligible(change, base.period, 'billing'), false);
assert.equal(rentChangeEligible({ ...rentChange, adjustment_type: 'one_time', rent_period: '2026-11-01' }, base.period, 'rent'), false);
const noAccounted = previewRent({ ...input, accountedEnabled: false })[0]; assert.equal(noAccounted.total, 9650); assert.ok(noAccounted.warnings.some(w => w.includes('Accounted')));
const item = { id: 'item', tenancy_id: 'lease', tenant_id: 'tenant', finance_customer_id: 'customer', run_id: 'run', rent_period: base.period, status: 'draft', base_rent_amount: 8550, adjustment_amount: 0, amount: 8550, vat_rate: 0, total_amount: 8550, invoice_id: null, accounted_invoice_link_id: null };
const stale = previewRent({ ...base, items: [item], rentChanges: [rentChange] })[0]; assert.equal(stale.total, 8550); assert.ok(stale.warnings.length);
const billed = previewRent({ ...input, items: [{ ...item, status: 'invoiced', accounted_invoice_link_id: 'invoice' }] })[0]; assert.equal(billed.state, 'invoiced'); assert.equal(billed.lines.length, 0);
const negativeVat = previewRent({ ...base, billingChanges: [{ ...billingChange, amount: -0.02, vat_rate: 25 }] })[0]; assert.equal(negativeVat.vat, -0.01);
const snapshot = { ...input, customers: [{ id: 'customer', company_id: 'company', customer_type: 'private', name: 'Exempel', email: tenant.tenant.email }, { id: 'project-only', company_id: 'company', name: 'Annan kund', email: '', customer_type: 'company' }], tenancies: [tenant, { ...tenant, id: 'lease2', apartment: { ...tenant.apartment, apartment_number: '1005' } }], items: [item, { ...item, id: 'item2', tenancy_id: 'lease2' }], invoices: [{ id: 'legacy', customer_id: 'customer', source_type: 'rent_billing' }], accountedInvoices: [{ id: 'link1', accounted_invoice_id: 'collection', source_id: 'item', source_type: 'rental_billing' }, { id: 'link2', accounted_invoice_id: 'collection', source_id: 'item2', source_type: 'rental_billing' }, { id: 'manual', accounted_invoice_id: 'manual-invoice', source_id: 'manual-source', source_type: 'rental_billing' }], customerLinks: [{ source_type: 'finance_customer', source_id: 'customer', accounted_customer_id: 'acc-customer' }] };
const rows = buildRentCustomers(snapshot, { manual: 'acc-customer' });
assert.equal(rows.length, 1); assert.equal(rows.find(r => r.key === 'customer').tenancies.length, 2); assert.equal(rows.find(r => r.key === 'customer').accountedInvoices.length, 2); assert.equal(rows.find(r => r.key === 'customer').invoices.length, 1);
console.log('Rent module checks passed: both adjustment sources, read-only preview, notice/end dates, future starts, company scope, consumption, saved snapshots, VAT rounding, all customers and collection invoice deduplication.');

const sources = [
 { id: 'rent', source_type: 'rent_billing' },
 { id: 'installment', source_type: 'installment_plan', tenancy_id: 'lease' },
 { id: 'hostel', source_type: 'short_stay' },
 { id: 'hostel-credit', source_type: 'credit_invoice', original_invoice_id: 'hostel' },
 { id: 'rent-credit', source_type: 'credit_invoice', original_invoice_id: 'rent' },
 { id: 'credit-chain', source_type: 'credit_invoice', source_id: 'rent-credit' },
 { id: 'project', source_type: 'customer_project' },
 { id: 'manual-rent', source_type: 'manual', tenancy_id: 'lease' },
];
assert.deepEqual(filterRentInvoices(sources).map(i => i.id), ['rent','rent-credit','credit-chain','manual-rent']);
const mixed = { ...snapshot, customers: [...snapshot.customers, { id: 'therese', name: 'Exempel avbetalning', customer_type: 'private' }, { id: 'jonas', name: 'Exempel vandrarhem', customer_type: 'private' }], invoices: [...snapshot.invoices, { id: 'inst', customer_id: 'therese', source_type: 'installment_plan' }, { id: 'hostel', customer_id: 'jonas', source_type: 'short_stay' }, { id: 'hostel-credit', customer_id: 'jonas', source_type: 'credit_invoice', original_invoice_id: 'hostel' }], accountedInvoices: [...snapshot.accountedInvoices, { id: 'project-link', source_type: 'customer_project', accounted_invoice_id: 'project-invoice', source_id: 'item' }] };
const scoped = buildRentCustomers(mixed, { manual: 'acc-customer' });
assert.ok(scoped.every(r => !['therese','jonas','project-only'].includes(r.key)));
assert.equal(scoped[0].invoices.length, 1);
assert.equal(scoped[0].accountedInvoices.length, 2);
console.log('PASS: installment documents, hostel receipts/credits and unrelated customers excluded; actual rent originals and rent credits retained.');
