// Creates the real customer invoice in Accounted from a VI-HEM billing
// source (customer-project billing basis, manual charge -- rent billing goes
// through vihem-accounted-rent-billing's batch flow instead, which calls the
// same shared creator directly), and refreshes the local read-model row from
// Accounted's current state.
//
// VI-HEM computes WHAT to bill (the items array below) and hands it to
// Accounted, which owns invoice numbering, VAT computation, PDF, sending and
// payment status from here on.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, type AuthContext, corsHeaders, errorJson, isAuthContext, json, requireCompanyAccess } from "../_shared/vihem-auth.ts";
import { AccountedContextError, loadAccountedCompanyContext } from "../_shared/accounted-company-context.ts";
import {
  ACCOUNTED_INVOICE_SOURCE_TYPES,
  createAccountedInvoiceForSource,
  type AccountedInvoiceSourceType,
} from "../_shared/accounted-invoice-creator.ts";
import { AccountedApiError, createAccountedClient } from "../_shared/accounted-rest-client.ts";
import type { AccountedCustomerSourceType } from "../_shared/accounted-customer-resolver.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return errorJson("METHOD_NOT_ALLOWED", "Endast POST stöds.", 405);

  const auth = await authenticate(req);
  if (!isAuthContext(auth)) return auth;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorJson("VALIDATION_ERROR", "Ogiltig JSON.", 400);
  }

  const action = String(body?.action || "create");
  const companyId = String(body?.company_id || "");
  if (!companyId) return errorJson("VALIDATION_ERROR", "company_id krävs.", 400);

  const accessError = await requireCompanyAccess(auth, companyId, "seller");
  if (accessError) return accessError;

  try {
    const context = await loadAccountedCompanyContext(auth.adminClient, companyId);
    if (action === "refresh_status") return await handleRefreshStatus(auth, context, body);
    if (action === "create") return await handleCreate(auth, context, body);
    return errorJson("VALIDATION_ERROR", `Okänd action: ${action}`, 400);
  } catch (err) {
    if (err instanceof AccountedContextError) return errorJson(err.code, err.message, 400);
    if (err instanceof AccountedApiError) {
      return errorJson(err.code, err.message, err.httpStatus >= 400 ? err.httpStatus : 502, {
        recovery_hint: err.recoveryHint,
        details: err.details,
        request_id: err.requestId,
      });
    }
    return errorJson("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), 500);
  }
});

async function handleCreate(auth: AuthContext, context: Awaited<ReturnType<typeof loadAccountedCompanyContext>>, body: any) {
  const sourceType = String(body?.source_type || "");
  const sourceId = String(body?.source_id || "");
  const dryRun = Boolean(body?.dry_run);
  const invoice = body?.invoice || {};

  if (!ACCOUNTED_INVOICE_SOURCE_TYPES.includes(sourceType as AccountedInvoiceSourceType)) {
    return errorJson("VALIDATION_ERROR", `source_type måste vara en av: ${ACCOUNTED_INVOICE_SOURCE_TYPES.join(", ")}`, 400);
  }
  if (!sourceId) return errorJson("VALIDATION_ERROR", "source_id krävs.", 400);
  if (!Array.isArray(invoice.items) || invoice.items.length === 0) {
    return errorJson("VALIDATION_ERROR", "invoice.items måste innehålla minst en rad.", 400);
  }

  let accountedCustomerId = String(invoice.accounted_customer_id || "");
  if (!accountedCustomerId && invoice.customer_source_type && invoice.customer_source_id) {
    const { data: customerLink } = await auth.adminClient
      .from("vihem_accounted_customer_links")
      .select("accounted_customer_id")
      .eq("company_link_id", context.link.id)
      .eq("source_type", invoice.customer_source_type as AccountedCustomerSourceType)
      .eq("source_id", invoice.customer_source_id)
      .maybeSingle();
    accountedCustomerId = customerLink?.accounted_customer_id || "";
  }
  if (!accountedCustomerId) {
    return errorJson(
      "ACCOUNTED_CUSTOMER_NOT_LINKED",
      "Ingen Accounted-kund angiven. Länka/skapa kunden via vihem-accounted-customers först.",
      400,
    );
  }

  const result = await createAccountedInvoiceForSource(auth.adminClient, context.link, context.apiKey, {
    sourceType: sourceType as AccountedInvoiceSourceType,
    sourceId,
    dryRun,
    createdBy: auth.callerId,
    invoice: {
      accountedCustomerId,
      invoiceDate: invoice.invoice_date,
      dueDate: invoice.due_date,
      currency: invoice.currency,
      items: invoice.items,
      yourReference: invoice.your_reference,
      ourReference: invoice.our_reference,
      notes: invoice.notes,
    },
  });

  if ("dry_run" in result) return json({ data: result });
  if ("already_invoiced" in result) return json({ data: { already_invoiced: true, ...result.link } });
  return json({ data: result.link }, 201);
}

async function handleRefreshStatus(auth: AuthContext, context: Awaited<ReturnType<typeof loadAccountedCompanyContext>>, body: any) {
  const invoiceLinkId = String(body?.invoice_link_id || "");
  if (!invoiceLinkId) return errorJson("VALIDATION_ERROR", "invoice_link_id krävs.", 400);

  const { data: existing, error: existingErr } = await auth.adminClient
    .from("vihem_accounted_invoice_links")
    .select("id, accounted_invoice_id")
    .eq("id", invoiceLinkId)
    .eq("company_link_id", context.link.id)
    .maybeSingle();
  if (existingErr || !existing) return errorJson("NOT_FOUND", "Fakturakopplingen hittades inte.", 404);

  const client = createAccountedClient({ baseUrl: context.link.accounted_base_url, apiKey: context.apiKey });
  const result = await client.get<any>(
    `/api/v1/companies/${encodeURIComponent(context.link.accounted_company_id)}/invoices/${encodeURIComponent(existing.accounted_invoice_id)}`,
  );

  const { data: updated, error: updateErr } = await auth.adminClient
    .from("vihem_accounted_invoice_links")
    .update({
      accounted_invoice_number: result.invoice_number,
      status: result.status,
      total: result.total,
      remaining_amount: result.remaining_amount,
      invoice_date: result.invoice_date,
      due_date: result.due_date,
      paid_at: result.paid_at,
      last_sync_source: "manual_refresh",
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .select("id, accounted_invoice_id, accounted_invoice_number, status, total, remaining_amount, invoice_date, due_date, paid_at")
    .single();
  if (updateErr) return errorJson("INTERNAL_ERROR", "Kunde inte uppdatera fakturakopplingen.", 500, { details: updateErr.message });

  return json({ data: updated });
}
