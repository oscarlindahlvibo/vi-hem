// Shared calculation for the `price_table` block (line items -> Netto /
// Moms / Öresavrundning / Total, plus optional RUT/ROT-avdrag), used by
// both the block editor's live preview and BlockRenderer's read-only
// rendering. The PDF generator (_shared/agreement-pdf.ts, a separate Deno
// runtime) duplicates this same arithmetic rather than importing it --
// small and pure enough that keeping two copies in sync is simpler than
// sharing a module across the browser/edge-function boundary.
export interface PriceTableItem {
  description: string;
  quantity: string;
  unit_price: string;
  /** Whether this row's labour cost counts toward the RUT/ROT deduction
   * base -- Skatteverket only allows the deduction on labour, never on
   * materials, so this must stay opt-in per row rather than applying to
   * the whole invoice. Meaningless when deduction_type is 'none'. */
  deduction_eligible?: boolean;
}

export type DeductionType = 'none' | 'rut' | 'rot';

export interface PriceTableContent {
  price_form: 'fixed' | 'recurring';
  vat_rate: number;
  items: PriceTableItem[];
  deduction_type: DeductionType;
  /** Percent, editable rather than hardcoded: RUT/ROT rates are set by
   * government budget decisions and change over time, so this module
   * offers a sensible starting default (see DEFAULT_DEDUCTION_RATE) but
   * never asserts it as authoritative -- staff must confirm the current
   * rate with Skatteverket before sending. */
  deduction_rate: number;
  /** The buyer's personnummer -- required by Skatteverket for a RUT/ROT
   * claim (deductions only apply to private individuals, never
   * organisations). Kept on the block itself rather than derived from a
   * party/signer field so it works even for a quote with no signer set up
   * yet. */
  deduction_personal_number: string;
}

export const DEFAULT_DEDUCTION_RATE: Record<DeductionType, number> = { none: 0, rut: 50, rot: 30 };

export interface PriceTableTotals {
  netto: number;
  moms: number;
  roundOff: number;
  /** Gross total before any RUT/ROT deduction is applied. */
  total: number;
  /** Labour cost (incl. moms) among rows marked deduction_eligible -- the
   * base Skatteverket calculates the deduction percentage against. */
  deductionBase: number;
  /** deductionBase * deduction_rate / 100. Zero when deduction_type is 'none'. */
  deductionAmount: number;
  /** What the customer actually pays: total - deductionAmount. Equal to
   * `total` when there's no deduction. */
  amountToPay: number;
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

  const deductionType = content.deduction_type || 'none';
  const eligibleNetto = deductionType === 'none' ? 0 : items.reduce((sum, item) => sum + (item.deduction_eligible ? lineTotal(item) : 0), 0);
  const deductionBase = eligibleNetto * (1 + vatRate / 100);
  const deductionRate = deductionType === 'none' ? 0 : toNumber(content.deduction_rate);
  const deductionAmount = deductionBase * (deductionRate / 100);
  const amountToPay = roundedTotal - deductionAmount;

  return { netto, moms, roundOff, total: roundedTotal, deductionBase, deductionAmount, amountToPay };
}

export function formatSek(amount: number): string {
  return amount.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';
}
