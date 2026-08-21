// Admin surface for the Accounted V2 integration: link a VI-HEM company to
// an Accounted company, store/rotate its API key, run a connectivity test,
// and register the outbound webhook subscriptions Finance V2 needs.
//
// Requires 'admin' company access (org admin or a company-scoped admin
// permission) via vihem_user_has_company_access — same gate the legacy
// finance module's admin-write RLS policies use.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, type AuthContext, corsHeaders, errorJson, isAuthContext, json, requireCompanyAccess } from "../_shared/vihem-auth.ts";
import { decryptAccountedSecret, encryptAccountedSecret, hintFor } from "../_shared/accounted-crypto.ts";
import { createAccountedClient } from "../_shared/accounted-rest-client.ts";

// Accounted only accepts one event_type per webhook subscription (see
// app/api/v1/companies/[companyId]/webhooks/route.ts CreateWebhookSchema),
// so Finance V2's four events of interest need four separate registrations.
const WEBHOOK_EVENT_TYPES = ["invoice.created", "invoice.sent", "invoice.paid", "credit_note.created"] as const;

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

  const action = String(body?.action || "");
  const companyId = String(body?.company_id || "");
  if (!companyId) return errorJson("VALIDATION_ERROR", "company_id krävs.", 400);

  const accessError = await requireCompanyAccess(auth, companyId, "admin");
  if (accessError) return accessError;

  const { data: company, error: companyErr } = await auth.adminClient
    .from("vihem_companies")
    .select("id, organisation_id")
    .eq("id", companyId)
    .maybeSingle();
  if (companyErr || !company) return errorJson("NOT_FOUND", "Bolaget hittades inte.", 404);

  switch (action) {
    case "save_company_link":
      return handleSaveCompanyLink(auth, company, body);
    case "test_connection":
      return handleTestConnection(auth, companyId);
    case "register_webhooks":
      return handleRegisterWebhooks(auth, companyId);
    default:
      return errorJson("VALIDATION_ERROR", `Okänd action: ${action}`, 400);
  }
});

async function handleSaveCompanyLink(auth: AuthContext, company: { id: string; organisation_id: string }, body: any) {
  const baseUrl = String(body?.accounted_base_url || "").trim().replace(/\/$/, "");
  const accountedCompanyId = String(body?.accounted_company_id || "").trim();
  const apiKey: string | undefined = typeof body?.api_key === "string" ? body.api_key.trim() : undefined;
  const enabled = Boolean(body?.enabled);

  if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
    return errorJson("VALIDATION_ERROR", "accounted_base_url måste vara en https-URL.", 400);
  }
  if (!accountedCompanyId) return errorJson("VALIDATION_ERROR", "accounted_company_id krävs.", 400);

  const { data: link, error: upsertErr } = await auth.adminClient
    .from("vihem_accounted_company_links")
    .upsert(
      {
        organisation_id: company.organisation_id,
        company_id: company.id,
        accounted_base_url: baseUrl,
        accounted_company_id: accountedCompanyId,
        enabled,
        updated_by: auth.callerId,
      },
      { onConflict: "company_id" },
    )
    .select("id, organisation_id, company_id, accounted_base_url, accounted_company_id, enabled, last_health_status, last_health_check_at, last_sync_at, created_at, updated_at")
    .single();

  if (upsertErr) return errorJson("INTERNAL_ERROR", "Kunde inte spara bolagskopplingen.", 500, { details: upsertErr.message });

  if (apiKey) {
    if (!apiKey.startsWith("gnubok_sk_")) {
      return errorJson("VALIDATION_ERROR", "API-nyckeln ser inte ut som en giltig Accounted-nyckel (ska börja med gnubok_sk_).", 400);
    }
    let encrypted: string;
    try {
      encrypted = await encryptAccountedSecret(apiKey);
    } catch (err) {
      return errorJson("SECRET_ENCRYPTION_UNAVAILABLE", err instanceof Error ? err.message : String(err), 500);
    }
    const { error: secretErr } = await auth.adminClient
      .from("vihem_accounted_secrets")
      .upsert(
        {
          organisation_id: company.organisation_id,
          company_link_id: link.id,
          secret_type: "api_key",
          webhook_subscription_id: null,
          encrypted_secret: encrypted,
          secret_hint: hintFor(apiKey),
          rotated_at: new Date().toISOString(),
          created_by: auth.callerId,
        },
        { onConflict: "company_link_id,secret_type,webhook_subscription_id" },
      );
    if (secretErr) return errorJson("INTERNAL_ERROR", "Kunde inte spara API-nyckeln.", 500, { details: secretErr.message });
  }

  return json({ data: link });
}

interface CompanyLinkRow {
  id: string;
  organisation_id: string;
  accounted_base_url: string;
  accounted_company_id: string;
}

type LoadCompanyLinkResult =
  | { error: Response; link?: undefined; client?: undefined }
  | { error?: undefined; link: CompanyLinkRow; client: ReturnType<typeof createAccountedClient> };

