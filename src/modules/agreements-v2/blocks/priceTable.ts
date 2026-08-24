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

/** A `package_option` block's content is a `price_table` (same items/
 * price_form/rut_rate/rot_rate shape, so `calcPriceTable` works on it
 * unchanged) plus a title/description and whether it's pre-checked when a
 * signer first sees the document. */
export interface PackageOptionContent extends PriceTableContent {
  title: string;
  description: string;
  selected_by_default: boolean;
}

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

export interface DocumentAddonTotal {
  blockId: string;
  title: string;
  amount: number;
  selected: boolean;
}

export interface DocumentTotals {
  /** False when the document has no price/price_table/package_option
   * blocks at all -- callers use this to decide whether to show a summary
   * footer, rather than always showing "Totalt: 0,00 kr". */
  hasPricing: boolean;
  /** Sum of every `price` and `price_table` block -- the parts of the
   * document that aren't opt-in. */
  base: number;
  /** One entry per `package_option` block, selected or not, so a caller
   * can render "vad som INTE valdes" too if useful. */
  addons: DocumentAddonTotal[];
  addonsTotal: number;
  grandTotal: number;
}

/** Walks the whole block list once to total the base (non-optional)
 * pricing plus whichever `package_option` blocks are currently selected --
 * "grundkostnad + valda tillägg = totalt", the sum a signer actually sees
 * change as they toggle add-ons on/off. `isSelected` is injected rather
 * than read off a fixed field because the browser (live, per-signer
 * toggle state) and the PDF generator (a fixed, already-decided selection
 * frozen at completion time) resolve "selected" completely differently. */
export function calcDocumentTotals(
  blocks: { id: string; block_type: string; content: any }[],
  isSelected: (blockId: string, content: any) => boolean,
): DocumentTotals {
  let base = 0;
  let hasPricing = false;
  const addons: DocumentAddonTotal[] = [];
  for (const block of blocks) {
    if (block.block_type === 'price') {
      hasPricing = true;
      const n = Number(String(block.content?.amount ?? '').replace(',', '.'));
      base += Number.isFinite(n) ? n : 0;
    } else if (block.block_type === 'price_table') {
      hasPricing = true;
      base += calcPriceTable(block.content || {}).amountToPay;
    } else if (block.block_type === 'package_option') {
      hasPricing = true;
      addons.push({
        blockId: block.id,
        title: block.content?.title || 'Valbart tillägg',
        amount: calcPriceTable(block.content || {}).amountToPay,
        selected: isSelected(block.id, block.content),
      });
    }
  }
  const addonsTotal = addons.filter((a) => a.selected).reduce((sum, a) => sum + a.amount, 0);
  return { hasPricing, base, addons, addonsTotal, grandTotal: base + addonsTotal };
}
