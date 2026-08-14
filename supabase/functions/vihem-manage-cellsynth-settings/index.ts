import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const db = createClient(url, serviceKey);
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: profile } = await db.from("vihem_profiles").select("id,role,organisation_id").eq("id", user.id).maybeSingle();
    if (!profile?.organisation_id || !["admin", "superadmin"].includes(profile.role)) return json({ error: "Endast admin kan hantera Cellsynt." }, 403);
    const body = await req.json().catch(() => ({}));
    const existing = await getSettings(db, profile.organisation_id);
    if (body.action === "get") return json({ ok: true, settings: publicSettings(existing) });
    if (body.action !== "save") return json({ error: "Okänd åtgärd." }, 400);
    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    const apiUrl = String(body.api_url || "").trim();
    if (!username && !existing?.encrypted_username) return json({ error: "Cellsynt användarnamn krävs." }, 400);
    if (!password && !existing?.encrypted_password) return json({ error: "Cellsynt lösenord krävs." }, 400);
    const secret = encryptionSecret(serviceKey);
    const row = {
      organisation_id: profile.organisation_id,
      provider: "cellsynt",
      enabled: Boolean(body.enabled),
      sender: String(body.sender || "").trim().slice(0, 11),
      encrypted_username: username ? await encrypt(username, secret) : existing.encrypted_username,
      encrypted_password: password ? await encrypt(password, secret) : existing.encrypted_password,
      encrypted_api_url: apiUrl ? await encrypt(apiUrl, secret) : existing?.encrypted_api_url || "",
      username_hint: username ? hint(username) : existing.username_hint,
      api_url_hint: apiUrl ? hint(apiUrl) : existing?.api_url_hint || "",
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await db.from("vihem_sms_settings").upsert(row, { onConflict: "organisation_id" }).select("*").single();
    if (error) throw error;
    return json({ ok: true, settings: publicSettings(data) });
  } catch (error) { console.error("vihem-manage-cellsynth-settings", error); return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400); }
});

async function getSettings(db: any, organisationId: string) { const { data } = await db.from("vihem_sms_settings").select("*").eq("organisation_id", organisationId).maybeSingle(); return data; }
function publicSettings(s: any) { return { enabled: Boolean(s?.enabled), sender: s?.sender || "", has_username: Boolean(s?.encrypted_username), username_hint: s?.username_hint || "", has_password: Boolean(s?.encrypted_password), has_api_url: Boolean(s?.encrypted_api_url), api_url_hint: s?.api_url_hint || "", updated_at: s?.updated_at || null }; }
function encryptionSecret(serviceKey: string) { return Deno.env.get("VIHEM_CELLSYNT_SECRET_KEY") || Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || serviceKey; }
async function encrypt(value: string, secret: string) { const enc = new TextEncoder(); const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret)); const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt"]); const iv = crypto.getRandomValues(new Uint8Array(12)); const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(value)); const all = new Uint8Array(iv.length + cipher.byteLength); all.set(iv); all.set(new Uint8Array(cipher), iv.length); return btoa(String.fromCharCode(...all)); }
function hint(value: string) { return value.length > 8 ? `${value.slice(0, 4)}...${value.slice(-4)}` : "sparad"; }
function json(data: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } }); }
