// Proactive Accounted connectivity check, run on a schedule by pg_cron
// (see supabase/migrations/*_accounted_v2_scheduled_healthcheck.sql) instead
// of relying on someone remembering to click "Testa anslutning" in the
// Bolagskoppling tab. Iterates every ENABLED vihem_accounted_company_links
// row and runs the exact same check that button triggers manually --
// runAccountedHealthCheck is the single shared implementation, so the two
// paths can never drift apart.
//
// Auth follows the same dual pattern as the other scheduled functions in
// this codebase (vihem-sync-beds24-bookings, vihem-gmail): a superadmin JWT
// for an on-demand manual run (useful while setting up a new company link),
// or the per-feature shared secret pg_cron sends -- never both required.
// verify_jwt must be OFF for this function (see supabase/config.toml) since
// the scheduled call carries no Supabase JWT at all.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { runAccountedHealthCheck } from "../_shared/accounted-company-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SETTINGS_KEY = "accounted_scheduled_healthcheck";
const SECRET_HEADER = "x-vihem-accounted-healthcheck-secret";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  let authorized = false;

  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader) {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (user) {
      const { data: profile } = await adminClient.from("vihem_profiles").select("role").eq("id", user.id).maybeSingle();
      if (profile?.role === "superadmin") authorized = true;
    }
  }

  if (!authorized) {
    const providedSecret = req.headers.get(SECRET_HEADER) || "";
    const { data: settingsRow } = await adminClient
      .from("vihem_system_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    const expectedSecret = settingsRow?.value && typeof settingsRow.value === "object" ? String((settingsRow.value as any).secret || "") : "";
    if (providedSecret && expectedSecret && providedSecret === expectedSecret) authorized = true;
  }

  if (!authorized) return json({ error: { code: "UNAUTHORIZED", message: "Saknar behörighet." } }, 401);

  const { data: links, error: linksErr } = await adminClient
    .from("vihem_accounted_company_links")
    .select("id, company_id")
    .eq("enabled", true);
  if (linksErr) return json({ error: { code: "INTERNAL_ERROR", message: linksErr.message } }, 500);

  const results: { company_id: string; ok: boolean; error?: string }[] = [];
  for (const link of (links ?? []) as { id: string; company_id: string }[]) {
    try {
      const result = await runAccountedHealthCheck(adminClient, link.company_id);
      results.push({
        company_id: link.company_id,
        ok: result.ok,
        error: result.ok ? undefined : `${result.error?.code}: ${result.error?.message}`,
      });
    } catch (err) {
      results.push({ company_id: link.company_id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return json({
    data: {
      checked: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    },
  });
});
