// Resolves a VI-HEM customer/tenant to an Accounted customer_id: returns the
// existing link if one exists, otherwise creates the customer in Accounted
// and stores the mapping. Accounted is the master for the customer register
// used in actual invoicing (see docs/accounted-v2-integration.md); VI-HEM
// keeps its own operational person/tenant data but never invents its own
// duplicate "billing customer" concept.
//
// Idempotency: the Idempotency-Key sent to Accounted is derived from
// (company_link_id, source_type, source_id), so calling this twice for the
// same VI-HEM record is always safe — either it finds the existing local
// link (fast path) or Accounted itself replays the cached create response.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, corsHeaders, errorJson, isAuthContext, json, requireCompanyAccess } from "../_shared/vihem-auth.ts";
import { decryptAccountedSecret } from "../_shared/accounted-crypto.ts";
import { createAccountedClient, deriveIdempotencyKey, AccountedApiError } from "../_shared/accounted-rest-client.ts";

const SOURCE_TYPES = ["tenancy", "finance_customer", "customer_project_customer", "short_stay_guest"] as const;

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
  if (!SOURCE_TYPES.includes(sourceType as any)) {
    return errorJson("VALIDATION_ERROR", `source_type måste vara en av: ${SOURCE_TYPES.join(", ")}`, 400);
  }
  if (!sourceId) return errorJson("VALIDATION_ERROR", "source_id krävs.", 400);
  if (!customer?.name) return errorJson("VALIDATION_ERROR", "customer.name krävs.", 400);

  const accessError = await requireCompanyAccess(auth, companyId, "seller");
  if (accessError) return accessError;

  const { data: link, error: linkErr } = await auth.adminClient
    .from("vihem_accounted_company_links")
    .select("id, organisation_id, accounted_base_url, accounted_company_id, enabled")
    .eq("company_id", companyId)
    .maybeSingle();
  if (linkErr || !link) return errorJson("ACCOUNTED_NOT_LINKED", "Bolaget är inte kopplat till Accounted ännu.", 400);
  if (!link.enabled) return errorJson("ACCOUNTED_LINK_DISABLED", "Accounted-kopplingen är inaktiverad för bolaget.", 400);

  // Fast path: already linked.
  const { data: existing } = await auth.adminClient
    .from("vihem_accounted_customer_links")
    .select("id, accounted_customer_id, accounted_customer_number, sync_status, last_synced_at")
    .eq("company_link_id", link.id)
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .maybeSingle();
  if (existing) return json({ data: existing });

  const { data: secret, error: secretErr } = await auth.adminClient
    .from("vihem_accounted_secrets")
    .select("encrypted_secret")
    .eq("company_link_id", link.id)
    .eq("secret_type", "api_key")
    .is("webhook_subscription_id", null)
    .maybeSingle();
  if (secretErr || !secret) return errorJson("ACCOUNTED_NO_API_KEY", "Ingen Accounted API-nyckel sparad för bolaget.", 400);

  let apiKey: string;
  try {
    apiKey = await decryptAccountedSecret(secret.encrypted_secret);
  } catch (err) {
    return errorJson("SECRET_DECRYPTION_FAILED", err instanceof Error ? err.message : String(err), 500);
  }

  const client = createAccountedClient({ baseUrl: link.accounted_base_url, apiKey });
  const idempotencyKey = await deriveIdempotencyKey(["customer", link.id, sourceType, sourceId]);

  const accountedPayload = {
    name: customer.name,
    customer_type: mapCustomerType(customer.customer_type),
    email: customer.email || undefined,
    phone: customer.phone || undefined,
    address_line1: customer.address_line1 || undefined,
    address_line2: customer.address_line2 || undefined,
    postal_code: customer.postal_code || undefined,
    city: customer.city || undefined,
    country: customer.country_code || "SE",
    org_number: customer.customer_type !== "individual" ? (customer.organisation_number || undefined) : undefined,
    personal_number: customer.customer_type === "individual" ? (customer.personal_number || undefined) : undefined,
    default_payment_terms: customer.payment_terms_days || undefined,
  };

  try {
    if (dryRun) {
      const preview = await client.post(
        `/api/v1/companies/${encodeURIComponent(link.accounted_company_id)}/customers`,
        accountedPayload,
        { idempotencyKey, dryRun: true },
      );
      return json({ data: { dry_run: true, preview } });
    }

    const created = await client.post<{ id: string; customer_number?: string }>(
      `/api/v1/companies/${encodeURIComponent(link.accounted_company_id)}/customers`,
      accountedPayload,
      { idempotencyKey },
    );

    const { data: inserted, error: insertErr } = await auth.adminClient
      .from("vihem_accounted_customer_links")
      .upsert(
        {
          organisation_id: link.organisation_id,
          company_link_id: link.id,
          source_type: sourceType,
          source_id: sourceId,
          accounted_customer_id: created.id,
          accounted_customer_number: created.customer_number || "",
          sync_status: "linked",
          last_synced_at: new Date().toISOString(),
          created_by: auth.callerId,
        },
        { onConflict: "company_link_id,source_type,source_id" },
      )
      .select("id, accounted_customer_id, accounted_customer_number, sync_status, last_synced_at")
      .single();
    if (insertErr) return errorJson("INTERNAL_ERROR", "Kunde inte spara kundkopplingen.", 500, { details: insertErr.message });

    return json({ data: inserted }, 201);
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

function mapCustomerType(vihemType: string | undefined): "individual" | "swedish_business" | "eu_business" | "non_eu_business" {
  switch (vihemType) {
    case "private":
      return "individual";
    case "company":
    case "brf":
    case "property_owner":
    case "internal":
    default:
      return "swedish_business";
  }
}
