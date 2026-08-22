// Creates the real Accounted invoice for one or more customer-project
// invoice bases ("faktureringsunderlag") that are ready_for_invoicing.
//
// WHAT to bill (time/material/change-order/fixed-price lines marked "ready")
// is entirely existing VI-HEM logic, assembled in CustomerProjectsPage.tsx
// (untouched) into vihem_project_invoice_basis/_lines. Customer resolution
// reuses the existing vihem_ensure_finance_customer_for_project SQL function
// (match-or-create against vihem_finance_customers, same one the legacy
// vihem_create_invoice_from_project_basis RPC uses) so project->customer
// matching behaves identically whichever path issues the invoice. This
// function only adds the new step: push the assembled lines to Accounted as
// a real invoice instead of (or alongside, during migration) the legacy
// vihem_invoices row.
//
// Two request shapes, two independent code paths:
//   - { basis_id: "..." }   single basis -> single invoice (original).
//   - { basis_ids: [...] }  several bases -> ONE combined invoice
//     ("samlingsfaktura"), mirroring legacy vihem_create_invoice_from_
//     project_basis_batch's guard that every basis must resolve to the same
//     Accounted customer. The single-basis path is untouched by this split.
//
// A basis can only be invoiced once, through either path: it's picked up
// here only when BOTH finance_invoice_id (legacy) and
// accounted_invoice_link_id (this function) are still null.
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
import { buildAdjustmentLineItems, listEligibleAdjustments, recordAdjustmentApplications, type BillingAdjustmentRow } from "../_shared/billing-adjustments.ts";

interface BasisRow {
  id: string;
  project_id: string;
  status: string;
  title: string;
  description: string;
  basis_number: string;
  finance_invoice_id: string | null;
  accounted_invoice_link_id: string | null;
}

interface BasisLineRow {
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  vat_rate: number;
  billing_status: string;
}

type Context = Awaited<ReturnType<typeof loadAccountedCompanyContext>>;

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
  const dryRun = Boolean(body?.dry_run);
  if (!companyId) return errorJson("VALIDATION_ERROR", "company_id krävs.", 400);

  const accessError = await requireCompanyAccess(auth, companyId, "seller");
  if (accessError) return accessError;

  let context: Context;
  try {
    context = await loadAccountedCompanyContext(auth.adminClient, companyId);
  } catch (err) {
    if (err instanceof AccountedContextError) return errorJson(err.code, err.message, 400);
    throw err;
  }

  if (Array.isArray(body?.basis_ids)) {
    return handleCollection(auth, context, companyId, body.basis_ids.map(String), dryRun);
  }

  const basisId = String(body?.basis_id || "");
  if (!basisId) return errorJson("VALIDATION_ERROR", "basis_id eller basis_ids krävs.", 400);
  return handleSingleBasis(auth, context, companyId, basisId, dryRun);
});

