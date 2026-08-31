import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const db = createClient(url, serviceKey);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: profile } = await db.from("vihem_profiles").select("id,role,organisation_id,is_system_admin").eq("id", user.id).maybeSingle();
    if (!profile?.organisation_id || !(profile.role === "superadmin" || (profile.role === "admin" && profile.is_system_admin))) return json({ error: "Endast systemadmin kan hantera Google Workspace." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "get");
    const settings = await getSettings(db, profile.organisation_id);
    if (action === "get") return json({ ok: true, settings: publicSettings(settings) });
    if (action === "save_drive_storage") {
      const rootFolderId = String(body.drive_root_folder_id || "").trim();
      const sharedDriveId = String(body.drive_shared_drive_id || "").trim();
      const delegatedUser = String(body.drive_delegated_user || "").trim();
      const driveStorageEnabled = Boolean(body.drive_storage_enabled);
      const driveFallbackEnabled = body.drive_fallback_enabled !== false;
      if (driveStorageEnabled && !rootFolderId) return json({ error: "Ange en Google Drive-mapp innan Drive-lagring aktiveras." }, 400);
      const { data, error } = await db.from("vihem_google_workspace_settings").upsert({
        organisation_id: profile.organisation_id,
        drive_root_folder_id: rootFolderId,
        drive_shared_drive_id: sharedDriveId,
        drive_delegated_user: delegatedUser,
        drive_storage_enabled: driveStorageEnabled,
        drive_fallback_enabled: driveFallbackEnabled,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "organisation_id" }).select("drive_root_folder_id,drive_shared_drive_id,drive_delegated_user,drive_storage_enabled,drive_fallback_enabled").single();
      if (error) throw error;
      return json({ ok: true, settings: { ...publicSettings(settings), ...publicDriveSettings(data) } });
    }
    if (action === "delete") {
      const { error } = await db.from("vihem_google_workspace_settings").upsert({ organisation_id: profile.organisation_id, encrypted_service_account_json: "", service_account_hint: "", rotated_at: null, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "organisation_id" });
      if (error) throw error;
      return json({ ok: true, settings: publicSettings(null) });
    }
    if (action === "save") {
      const raw = String(body.service_account_json || "").trim();
      if (!raw) return json({ error: "Klistra in service account-JSON först." }, 400);
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(raw); } catch { return json({ error: "Service account-JSON är inte giltig JSON." }, 400); }
      if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return json({ error: "JSON måste innehålla client_email och private_key." }, 400);
      const encrypted = await encryptSecret(raw, getEncryptionSecret(serviceKey));
      const hint = buildHint(String(parsed.client_email));
      const { data, error } = await db.from("vihem_google_workspace_settings").upsert({ organisation_id: profile.organisation_id, encrypted_service_account_json: encrypted, service_account_hint: hint, rotated_at: new Date().toISOString(), updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "organisation_id" }).select("service_account_hint,rotated_at,updated_at,encrypted_service_account_json").single();
      if (error) throw error;
      return json({ ok: true, settings: publicSettings(data) });
    }
    if (action === "test") {
      const raw = await decryptSettings(settings, getEncryptionSecret(serviceKey));
      if (!raw) return json({ ok: false, error: "Google service account saknas." }, 400);
      try { const parsed = JSON.parse(raw); return json({ ok: Boolean(parsed.client_email && parsed.private_key), message: "Service account-JSON är sparad. Testa sedan en mailbox under E-post & underlag." }); }
      catch { return json({ ok: false, error: "Den sparade kopplingen kunde inte läsas." }, 400); }
    }
    return json({ error: "Okänd åtgärd." }, 400);
  } catch (error) { console.error("vihem-manage-google-workspace-settings", error); return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400); }
});

async function getSettings(db: any, organisationId: string) { const { data } = await db.from("vihem_google_workspace_settings").select("*").eq("organisation_id", organisationId).maybeSingle(); return data; }
async function decryptSettings(settings: any, secret: string) { if (!settings?.encrypted_service_account_json) return ""; return decryptSecret(settings.encrypted_service_account_json, secret); }
function publicSettings(settings: any) { return { has_service_account: Boolean(settings?.encrypted_service_account_json), service_account_hint: settings?.service_account_hint || "", rotated_at: settings?.rotated_at || null, updated_at: settings?.updated_at || null, ...publicDriveSettings(settings) }; }
function publicDriveSettings(settings: any) { return { drive_root_folder_id: settings?.drive_root_folder_id || "", drive_shared_drive_id: settings?.drive_shared_drive_id || "", drive_delegated_user: settings?.drive_delegated_user || "", drive_storage_enabled: Boolean(settings?.drive_storage_enabled), drive_fallback_enabled: settings?.drive_fallback_enabled !== false }; }
async function encryptSecret(value: string, secret: string) { const enc = new TextEncoder(); const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret)); const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt"]); const iv = crypto.getRandomValues(new Uint8Array(12)); const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(value)); const all = new Uint8Array(iv.length + cipher.byteLength); all.set(iv); all.set(new Uint8Array(cipher), iv.length); return btoa(String.fromCharCode(...all)); }
async function decryptSecret(value: string, secret: string) { const dec = new TextDecoder(); const enc = new TextEncoder(); const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0)); const iv = bytes.slice(0, 12); const cipher = bytes.slice(12); const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret)); const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]); return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher)); }
function getEncryptionSecret(serviceKey: string) { return Deno.env.get("VIHEM_GOOGLE_WORKSPACE_SECRET_KEY") || Deno.env.get("VIHEM_OCR_SECRET_KEY") || Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || serviceKey; }
function buildHint(email: string) { return email.length > 8 ? `${email.slice(0, 4)}...${email.slice(-8)}` : "sparad"; }
function json(data: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } }); }
