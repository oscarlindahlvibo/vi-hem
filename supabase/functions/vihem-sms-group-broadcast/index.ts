// Group SMS: sends one message to every active tenant in a property (or
// every active tenant in the organisation, if no property is chosen), via
// the same Cellsynt integration and vihem_sms_messages logging as
// vihem-send-sms -- but that function only ever sends to one recipient per
// call, so this fans out into one Cellsynt HTTP call per tenant, reusing
// the same decrypted credentials for the whole batch instead of
// re-decrypting per recipient. Never cross-org, same as
// vihem-admin-broadcast: this sends real, billable SMS, so the audience is
// always scoped to the caller's own organisation, even for superadmin.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey" };
const MAX_MESSAGE_LENGTH = 4000;
const TEST_SEND_URL = "https://se-1.cellsynt.net/sms.php";

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } });
}

function normalisePhone(value: unknown): string {
  const raw = String(value ?? "").trim().replace(/[\s()-]/g, "");
  if (!raw) return "";
  if (raw.startsWith("+")) return `00${raw.slice(1)}`;
  if (raw.startsWith("0")) return `0046${raw.slice(1)}`;
  return raw;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: authData } = await authClient.auth.getUser();
    if (!authData.user) return json({ error: "Du måste vara inloggad." }, 401);

    const { data: profile } = await db.from("vihem_profiles").select("id,role,organisation_id").eq("id", authData.user.id).maybeSingle();
    if (!profile || !["admin", "superadmin"].includes(profile.role)) return json({ error: "Endast admin kan skicka gruppsms." }, 403);
    if (!profile.organisation_id) return json({ error: "Kontot saknar organisation." }, 400);
    const organisationId = profile.organisation_id;

    const body = await req.json().catch(() => ({}));
    const message = String(body.message || "").trim();
    const propertyId = body.property_id ? String(body.property_id).trim() : null;
    if (!message) return json({ error: "Meddelande krävs." }, 400);
    if (message.length > MAX_MESSAGE_LENGTH) return json({ error: `Meddelandet får vara högst ${MAX_MESSAGE_LENGTH} tecken.` }, 400);

    const { data: settings } = await db.from("vihem_sms_settings").select("enabled,sender,encrypted_username,encrypted_password,encrypted_api_url").eq("organisation_id", organisationId).maybeSingle();
    if (!settings?.enabled) return json({ error: "SMS är inte aktiverat för organisationen." }, 409);
    const sender = String(settings.sender || "").trim().slice(0, 11);
    const secret = encryptionSecret();
    const username = settings.encrypted_username ? await decrypt(settings.encrypted_username, secret) : "";
    const password = settings.encrypted_password ? await decrypt(settings.encrypted_password, secret) : "";
    const endpoint = settings.encrypted_api_url ? await decrypt(settings.encrypted_api_url, secret) : TEST_SEND_URL;
    if (!username || !password || !sender) return json({ error: "Cellsynt är inte komplett konfigurerat på servern." }, 503);

    let propertyName = "Alla fastigheter";
    if (propertyId) {
      const { data: property } = await db.from("vihem_properties").select("name").eq("id", propertyId).eq("organisation_id", organisationId).maybeSingle();
      if (!property) return json({ error: "Fastigheten hittades inte." }, 404);
      propertyName = property.name;
    }

    let tenancyQuery = db
      .from("vihem_tenancies")
      .select("tenant_id, tenant:vihem_profiles!tenancies_tenant_id_fkey(id,name,phone,active)")
      .eq("organisation_id", organisationId)
      .eq("status", "active");
    if (propertyId) tenancyQuery = tenancyQuery.eq("property_id", propertyId);
    const { data: tenancies, error: tenancyError } = await tenancyQuery;
    if (tenancyError) throw tenancyError;

    // One tenant can have more than one active tenancy row (e.g. two
    // apartments) -- dedupe by tenant id so they get exactly one SMS, and
    // drop anyone without a usable phone number or an inactive profile.
    const seen = new Set<string>();
    const recipients: { id: string; name: string; phone: string }[] = [];
    for (const row of tenancies || []) {
      const tenant = row.tenant as { id: string; name: string; phone: string; active: boolean } | null;
      if (!tenant || tenant.active === false || seen.has(tenant.id)) continue;
      const phone = normalisePhone(tenant.phone);
      if (!phone) continue;
      seen.add(tenant.id);
      recipients.push({ id: tenant.id, name: tenant.name || "", phone });
    }
    if (recipients.length === 0) return json({ error: "Inga hyresgäster med telefonnummer hittades för valt urval." }, 404);

    const { data: broadcast, error: broadcastError } = await db
      .from("vihem_sms_broadcasts")
      .insert({ organisation_id: organisationId, sent_by: profile.id, property_id: propertyId, property_name: propertyName, message, recipient_count: recipients.length })
      .select("id")
      .single();
    if (broadcastError) throw broadcastError;

    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      const { data: log } = await db.from("vihem_sms_messages").insert({ organisation_id: organisationId, provider: "cellsynt", recipient: recipient.phone, message, status: "sending", related_type: "sms_broadcast", related_id: broadcast.id, created_by: profile.id }).select("id").single();
      try {
        const params = new URLSearchParams({ username, password, destination: recipient.phone, type: "text", charset: "UTF-8", text: message, originatortype: "alpha", originator: sender });
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/plain" }, body: params });
        const result = (await response.text()).trim();
        if (!response.ok || !/^OK:\s*/i.test(result)) throw new Error(result || `Cellsynt (${response.status})`);
        const externalId = result.replace(/^OK:\s*/i, "").slice(0, 200);
        if (log) await db.from("vihem_sms_messages").update({ status: "sent", external_id: externalId, sent_at: new Date().toISOString() }).eq("id", log.id);
        sent++;
      } catch (sendError) {
        const errorMessage = sendError instanceof Error ? sendError.message : "SMS-utskicket misslyckades.";
        if (log) await db.from("vihem_sms_messages").update({ status: "failed", error: errorMessage }).eq("id", log.id);
        failed++;
      }
    }

    if (failed > 0) await db.from("vihem_sms_broadcasts").update({ failed_count: failed }).eq("id", broadcast.id);

    return json({ ok: true, broadcast_id: broadcast.id, recipient_count: recipients.length, sent, failed });
  } catch (error) {
    console.error("vihem-sms-group-broadcast", error);
    return json({ error: error instanceof Error ? error.message : "Utskicket misslyckades." }, 500);
  }
});

function encryptionSecret() { return Deno.env.get("VIHEM_CELLSYNT_SECRET_KEY") || Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""; }
async function decrypt(value: string, secret: string) { const dec = new TextDecoder(); const enc = new TextEncoder(); const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0)); const iv = bytes.slice(0, 12); const cipher = bytes.slice(12); const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret)); const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]); return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher)); }