async function loadEligibleBasis(
  auth: AuthContext,
  companyId: string,
  basisId: string,
): Promise<{ error: Response } | { basisRow: BasisRow; project: { id: string; organisation_id: string; company_id: string; title: string; name: string }; readyLines: BasisLineRow[] }> {
  const { data: basis, error: basisErr } = await auth.adminClient
    .from("vihem_project_invoice_basis")
    .select("id, project_id, status, title, description, basis_number, finance_invoice_id, accounted_invoice_link_id")
    .eq("id", basisId)
    .maybeSingle();
  if (basisErr || !basis) return { error: errorJson("NOT_FOUND", `Faktureringsunderlaget ${basisId} hittades inte.`, 404) };
  const basisRow = basis as BasisRow;

  if (basisRow.finance_invoice_id || basisRow.accounted_invoice_link_id) {
    return { error: errorJson("PROJECT_BASIS_ALREADY_INVOICED", `Underlaget ${basisRow.basis_number || basisId} är redan fakturerat.`, 400) };
  }
  if (basisRow.status !== "ready_for_invoicing") {
    return {
      error: errorJson(
        "PROJECT_BASIS_NOT_READY",
        `Underlaget ${basisRow.basis_number || basisId} har status "${basisRow.status}" och behöver vara "ready_for_invoicing".`,
        400,
      ),
    };
  }

  const { data: project, error: projectErr } = await auth.adminClient
    .from("vihem_customer_projects")
    .select("id, organisation_id, company_id, title, name")
    .eq("id", basisRow.project_id)
    .maybeSingle();
  if (projectErr || !project) return { error: errorJson("NOT_FOUND", "Kundprojektet hittades inte.", 404) };
  if (project.company_id !== companyId) {
    return { error: errorJson("VALIDATION_ERROR", `Underlaget ${basisRow.basis_number || basisId} tillhör inte det angivna bolaget.`, 400) };
  }

  const { data: lines, error: linesErr } = await auth.adminClient
    .from("vihem_project_invoice_basis_lines")
    .select("description, quantity, unit, unit_price, vat_rate, billing_status")
    .eq("basis_id", basisId)
    .eq("billing_status", "ready");
  if (linesErr) return { error: errorJson("INTERNAL_ERROR", "Kunde inte läsa underlagsraderna.", 500, { details: linesErr.message }) };
  const readyLines = (lines ?? []) as BasisLineRow[];
  if (readyLines.length === 0) {
    return { error: errorJson("PROJECT_BASIS_NO_LINES", `Underlaget ${basisRow.basis_number || basisId} har inga fakturerbara rader.`, 400) };
  }

  return { basisRow, project, readyLines };
}

async function resolveProjectFinanceCustomer(auth: AuthContext, companyId: string, project: { id: string; organisation_id: string }) {
  const { data: financeCustomerId, error: rpcErr } = await auth.userClient.rpc(
    "vihem_ensure_finance_customer_for_project",
    { target_organisation_id: project.organisation_id, target_company_id: companyId, target_project_id: project.id },
  );
  if (rpcErr || !financeCustomerId) {
    throw new Error(rpcErr?.message || "Kunde inte hitta/skapa ekonomikund för projektet.");
  }
  return financeCustomerId as string;
}

