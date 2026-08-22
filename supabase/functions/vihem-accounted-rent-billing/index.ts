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
//
// Optional combine_by_customer: when true, billing items in the run that
// share the same finance_customer_id (e.g. one tenant renting several
// apartments) are combined into a SINGLE Accounted invoice instead of one
// invoice per tenancy, using the same many-sources-per-invoice model
// customer-project billing already uses. Defaults to false so existing
// behaviour (one invoice per billing item) is unchanged unless a caller
// explicitly opts in.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, type AuthContext, corsHeaders, errorJson, isAuthContext, json, requireCompanyAccess } from "../_shared/vihem-auth.ts";
import { AccountedContextError, loadAccountedCompanyContext } from "../_shared/accounted-company-context.ts";
import { resolveOrCreateAccountedCustomer, type VihemCustomerInput } from "../_shared/accounted-customer-resolver.ts";
import {
  createAccountedCollectionInvoiceForSources,
  createAccountedInvoiceForSource,
  type AccountedInvoiceItemInput,
} from "../_shared/accounted-invoice-creator.ts";
import { AccountedApiError } from "../_shared/accounted-rest-client.ts";
import {
  type BillingAdjustmentRow,
  buildAdjustmentLineItems,
  listEligibleAdjustments,
  recordAdjustmentApplications,
} from "../_shared/billing-adjustments.ts";

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
  apartment: { apartment_number: string } | null;
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

