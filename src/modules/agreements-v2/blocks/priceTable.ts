// Shared calculation for the `price_table` block (line items -> Netto /
// Moms / Öresavrundning / Total), used by both the block editor's live
// preview and BlockRenderer's read-only rendering. The PDF generator
// (_shared/agreement-pdf.ts, a separate Deno runtime) duplicates this same
// arithmetic rather than importing it -- small and pure enough that keeping
// two copies in sync is simpler than sharing a module across the
// browser/edge-function boundary.
export interface PriceTableItem {
  description: string;
  quantity: string;
  unit_price: string;
}

export interface PriceTableContent {
  price_form: 'fixed' | 'recurring';
  vat_rate: number;
  items: PriceTableItem[];
}

export interface PriceTableTotals {
  netto: number;
  moms: number;
  roundOff: number;
  total: number;
}

function toNumber(value: string | number | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function lineTotal(item: PriceTableItem): number {
  return toNumber(item.quantity) * toNumber(item.unit_price);
}

export function calcPriceTable(content: Partial<PriceTableContent>): PriceTableTotals {
  const items = Array.isArray(content.items) ? content.items : [];
  const netto = items.reduce((sum, item) => sum + lineTotal(item), 0);
  const vatRate = toNumber(content.vat_rate);
  const moms = netto * (vatRate / 100);
  const roundedTotal = Math.round(netto + moms);
  const roundOff = roundedTotal - (netto + moms);
  return { netto, moms, roundOff, total: roundedTotal };
}

export function formatSek(amount: number): string {
  return amount.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';
}