async function handleSingleBasis(auth: AuthContext, context: Context, companyId: string, basisId: string, dryRun: boolean) {
  const resolved = await loadEligibleBasis(auth, companyId, basisId);
  if ("error" in resolved) return resolved.error;
  const { basisRow, project, readyLines } = resolved;

  try {
    let financeCustomerId: string;
    try {
      financeCustomerId = await resolveProjectFinanceCustomer(auth, companyId, project);
    } catch (err) {
      return errorJson("PROJECT_CUSTOMER_RESOLUTION_FAILED", err instanceof Error ? err.message : String(err), 500);
    }

    const { data: financeCustomer, error: fcErr } = await auth.adminClient
      .from("vihem_finance_customers")
      .select("name, customer_type, email, phone, address_line1, address_line2, postal_code, city, country_code, organisation_number, payment_terms_days")
      .eq("id", financeCustomerId)
      .maybeSingle();
    if (fcErr || !financeCustomer) return errorJson("NOT_FOUND", "Ekonomikunden hittades inte.", 404);

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

    // Customer creation always runs for real, even during an invoice
    // dry-run -- see accounted-v2-integration.md "Felhantering".
    const customerResult = await resolveOrCreateAccountedCustomer(auth.adminClient, context.link, context.apiKey, {
      sourceType: "finance_customer",
      sourceId: financeCustomerId,
      customer: customerInput,
      dryRun: false,
      createdBy: auth.callerId,
    });
    if ("dry_run" in customerResult) throw new Error("Oväntat dry-run-svar vid kundskapande.");

    const invoiceDate = new Date().toISOString().slice(0, 10);
    const dueDate = new Date(Date.now() + (financeCustomer.payment_terms_days || 30) * 86_400_000).toISOString().slice(0, 10);

    // Avdrag & tillägg on the project itself (not the customer): projects
    // don't have a calendar billing period the way rent does, so eligibility
    // is checked against today's date rather than a specific period --
    // "apply to the project's next invoice" reads the same either way, it
    // just means a recurring adjustment's max_occurrences/end_period compare
    // against the invoice date instead of a rent_period. Included in both
    // dry-run previews and real invoices; recorded as consumed only after a
    // confirmed (non-dry-run, newly-created) result below.
    const eligibleAdjustments = await listEligibleAdjustments(auth.adminClient, {
      companyId,
      targetType: "customer_project",
      targetId: project.id,
      period: invoiceDate,
    });
    const items: AccountedInvoiceItemInput[] = [
      ...readyLines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unit_price,
        vat_rate: line.vat_rate,
      })),
      ...buildAdjustmentLineItems(eligibleAdjustments),
    ];

    const invoiceResult = await createAccountedInvoiceForSource(auth.adminClient, context.link, context.apiKey, {
      sourceType: "customer_project",
      sourceId: basisId,
      dryRun,
      createdBy: auth.callerId,
      invoice: {
        accountedCustomerId: customerResult.accounted_customer_id,
        invoiceDate,
        dueDate,
        currency: "SEK",
        items,
        yourReference: basisRow.basis_number || undefined,
        notes: basisRow.description || basisRow.title || undefined,
      },
    });

    if ("dry_run" in invoiceResult) return json({ data: { dry_run: true, preview: invoiceResult.preview } });
    if ("already_invoiced" in invoiceResult) {
      return json({ data: { already_invoiced: true, ...invoiceResult.link } });
    }

    // Invoice is confirmed created in Accounted from here on -- the ONLY
    // point where these adjustments may be marked consumed.
    if (eligibleAdjustments.length > 0) {
      await recordAdjustmentApplications(auth.adminClient, {
        organisationId: context.link.organisation_id,
        adjustments: eligibleAdjustments,
        billingPeriod: null,
        sourceType: "customer_project",
        sourceId: basisId,
        accountedInvoiceLinkId: invoiceResult.link.id,
      });
    }

    const markResult = await markBasisInvoiced(auth, basisId, invoiceResult.link.id, invoiceResult.link.accounted_invoice_id);
    if (!markResult.basisUpdated) {
      // The invoice exists in both Accounted and vihem_accounted_invoice_links
      // at this point; only the basis's own pointer failed to update.
      // Surface it as a failure rather than losing the operator's ability to
      // see it needs a manual fix (matches the pre-collection-support
      // behavior of this code path).
      return errorJson(
        "PROJECT_BASIS_LINK_UPDATE_FAILED",
        `Fakturan skapades (Accounted-id ${invoiceResult.link.accounted_invoice_id}) men underlaget kunde inte uppdateras: ${markResult.basisError}`,
        500,
        { accounted_invoice_id: invoiceResult.link.accounted_invoice_id },
      );
    }

    return json({ data: invoiceResult.link }, 201);
  } catch (err) {
    return respondToError(err);
  }
}

