import { getEncryptionSecret, decryptSettings, googleDriveToken as token } from "../_shared/google-drive-auth.ts";
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
    const { data: profile } = await db.from("vihem_profiles").select("id,role,organisation_id,active").eq("id", user.id).maybeSingle();
    if (!profile?.active || !profile?.organisation_id || !["staff", "admin", "superadmin"].includes(profile.role)) return json({ error: "Endast personal kan använda dokumentlagringen." }, 403);
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
      const [registered, document] = await Promise.all([
        db.from('vihem_google_drive_files').select('id').eq('organisation_id',profile.organisation_id).eq('drive_file_id',fileId).limit(1),
        db.from('vihem_documents').select('id').eq('organisation_id',profile.organisation_id).eq('drive_file_id',fileId).limit(1),
      ]);
      if(registered.error||document.error||(!registered.data?.length&&!document.data?.length)) return json({error:'Filen är inte registrerad i din organisation.'},403);

      const credentials = await decryptSettings(settings, getEncryptionSecret(serviceKey));
      if (!credentials) return json({ ok: false, error_code: "GOOGLE_CREDENTIALS_MISSING", error: "Google service account saknas." }, 400);
      const parsed = JSON.parse(credentials);
      const delegatedUser = String(settings.drive_delegated_user || "");
      const accessToken = await token(parsed, delegatedUser, profile.organisation_id === '38fe702d-e72c-49a2-9750-5e0b6934959b' ? 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly' : 'https://www.googleapis.com/auth/drive.file');
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
    const delegatedUser = String(settings.drive_delegated_user || "");
    const accessToken = await token(parsed, delegatedUser, profile.organisation_id === '38fe702d-e72c-49a2-9750-5e0b6934959b' ? 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly' : 'https://www.googleapis.com/auth/drive.file');
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
async function ensureFolderPath(accessToken: string, path: string, parentId: string, sharedDriveId: string) {
  let currentId = parentId;
  for (const rawName of path.split("/").filter(Boolean)) {
    const name = sanitizeFilename(rawName);
    currentId = await ensureFolder(accessToken, name, currentId, sharedDriveId);
  }
  return currentId;
}
async function ensureFolder(accessToken: string, name: string, parentId: string, sharedDriveId: string) { const query = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`; const params = new URLSearchParams({ q: query, fields: "files(id,name)", pageSize: "1", supportsAllDrives: "true", includeItemsFromAllDrives: "true" }); if (sharedDriveId) { params.set("corpora", "drive"); params.set("driveId", sharedDriveId); } const existing = await driveFetch(`/drive/v3/files?${params}`, accessToken); if (existing.files?.[0]?.id) return existing.files[0].id; const created = await driveFetch("/drive/v3/files?supportsAllDrives=true", accessToken, "POST", { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }); return created.id as string; }
async function uploadFile(accessToken: string, filename: string, mimeType: string, bytes: Uint8Array, folderId: string, sharedDriveId: string) { const boundary = `vihem-${crypto.randomUUID()}`; const metadata = JSON.stringify({ name: filename, parents: [folderId] }); const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`); const suffix = new TextEncoder().encode(`\r\n--${boundary}--`); const payload = new Uint8Array(prefix.length + bytes.length + suffix.length); payload.set(prefix); payload.set(bytes, prefix.length); payload.set(suffix, prefix.length + bytes.length); const params = new URLSearchParams({ uploadType: "multipart", fields: "id,name,webViewLink", supportsAllDrives: "true" }); if (sharedDriveId) params.set("driveId", sharedDriveId); return await driveFetch(`/upload/drive/v3/files?${params}`, accessToken, "POST", payload, { "Content-Type": `multipart/related; boundary=${boundary}` }); }
async function driveFetch(path: string, accessToken: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) { const response = await fetch(`https://www.googleapis.com${path}`, { method, headers: { Authorization: `Bearer ${accessToken}`, ...(body instanceof Uint8Array ? {} : { "Content-Type": "application/json" }), ...headers }, body: body instanceof Uint8Array ? body.slice().buffer : body ? JSON.stringify(body) : undefined }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error?.message || "Google Drive svarade med ett fel."); return data; }
function sanitizeFilename(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 180) || "dokument"; }
function json(data: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } }); }
