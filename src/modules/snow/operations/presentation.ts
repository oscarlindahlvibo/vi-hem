import type { Batch } from "./types";
export const snowDateTime = (s: string) =>
  new Date(s).toLocaleString("sv-SE", {
    timeZone: "Europe/Stockholm",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const money = (n: number) =>
  Number(n).toLocaleString("sv-SE", { style: "currency", currency: "SEK" });
export function snowBatchCsv(batch: Batch) {
  const escape = (v: unknown) => {
    let value =
      typeof v === "number"
        ? v.toLocaleString("sv-SE", {
            useGrouping: false,
            maximumFractionDigits: 12,
          })
        : String(v ?? "");
    let probe = value;
    while (
      probe.length &&
      (probe.charCodeAt(0) <= 32 || probe[0].trim() === "")
    )
      probe = probe.slice(1);
    if (/^[=+\-@]/.test(probe)) value = "'" + value;
    return '"' + value.replace(/"/g, '""') + '"';
  };
  const rows = [
    [
      "Datum",
      "Uppdrag",
      "Maskin",
      "Förare",
      "Benämning",
      "Antal",
      "Enhet",
      "Pris ex moms",
      "Moms %",
      "Netto",
      "Moms",
      "Arbetskostnad RUT prövas",
    ],
    ...batch.snapshot.lines.map((l) => [
      l.date,
      l.assignment,
      l.resource,
      l.driver,
      l.description,
      l.quantity,
      l.unit,
      l.unit_price,
      l.vat_rate,
      l.net,
      l.vat,
      l.rut_requested && l.rut_eligible ? "Ja" : "Nej",
    ]),
    ["Summa netto", batch.snapshot.net],
    ["Moms", batch.snapshot.vat],
    ["Totalt", batch.snapshot.gross],
    ["Prövat RUT", batch.snapshot.rut],
    ["Kundens del", batch.snapshot.customer_payable],
  ];
  return "\ufeff" + rows.map((r) => r.map(escape).join(";")).join("\r\n");
}
function exportSnowBatch(batch: Batch) {
  const blob = new Blob([snowBatchCsv(batch)], {
      type: "text/csv;charset=utf-8",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `sno-underlag-${batch.id}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { money, exportSnowBatch };
export const options = (
  rows: { id: string; name: string }[],
  empty = "Välj…",
) => [
  { value: "", label: empty },
  ...rows.map((r) => ({ value: r.id, label: r.name })),
];