async function handleCollection(auth: AuthContext, context: Context, companyId: string, basisIds: string[], dryRun: boolean) {
  const uniqueBasisIds = Array.from(new Set(basisIds.filter(Boolean)));
  if (uniqueBasisIds.length === 0) return errorJson("VALIDATION_ERROR", "basis_ids får inte vara tom.", 400);
  if (uniqueBasisIds.length === 1) return handleSingleBasis(auth, context, companyId, uniqueBasisIds[0], dryRun);
  if (uniqueBasisIds.length > 25) return errorJson("VALIDATION_ERROR", "Max 25 underlag per samlingsfaktura.", 400);

  const resolvedBases: { basisRow: BasisRow; project: { id: string; organisation_id: string; company_id: string; title: string; name: string }; readyLines: BasisLineRow[] }[] = [];
  for (const basisId of uniqueBasisIds) {
    const resolved = await loadEligibleBasis(auth, companyId, basisId);
    if ("error" in resolved) return resolved.error;
    resolvedBases.push(resolved);
  }

  try {
    // Resolve (and, per project, match-or-create) the finance customer for
    // every basis's project. Legacy's own batch RPC refuses to combine
    // bases that resolve to different customers -- same guard here, just
    // enforced in application code since this path doesn't use that RPC's
    // batch variant.
    const customerIdsByBasis = new Map<string, string>();
    const customerIdByProject = new Map<string, string>();
    for (const { basisRow, project } of resolvedBases) {
      let financeCustomerId = customerIdByProject.get(project.id);
      if (!financeCustomerId) {
        try {
          financeCustomerId = await resolveProjectFinanceCustomer(auth, companyId, project);
        } catch (err) {
          return errorJson("PROJECT_CUSTOMER_RESOLUTION_FAILED", err instanceof Error ? err.message : String(err), 500);
        }
        customerIdByProject.set(project.id, financeCustomerId);
      }
      customerIdsByBasis.set(basisRow.id, financeCustomerId);
    }
    const distinctCustomerIds = new Set(customerIdsByBasis.values());
    if (distinctCustomerIds.size > 1) {
      return errorJson(
        "PROJECT_BASIS_CUSTOMER_MISMATCH",
        "Valda underlag tillhör olika kunder och kan inte slås ihop till en samlingsfaktura.",
        400,
      );
    }
    const financeCustomerId = distinctCustomerIds.values().next().value as string;

    const { data: financeCustomer, error: fcErr } = await auth.adminClient
      .from("vihem_finance_customers")
      .select("name, customer_type, email, phone, address_line1, address_line2, postal_code, city, country_code, organisation_number, payment_terms_days")
      .eq("id", financeCustomerId)
      .maybeSingle();
    if (fcErr || !financeCustomer) return errorJson("NOT_FOUND", "Ekonomikunden hittades inte.", 404);

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
    if ("dry_run" in customerResult) throw new Error("Oväntat dry-run-svar vid kundskapande.");

    const invoiceDate = new Date().toISOString().slice(0, 10);
    const dueDate = new Date(Date.now() + (financeCustomer.payment_terms_days || 30) * 86_400_000).toISOString().slice(0, 10);

    // Adjustments for every distinct project among the selected bases
    // (a customer can have several projects combined into one collection
    // invoice), deduplicated by adjustment id in case the same project
    // appears more than once.
    const distinctProjectIds = Array.from(new Set(resolvedBases.map((b) => b.project.id)));
    const adjustmentsById = new Map<string, BillingAdjustmentRow>();
    for (const projectId of distinctProjectIds) {
      const eligible = await listEligibleAdjustments(auth.adminClient, {
        companyId,
        targetType: "customer_project",
        targetId: projectId,
        period: invoiceDate,
      });
      for (const adj of eligible) adjustmentsById.set(adj.id, adj);
    }
    const eligibleAdjustments = Array.from(adjustmentsById.values());

    const lineItems: AccountedInvoiceItemInput[] = resolvedBases.flatMap(({ basisRow, readyLines }) =>
      readyLines.map((line) => ({
        description: `${line.description} (${basisRow.basis_number || basisRow.title || basisRow.id.slice(0, 8)})`,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unit_price,
        vat_rate: line.vat_rate,
      })),
    );
    const items: AccountedInvoiceItemInput[] = [...lineItems, ...buildAdjustmentLineItems(eligibleAdjustments)];

    const collectionResult = await createAccountedCollectionInvoiceForSources(auth.adminClient, context.link, context.apiKey, {
      sources: resolvedBases.map(({ basisRow }) => ({ sourceType: "customer_project" as const, sourceId: basisRow.id })),
      dryRun,
      createdBy: auth.callerId,
      invoice: {
        accountedCustomerId: customerResult.accounted_customer_id,
        invoiceDate,
        dueDate,
        currency: "SEK",
        items,
        yourReference: resolvedBases.map(({ basisRow }) => basisRow.basis_number).filter(Boolean).join(", ") || undefined,
        notes: `Samlingsfaktura för ${resolvedBases.length} underlag.`,
      },
    });

    if ("dry_run" in collectionResult) return json({ data: { dry_run: true, preview: collectionResult.preview } });

    // Invoice is confirmed created in Accounted from here on.
    if (eligibleAdjustments.length > 0) {
      await recordAdjustmentApplications(auth.adminClient, {
        organisationId: context.link.organisation_id,
        adjustments: eligibleAdjustments,
        billingPeriod: null,
        sourceType: "customer_project",
        sourceId: resolvedBases[0].basisRow.id,
        accountedInvoiceLinkId: collectionResult.links[0].id,
      });
    }

    // The Accounted invoice is confirmed and every source already has its
    // link row (createAccountedCollectionInvoiceForSources wrote those) --
    // a basis's own status/line-status update failing here doesn't change
    // that. Collected as warnings rather than failing the whole response,
    // since unlike the single-basis path there ARE other bases in this
    // request that may have succeeded; each warning still names exactly
    // which basis needs a manual look.
    const warnings: { basis_id: string; error: string }[] = [];
    for (let i = 0; i < resolvedBases.length; i++) {
      const { basisRow } = resolvedBases[i];
      const linkRow = collectionResult.links[i];
      const markResult = await markBasisInvoiced(auth, basisRow.id, linkRow.id, linkRow.accounted_invoice_id);
      if (!markResult.basisUpdated) warnings.push({ basis_id: basisRow.id, error: markResult.basisError! });
    }

    return json(
      {
        data: {
          collection: true,
          accounted_invoice_id: collectionResult.links[0].accounted_invoice_id,
          accounted_invoice_number: collectionResult.links[0].accounted_invoice_number,
          links: collectionResult.links,
          warnings,
        },
      },
      201,
    );
  } catch (err) {
    return respondToError(err);
  }
}

