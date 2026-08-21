// Lets a tenant fetch the PDF of their OWN rent invoice, proxied through
// VI-HEM because the Accounted API key can never reach the browser. Ownership
// is verified manually (this uses the service-role client, which bypasses
// RLS) by walking source_type='rental_billing' -> vihem_rent_billing_items
// -> tenant_id === caller.id, the same relation the tenant-facing SELECT RLS
// policy on vihem_accounted_invoice_links now uses for the list view (see
// 20260821160000_accounted_v2_tenant_invoice_view.sql) -- kept in application
// code here too since a signed-URL/PDF response can't rely on Postgres RLS
// the way a table read can.
//
// GET (not POST): this is a pure read of an already-existing invoice, no
// state change, matches Accounted's own convention for its PDF endpoint.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { AccountedContextError, loadAccountedCompanyContext } from "../_shared/accounted-company-context.ts";
import { createAccountedClient, AccountedApiError } from "../_shared/accounted-rest-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function errorJson(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "GET") return errorJson("METHOD_NOT_ALLOWED", "Endast GET stöds.", 405);

  const url = new URL(req.url);
  const invoiceLinkId = url.searchParams.get("invoice_link_id") || "";
  if (!invoiceLinkId) return errorJson("VALIDATION_ERROR", "invoice_link_id krävs.", 400);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorJson("UNAUTHORIZED", "Saknar Authorization-header.", 401);

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerErr } = await userClient.auth.getUser();
  if (callerErr || !caller) return errorJson("UNAUTHORIZED", "Ogiltig session.", 401);

  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: invoiceLink, error: linkErr } = await adminClient
    .from("vihem_accounted_invoice_links")
    .select("id, company_link_id, source_type, source_id, accounted_invoice_id")
    .eq("id", invoiceLinkId)
    .maybeSingle();
  if (linkErr || !invoiceLink) return errorJson("NOT_FOUND", "Fakturan hittades inte.", 404);

  if (invoiceLink.source_type !== "rental_billing") {
    return errorJson("FORBIDDEN", "Den här fakturatypen kan inte visas i hyresgästportalen.", 403);
  }

  const { data: billingItem, error: itemErr } = await adminClient
    .from("vihem_rent_billing_items")
    .select("id, tenant_id")
    .eq("id", invoiceLink.source_id)
    .maybeSingle();
  if (itemErr || !billingItem || billingItem.tenant_id !== caller.id) {
    // 404, not 403: don't confirm to a probing caller that a given
    // invoice_link_id exists but belongs to someone else.
    return errorJson("NOT_FOUND", "Fakturan hittades inte.", 404);
  }

  const { data: companyLink, error: companyLinkErr } = await adminClient
    .from("vihem_accounted_company_links")
    .select("company_id")
    .eq("id", invoiceLink.company_link_id)
    .maybeSingle();
  if (companyLinkErr || !companyLink) return errorJson("NOT_FOUND", "Bolagskopplingen hittades inte.", 404);

  try {
    const context = await loadAccountedCompanyContext(adminClient, companyLink.company_id);
    const client = createAccountedClient({ baseUrl: context.link.accounted_base_url, apiKey: context.apiKey });
    const pdf = await client.getBinary(
      `/api/v1/companies/${encodeURIComponent(context.link.accounted_company_id)}/invoices/${encodeURIComponent(invoiceLink.accounted_invoice_id)}/pdf`,
    );
    return new Response(pdf.bytes, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": pdf.contentType, "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    if (err instanceof AccountedContextError) return errorJson(err.code, err.message, 502);
    if (err instanceof AccountedApiError) return errorJson(err.code, err.message, err.httpStatus >= 400 ? err.httpStatus : 502);
    return errorJson("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), 500);
  }
});
