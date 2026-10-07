import type { RentOverview, RentInvoice, RentTenancy } from './types';
import type { AccountedInvoiceLink } from '../finance-v2/types';
export interface CustomerRow {
  key: string; name: string; email: string; phone: string; customerIds: string[];
  tenantIds: string[]; tenancies: RentTenancy[]; invoices: RentInvoice[]; accountedInvoices: AccountedInvoiceLink[];
}
// Explicit billing-item links outrank the same email matching the existing
// tenant-customer resolver uses. Never join different people by display name.
export function buildRentCustomers(data: RentOverview, invoiceCustomerIds: Record<string, string> = {}): CustomerRow[] {
  const rows = data.customers.map(c => ({ key: c.id, name: c.name, email: c.email, phone: c.phone, customerIds: [c.id], tenantIds: [] as string[], tenancies: [] as RentTenancy[], invoices: [] as RentInvoice[], accountedInvoices: [] as AccountedInvoiceLink[] }));
  for (const tenancy of data.tenancies) {
    const explicitIds = [...new Set(data.items.filter(i => i.tenant_id === tenancy.tenant_id && i.finance_customer_id).map(i => i.finance_customer_id!))];
    let row = explicitIds.length === 1 ? rows.find(r => r.customerIds.includes(explicitIds[0])) : undefined;
    if (!row && !explicitIds.length && tenancy.tenant?.email) {
      const candidates = data.customers.filter(c => c.customer_type === 'private' && c.email === tenancy.tenant!.email)
        .sort((a, b) => Number(b.company_id === data.companyId) - Number(a.company_id === data.companyId));
      if (candidates.length === 1 || (candidates.length > 1 && candidates[0].company_id === data.companyId && candidates[1].company_id !== data.companyId)) row = rows.find(r => r.key === candidates[0].id);
    }
    if (!row) row = rows.find(r => r.key === `tenant:${tenancy.tenant_id}`);
    if (!row) {
      row = { key: `tenant:${tenancy.tenant_id}`, name: tenancy.tenant?.name || 'Hyresgäst', email: tenancy.tenant?.email || '', phone: tenancy.tenant?.phone || '', customerIds: [], tenantIds: [], tenancies: [], invoices: [], accountedInvoices: [] };
      rows.push(row);
    }
    if (!row.tenantIds.includes(tenancy.tenant_id)) row.tenantIds.push(tenancy.tenant_id);
    row.tenancies.push(tenancy);
  }
  for (const row of rows) {
    const tenancyIds = row.tenancies.map(t => t.id);
    row.invoices = data.invoices.filter(i => (i.customer_id && row.customerIds.includes(i.customer_id)) || (i.tenancy_id && tenancyIds.includes(i.tenancy_id)));
    const accountedCustomerIds = data.customerLinks.filter(l => (l.source_type === 'finance_customer' && row.customerIds.includes(l.source_id)) || (l.source_type === 'tenant' && row.tenantIds.includes(l.source_id))).map(l => l.accounted_customer_id);
    const matching = data.accountedInvoices.filter(i => {
      if (invoiceCustomerIds[i.id] && accountedCustomerIds.includes(invoiceCustomerIds[i.id])) return true;
      return data.items.some(item => (item.id === i.source_id || item.accounted_invoice_link_id === i.id) && (tenancyIds.includes(item.tenancy_id) || (item.finance_customer_id && row.customerIds.includes(item.finance_customer_id))));
    });
    row.accountedInvoices = [...new Map(matching.map(i => [i.accounted_invoice_id, i])).values()];
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}
