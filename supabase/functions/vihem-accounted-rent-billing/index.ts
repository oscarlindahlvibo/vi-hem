// Batch-creates Accounted invoices for a rent billing run.
//
// The run itself (which tenancies to bill, base rent, adjustments folded in)
// is entirely computed by existing VI-HEM SQL
// (vihem_create_rent_billing_run / vihem_apply_rent_adjustments_to_item) --
// this function does not duplicate that logic. It only does the new part:
// for each draft billing item not yet invoiced through either path, resolve
// the tenant's Accounted customer and create the real invoice in Accounted,
// then record the link on both vihem_accounted_invoice_links and the
// billing item itself.
//
// A billing item can only be invoiced once: it's picked up here only when
// BOTH invoice_id (legacy) and accounted_invoice_link_id (this function) are
// still null, so this can safely run alongside legacy rent invoicing during
// the migration period without double-billing anything.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, corsHeaders, errorJson, isAuthContext, json, requireCompanyAccess } from "../_shared/vihem-auth.ts";
import { AccountedContextError, loadAccountedCompanyContext } from "../_shared/accounted-company-context.ts";
import { resolveOrCreateAccountedCustomer, type VihemCustomerInput } from "../_shared/accounted-customer-resolver.ts";
import { createAccountedInvoiceForSource, type AccountedInvoiceItemInput } from "../_shared/accounted-invoice-creator.ts";
import { AccountedApiError } from "../_shared/accounted-rest-client.ts";
import { buildAdjustmentLineItems, listEligibleAdjustments, recordAdjustmentApplications } from "../_shared/billing-adjustments.ts";

interface RentBillingItemRow {
  id: string;
  tenancy_id: string;
  finance_customer_id: string | null;
  rent_period: string;
  due_date: string;
  description: string;
  amount: number;
  vat_rate: number;
  total_amount: number;
}