async function loadCompanyLinkAndClient(auth: AuthContext, companyId: string): Promise<LoadCompanyLinkResult> {
  const { data: link, error: linkErr } = await auth.adminClient
    .from("vihem_accounted_company_links")
    .select("id, organisation_id, accounted_base_url, accounted_company_id")
    .eq("company_id", companyId)
    .maybeSingle();
  if (linkErr || !link) {
    return { error: errorJson("ACCOUNTED_NOT_LINKED", "Bolaget är inte kopplat till Accounted ännu.", 400) };
  }

  const { data: secret, error: secretErr } = await auth.adminClient
    .from("vihem_accounted_secrets")
    .select("encrypted_secret")
    .eq("company_link_id", link.id)
    .eq("secret_type", "api_key")
    .is("webhook_subscription_id", null)
    .maybeSingle();
  if (secretErr || !secret) {
    return { error: errorJson("ACCOUNTED_NO_API_KEY", "Ingen Accounted API-nyckel sparad för bolaget.", 400) };
  }

  let apiKey: string;
  try {
    apiKey = await decryptAccountedSecret(secret.encrypted_secret);
  } catch (err) {
    return { error: errorJson("SECRET_DECRYPTION_FAILED", err instanceof Error ? err.message : String(err), 500) };
  }

  const client = createAccountedClient({ baseUrl: link.accounted_base_url, apiKey });
  return { link, client };
}

async function handleTestConnection(auth: AuthContext, companyId: string) {
  const resolved = await loadCompanyLinkAndClient(auth, companyId);
  if (resolved.error) return resolved.error;
  const { link, client } = resolved;

  const result = await client!.healthCheck(link!.accounted_company_id);

  await auth.adminClient
    .from("vihem_accounted_company_links")
    .update({
      last_health_check_at: new Date().toISOString(),
      last_health_status: result.ok ? "ok" : "error",
      last_health_error: result.ok ? "" : `${result.error?.code}: ${result.error?.message}`,
    })
    .eq("id", link!.id);

  if (!result.ok) {
    return errorJson(result.error!.code, result.error!.message, 502, {
      recovery_hint: result.error!.recovery_hint,
      details: result.error!.details,
    });
  }
  return json({ data: { ok: true } });
}

async function handleRegisterWebhooks(auth: AuthContext, companyId: string) {
  const resolved = await loadCompanyLinkAndClient(auth, companyId);
  if (resolved.error) return resolved.error;
  const { link, client } = resolved;

  const webhookBaseUrl = (Deno.env.get("VIHEM_ACCOUNTED_WEBHOOK_URL") || `${Deno.env.get("SUPABASE_URL")}/functions/v1/vihem-accounted-webhook`).replace(/\/$/, "");

  const results: Record<string, { ok: boolean; error?: string }> = {};

  for (const eventType of WEBHOOK_EVENT_TYPES) {
    const { data: existing } = await auth.adminClient
      .from("vihem_accounted_webhook_subscriptions")
      .select("id, accounted_webhook_id")
      .eq("company_link_id", link!.id)
      .eq("event_type", eventType)
      .maybeSingle();

    if (existing?.accounted_webhook_id) {
      results[eventType] = { ok: true };
      continue;
    }

    const callbackUrl = `${webhookBaseUrl}?link=${encodeURIComponent(link!.id)}&event=${encodeURIComponent(eventType)}`;
    const idempotencyKey = `vihem-webhook-${link!.id}-${eventType}`;

    try {
      const created = await client!.post<{ id: string; secret: string }>(
        `/api/v1/companies/${encodeURIComponent(link!.accounted_company_id)}/webhooks`,
        { event_type: eventType, webhook_url: callbackUrl, name: `VI-HEM (${eventType})` },
        { idempotencyKey },
      );

      const { data: subscription, error: subErr } = await auth.adminClient
        .from("vihem_accounted_webhook_subscriptions")
        .upsert(
          {
            organisation_id: link!.organisation_id,
            company_link_id: link!.id,
            event_type: eventType,
            accounted_webhook_id: created.id,
            active: true,
          },
          { onConflict: "company_link_id,event_type" },
        )
        .select("id")
        .single();
      if (subErr || !subscription) throw new Error(subErr?.message || "Kunde inte spara webhook-prenumerationen.");

      const encrypted = await encryptAccountedSecret(created.secret);
      const { error: secretErr } = await auth.adminClient.from("vihem_accounted_secrets").upsert(
        {
          organisation_id: link!.organisation_id,
          company_link_id: link!.id,
          secret_type: "webhook_secret",
          webhook_subscription_id: subscription.id,
          encrypted_secret: encrypted,
          secret_hint: hintFor(created.secret),
          rotated_at: new Date().toISOString(),
          created_by: auth.callerId,
        },
        { onConflict: "company_link_id,secret_type,webhook_subscription_id" },
      );
      if (secretErr) throw new Error(secretErr.message);

      results[eventType] = { ok: true };
    } catch (err) {
      results[eventType] = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return json({ data: { results } });
}
