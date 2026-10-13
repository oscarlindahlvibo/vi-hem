// Fakturor för kursordrar skapas i Accounted via befintliga delade moduler (ingen parallell fakturamotor).
// Saknas Accounted-koppling för WPE Sweden AB lämnas ordern markerad och inget påstås vara fakturerat.
import { AccountedContextError, loadAccountedCompanyContext } from "./accounted-company-context.ts";
import { resolveOrCreateAccountedCustomer } from "./accounted-customer-resolver.ts";
import { createAccountedInvoiceForSource } from "./accounted-invoice-creator.ts";

export type InvoiceResult = { ok: true; linkId: string; number: string | null; dueDate: string | null; alreadyInvoiced: boolean } | { ok: false; code: string; message: string };

export async function createInvoiceForOrder(admin: any, orderId: string, actorId: string | null): Promise<InvoiceResult> {
  const { data: order } = await admin.from("vihem_kp_orders").select("*, items:vihem_kp_order_items(*), customer:vihem_kp_customers(*)").eq("id", orderId).maybeSingle();
  if (!order || order.payment_method !== "invoice" || !order.customer) return { ok: false, code: "NOT_INVOICE_ORDER", message: "Ordern är inte en fakturaorder." };
  if (order.invoice_link_id) {
    const { data: link } = await admin.from("vihem_accounted_invoice_links").select("id, accounted_invoice_number, due_date").eq("id", order.invoice_link_id).maybeSingle();
    return { ok: true, linkId: order.invoice_link_id, number: link?.accounted_invoice_number ?? null, dueDate: link?.due_date ?? null, alreadyInvoiced: true };
  }
  const { data: settings } = await admin.from("vihem_kp_settings").select("*").eq("organisation_id", order.organisation_id).maybeSingle();
  if (!settings?.finance_company_id) return { ok: false, code: "NO_FINANCE_COMPANY", message: "Inställningen för ekonomibolag (WPE Sweden AB) saknas." };
  let context;
  try { context = await loadAccountedCompanyContext(admin, settings.finance_company_id); }
  catch (e) { if (e instanceof AccountedContextError) return { ok: false, code: e.code, message: e.message }; throw e; }
  try {
    const c = order.customer;
    const customerLink: any = await resolveOrCreateAccountedCustomer(admin, context.link, context.apiKey, {
      sourceType: "kp_customer" as any, sourceId: c.id, createdBy: actorId ?? "system",
      customer: { name: c.name, customer_type: "company", email: c.invoice_email || c.contact_email, phone: c.contact_phone, address_line1: c.billing_address, postal_code: c.billing_postal_code, city: c.billing_city, country_code: c.billing_country || "SE", organisation_number: c.org_number, payment_terms_days: c.payment_terms_days ?? settings.invoice_payment_terms_days },
    });
    const terms = c.payment_terms_days ?? settings.invoice_payment_terms_days ?? 30;
    const today = new Date(); const due = new Date(today.getTime() + terms * 86400000);
    const result: any = await createAccountedInvoiceForSource(admin, context.link, context.apiKey, {
      sourceType: "course_order" as any, sourceId: order.id, createdBy: actorId ?? "system",
      invoice: {
        accountedCustomerId: customerLink.accounted_customer_id, invoiceDate: today.toISOString().slice(0, 10), dueDate: due.toISOString().slice(0, 10), currency: order.currency,
        yourReference: c.reference || undefined, ourReference: order.order_number, notes: `Order ${order.order_number}. Betalningsreferens: ${order.order_number}.`,
        items: (order.items as any[]).map((it) => ({ description: it.description, quantity: it.quantity, unit: "st", unit_price: Number(it.net_total) / it.quantity, vat_rate: Number(it.vat_rate) })),
      },
    });
    const link = result.link ?? result;
    await admin.from("vihem_kp_orders").update({ invoice_link_id: link.id, invoice_status: link.status || "draft" }).eq("id", order.id);
    return { ok: true, linkId: link.id, number: link.accounted_invoice_number ?? null, dueDate: link.due_date ?? null, alreadyInvoiced: !!result.already_invoiced };
  } catch (e) {
    return { ok: false, code: "ACCOUNTED_ERROR", message: e instanceof Error ? e.message.slice(0, 300) : "Fakturan kunde inte skapas i Accounted." };
  }
}
