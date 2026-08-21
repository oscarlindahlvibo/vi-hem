// Resolves a VI-HEM customer/tenant to an Accounted customer_id: returns the
// existing link if one exists, otherwise creates the customer in Accounted
// and stores the mapping. Accounted is the master for the customer register
// used in actual invoicing (see docs/accounted-v2-integration.md); VI-HEM
// keeps its own operational person/tenant data but never invents its own
// duplicate "billing customer" concept.
//
// Thin HTTP wrapper around the shared resolver in
// _shared/accounted-customer-resolver.ts -- batch callers (rent billing,
// future customer-project billing) call that module directly in-process
// instead of round-tripping through this function.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, corsHeaders, errorJson, isAuthContext, json, requireCompanyAccess } from "../_shared/vihem-auth.ts";
import { AccountedContextError, loadAccountedCompanyContext } from "../_shared/accounted-company-context.ts";
import {
  ACCOUNTED_CUSTOMER_SOURCE_TYPES,
  resolveOrCreateAccountedCustomer,
  type AccountedCustomerSourceType,
} from "../_shared/accounted-customer-resolver.ts";
import { AccountedApiError } from "../_shared/accounted-rest-client.ts";

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
  const sourceType = String(body?.source_type || "");
  const sourceId = String(body?.source_id || "");
  const dryRun = Boolean(body?.dry_run);
  const customer = body?.customer || {};

  if (!companyId) return errorJson("VALIDATION_ERROR", "company_id krävs.", 400);
  if (!ACCOUNTED_CUSTOMER_SOURCE_TYPES.includes(sourceType as AccountedCustomerSourceType)) {
    return errorJson("VALIDATION_ERROR", `source_type måste vara en av: ${ACCOUNTED_CUSTOMER_SOURCE_TYPES.join(", ")}`, 400);
  }
  if (!sourceId) return errorJson("VALIDATION_ERROR", "source_id krävs.", 400);
  if (!customer?.name) return errorJson("VALIDATION_ERROR", "customer.name krävs.", 400);

  const accessError = await requireCompanyAccess(auth, companyId, "seller");
  if (accessError) return accessError;

  try {
    const context = await loadAccountedCompanyContext(auth.adminClient, companyId);
    const result = await resolveOrCreateAccountedCustomer(auth.adminClient, context.link, context.apiKey, {
      sourceType: sourceType as AccountedCustomerSourceType,
      sourceId,
      customer,
      dryRun,
      createdBy: auth.callerId,
    });
    if ("dry_run" in result) return json({ data: result });
    return json({ data: result });
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
