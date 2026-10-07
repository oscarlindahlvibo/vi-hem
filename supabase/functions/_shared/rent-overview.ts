// Read-only rent projection. Existing prepared items are authoritative; for
// unprepared periods mirror vihem_create_rent_billing_run and its adjustment
// trigger. No run, customer, invoice or adjustment is written/consumed here.
export interface RentTenancy {
  id: string; tenant_id: string; apartment_id: string; company_id: string | null;
  start_date: string; end_date: string | null; status: string; monthly_rent: number; rent_vat_rate: number;
  tenant: { id: string; name: string; email: string; phone?: string } | null;
  apartment: { apartment_number: string; company_id: string | null; rent: number } | null;
  property: { name: string; address: string } | null;
}
export interface RentChange {
  id: string; tenancy_id?: string; target_id?: string; target_type?: string; company_id: string;
  adjustment_type: string; amount: number; percentage_rate?: number; vat_rate: number; description: string;
  status: string; rent_period?: string; start_period: string | null; end_period: string | null;
  max_occurrences?: number | null; applied_count?: number; last_applied_period?: string | null;
}
export interface RentItem {
  id: string; tenancy_id: string; tenant_id: string; finance_customer_id: string | null;
  rent_period: string; run_id: string; base_rent_amount: number; adjustment_amount: number;
  amount: number; vat_rate: number; total_amount: number; status: string;
  invoice_id: string | null; accounted_invoice_link_id: string | null;
}
export interface RentPreviewLine { id: string; description: string; amount: number; vat_rate: number; origin: 'rent' | 'billing'; }
export interface RentPreviewRow {
  tenancy_id: string; tenant_id: string; name: string; apartment: string; property: string;
  start_date: string; end_date: string | null; company_missing: boolean;
  item_id: string | null; run_id: string | null; state: string;
  base: number; deductions: number; additions: number; vat: number; total: number;
  lines: RentPreviewLine[]; warnings: string[];
}
const money = (n: number) => Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON * Math.max(1, Math.abs(n))) * 100) / 100;
export function rentChangeEligible(change: RentChange, period: string, kind: 'rent' | 'billing'): boolean {
  if (change.status !== 'active') return false;
  if (kind === 'rent' && change.adjustment_type === 'one_time') return change.rent_period === period;
  if ((change.start_period || change.rent_period || '9999') > period || (change.end_period && change.end_period < period)) return false;
  if (kind === 'billing') {
    if (change.last_applied_period === period) return false;
    if (change.max_occurrences != null && (change.applied_count || 0) >= change.max_occurrences) return false;
  }
  return true;
}
export function previewRent(params: { companyId: string; period: string; tenancies: RentTenancy[]; items: RentItem[]; rentChanges: RentChange[]; billingChanges: RentChange[]; accountedEnabled: boolean }): RentPreviewRow[] {
  const { companyId, period, items, rentChanges, billingChanges, accountedEnabled } = params;
  return params.tenancies.filter(t => {
    const company = t.company_id || t.apartment?.company_id || companyId;
    return (company === companyId && ['active', 'terminated'].includes(t.status) && t.start_date <= period && (!t.end_date || t.end_date >= period)) || items.some(i => i.tenancy_id === t.id && i.rent_period === period);
  }).map(t => {
    const item = items.find(i => i.tenancy_id === t.id && i.rent_period === period);
    const state = item?.invoice_id || item?.accounted_invoice_link_id || item?.status === 'invoiced' ? 'invoiced' : item?.status || 'unprepared';
    const base = Number(item ? (Number(item.base_rent_amount) || Number(item.amount)) : (Number(t.monthly_rent) || Number(t.apartment?.rent) || 0));
    const vatRate = Number(item?.vat_rate ?? t.rent_vat_rate ?? 0);
    const lines: RentPreviewLine[] = rentChanges.filter(c => c.company_id === companyId && c.tenancy_id === t.id && rentChangeEligible(c, period, 'rent')).map(c => ({
      id: c.id, description: c.description, amount: money(Number(c.amount) + (c.adjustment_type === 'indexed' ? money(base * Number(c.percentage_rate || 0) / 100) : 0)), vat_rate: vatRate, origin: 'rent',
    }));
    const warnings: string[] = [];
    const companyMissing = !t.company_id && !t.apartment?.company_id;
    if (companyMissing) warnings.push('Hyresförhållandet och lägenheten saknar bolagskoppling. Kontrollera bolag före körningen.');
    if (state === 'invoiced' || state === 'skipped' || state === 'cancelled') {
      return { tenancy_id: t.id, tenant_id: t.tenant_id, name: t.tenant?.name || 'Hyresgäst', apartment: t.apartment?.apartment_number || '', property: t.property?.name || '', start_date: t.start_date, end_date: t.end_date, company_missing: companyMissing, item_id: item!.id, run_id: item!.run_id, state, base, deductions: 0, additions: 0, vat: Number(item!.total_amount) - Number(item!.amount), total: Number(item!.total_amount), lines: [], warnings };
    }
    const rentTotal = money(lines.reduce((sum, l) => sum + l.amount, 0));
    if (item && Math.abs(Number(item.adjustment_amount) - rentTotal) > 0.01) warnings.push('Sparad körning skiljer sig från aktuella hyresjusteringar. Sparat underlag används.');
    const billing = billingChanges.filter(c => c.company_id === companyId && c.target_type === 'tenancy' && c.target_id === t.id && rentChangeEligible(c, period, 'billing'));
    if (accountedEnabled) lines.push(...billing.map(c => ({ id: c.id, description: c.description, amount: Number(c.amount), vat_rate: Number(c.vat_rate), origin: 'billing' as const })));
    else if (billing.length) warnings.push('Det finns avdrag/tillägg från Ekonomi V2 som kräver en aktiv Accounted-koppling. De ingår inte i totalsumman.');
    const amount = Number(item?.amount ?? money(base + rentTotal));
    const baseVat = item ? money(Number(item.total_amount) - amount) : money(amount * vatRate / 100);
    const extra = accountedEnabled ? billing.reduce((sum, c) => sum + Number(c.amount), 0) : 0;
    const extraVat = accountedEnabled ? billing.reduce((sum, c) => sum + money(Number(c.amount) * Number(c.vat_rate) / 100), 0) : 0;
    const total = money(amount + baseVat + extra + extraVat);
    if (amount + baseVat <= 0 || total <= 0) warnings.push('Beloppet kan inte faktureras med den ordinarie hyreskörningen. Granska underlaget.');
    return { tenancy_id: t.id, tenant_id: t.tenant_id, name: t.tenant?.name || 'Hyresgäst', apartment: t.apartment?.apartment_number || '', property: t.property?.name || '', start_date: t.start_date, end_date: t.end_date, company_missing: companyMissing, item_id: item?.id || null, run_id: item?.run_id || null, state, base, deductions: money(lines.filter(l => l.amount < 0).reduce((sum, l) => sum + l.amount, 0)), additions: money(lines.filter(l => l.amount > 0).reduce((sum, l) => sum + l.amount, 0)), vat: money(baseVat + extraVat), total, lines, warnings };
  }).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}