interface ItemResult {
  item_id: string;
  ok: boolean;
  dry_run?: boolean;
  already_invoiced?: boolean;
  accounted_invoice_id?: string;
  adjustments_applied?: number;
  error?: { code: string; message: string };
}

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

  const companyId = String(body?.company_id || "");
  const runId = String(body?.run_id || "");
  const dryRun = Boolean(body?.dry_run);
  if (!companyId) return errorJson("VALIDATION_ERROR", "company_id krävs.", 400);
  if (!runId) return errorJson("VALIDATION_ERROR", "run_id krävs.", 400);

  // Same minimum role as vihem_generate_rent_invoices (legacy) requires.
  const accessError = await requireCompanyAccess(auth, companyId, "seller");
  if (accessError) return accessError;

  let context;
  try {
    context = await loadAccountedCompanyContext(auth.adminClient, companyId);
  } catch (err) {
    if (err instanceof AccountedContextError) return errorJson(err.code, err.message, 400);
    throw err;
  }

  const { data: run, error: runErr } = await auth.adminClient
    .from("vihem_rent_billing_runs")
    .select("id, company_id")
    .eq("id", runId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (runErr || !run) return errorJson("NOT_FOUND", "Hyreskörningen hittades inte.", 404);

  const { data: items, error: itemsErr } = await auth.adminClient
    .from("vihem_rent_billing_items")
    .select("id, tenancy_id, finance_customer_id, rent_period, due_date, description, amount, vat_rate, total_amount")
    .eq("run_id", runId)
    .eq("status", "draft")
    .is("invoice_id", null)
    .is("accounted_invoice_link_id", null)
    .gt("total_amount", 0)
    .order("created_at", { ascending: true });
  if (itemsErr) return errorJson("INTERNAL_ERROR", "Kunde inte läsa hyresraderna.", 500, { details: itemsErr.message });

  const results: ItemResult[] = [];

  for (const item of (items ?? []) as RentBillingItemRow[]) {
    try {
      if (!item.finance_customer_id) {
        results.push({
          item_id: item.id,
          ok: false,
          error: { code: "RENT_ITEM_NO_CUSTOMER", message: "Hyresraden saknar kopplad ekonomikund." },
        });
        continue;
      }

      const { data: financeCustomer, error: fcErr } = await auth.adminClient
        .from("vihem_finance_customers")
        .select("name, customer_type, email, phone, address_line1, address_line2, postal_code, city, country_code, organisation_number, payment_terms_days")
        .eq("id", item.finance_customer_id)
        .maybeSingle();
      if (fcErr || !financeCustomer) {
        results.push({
          item_id: item.id,
          ok: false,
          error: { code: "RENT_ITEM_CUSTOMER_NOT_FOUND", message: "Ekonomikunden för hyresraden hittades inte." },
        });
        continue;
      }

      const customerInput: VihemCustomerInput = {
        name: financeCustomer.name,
        customer_type: financeCustomer.customer_type,
        email: financeCustomer.email || undefined,
        phone: financeCustomer.phone || undefined,
        address_line1: financeCustomer.address_line1 || undefined,
        address_line2: financeCustomer.address_line2 || undefined,
        postal_code: financeCustomer.postal_code || undefined,
        city: financeCustomer.city || undefined,
        country_code: financeCustomer.country_code || undefined,
        organisation_number: financeCustomer.organisation_number || undefined,
        payment_terms_days: financeCustomer.payment_terms_days || undefined,
      };

      // Customer creation always runs for real (never dry-run): creating a
      // customer record has no financial effect and the invoice dry-run
      // below needs a real customer_id to validate against.
      const customerResult = await resolveOrCreateAccountedCustomer(auth.adminClient, context.link, context.apiKey, {
        sourceType: "finance_customer",
        sourceId: item.finance_customer_id,
        customer: customerInput,
        dryRun: false,
        createdBy: auth.callerId,
      });
      if ("dry_run" in customerResult) {
        // Unreachable (dryRun: false above), but keeps TS narrowing honest.
        throw new Error("Oväntat dry-run-svar vid kundskapande.");
      }

      // Avdrag & tillägg: read fresh here (not baked into the run at
      // generation time), so an adjustment created after the run was
      // generated but before this invoice is sent still gets included.
      // Included in the invoice payload regardless of dry-run (an accurate
      // preview needs them); ONLY recorded as consumed after a real,
      // confirmed (non-dry-run, newly-created) invoice below.
      const eligibleAdjustments = await listEligibleAdjustments(auth.adminClient, {
        companyId,
        targetType: "tenancy",
        targetId: item.tenancy_id,
        period: item.rent_period,
      });
      const items: AccountedInvoiceItemInput[] = [
        {
          description: item.description || `Hyra ${item.rent_period}`,
          quantity: 1,
          unit: "mån",
          unit_price: item.amount,
          vat_rate: item.vat_rate,
        },
        ...buildAdjustmentLineItems(eligibleAdjustments),
      ];

      const invoiceDate = new Date().toISOString().slice(0, 10);
      const invoiceResult = await createAccountedInvoiceForSource(auth.adminClient, context.link, context.apiKey, {
        sourceType: "rental_billing",
        sourceId: item.id,
        dryRun,
        createdBy: auth.callerId,
        invoice: {
          accountedCustomerId: customerResult.accounted_customer_id,
          invoiceDate,
          dueDate: item.due_date,
          currency: "SEK",
          items,
        },
      });

      if ("dry_run" in invoiceResult) {
        results.push({ item_id: item.id, ok: true, dry_run: true, adjustments_applied: eligibleAdjustments.length });
        continue;
      }
      if ("already_invoiced" in invoiceResult) {
        results.push({ item_id: item.id, ok: true, already_invoiced: true, accounted_invoice_id: invoiceResult.link.accounted_invoice_id });
        continue;
      }

      // Invoice is confirmed created in Accounted from here on -- this is
      // the ONLY point where adjustments may be marked consumed.
      if (eligibleAdjustments.length > 0) {
        await recordAdjustmentApplications(auth.adminClient, {
          organisationId: context.link.organisation_id,
          adjustments: eligibleAdjustments,
          billingPeriod: item.rent_period,
          sourceType: "rental_billing",
          sourceId: item.id,
          accountedInvoiceLinkId: invoiceResult.link.id,
        });
      }

      const { error: updateErr } = await auth.adminClient
        .from("vihem_rent_billing_items")
        .update({ accounted_invoice_link_id: invoiceResult.link.id, status: "invoiced" })
        .eq("id", item.id);
      if (updateErr) {
        // The invoice exists in both Accounted and vihem_accounted_invoice_links
        // at this point; only the billing item's own pointer failed to update.
        // Surface it as a partial failure rather than losing the operator's
        // ability to see it needs a manual fix.
        results.push({
          item_id: item.id,
          ok: false,
          accounted_invoice_id: invoiceResult.link.accounted_invoice_id,
          error: { code: "RENT_ITEM_LINK_UPDATE_FAILED", message: updateErr.message },
        });
        continue;
      }

      results.push({
        item_id: item.id,
        ok: true,
        accounted_invoice_id: invoiceResult.link.accounted_invoice_id,
        adjustments_applied: eligibleAdjustments.length,
      });
    } catch (err) {
      if (err instanceof AccountedApiError) {
        results.push({ item_id: item.id, ok: false, error: { code: err.code, message: err.message } });
      } else {
        results.push({
          item_id: item.id,
          ok: false,
          error: { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) },
        });
      }
    }
  }

  return json({
    data: {
      results,
      summary: {
        total: results.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
      },
    },
  });
});
