import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const text = (value: unknown, max = 5000) => String(value ?? "").trim().slice(0, max);

function normalisePhone(value: unknown) {
  const raw = text(value, 40).replace(/[\s()\-]/g, "");
  if (raw.startsWith("+")) return `00${raw.slice(1)}`;
  if (raw.startsWith("0")) return `0046${raw.slice(1)}`;
  return raw;
}

function uuidOrNull(value: unknown) {
  const candidate = text(value, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : null;
}

async function staff(supabase: any, request: Request) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: auth } = await supabase.auth.getUser(token);
  if (!auth.user) return null;
  const { data: profile } = await supabase.from("vihem_profiles").select("id,role,organisation_id").eq("id", auth.user.id).maybeSingle();
  return profile && ["staff", "admin", "superadmin"].includes(profile.role) ? { auth: auth.user, profile } : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let logId = "";
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const actor = await staff(supabase, request);
    if (!actor) return json({ error: "Personalbehörighet krävs." }, 403);
    const body = await request.json().catch(() => ({}));
    const organisationId = text(body.organisation_id, 80);
    if (actor.profile.role !== "superadmin" && actor.profile.organisation_id !== organisationId) return json({ error: "Organisationen kan inte användas här." }, 403);
    const recipient = normalisePhone(body.recipient);
    const message = text(body.message, 4000);
    if (!organisationId || !recipient || !message) return json({ error: "organisation_id, recipient och message krävs." }, 400);
    const { data: settings } = await supabase.from("vihem_sms_settings").select("enabled,sender").eq("organisation_id", organisationId).maybeSingle();
    if (settings && !settings.enabled) return json({ error: "SMS är inte aktiverat för organisationen." }, 409);
    const sender = text(settings?.sender || Deno.env.get("CELLSYNT_SENDER"), 11);
    const username = Deno.env.get("CELLSYNT_USERNAME");
    const password = Deno.env.get("CELLSYNT_PASSWORD");
    const endpoint = Deno.env.get("CELLSYNT_API_URL") || "https://se-1.cellsynt.net/sms.php";
    if (!username || !password || !sender) return json({ error: "Cellsynt är inte komplett konfigurerat på servern." }, 503);
    const { data: log, error: logError } = await supabase.from("vihem_sms_messages").insert({ organisation_id: organisationId, provider: "cellsynt", recipient, message, status: "sending", related_type: text(body.related_type, 80), related_id: uuidOrNull(body.related_id), created_by: actor.profile.id }).select("id").single();
    if (logError) throw logError;
    logId = log.id;
    const params = new URLSearchParams({ username, password, destination: recipient, type: "text", charset: "UTF-8", text: message, originatortype: "alpha", originator: sender });
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params });
    const result = await response.text();
    if (!response.ok || !result.trim().startsWith("OK:")) throw new Error(result.trim() || `Cellsynt svarade med HTTP ${response.status}.`);
    const externalId = result.trim().replace(/^OK:\s*/i, "").slice(0, 200);
    await supabase.from("vihem_sms_messages").update({ status: "sent", external_id: externalId, sent_at: new Date().toISOString() }).eq("id", logId);
    return json({ ok: true, message_id: logId, external_id: externalId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMS-utskicket misslyckades.";
    if (logId) {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await supabase.from("vihem_sms_messages").update({ status: "failed", error: message }).eq("id", logId);
    }
    console.error("vihem-send-sms error:", message);
    return json({ error: message }, 502);
  }
});
