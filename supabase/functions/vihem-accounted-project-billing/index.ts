// Creates the real Accounted invoice for a customer-project invoice basis
// ("faktureringsunderlag") that's ready_for_invoicing.
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
// A basis can only be invoiced once: it's picked up here only when BOTH
// finance_invoice_id (legacy) and accounted_invoice_link_id (this function)
// are still null.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, corsHeaders, errorJson, isAuthContext, json, requireCompanyAccess } from "../_shared/vihem-auth.ts";
import { AccountedContextError, loadAccountedCompanyContext } from "../_shared/accounted-company-context.ts";
import { resolveOrCreateAccountedCustomer, type VihemCustomerInput } from "../_shared/accounted-customer-resolver.ts";
import { createAccountedInvoiceForSource, type AccountedInvoiceItemInput } from "../_shared/accounted-invoice-creator.ts";
import { AccountedApiError } from "../_shared/accounted-rest-client.ts";

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
  const basisId = String(body?.basis_id || "");
  const dryRun = Boolean(body?.dry_run);
  if (!companyId) return errorJson("VALIDATION_ERROR", "company_id krävs.", 400);
  if (!basisId) return errorJson("VALIDATION_ERROR", "basis_id krävs.", 400);

  // Same minimum role vihem_create_invoice_from_project_basis requires.
  const accessError = await requireCompanyAccess(auth, companyId, "seller");
  if (accessError) return accessError;

  let context;
  try {
    context = await loadAccountedCompanyContext(auth.adminClient, companyId);
  } catch (err) {
    if (err instanceof AccountedContextError) return errorJson(err.code, err.message, 400);
    throw err;
  }

  const { data: basis, error: basisErr } = await auth.adminClient
    .from("vihem_project_invoice_basis")
    .select("id, project_id, status, title, description, basis_number, finance_invoice_id, accounted_invoice_link_id")
    .eq("id", basisId)
    .maybeSingle();
  if (basisErr || !basis) return errorJson("NOT_FOUND", "Faktureringsunderlaget hittades inte.", 404);
  const basisRow = basis as BasisRow;

  if (basisRow.finance_invoice_id || basisRow.accounted_invoice_link_id) {
    return errorJson("PROJECT_BASIS_ALREADY_INVOICED", "Underlaget är redan fakturerat.", 400);
  }
  if (basisRow.status !== "ready_for_invoicing") {
    return errorJson(
      "PROJECT_BASIS_NOT_READY",
      `Underlaget har status "${basisRow.status}" och behöver vara "ready_for_invoicing".`,
      400,
    );
  }

  const { data: project, error: projectErr } = await auth.adminClient
    .from("vihem_customer_projects")
    .select("id, organisation_id, company_id, title, name")
    .eq("id", basisRow.project_id)
    .maybeSingle();
  if (projectErr || !project) return errorJson("NOT_FOUND", "Kundprojektet hittades inte.", 404);
  if (project.company_id !== companyId) {
    return errorJson("VALIDATION_ERROR", "Underlaget tillhör inte det angivna bolaget.", 400);
  }

  const { data: lines, error: linesErr } = await auth.adminClient
    .from("vihem_project_invoice_basis_lines")
    .select("description, quantity, unit, unit_price, vat_rate, billing_status")
    .eq("basis_id", basisId)
    .eq("billing_status", "ready");
  if (linesErr) return errorJson("INTERNAL_ERROR", "Kunde inte läsa underlagsraderna.", 500, { details: linesErr.message });
  const readyLines = (lines ?? []) as BasisLineRow[];
  if (readyLines.length === 0) {
    return errorJson("PROJECT_BASIS_NO_LINES", "Underlaget har inga fakturerbara rader.", 400);
  }

  try {
    // Reuses the exact match-or-create-customer logic the legacy RPC uses,
    // via userClient so auth.uid() (the SECURITY DEFINER function's own
    // access check) resolves to the calling user, not the service role.
    const { data: financeCustomerId, error: rpcErr } = await auth.userClient.rpc(
      "vihem_ensure_finance_customer_for_project",
      {
        target_organisation_id: project.organisation_id,
        target_company_id: companyId,
        target_project_id: project.id,
      },
    );
    if (rpcErr || !financeCustomerId) {
      return errorJson("PROJECT_CUSTOMER_RESOLUTION_FAILED", rpcErr?.message || "Kunde inte hitta/skapa ekonomikund för projektet.", 500);
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
    const items: AccountedInvoiceItemInput[] = readyLines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unit_price: line.unit_price,
      vat_rate: line.vat_rate,
    }));

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

    const { error: updateBasisErr } = await auth.adminClient
      .from("vihem_project_invoice_basis")
      .update({ status: "invoiced", accounted_invoice_link_id: invoiceResult.link.id })
      .eq("id", basisId);
    if (updateBasisErr) {
      // The invoice exists in Accounted and in vihem_accounted_invoice_links;
      // only the basis's own pointer failed. Surface the id for manual fix
      // rather than silently leaving the basis looking un-invoiced.
      return errorJson(
        "PROJECT_BASIS_LINK_UPDATE_FAILED",
        `Fakturan skapades (Accounted-id ${invoiceResult.link.accounted_invoice_id}) men underlaget kunde inte uppdateras: ${updateBasisErr.message}`,
        500,
        { accounted_invoice_id: invoiceResult.link.accounted_invoice_id },
      );
    }

    const { error: updateLinesErr } = await auth.adminClient
      .from("vihem_project_invoice_basis_lines")
      .update({ billing_status: "invoiced" })
      .eq("basis_id", basisId)
      .eq("billing_status", "ready");
    if (updateLinesErr) {
      console.error("vihem-accounted-project-billing: basis invoiced but line status update failed", {
        basisId,
        error: updateLinesErr.message,
      });
    }

    return json({ data: invoiceResult.link }, 201);
  } catch (err) {
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
