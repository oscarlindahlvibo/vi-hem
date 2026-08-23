// Shared calculation for the `price_table` block (line items -> Netto /
// Moms / Öresavrundning / Total, plus optional RUT/ROT-avdrag), used by
// both the block editor's live preview and BlockRenderer's read-only
// rendering. The PDF generator (_shared/agreement-pdf.ts, a separate Deno
// runtime) duplicates this same arithmetic rather than importing it --
// small and pure enough that keeping two copies in sync is simpler than
// sharing a module across the browser/edge-function boundary.
export type DeductionType = 'none' | 'rut' | 'rot';

export const VAT_RATES = [25, 12, 6, 0] as const;
export const DEFAULT_VAT_RATE = 25;

export interface PriceTableItem {
  description: string;
  quantity: string;
  unit_price: string;
  /** Per item, not per block -- a single quote can genuinely mix VAT rates
   * (e.g. 25% goods with a 12% catering line), so each row prices and
   * taxes itself independently rather than sharing one rate. */
  vat_rate: number;
  /** Per item, not per block: a single quote can genuinely mix RUT-eligible
   * rows (e.g. cleanup) with ROT-eligible rows (e.g. renovation) with
   * regular rows in between (materials) -- Skatteverket calculates each
   * deduction separately against only the rows that actually qualify for
   * it, never against the invoice as a whole. */
  deduction_type?: DeductionType;
}

export interface PriceTableContent {
  price_form: 'fixed' | 'recurring';
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

/** Reads a row's VAT rate with a fallback for rows saved before per-item
 * VAT existed (block used to carry a single `vat_rate` -- old content
 * objects may still have that key sitting unused alongside items that
 * predate this field). Never throws on old data, just assumes the
 * standard rate. */
function itemVatRate(item: Pick<PriceTableItem, 'vat_rate'> & { vat_rate?: unknown }): number {
  return item.vat_rate === undefined || item.vat_rate === null ? DEFAULT_VAT_RATE : toNumber(item.vat_rate as number);
}

export function lineTotal(item: Pick<PriceTableItem, 'quantity' | 'unit_price'>): number {
  return toNumber(item.quantity) * toNumber(item.unit_price);
}

export function lineMoms(item: Pick<PriceTableItem, 'quantity' | 'unit_price' | 'vat_rate'>): number {
  return lineTotal(item) * (itemVatRate(item) / 100);
}

export function calcPriceTable(content: Partial<PriceTableContent>): PriceTableTotals {
  const items = Array.isArray(content.items) ? content.items : [];
  const netto = items.reduce((sum, item) => sum + lineTotal(item), 0);
  const moms = items.reduce((sum, item) => sum + lineMoms(item), 0);
  const roundedTotal = Math.round(netto + moms);
  const roundOff = roundedTotal - (netto + moms);

  const baseFor = (type: DeductionType) =>
    items.reduce((sum, item) => sum + (item.deduction_type === type ? lineTotal(item) + lineMoms(item) : 0), 0);
  const rutBase = baseFor('rut');
  const rotBase = baseFor('rot');
  const rutAmount = rutBase * (toNumber(content.rut_rate) / 100);
  const rotAmount = rotBase * (toNumber(content.rot_rate) / 100);
  const amountToPay = roundedTotal - rutAmount - rotAmount;

  return { netto, moms, roundOff, total: roundedTotal, rutBase, rutAmount, rotBase, rotAmount, amountToPay };
}

export function formatSek(amount: number): string {
  return amount.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';
}
