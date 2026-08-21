import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createAccountedService } from "../_shared/accounted.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const integrationId = typeof body.integration_id === "string" ? body.integration_id : "";
    if (!integrationId) return json({ error: "Saknar bokföringskoppling." }, 400);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile, error: profileError } = await serviceClient
      .from("vihem_profiles")
      .select("id, role, organisation_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) return json({ error: "Kunde inte verifiera användaren." }, 403);

    const { data: integration, error: integrationError } = await serviceClient
      .from("vihem_accounting_integrations")
      .select("id, organisation_id, company_id, provider, has_secret, config")
      .eq("id", integrationId)
      .maybeSingle();

    if (integrationError || !integration) return json({ error: "Bokföringskopplingen hittades inte." }, 404);

    const allowed = await userCanManageIntegration(serviceClient, profile, integration.company_id, integration.organisation_id);
    if (!allowed) return json({ error: "Saknar behörighet att testa bokföringskoppling." }, 403);

    const provider = integration.provider || "manual";
    const isLocalExport = ["manual", "sie", "none"].includes(provider);
    const secret = !isLocalExport && integration.has_secret
      ? await loadIntegrationSecret(serviceClient, integration.id)
      : "";
    const missingSecret = !isLocalExport && !secret;
    let adapterMessage = "";
    if (!missingSecret && provider === "accounted") {
      await createAccountedService(integration, secret).testConnection();
      adapterMessage = " Accounted API svarade korrekt.";
    }
    const message = missingSecret
      ? `Saknar sparad token för ${provider}.`
      : isLocalExport
        ? `${provider === "sie" ? "SIE" : "Manuell export"} är redo.`
        : `Token finns för ${provider}.${adapterMessage || " Kopplingen är redo."}`;

    const { error: updateError } = await serviceClient
      .from("vihem_accounting_integrations")
      .update({
        status: missingSecret ? "error" : "active",
        last_sync_at: new Date().toISOString(),
        config: {
          ...(integration.config || {}),
          last_tested_at: new Date().toISOString(),
          last_test_result: missingSecret ? "missing_secret" : "ok",
          last_test_message: message,
        },
      })
      .eq("id", integration.id);

    if (updateError) throw updateError;

    return json({
      ok: !missingSecret,
      status: missingSecret ? "error" : "active",
      provider,
      message,
    }, missingSecret ? 400 : 200);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

async function userCanManageIntegration(serviceClient: any, profile: any, companyId: string, organisationId: string) {
  if (profile.role === "superadmin") return true;
  if (profile.organisation_id !== organisationId) return false;
  if (profile.role === "admin") return true;

  const { data, error } = await serviceClient
    .from("vihem_company_user_permissions")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", profile.id)
    .eq("active", true)
    .in("role", ["bookkeeper", "admin"])
    .limit(1);

  if (error) throw error;
  return (data || []).length > 0;
}

async function loadIntegrationSecret(serviceClient: any, integrationId: string) {
  const encryptionSecret = Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || "";
  if (!encryptionSecret) return "";
  const { data, error } = await serviceClient
    .from("vihem_accounting_integration_secrets")
    .select("encrypted_secret")
    .eq("integration_id", integrationId)
    .eq("secret_name", "primary_token")
    .maybeSingle();
  if (error) throw error;
  if (!data?.encrypted_secret) return "";
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest("SHA-256", encoder.encode(encryptionSecret));
  const key = await crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["decrypt"]);
  const bytes = Uint8Array.from(atob(String(data.encrypted_secret)), char => char.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return new TextDecoder().decode(plain);
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
