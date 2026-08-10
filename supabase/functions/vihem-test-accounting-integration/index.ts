import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    const missingSecret = !isLocalExport && !integration.has_secret;
    const message = missingSecret
      ? `Saknar sparad token för ${provider}.`
      : isLocalExport
        ? `${provider === "sie" ? "SIE" : "Manuell export"} är redo.`
        : `Token finns för ${provider}. Riktig API-verifiering byggs i adaptersteget.`;

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

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
