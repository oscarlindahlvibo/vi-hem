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
    const encryptionSecret = Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || "";
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    if (!encryptionSecret) return json({ error: "VIHEM_ACCOUNTING_SECRET_KEY saknas i edge-miljön." }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const integrationId = typeof body.integration_id === "string" ? body.integration_id : "";
    const secretName = typeof body.secret_name === "string" && body.secret_name ? body.secret_name : "primary_token";
    const secretValue = typeof body.secret_value === "string" ? body.secret_value : "";
    const deleteSecret = body.delete_secret === true;

    if (!integrationId) return json({ error: "Saknar bokföringskoppling." }, 400);
    if (!deleteSecret && !secretValue.trim()) return json({ error: "Saknar token eller hemlighet att spara." }, 400);

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
      .select("id, organisation_id, company_id, provider")
      .eq("id", integrationId)
      .maybeSingle();

    if (integrationError || !integration) return json({ error: "Bokföringskopplingen hittades inte." }, 404);

    const allowed = await userCanManageSecret(serviceClient, profile, integration.company_id, integration.organisation_id);
    if (!allowed) return json({ error: "Saknar behörighet att hantera bokföringstoken." }, 403);

    if (deleteSecret) {
      const { error: deleteError } = await serviceClient
        .from("vihem_accounting_integration_secrets")
        .delete()
        .eq("integration_id", integrationId)
        .eq("secret_name", secretName);

      if (deleteError) throw deleteError;
      const { error: integrationUpdateError } = await serviceClient
        .from("vihem_accounting_integrations")
        .update({
          has_secret: false,
          secret_hint: "",
          secret_rotated_at: null,
        })
        .eq("id", integrationId);

      if (integrationUpdateError) throw integrationUpdateError;
      return json({ ok: true, deleted: true, has_secret: false });
    }

    const encryptedSecret = await encryptSecret(secretValue, encryptionSecret);
    const secretHint = buildSecretHint(secretValue);
    const rotatedAt = new Date().toISOString();
    const { error: upsertError } = await serviceClient
      .from("vihem_accounting_integration_secrets")
      .upsert({
        organisation_id: integration.organisation_id,
        company_id: integration.company_id,
        integration_id: integration.id,
        provider: integration.provider,
        secret_name: secretName,
        encrypted_secret: encryptedSecret,
        secret_hint: secretHint,
        updated_by: user.id,
        created_by: user.id,
        rotated_at: rotatedAt,
      }, { onConflict: "integration_id,secret_name" });

    if (upsertError) throw upsertError;

    const { error: integrationUpdateError } = await serviceClient
      .from("vihem_accounting_integrations")
      .update({
        has_secret: true,
        secret_hint: secretHint,
        secret_rotated_at: rotatedAt,
      })
      .eq("id", integrationId);

    if (integrationUpdateError) throw integrationUpdateError;

    return json({
      ok: true,
      has_secret: true,
      secret_hint: secretHint,
      rotated_at: rotatedAt,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

async function userCanManageSecret(serviceClient: any, profile: any, companyId: string, organisationId: string) {
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

async function encryptSecret(secretValue: string, encryptionSecret: string) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest("SHA-256", encoder.encode(encryptionSecret));
  const key = await crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(secretValue));
  const combined = new Uint8Array(iv.byteLength + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

function buildSecretHint(secretValue: string) {
  const trimmed = secretValue.trim();
  if (trimmed.length <= 8) return `${"*".repeat(Math.max(trimmed.length, 4))}`;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
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