type Context = Awaited<ReturnType<typeof loadAccountedCompanyContext>>;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return errorJson("METHOD_NOT_ALLOWED", "Endast POST stöds.", 405);

  const authResult = await authenticate(req);
  if (!isAuthContext(authResult)) return authResult;
  const auth: AuthContext = authResult;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorJson("VALIDATION_ERROR", "Ogiltig JSON.", 400);
  }

  const companyId = String(body?.company_id || "");
  const runId = String(body?.run_id || "");
  const dryRun = Boolean(body?.dry_run);
  const combineByCustomer = Boolean(body?.combine_by_customer);
  if (!companyId) return errorJson("VALIDATION_ERROR", "company_id krävs.", 400);
  if (!runId) return errorJson("VALIDATION_ERROR", "run_id krävs.", 400);

  // Same minimum role as vihem_generate_rent_invoices (legacy) requires.
  const accessError = await requireCompanyAccess(auth, companyId, "seller");
  if (accessError) return accessError;

  let context: Context;
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
    .select(
      "id, tenancy_id, finance_customer_id, rent_period, due_date, description, amount, vat_rate, total_amount, apartment:apartment_id(apartment_number)",
    )
    .eq("run_id", runId)
    .eq("status", "draft")
    .is("invoice_id", null)
    .is("accounted_invoice_link_id", null)
    .gt("total_amount", 0)
    .order("created_at", { ascending: true });
  if (itemsErr) return errorJson("INTERNAL_ERROR", "Kunde inte läsa hyresraderna.", 500, { details: itemsErr.message });

  const rows = (items ?? []) as unknown as RentBillingItemRow[];

  async function invoiceSingleItem(item: RentBillingItemRow): Promise<ItemResult> {
    try {
      if (!item.finance_customer_id) {
        return {
          item_id: item.id,
          ok: false,
          error: { code: "RENT_ITEM_NO_CUSTOMER", message: "Hyresraden saknar kopplad ekonomikund." },
        };
      }

      const { data: financeCustomer, error: fcErr } = await auth.adminClient
        .from("vihem_finance_customers")
        .select("name, customer_type, email, phone, address_line1, address_line2, postal_code, city, country_code, organisation_number, payment_terms_days")
        .eq("id", item.finance_customer_id)
        .maybeSingle();
      if (fcErr || !financeCustomer) {
        return {
          item_id: item.id,
          ok: false,
          error: { code: "RENT_ITEM_CUSTOMER_NOT_FOUND", message: "Ekonomikunden för hyresraden hittades inte." },
        };
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
      const lineItems: AccountedInvoiceItemInput[] = [
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
          items: lineItems,
        },
      });

      if ("dry_run" in invoiceResult) {
        return { item_id: item.id, ok: true, dry_run: true, adjustments_applied: eligibleAdjustments.length };
      }
      if ("already_invoiced" in invoiceResult) {
        return { item_id: item.id, ok: true, already_invoiced: true, accounted_invoice_id: invoiceResult.link.accounted_invoice_id };
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
        return {
          item_id: item.id,
          ok: false,
          accounted_invoice_id: invoiceResult.link.accounted_invoice_id,
          error: { code: "RENT_ITEM_LINK_UPDATE_FAILED", message: updateErr.message },
        };
      }

      return {
        item_id: item.id,
        ok: true,
        accounted_invoice_id: invoiceResult.link.accounted_invoice_id,
        adjustments_applied: eligibleAdjustments.length,
      };
    } catch (err) {
      if (err instanceof AccountedApiError) {
        return { item_id: item.id, ok: false, error: { code: err.code, message: err.message } };
      }
      return {
        item_id: item.id,
        ok: false,
        error: { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  // Combines several billing items that share the same finance_customer_id
  // into ONE Accounted invoice. Only called for groups with 2+ items --
  // callers route single-item groups through invoiceSingleItem instead, so
  // the resulting invoice/idempotency behaviour for a lone tenancy is
  // identical whether or not combine_by_customer was requested.
  async function invoiceGroupForCustomer(financeCustomerId: string, groupItems: RentBillingItemRow[]): Promise<ItemResult[]> {
    try {
      const { data: financeCustomer, error: fcErr } = await auth.adminClient
        .from("vihem_finance_customers")
        .select("name, customer_type, email, phone, address_line1, address_line2, postal_code, city, country_code, organisation_number, payment_terms_days")
        .eq("id", financeCustomerId)
        .maybeSingle();
      if (fcErr || !financeCustomer) {
        return groupItems.map((item) => ({
          item_id: item.id,
          ok: false,
          error: { code: "RENT_ITEM_CUSTOMER_NOT_FOUND", message: "Ekonomikunden för hyresraden hittades inte." },
        }));
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
      const customerResult = await resolveOrCreateAccountedCustomer(auth.adminClient, context.link, context.apiKey, {
        sourceType: "finance_customer",
        sourceId: financeCustomerId,
        customer: customerInput,
        dryRun: false,
        createdBy: auth.callerId,
      });
      if ("dry_run" in customerResult) {
        throw new Error("Oväntat dry-run-svar vid kundskapande.");
      }

      const perItemAdjustments = new Map<string, BillingAdjustmentRow[]>();
      const combinedLineItems: AccountedInvoiceItemInput[] = [];
      for (const item of groupItems) {
        const eligible = await listEligibleAdjustments(auth.adminClient, {
          companyId,
          targetType: "tenancy",
          targetId: item.tenancy_id,
          period: item.rent_period,
        });
        perItemAdjustments.set(item.id, eligible);
        const label = item.apartment?.apartment_number ? ` (lgh ${item.apartment.apartment_number})` : "";
        combinedLineItems.push({
          description: `${item.description || `Hyra ${item.rent_period}`}${label}`,
          quantity: 1,
          unit: "mån",
          unit_price: item.amount,
          vat_rate: item.vat_rate,
        });
        for (const line of buildAdjustmentLineItems(eligible)) {
          combinedLineItems.push({ ...line, description: `${line.description}${label}` });
        }
      }

      const invoiceDate = new Date().toISOString().slice(0, 10);
      const invoiceResult = await createAccountedCollectionInvoiceForSources(auth.adminClient, context.link, context.apiKey, {
        sources: groupItems.map((item) => ({ sourceType: "rental_billing" as const, sourceId: item.id })),
        invoice: {
          accountedCustomerId: customerResult.accounted_customer_id,
          invoiceDate,
          dueDate: groupItems[0].due_date,
          currency: "SEK",
          items: combinedLineItems,
        },
        dryRun,
        createdBy: auth.callerId,
      });

      if ("dry_run" in invoiceResult) {
        return groupItems.map((item) => ({
          item_id: item.id,
          ok: true,
          dry_run: true,
          adjustments_applied: (perItemAdjustments.get(item.id) ?? []).length,
        }));
      }

      const results: ItemResult[] = [];
      for (let i = 0; i < groupItems.length; i++) {
        const item = groupItems[i];
        const link = invoiceResult.links[i];
        const eligible = perItemAdjustments.get(item.id) ?? [];

        // Invoice is confirmed created in Accounted from here on -- this is
        // the ONLY point where this item's adjustments may be marked
        // consumed. Each item gets its OWN link row (from
        // createAccountedCollectionInvoiceForSources), so this is exact --
        // not a representative/shared link id.
        if (eligible.length > 0) {
          await recordAdjustmentApplications(auth.adminClient, {
            organisationId: context.link.organisation_id,
            adjustments: eligible,
            billingPeriod: item.rent_period,
            sourceType: "rental_billing",
            sourceId: item.id,
            accountedInvoiceLinkId: link.id,
          });
        }

        const { error: updateErr } = await auth.adminClient
          .from("vihem_rent_billing_items")
          .update({ accounted_invoice_link_id: link.id, status: "invoiced" })
          .eq("id", item.id);
        if (updateErr) {
          results.push({
            item_id: item.id,
            ok: false,
            accounted_invoice_id: link.accounted_invoice_id,
            error: { code: "RENT_ITEM_LINK_UPDATE_FAILED", message: updateErr.message },
          });
          continue;
        }

        results.push({
          item_id: item.id,
          ok: true,
          accounted_invoice_id: link.accounted_invoice_id,
          adjustments_applied: eligible.length,
        });
      }
      return results;
    } catch (err) {
      const error = err instanceof AccountedApiError
        ? { code: err.code, message: err.message }
        : { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) };
      return groupItems.map((item) => ({ item_id: item.id, ok: false, error }));
    }
  }

  const results: ItemResult[] = [];

  if (!combineByCustomer) {
    for (const item of rows) {
      results.push(await invoiceSingleItem(item));
    }
  } else {
    const groups = new Map<string, RentBillingItemRow[]>();
    const ungrouped: RentBillingItemRow[] = [];
    for (const item of rows) {
      if (!item.finance_customer_id) {
        ungrouped.push(item);
        continue;
      }
      const list = groups.get(item.finance_customer_id);
      if (list) list.push(item);
      else groups.set(item.finance_customer_id, [item]);
    }
    for (const item of ungrouped) {
      results.push(await invoiceSingleItem(item));
    }
    for (const [financeCustomerId, groupItems] of groups) {
      if (groupItems.length === 1) {
        results.push(await invoiceSingleItem(groupItems[0]));
      } else {
        results.push(...(await invoiceGroupForCustomer(financeCustomerId, groupItems)));
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
