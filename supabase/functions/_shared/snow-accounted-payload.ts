export interface SnowLine {
  description: string;
  assignment?: string;
  date?: string;
  quantity: number;
  unit: string;
  unit_price: number;
  vat_rate: number;
  kind: string;
  rut_eligible: boolean;
  rut_requested: boolean;
  labor_hours: number;
}
export interface SnowInvoiceSnapshot {
  invoice_date: string;
  due_date: string;
  lines: SnowLine[];
  rut: number;
  tax?: { personnummer?: string; housing?: string };
}
/** Matches the running Accounted v1 draft contract. Never send self-billing or send/post actions. */
export function snowAccountedPayload(
  snapshot: SnowInvoiceSnapshot,
  customerId: string,
  reference: string,
  batchId?: string,
) {
  if (!snapshot.lines.length) throw Error("Underlaget saknar rader");
  const items = snapshot.lines.map((l) => {
    const deduction = l.kind === "labor" && l.rut_eligible && l.rut_requested;
    if (
      !Number.isFinite(Number(l.quantity)) ||
      Number(l.quantity) <= 0 ||
      !Number.isFinite(Number(l.unit_price)) ||
      Number(l.unit_price) < 0
    )
      throw Error("Felaktig prisrad");
    return {
      description:
        `${l.date || ""} ${l.assignment || ""} · ${l.description}`.trim(),
      quantity: Number(l.quantity),
      unit: l.unit,
      unit_price: Number(l.unit_price),
      vat_rate: Number(l.vat_rate),
      ...(deduction
        ? {
            deduction_type: "rut",
            labor_hours: Number(l.labor_hours),
            work_type: "SNOSKOTTNING",
          }
        : {}),
    };
  });
  if (
    Number(snapshot.rut) > 0 &&
    (!snapshot.tax?.personnummer || !snapshot.tax?.housing)
  )
    throw Error("RUT-uppgifter saknas");
  return {
    customer_id: customerId,
    invoice_date: snapshot.invoice_date,
    due_date: snapshot.due_date,
    currency: "SEK",
    your_reference: reference,
    save_as_draft: true,
    ...(batchId ? { notes: `VI-HEM snow batch ${batchId}` } : {}),
    items,
    ...(Number(snapshot.rut) > 0
      ? {
          deduction_personnummer: snapshot.tax!.personnummer,
          deduction_housing_designation: snapshot.tax!.housing,
        }
      : {}),
  };
}
