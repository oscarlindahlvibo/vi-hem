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
    const { data: profile } = await db.from("vihem_profiles").select("id,role,organisation_id").eq("id", user.id).maybeSingle();
    if (!profile?.organisation_id || !["staff", "admin", "superadmin"].includes(profile.role)) return json({ error: "Endast personal kan använda dokumentlagringen." }, 403);
    const settings = await getSettings(db, profile.organisation_id);
    const { data: organisation } = await db.from("vihem_organisations").select("name").eq("id", profile.organisation_id).maybeSingle();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "settings");
    if (action === "settings") return json({ ok: true, settings: publicSettings(settings) });
    if (action === "rename") {
      if (!settings?.drive_storage_enabled || !settings.drive_root_folder_id) {
        return json({ ok: false, error_code: "DRIVE_DISABLED", settings: publicSettings(settings) }, 409);
      }
      const fileId = String(body.file_id || "");
      if (!fileId) return json({ error: "Drive-filen saknar id." }, 400);
      const credentials = await decryptSettings(settings, getEncryptionSecret(serviceKey));
      if (!credentials) return json({ ok: false, error_code: "GOOGLE_CREDENTIALS_MISSING", error: "Google service account saknas." }, 400);
      const parsed = JSON.parse(credentials);
      const delegatedUser = String(body.delegated_user || settings.drive_delegated_user || parsed.client_email || "");
      const accessToken = await token(parsed, delegatedUser);
      const filename = sanitizeFilename(String(body.filename || "dokument"));
      const params = new URLSearchParams({ fields: "id,name,webViewLink", supportsAllDrives: "true" });
      const updated = await driveFetch(`/drive/v3/files/${encodeURIComponent(fileId)}?${params}`, accessToken, "PATCH", { name: filename });
      return json({ ok: true, storage_provider: "google_drive", ...updated });
    }
    if (action !== "upload") return json({ error: "Okänd åtgärd." }, 400);
    if (!settings?.drive_storage_enabled || !settings.drive_root_folder_id) return json({ ok: false, error_code: "DRIVE_DISABLED", settings: publicSettings(settings) }, 409);
    const filename = sanitizeFilename(String(body.filename || "dokument"));
    const mimeType = String(body.mime_type || "application/octet-stream");
    const encoded = String(body.content_base64 || "");
    if (!encoded) return json({ error: "Filen saknar innehåll." }, 400);
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    if (bytes.byteLength > 25 * 1024 * 1024) return json({ error: "Filen är större än 25 MB." }, 413);
    const credentials = await decryptSettings(settings, getEncryptionSecret(serviceKey));
    if (!credentials) return json({ ok: false, error_code: "GOOGLE_CREDENTIALS_MISSING", error: "Google service account saknas." }, 400);
    const parsed = JSON.parse(credentials);
    const delegatedUser = String(body.delegated_user || settings.drive_delegated_user || parsed.client_email || "");
    const accessToken = await token(parsed, delegatedUser);
    const organisationFolder = `${sanitizeFilename(String(organisation?.name || "Organisation"))}__${profile.organisation_id.slice(0, 8)}`;
    const requestedFolder = String(body.folder || "Dokument");
    const folderPath = [organisationFolder, ...requestedFolder.split("/").filter(Boolean)].join("/");
    const folderId = await ensureFolderPath(accessToken, folderPath, settings.drive_root_folder_id, settings.drive_shared_drive_id || "");
    const uploaded = await uploadFile(accessToken, filename, mimeType, bytes, folderId, settings.drive_shared_drive_id || "");
    return json({ ok: true, storage_provider: "google_drive", folder_id: folderId, ...uploaded });
  } catch (error) {
    console.error("vihem-google-drive-storage", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Google Drive-uppladdningen misslyckades." }, 400);
  }
});

