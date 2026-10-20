// Ren hjälplogik för fakturamodulen (formatering, månadshantering, CSV). Testas i scripts/billing-format-check.mjs.
export type StatementLine = { kind: string; description: string; quantity: number; unit: string; unit_price: number; amount: number };
export type StatementInterpretation = { id: string; created_at: string; source: string; user_ref: string; file_name: string; pages: number; unit_price: number; amount: number };
export type StatementData = {
  period: string; vat_rate: number; lines: StatementLine[]; ai_interpretations: number; ai_pages: number;
  total_ex_vat: number; vat_amount: number; total_inc_vat: number;
  statement: { id: string; status: 'locked' | 'invoiced'; invoice_reference: string | null } | null;
  interpretations: StatementInterpretation[];
};

export const formatSek = (value: number) => `${Number(value).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;

export const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
export const monthStartDate = (key: string) => `${key}-01`;
export function previousMonth(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

const csvCell = (value: unknown) => {
  let text = String(value ?? '');
  // Skydd mot formelinjektion i kalkylblad.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const decimal = (value: number) => Number(value).toFixed(2).replace('.', ',');

export function statementCsv(customerName: string, data: StatementData): string {
  const rows: unknown[][] = [
    ['Fakturaunderlag', customerName, data.period],
    [],
    ['Post', 'Antal', 'Enhet', 'À-pris exkl. moms', 'Belopp exkl. moms'],
    ...data.lines.map((line) => [line.description, decimal(line.quantity), line.unit, decimal(line.unit_price), decimal(line.amount)]),
    [],
    ['Summa exkl. moms', '', '', '', decimal(data.total_ex_vat)],
    [`Moms ${data.vat_rate} %`, '', '', '', decimal(data.vat_amount)],
    ['Att fakturera', '', '', '', decimal(data.total_inc_vat)],
    [],
    ['Tolkningar', 'Tid', 'Användare', 'Fil', 'Sidor', 'Belopp exkl. moms'],
    ...data.interpretations.map((item) => ['', item.created_at, item.user_ref, item.file_name, item.pages, decimal(item.amount)]),
  ];
  return rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
}
