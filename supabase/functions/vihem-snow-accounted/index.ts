import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authenticate,
  corsHeaders,
  isAuthContext,
  json,
  errorJson,
  requireCompanyAccess,
} from "../_shared/vihem-auth.ts";
import {
  AccountedContextError,
  loadAccountedCompanyContext,
} from "../_shared/accounted-company-context.ts";
import {
  resolveOrCreateAccountedCustomer,
  type VihemCustomerInput,
} from "../_shared/accounted-customer-resolver.ts";
import {
  AccountedApiError,
  createAccountedClient,
  deriveIdempotencyKey,
} from "../_shared/accounted-rest-client.ts";
import {
  snowAccountedPayload,
  type SnowInvoiceSnapshot,
} from "../_shared/snow-accounted-payload.ts";
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")
    return errorJson("METHOD_NOT_ALLOWED", "Endast POST", 405);
  const auth = await authenticate(req);
  if (!isAuthContext(auth)) return auth;
  const { data: admin, error: accessError } =
    await auth.userClient.rpc("vihem_snow_admin");
  if (accessError || admin !== true)
    return errorJson("FORBIDDEN", "Aktiv snöadministration krävs", 403);
  const body = await req.json().catch(() => null),
    id = String(body?.batch_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return errorJson("VALIDATION", "Ogiltigt underlags-ID");
  const { data: source, error: sourceError } = await auth.adminClient
    .from("vihem_snow_invoice_batches")
    .select("company_id,organisation_id")
    .eq("id", id)
    .eq("organisation_id", auth.callerProfile.organisation_id)
    .maybeSingle();
  if (sourceError || !source)
    return errorJson("NOT_FOUND", "Underlaget saknas", 404);
  const companyAccess = await requireCompanyAccess(
    auth,
    source.company_id,
    "seller",
  );
  if (companyAccess) return companyAccess;
  const attempt = crypto.randomUUID();
  let claimed = false;
  try {
    const context = await loadAccountedCompanyContext(
      auth.adminClient,
      source.company_id,
    );
    const reconcileId = String(body?.reconcile_invoice_id || "");
    if (reconcileId && !/^[0-9a-f-]{36}$/i.test(reconcileId))
      return errorJson("VALIDATION", "Ogiltigt Accounted-ID");
    const { data: batch, error: claimError } = await auth.adminClient.rpc(
      "vihem_snow_invoice_claim",
      { p_id: id, p_attempt: attempt, p_reconcile: !!reconcileId },
    );
    if (claimError)
      return errorJson(
        "BUSY",
        claimError.message || "Överföring pågår. Kontrollera igen senare.",
        409,
      );
    if (batch.state === "draft_created")
      return json({
        state: "draft_created",
        invoice_id: batch.accounted_invoice_id,
      });
    claimed = true;
    const integrationContext = {
      company_link_id: context.link.id,
      accounted_company_id: context.link.accounted_company_id,
      base_url: context.link.accounted_base_url,
    };
    if (
      batch.external_payload &&
      Object.entries(integrationContext).some(
        ([k, v]) => batch.external_context?.[k] !== v,
      )
    )
      throw Error("ACCOUNTED_CONTEXT_CHANGED");
    let payload = batch.external_payload;
    if (!payload) {
      const customer = await resolveOrCreateAccountedCustomer(
        auth.adminClient,
        context.link,
        context.apiKey,
        {
          sourceType: "finance_customer",
          sourceId: batch.customer_id,
          customer: batch.snapshot.customer as VihemCustomerInput,
          createdBy: auth.callerId,
        },
      );
      if ("dry_run" in customer) throw Error("Oväntat kundsvar");
      payload = snowAccountedPayload(
        batch.snapshot as SnowInvoiceSnapshot,
        customer.accounted_customer_id,
        batch.reference,
        id,
      );
      const { error } = await auth.adminClient.rpc(
        "vihem_snow_invoice_payload",
        {
          p_id: id,
          p_attempt: attempt,
          p_payload: payload,
          p_context: integrationContext,
        },
      );
      if (error) throw Error("Payload kunde inte låsas");
    }
    const client = createAccountedClient({
      baseUrl: context.link.accounted_base_url,
      apiKey: context.apiKey,
    });
    const response = reconcileId
      ? await client.get(
          `/api/v1/companies/${encodeURIComponent(context.link.accounted_company_id)}/invoices/${encodeURIComponent(reconcileId)}`,
        )
      : await client.post(
          `/api/v1/companies/${encodeURIComponent(context.link.accounted_company_id)}/invoices`,
          payload,
          {
            idempotencyKey: await deriveIdempotencyKey([
              "snow-draft",
              context.link.id,
              id,
            ]),
          },
        );
    const { error } = await auth.adminClient.rpc("vihem_snow_invoice_finish", {
      p_id: id,
      p_attempt: attempt,
      p_company_link: context.link.id,
      p_response: response,
    });
    if (error) throw Error("Svaret kunde inte stämmas av eller sparas lokalt");
    return json({ state: "draft_created" });
  } catch (error) {
    const code =
      error instanceof AccountedApiError ||
      error instanceof AccountedContextError
        ? error.code
        : error instanceof Error &&
            error.message === "ACCOUNTED_CONTEXT_CHANGED"
          ? error.message
          : "SNOW_ACCOUNTED_UNCONFIRMED";
    console.error("Snow draft integration", { batch_id: id, code });
    if (claimed)
      await auth.adminClient.rpc("vihem_snow_invoice_uncertain", {
        p_id: id,
        p_attempt: attempt,
        p_error:
          code +
          ": Extern status eller lokal kvittens kunde inte säkerställas. Återförsök samma underlag; ändrad bolagskoppling kräver manuell kontroll.",
      });
    return errorJson(
      "SNOW_ACCOUNTED_UNCONFIRMED",
      "Ingen ny faktura är bekräftad i VI-HEM. Kontrollera bolagskoppling och underlag; återförsök samma underlag.",
      502,
    );
  }
});
