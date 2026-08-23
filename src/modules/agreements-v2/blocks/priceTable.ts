// Shared calculation for the `price_table` block (line items -> Netto /
// Moms / Öresavrundning / Total, plus optional RUT/ROT-avdrag), used by
// both the block editor's live preview and BlockRenderer's read-only
// rendering. The PDF generator (_shared/agreement-pdf.ts, a separate Deno
// runtime) duplicates this same arithmetic rather than importing it --
// small and pure enough that keeping two copies in sync is simpler than
// sharing a module across the browser/edge-function boundary.
export type DeductionType = 'none' | 'rut' | 'rot';

export interface PriceTableItem {
  description: string;
  quantity: string;
  unit_price: string;
  /** Per-item, not per-block: a single quote can genuinely mix RUT-eligible
   * rows (e.g. cleanup) with ROT-eligible rows (e.g. renovation) with
   * regular rows in between (materials) -- Skatteverket calculates each
   * deduction separately against only the rows that actually qualify for
   * it, never against the invoice as a whole. */
  deduction_type?: DeductionType;
}

export interface PriceTableContent {
  price_form: 'fixed' | 'recurring';
  vat_rate: number;
  items: PriceTableItem[];
  /** Percent, editable rather than hardcoded: RUT/ROT rates are set by
   * government budget decisions and change over time, so this module
   * offers a sensible starting default (see DEFAULT_DEDUCTION_RATE) but
   * never asserts it as authoritative -- staff must confirm the current
   * rate with Skatteverket before sending. */
  rut_rate: number;
  rot_rate: number;
  /** The buyer's personnummer -- required by Skatteverket for a RUT/ROT
   * claim (deductions only apply to private individuals, never
   * organisations). Kept on the block itself rather than derived from a
   * party/signer field so it works even for a quote with no signer set up
   * yet. One buyer per document, so this stays block-level even though the
   * deduction type itself is now per item. */
  deduction_personal_number: string;
}

export const DEFAULT_DEDUCTION_RATE: Record<DeductionType, number> = { none: 0, rut: 50, rot: 30 };

export interface PriceTableTotals {
  netto: number;
  moms: number;
  roundOff: number;
  /** Gross total before any RUT/ROT deduction is applied. */
  total: number;
  rutBase: number;
  rutAmount: number;
  rotBase: number;
  rotAmount: number;
  /** What the customer actually pays: total - rutAmount - rotAmount. Equal
   * to `total` when no item has a deduction type set. */
  amountToPay: number;
}

function toNumber(value: string | number | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function lineTotal(item: Pick<PriceTableItem, 'quantity' | 'unit_price'>): number {
  return toNumber(item.quantity) * toNumber(item.unit_price);
}

export function calcPriceTable(content: Partial<PriceTableContent>): PriceTableTotals {
  const items = Array.isArray(content.items) ? content.items : [];
  const netto = items.reduce((sum, item) => sum + lineTotal(item), 0);
  const vatRate = toNumber(content.vat_rate);
  const moms = netto * (vatRate / 100);
  const roundedTotal = Math.round(netto + moms);
  const roundOff = roundedTotal - (netto + moms);

  const nettoFor = (type: DeductionType) => items.reduce((sum, item) => sum + (item.deduction_type === type ? lineTotal(item) : 0), 0);
  const rutBase = nettoFor('rut') * (1 + vatRate / 100);
  const rotBase = nettoFor('rot') * (1 + vatRate / 100);
  const rutAmount = rutBase * (toNumber(content.rut_rate) / 100);
  const rotAmount = rotBase * (toNumber(content.rot_rate) / 100);
  const amountToPay = roundedTotal - rutAmount - rotAmount;

  return { netto, moms, roundOff, total: roundedTotal, rutBase, rutAmount, rotBase, rotAmount, amountToPay };
}

export function formatSek(amount: number): string {
  return amount.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';
}
