// Kvitton: skapa (SQL, idempotent), rendera PDF i privat lagring, skicka som bilaga. Kastar aldrig vidare – misslyckas något ligger kvittot kvar
// i databasen och arbetaren (vihem-kp-worker) försöker igen tills PDF och mejl är klara.
import { renderReceiptPdf } from "./kp-receipt-pdf.ts";
import { KP_LOGO_JPEG } from "./kp-brand-logo.ts";
import { money, queueMail } from "./kp-common.ts";

const sv = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Stockholm" });

export async function ensureReceiptPdf(admin: any, receiptId: string): Promise<string> {
  const { data: r, error } = await admin.from("vihem_kp_receipts").select("*, order:vihem_kp_orders(order_number)").eq("id", receiptId).single();
  if (error || !r) throw new Error("Kvittot finns inte.");
  if (r.pdf_path) return r.pdf_path;
  const b = r.billing ?? {};
  const bytes = renderReceiptPdf({
    kind: r.kind, receiptNumber: r.receipt_number, issuedAt: sv(r.issued_at), orderNumber: r.order?.order_number ?? "", currency: r.currency, seller: r.seller ?? {},
    buyerName: r.buyer_name, buyerEmail: r.buyer_email, buyerOrgNumber: r.buyer_org_number, billingAddress: [b.address, [b.postal_code, b.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    lines: r.lines ?? [], netTotal: Number(r.net_total), vatTotal: Number(r.vat_total), total: Number(r.total), paymentMethod: r.payment_method, paymentReference: r.payment_reference, logoJpeg: KP_LOGO_JPEG,
  });
  const path = `receipts/${r.organisation_id}/${r.id}.pdf`;
  const up = await admin.storage.from("vihem-kp-private").upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(`Kunde inte spara kvitto-PDF: ${up.error.message}`);
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
  await admin.from("vihem_kp_receipts").update({ pdf_path: path, pdf_sha256: sha }).eq("id", r.id).is("pdf_path", null);
  return path;
}

export async function sendReceiptEmail(admin: any, receiptId: string): Promise<void> {
  const { data: r } = await admin.from("vihem_kp_receipts").select("*, order:vihem_kp_orders(order_number, buyer_user_id)").eq("id", receiptId).single();
  if (!r || r.emailed_at || !r.pdf_path || !r.buyer_email) return;
  const { data: settings } = await admin.from("vihem_kp_settings").select("public_base_url").eq("organisation_id", r.organisation_id).single();
  const name = r.buyer_name || r.buyer_email;
  await queueMail(admin, r.organisation_id, r.kind === "receipt" ? "payment_received" : "refund_receipt", r.buyer_email, name,
    { name, order_number: r.order?.order_number ?? "", total: money(r.total), receipt_number: r.receipt_number, portal_url: `${String(settings?.public_base_url ?? "").replace(/\/$/, "")}/mina-sidor` },
    `receipt-${r.id}`, "receipt", r.id, { bucket: "vihem-kp-private", path: r.pdf_path, file_name: `${r.receipt_number}.pdf`, content_type: "application/pdf" });
  await admin.from("vihem_kp_receipts").update({ emailed_at: new Date().toISOString() }).eq("id", r.id);
}

/** Skapar kvitto för en betalning eller återbetalning och skickar det. Returnerar kvittots id eller null vid fel. */
export async function processReceipt(admin: any, orderId: string, ref: { paymentId?: string | null; refundId?: string | null }): Promise<string | null> {
  try {
    const { data: id, error } = await admin.rpc("vihem_kp_issue_receipt", { p_order: orderId, p_payment: ref.paymentId ?? null, p_refund: ref.refundId ?? null });
    if (error) throw error;
    try { await ensureReceiptPdf(admin, id); await sendReceiptEmail(admin, id); } catch (e) { console.error("receipt pdf/mail (retry by worker):", e instanceof Error ? e.message : e); }
    return id as string;
  } catch (e) { console.error("receipt issue:", e instanceof Error ? e.message : e); return null; }
}

/** Arbetarens återförsök: kvitton utan PDF eller utan skickat mejl. */
export async function retryPendingReceipts(admin: any, limit = 10): Promise<number> {
  const { data } = await admin.from("vihem_kp_receipts").select("id").or("pdf_path.is.null,emailed_at.is.null").order("created_at").limit(limit);
  let n = 0;
  for (const r of data ?? []) { try { await ensureReceiptPdf(admin, r.id); await sendReceiptEmail(admin, r.id); n++; } catch (e) { console.error("receipt retry:", e instanceof Error ? e.message : e); } }
  return n;
}