/**
 * Flips a basis (and its ready lines) to invoiced after its Accounted
 * invoice link already exists. Returns whether the basis's own status
 * update succeeded -- callers decide whether that failure should fail the
 * whole response (single-basis) or just be reported as a warning
 * (collection), but neither case should silently swallow it: the invoice
 * side effect in Accounted already happened and is irreversible from here,
 * so a local bookkeeping mismatch must stay visible.
 */
async function markBasisInvoiced(
  auth: AuthContext,
  basisId: string,
  invoiceLinkId: string,
  accountedInvoiceId: string,
): Promise<{ basisUpdated: boolean; basisError?: string }> {
  const { error: updateBasisErr } = await auth.adminClient
    .from("vihem_project_invoice_basis")
    .update({ status: "invoiced", accounted_invoice_link_id: invoiceLinkId })
    .eq("id", basisId);
  if (updateBasisErr) {
    console.error("vihem-accounted-project-billing: invoice created but basis link update failed", {
      basisId,
      accountedInvoiceId,
      error: updateBasisErr.message,
    });
  }

  const { error: updateLinesErr } = await auth.adminClient
    .from("vihem_project_invoice_basis_lines")
    .update({ billing_status: "invoiced" })
    .eq("basis_id", basisId)
    .eq("billing_status", "ready");
  if (updateLinesErr) {
    console.error("vihem-accounted-project-billing: basis invoiced but line status update failed", { basisId, error: updateLinesErr.message });
  }

  return updateBasisErr ? { basisUpdated: false, basisError: updateBasisErr.message } : { basisUpdated: true };
}

function respondToError(err: unknown) {
  if (err instanceof AccountedApiError) {
    return errorJson(err.code, err.message, err.httpStatus >= 400 ? err.httpStatus : 502, {
      recovery_hint: err.recoveryHint,
      details: err.details,
      request_id: err.requestId,
    });
  }
  return errorJson("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), 500);
}