async function getSettings(db: any, organisationId: string) { const { data } = await db.from("vihem_google_workspace_settings").select("*").eq("organisation_id", organisationId).maybeSingle(); return data; }
function publicSettings(settings: any) { return { enabled: Boolean(settings?.drive_storage_enabled), fallback_enabled: settings?.drive_fallback_enabled !== false, root_folder_id: settings?.drive_root_folder_id || "", shared_drive_id: settings?.drive_shared_drive_id || "", delegated_user: settings?.drive_delegated_user || "" }; }
function getEncryptionSecret(serviceKey: string) { return Deno.env.get("VIHEM_GOOGLE_WORKSPACE_SECRET_KEY") || Deno.env.get("VIHEM_OCR_SECRET_KEY") || Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || serviceKey; }
async function decryptSettings(settings: any, secret: string) { if (!settings?.encrypted_service_account_json) return ""; const bytes = Uint8Array.from(atob(settings.encrypted_service_account_json), c => c.charCodeAt(0)); const iv = bytes.slice(0, 12); const cipher = bytes.slice(12); const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)); const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher)); }
async function token(credentials: any, subject: string) { const now = Math.floor(Date.now() / 1000); const assertion = await signJwt({ iss: credentials.client_email, scope: "https://www.googleapis.com/auth/drive.file", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600, sub: subject }, credentials.private_key); const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error_description || "Google token kunde inte skapas."); return data.access_token as string; }
async function signJwt(payload: Record<string, unknown>, privateKey: string) { const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })); const body = b64url(JSON.stringify(payload)); const keyData = pemToDer(privateKey); const key = await crypto.subtle.importKey("pkcs8", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]); const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${body}`)); return `${header}.${body}.${b64url(signature)}`; }
function pemToDer(value: string) { const base64 = value.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""); return Uint8Array.from(atob(base64), c => c.charCodeAt(0)); }
function b64url(value: string | ArrayBuffer) { const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
async function ensureFolderPath(accessToken: string, path: string, parentId: string, sharedDriveId: string) {
  let currentId = parentId;
  for (const rawName of path.split("/").filter(Boolean)) {
    const name = sanitizeFilename(rawName);
    currentId = await ensureFolder(accessToken, name, currentId, sharedDriveId);
  }
  return currentId;
}
async function ensureFolder(accessToken: string, name: string, parentId: string, sharedDriveId: string) { const query = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`; const params = new URLSearchParams({ q: query, fields: "files(id,name)", pageSize: "1", supportsAllDrives: "true", includeItemsFromAllDrives: "true" }); if (sharedDriveId) { params.set("corpora", "drive"); params.set("driveId", sharedDriveId); } const existing = await driveFetch(`/drive/v3/files?${params}`, accessToken); if (existing.files?.[0]?.id) return existing.files[0].id; const created = await driveFetch("/drive/v3/files", accessToken, "POST", { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }, { supportsAllDrives: "true" }); return created.id as string; }
async function uploadFile(accessToken: string, filename: string, mimeType: string, bytes: Uint8Array, folderId: string, sharedDriveId: string) { const boundary = `vihem-${crypto.randomUUID()}`; const metadata = JSON.stringify({ name: filename, parents: [folderId] }); const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`); const suffix = new TextEncoder().encode(`\r\n--${boundary}--`); const payload = new Uint8Array(prefix.length + bytes.length + suffix.length); payload.set(prefix); payload.set(bytes, prefix.length); payload.set(suffix, prefix.length + bytes.length); const params = new URLSearchParams({ uploadType: "multipart", fields: "id,name,webViewLink", supportsAllDrives: "true" }); if (sharedDriveId) params.set("driveId", sharedDriveId); return await driveFetch(`/upload/drive/v3/files?${params}`, accessToken, "POST", payload, { "Content-Type": `multipart/related; boundary=${boundary}` }); }
async function driveFetch(path: string, accessToken: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) { const response = await fetch(`https://www.googleapis.com${path}`, { method, headers: { Authorization: `Bearer ${accessToken}`, ...(body instanceof Uint8Array ? {} : { "Content-Type": "application/json" }), ...headers }, body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error?.message || "Google Drive svarade med ett fel."); return data; }
function sanitizeFilename(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 180) || "dokument"; }
function json(data: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } }); }
