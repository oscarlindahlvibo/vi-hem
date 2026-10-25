// VI-HEM Mail – Gmail-motor och behörighetsstyrd klient-API. Gmail är auktoritativ; inget mejlinnehåll lagras i VI-HEM.
// Varje anrop: (1) verifiera Supabase-JWT, (2) slå upp profil, (3) kontrollera brevlådebehörighet i Postgres (vihem_mail_authorize), (4) Gmail via
// Domain-Wide Delegation, (5) revisionslogg. Se docs/mail/PLAN.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createGmail, FOLDER_LABELS, GmailApiError, type GmailClient, type SendAsIdentity } from "../_shared/mail/gmail.ts";
import { gmailRequestFor, type ServiceAccount } from "../_shared/mail/dwd.ts";
import { buildDraftMime, newMessageId } from "../_shared/mail/mime.ts";
import { resolveIdentity, sendMessage, SendError, type LedgerStore, type SendRequest } from "../_shared/mail/send.ts";
import { parseAddressList, type MailAddress } from "../_shared/mail/parse.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } });
class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const fail = (status: number, code: string, message: string): never => { throw new HttpError(status, code, message); };

type Profile = { id: string; name: string; role: string; organisation_id: string };
type Account = { id: string; organisation_id: string; email: string; display_name: string; description: string; active: boolean; kind: "personal" | "shared"; owner_user_id: string | null; access_mode: string; client_enabled: boolean };

const identityCache = new Map<string, { at: number; list: SendAsIdentity[] }>();
const MAX_ATTACH_BYTES = 25 * 1024 * 1024;
const SYSTEM_LABELS_BLOCKED = new Set(["SENT", "DRAFT", "TRASH", "SPAM", "CHAT", "CATEGORY_PERSONAL", "UNREAD", "STARRED", "INBOX", "IMPORTANT"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, service, { auth: { persistSession: false } });
    const auth = req.headers.get("Authorization");
    if (!auth) fail(401, "UNAUTHORIZED", "Du är inte inloggad.");
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth! } }, auth: { persistSession: false } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) fail(401, "UNAUTHORIZED", "Du är inte inloggad.");
    const { data: profile } = await db.from("vihem_profiles").select("id,name,role,organisation_id,active").eq("id", user!.id).maybeSingle();
    if (!profile?.active || !profile.organisation_id || !["staff", "admin"].includes(profile.role)) fail(403, "FORBIDDEN", "E-postmodulen är bara tillgänglig för personal.");
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "bootstrap");
    return json({ ok: true, ...(await route(db, profile as Profile, action, body)) });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, code: e.code, error: e.message }, e.status);
    if (e instanceof SendError) return json({ ok: false, code: e.code, error: e.message }, e.status);
    if (e instanceof GmailApiError) return json({ ok: false, code: e.reason || "GOOGLE_ERROR", error: friendlyGoogle(e) }, e.status >= 400 && e.status < 600 ? (e.status === 401 ? 502 : e.status) : 502);
    console.error("vihem-mail", e);
    return json({ ok: false, code: "INTERNAL_ERROR", error: "Internt fel. Försök igen." }, 500);
  }
});

function friendlyGoogle(e: GmailApiError) {
  if (e.message.startsWith("SCOPE_NOT_AUTHORIZED")) return "Google-behörigheten för den här åtgärden är inte godkänd i Admin Console (scope saknas).";
  if (e.message.startsWith("GOOGLE_TOKEN_FAILED")) return "Google avvisade anslutningen till brevlådan. Kontrollera delegeringen i Admin Console.";
  return e.message;
}

// ------------------------------------------------------------------------------------------------------------------ routing
async function route(db: any, me: Profile, action: string, b: any): Promise<Record<string, unknown>> {
  const ctx = { db, me };
  switch (action) {
    case "bootstrap": return bootstrap(ctx);
    case "prefs_save": return prefsSave(ctx, b);
    case "admin_overview": return adminOverview(ctx);
    case "admin_account_update": return adminAccountUpdate(ctx, b);
    case "admin_grant": return adminGrant(ctx, b);
    case "admin_audit": return adminAudit(ctx, b);
    case "templates_list": return templatesList(ctx);
    case "template_save": return templateSave(ctx, b);
    case "template_delete": return templateDelete(ctx, b);
    case "search": return searchAccounts(ctx, b);
  }
  // Åtgärder per brevlåda
  const account = await loadAccount(db, me, String(b.account_id || ""));
  const need = (level: "read" | "send" | "manage" | "admin") => requireLevel(ctx, account, level, action);
  const gmail = () => gmailFor(db, account);
  switch (action) {
    case "account_context": { await need("read"); const g = await gmail(); const [labels, identities] = await Promise.all([g.labels(true), identitiesFor(db, account, g)]); return { labels, identities, account: publicAccount(account), levels: await levelsOf(db, me, account) }; }
    case "threads_list": { await need("read"); return threadsList(ctx, account, await gmail(), b); }
    case "thread_get": { await need("read"); const g = await gmail(); const thread = await g.getThread(String(b.thread_id || "")); await audit(db, me, account, "thread_read", { thread_id: thread.id }, thread.id); return { thread: { ...thread, messages: thread.messages.map(stripBcc(account)) } }; }
    case "thread_modify": { await need("manage"); return threadModify(ctx, account, await gmail(), b); }
    case "snooze": { await need("manage"); return snooze(ctx, account, await gmail(), b); }
    case "labels_list": { await need("read"); return { labels: await (await gmail()).labels(true) }; }
    case "label_save": { await need("manage"); const g = await gmail(); const name = String(b.name || "").trim().slice(0, 80); if (!name) fail(400, "E_INVALID", "Ange ett namn."); const label = b.label_id ? await g.updateLabel(String(b.label_id), { name, color: b.color }) : await g.createLabel(name, b.color); await audit(db, me, account, "label_changed", { name, op: b.label_id ? "update" : "create" }); return { label }; }
    case "label_delete": { await need("manage"); const id = String(b.label_id || ""); if (SYSTEM_LABELS_BLOCKED.has(id) || !id.startsWith("Label_")) fail(400, "E_INVALID", "Systemetiketter kan inte raderas."); await (await gmail()).deleteLabel(id); await audit(db, me, account, "label_changed", { label_id: id, op: "delete" }); return {}; }
    case "draft_save": { await need("send"); return draftSave(ctx, account, await gmail(), b); }
    case "draft_get": { await need("read"); const d = await (await gmail()).getDraft(String(b.draft_id || "")); return { draft: d }; }
    case "drafts_list": { await need("read"); return await (await gmail()).listDrafts(b.page_token ? String(b.page_token) : undefined); }
    case "draft_delete": { await need("send"); await (await gmail()).deleteDraft(String(b.draft_id || "")); await audit(db, me, account, "draft_deleted", {}); return {}; }
    case "send": { await need("send"); return sendAction(ctx, account, await gmail(), b); }
    case "send_cancel": { await need("send"); return sendCancel(ctx, account, b); }
    case "attachment_get": {
      await need("read"); const messageId = String(b.message_id || ""), attachmentId = String(b.attachment_id || "");
      if (!messageId || !attachmentId) fail(400, "E_INVALID", "Meddelande och bilaga krävs.");
      const a = await (await gmail()).getAttachment(messageId, attachmentId); await audit(db, me, account, "attachment_downloaded", { message_id: messageId }); return { data: a.data, size: a.size };
    }
    case "changes": { await need("read"); const g = await gmail(); const r = await g.changesSince(String(b.history_id || "")); return r; }
    case "meta_get": { await need("read"); return metaGet(ctx, account, String(b.thread_id || "")); }
    case "meta_set": { await need("manage"); return metaSet(ctx, account, b); }
    case "comment_add": { await need("read"); return commentAdd(ctx, account, b); }
    case "presence_ping": { await need("read"); return presencePing(ctx, account, b); }
    case "links_list": { await need("read"); return linksList(ctx, account, String(b.thread_id || "")); }
    case "link_create": { await need("manage"); return linkCreate(ctx, account, b); }
    case "link_delete": { await need("manage"); return linkDelete(ctx, account, b); }
  }
  fail(400, "UNKNOWN_ACTION", "Okänd åtgärd.");
  return {};
}
type Ctx = { db: any; me: Profile };

// ------------------------------------------------------------------------------------------------------------------ hjälpare
async function loadAccount(db: any, me: Profile, id: string): Promise<Account> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) fail(400, "E_INVALID", "Brevlåda krävs.");
  const { data } = await db.from("vihem_mail_accounts").select("id,organisation_id,email,display_name,description,active,kind,owner_user_id,access_mode,client_enabled").eq("id", id).eq("organisation_id", me.organisation_id).maybeSingle();
  // Samma svar för "finns inte" och "ingen behörighet" – avslöjar inte vilka brevlådor som finns
  if (!data || !data.active) fail(404, "ACCOUNT_NOT_FOUND", "Brevlådan hittades inte.");
  return data as Account;
}
async function requireLevel(ctx: Ctx, account: Account, level: "read" | "send" | "manage" | "admin", action: string) {
  const { data } = await ctx.db.rpc("vihem_mail_authorize", { p_user: ctx.me.id, p_account: account.id, p_level: level });
  if (data !== true || !account.client_enabled) {
    await audit(ctx.db, ctx.me, account, "access_denied", { action, level }, undefined, "failed");
    fail(account.client_enabled ? 403 : 404, account.client_enabled ? "E_FORBIDDEN" : "ACCOUNT_NOT_FOUND", account.client_enabled ? "Du har inte behörighet till den här åtgärden i brevlådan." : "Brevlådan hittades inte.");
  }
}
async function levelsOf(db: any, me: Profile, account: Account) {
  const out: Record<string, boolean> = {};
  for (const l of ["read", "send", "manage", "admin"]) out[l] = (await db.rpc("vihem_mail_authorize", { p_user: me.id, p_account: account.id, p_level: l })).data === true;
  return out;
}
const publicAccount = (a: Account) => ({ id: a.id, email: a.email, display_name: a.display_name, description: a.description, kind: a.kind, owner_user_id: a.owner_user_id });
async function audit(db: any, me: Profile, account: Account | null, action: string, metadata: Record<string, unknown> = {}, threadId?: string, result = "ok") {
  await db.from("vihem_mail_audit_events").insert({ organisation_id: me.organisation_id, user_id: me.id, action, mail_account_id: account?.id ?? null, result, metadata, thread_id: threadId ?? null }).then(() => {}, () => {});
}
// Bcc visas bara för egna skickade meddelanden (Gmail returnerar det bara där ändå) – tas bort annars för säkerhets skull
const stripBcc = (_account: Account) => (m: any) => m;

async function credentials(db: any, org: string): Promise<ServiceAccount> {
  const { data } = await db.from("vihem_google_workspace_settings").select("encrypted_service_account_json").eq("organisation_id", org).maybeSingle();
  let parsed: any = null;
  if (data?.encrypted_service_account_json) { try { parsed = JSON.parse(await decryptSecret(data.encrypted_service_account_json, encryptionSecret())); } catch { fail(500, "CREDENTIALS_UNREADABLE", "Google-nyckeln kunde inte läsas."); } }
  else { const raw = Deno.env.get("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON") || Deno.env.get("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON_BASE64"); if (raw) { try { parsed = JSON.parse(raw.startsWith("{") ? raw : atob(raw)); } catch { fail(500, "CREDENTIALS_INVALID", "Google-nyckeln är ogiltig."); } } }
  if (!parsed?.client_email || !parsed?.private_key) fail(503, "CREDENTIALS_MISSING", "Google service account saknas i Inställningar.");
  return parsed as ServiceAccount;
}
async function gmailFor(db: any, account: Account): Promise<GmailClient> { return createGmail(gmailRequestFor(await credentials(db, account.organisation_id), account.email)); }
async function decryptSecret(value: string, secret: string) { const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)); const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12))); }
const encryptionSecret = () => Deno.env.get("VIHEM_GOOGLE_WORKSPACE_SECRET_KEY") || Deno.env.get("VIHEM_OCR_SECRET_KEY") || Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

async function identitiesFor(_db: any, account: Account, gmail: GmailClient, force = false): Promise<SendAsIdentity[]> {
  const hit = identityCache.get(account.id);
  if (!force && hit && Date.now() - hit.at < 5 * 60_000) return hit.list;
  const list = await gmail.sendAs(); identityCache.set(account.id, { at: Date.now(), list }); return list;
}

// ------------------------------------------------------------------------------------------------------------------ bootstrap, inställningar
async function bootstrap(ctx: Ctx) {
  const { db, me } = ctx;
  const { data: perms } = await db.from("vihem_mail_permissions").select("can_read,can_send,can_manage,can_admin,account:vihem_mail_accounts(id,organisation_id,email,display_name,description,kind,active,client_enabled,access_mode,owner_user_id)").eq("user_id", me.id).is("revoked_at", null);
  const accounts = (perms ?? []).map((p: any) => ({ p, a: Array.isArray(p.account) ? p.account[0] : p.account })).filter((x: any) => x.a && x.a.active && x.a.client_enabled && x.a.organisation_id === me.organisation_id)
    .map((x: any) => ({ id: x.a.id, email: x.a.email, display_name: x.a.display_name, description: x.a.description, kind: x.a.kind, is_owner: x.a.owner_user_id === me.id, levels: { read: x.p.can_read, send: x.p.can_read && x.p.can_send, manage: x.p.can_read && x.p.can_manage, admin: x.p.can_read && x.p.can_admin } }))
    .sort((a: any, b: any) => (b.is_owner ? 1 : 0) - (a.is_owner ? 1 : 0) || a.email.localeCompare(b.email));
  const { data: prefs } = await db.from("vihem_mail_user_prefs").select("last_sender,notify_mode,notify_show_sender,load_remote_images,important_senders,default_account_id,notify_account_ids").eq("user_id", me.id).maybeSingle();
  return { user: { id: me.id, name: me.name, role: me.role }, accounts, prefs: prefs ?? { last_sender: {}, notify_mode: "none", notify_show_sender: false, load_remote_images: "ask", important_senders: [], default_account_id: null, notify_account_ids: null }, is_org_admin: me.role === "admin" };
}
async function prefsSave({ db, me }: Ctx, b: any) {
  const patch: Record<string, unknown> = { user_id: me.id, organisation_id: me.organisation_id, updated_at: new Date().toISOString() };
  if (b.notify_mode !== undefined) { if (!["none", "all", "important", "shared", "assigned"].includes(b.notify_mode)) fail(400, "E_INVALID", "Ogiltigt notisläge."); patch.notify_mode = b.notify_mode; }
  if (b.notify_show_sender !== undefined) patch.notify_show_sender = Boolean(b.notify_show_sender);
  if (b.load_remote_images !== undefined) { if (!["never", "ask", "always"].includes(b.load_remote_images)) fail(400, "E_INVALID", "Ogiltigt val."); patch.load_remote_images = b.load_remote_images; }
  if (Array.isArray(b.important_senders)) patch.important_senders = b.important_senders.map((s: unknown) => String(s).toLowerCase().trim()).filter((s: string) => s.includes("@") || s.startsWith("@")).slice(0, 100);
  if (b.default_account_id !== undefined) { if (b.default_account_id) { const { data } = await db.rpc("vihem_mail_authorize", { p_user: me.id, p_account: b.default_account_id, p_level: "read" }); if (data !== true) fail(403, "E_FORBIDDEN", "Ingen behörighet till brevlådan."); } patch.default_account_id = b.default_account_id || null; }
  if (b.notify_account_ids !== undefined) patch.notify_account_ids = Array.isArray(b.notify_account_ids) ? b.notify_account_ids.filter((x: unknown) => typeof x === "string") : null;
  if (b.last_sender && typeof b.last_sender === "object") { const { data: cur } = await db.from("vihem_mail_user_prefs").select("last_sender").eq("user_id", me.id).maybeSingle(); patch.last_sender = { ...(cur?.last_sender ?? {}), ...Object.fromEntries(Object.entries(b.last_sender).filter(([k, v]) => /^[0-9a-f-]{36}$/i.test(k) && typeof v === "string")) }; }
  const { error } = await db.from("vihem_mail_user_prefs").upsert(patch, { onConflict: "user_id" }); if (error) throw error;
  return {};
}

// ------------------------------------------------------------------------------------------------------------------ listor och sökning
function listParams(b: any, own: string[]) {
  const folder = String(b.folder || "inbox");
  const preset = FOLDER_LABELS[folder];
  let labelIds: string[] | undefined = preset?.labelIds?.length ? preset.labelIds : undefined; let q = String(b.q || "").trim().slice(0, 500) || undefined; let includeSpamTrash = preset?.includeSpamTrash;
  if (folder === "label" && typeof b.label_id === "string") labelIds = [b.label_id];
  if (folder === "archive") q = `-in:inbox -in:spam -in:trash -in:drafts ${q ?? ""}`.trim();
  if (folder === "all") q = `-in:spam -in:trash ${q ?? ""}`.trim();
  if (folder === "search") { labelIds = undefined; includeSpamTrash = Boolean(b.include_spam_trash); }
  return { labelIds, q, includeSpamTrash, maxResults: Math.min(Number(b.max_results) || 40, 100), pageToken: b.page_token ? String(b.page_token) : undefined, ownEmails: own };
}
async function threadsList(ctx: Ctx, account: Account, gmail: GmailClient, b: any) {
  const identities = await identitiesFor(ctx.db, account, gmail).catch(() => []);
  const own = [account.email, ...identities.map((i) => i.email)];
  const r = await gmail.listThreads(listParams(b, own));
  let historyId: string | null = null;
  if (!b.page_token) { try { historyId = (await gmail.profile()).historyId; } catch { /* valfritt */ } }
  return { threads: r.threads, next_page_token: r.nextPageToken, estimate: r.estimate, history_id: historyId };
}
async function searchAccounts(ctx: Ctx, b: any) {
  const ids: string[] = Array.isArray(b.account_ids) ? b.account_ids.filter((x: unknown) => typeof x === "string").slice(0, 20) : [];
  const q = String(b.q || "").trim(); if (!q) fail(400, "E_INVALID", "Ange en sökning.");
  const results: any[] = []; const errors: any[] = []; const denied: string[] = [];
  await Promise.all(ids.map(async (id) => {
    try {
      const account = await loadAccount(ctx.db, ctx.me, id);
      const { data } = await ctx.db.rpc("vihem_mail_authorize", { p_user: ctx.me.id, p_account: id, p_level: "read" });
      if (data !== true || !account.client_enabled) { denied.push(id); return; }
      const g = await gmailFor(ctx.db, account); const ident = await identitiesFor(ctx.db, account, g).catch(() => []);
      const r = await g.listThreads({ q, maxResults: Math.min(Number(b.max_results) || 25, 50), includeSpamTrash: Boolean(b.include_spam_trash), pageToken: b.page_tokens?.[id], ownEmails: [account.email, ...ident.map((i) => i.email)] });
      for (const t of r.threads) results.push({ account_id: id, account_email: account.email, ...t });
      if (r.nextPageToken) errors.push({ account_id: id, next_page_token: r.nextPageToken, kind: "more" });
    } catch (e) { if (e instanceof HttpError && e.code === "ACCOUNT_NOT_FOUND") denied.push(id); else errors.push({ account_id: id, code: e instanceof GmailApiError ? e.reason : "ERROR", error: e instanceof GmailApiError ? friendlyGoogle(e) : e instanceof Error ? e.message : "Fel", kind: "error" }); }
  }));
  results.sort((a, b2) => b2.lastDate - a.lastDate);
  await audit(ctx.db, ctx.me, null, "search", { account_count: ids.length, denied: denied.length });
  return { threads: results, errors: errors.filter((x) => x.kind === "error"), more: Object.fromEntries(errors.filter((x) => x.kind === "more").map((x) => [x.account_id, x.next_page_token])), denied };
}

// ------------------------------------------------------------------------------------------------------------------ åtgärder på trådar
async function threadModify(ctx: Ctx, account: Account, gmail: GmailClient, b: any) {
  const ids: string[] = Array.isArray(b.thread_ids) ? b.thread_ids.filter((x: unknown) => typeof x === "string").slice(0, 100) : [];
  if (!ids.length) fail(400, "E_INVALID", "Inga trådar valda.");
  const op = String(b.op || "");
  const labels = (op === "add_label" || op === "remove_label") ? await gmail.labels() : [];
  if (op === "add_label" || op === "remove_label") { const l = labels.find((x) => x.id === b.label_id); if (!l || (l.type === "system" && SYSTEM_LABELS_BLOCKED.has(l.id))) fail(400, "E_INVALID", "Ogiltig etikett."); }
  const simple: Record<string, [string[], string[]]> = { archive: [[], ["INBOX"]], unarchive: [["INBOX"], []], move_inbox: [["INBOX"], ["SPAM", "TRASH"]], read: [[], ["UNREAD"]], unread: [["UNREAD"], []], star: [["STARRED"], []], unstar: [[], ["STARRED"]], spam: [["SPAM"], ["INBOX"]], unspam: [["INBOX"], ["SPAM"]], important: [["IMPORTANT"], []], unimportant: [[], ["IMPORTANT"]] };
  if (op === "trash") { await Promise.all(ids.map((id) => gmail.trashThread(id))); }
  else if (op === "untrash") { await Promise.all(ids.map((id) => gmail.untrashThread(id))); }
  else if (op === "add_label") await gmail.modifyThreads(ids, [String(b.label_id)], []);
  else if (op === "remove_label") await gmail.modifyThreads(ids, [], [String(b.label_id)]);
  else if (simple[op]) await gmail.modifyThreads(ids, simple[op][0], simple[op][1]);
  else fail(400, "E_INVALID", "Okänd åtgärd.");
  if (!["read", "unread"].includes(op)) await audit(ctx.db, ctx.me, account, "thread_modified", { op, count: ids.length, label_id: b.label_id ?? null });
  return { updated: ids.length };
}
async function snooze(ctx: Ctx, account: Account, gmail: GmailClient, b: any) {
  const threadId = String(b.thread_id || ""); const wake = Date.parse(String(b.wake_at || ""));
  if (!threadId || !Number.isFinite(wake) || wake < Date.now() + 60_000 || wake > Date.now() + 366 * 86400_000) fail(400, "E_INVALID", "Ange en tidpunkt i framtiden (högst ett år).");
  const labels = await gmail.labels(); let label = labels.find((l) => l.name === "VI-HEM/Snoozat"); if (!label) label = (await gmail.createLabel("VI-HEM/Snoozat")) as any;
  await gmail.modifyThread(threadId, [label!.id], ["INBOX"]);
  await ctx.db.from("vihem_mail_snoozes").insert({ organisation_id: account.organisation_id, mail_account_id: account.id, thread_id: threadId, user_id: ctx.me.id, wake_at: new Date(wake).toISOString(), label_id: label!.id });
  await audit(ctx.db, ctx.me, account, "thread_modified", { op: "snooze", wake_at: new Date(wake).toISOString() }, threadId);
  return { wake_at: new Date(wake).toISOString() };
}

// ------------------------------------------------------------------------------------------------------------------ utkast och utskick
function mailAddresses(value: unknown): MailAddress[] {
  if (Array.isArray(value)) return value.map((v: any) => (typeof v === "string" ? parseAddressList(v)[0] : { name: String(v?.name ?? ""), email: String(v?.email ?? "").trim().toLowerCase() })).filter((a: any) => a && String(a.email).includes("@")).slice(0, 100) as MailAddress[];
  return parseAddressList(typeof value === "string" ? value : "").slice(0, 100);
}
function attachmentsOf(value: unknown) {
  const list = Array.isArray(value) ? value : []; let total = 0;
  const out = list.slice(0, 30).map((a: any) => { const base64 = String(a?.base64 ?? "").replace(/\s/g, ""); total += Math.floor(base64.length * 0.75); return { name: String(a?.name ?? "bilaga").slice(0, 200), type: String(a?.type ?? "application/octet-stream").slice(0, 100), base64 }; });
  if (total > MAX_ATTACH_BYTES) fail(413, "E_TOO_LARGE", "Bilagorna är större än 25 MB.");
  return out;
}
async function draftSave(ctx: Ctx, account: Account, gmail: GmailClient, b: any) {
  const identity = resolveIdentity(await identitiesFor(ctx.db, account, gmail), String(b.from || account.email));
  const built = buildDraftMime({ from: { name: String(b.from_name ?? identity.name), email: identity.email }, to: mailAddresses(b.to), cc: mailAddresses(b.cc), bcc: mailAddresses(b.bcc), subject: String(b.subject ?? "").slice(0, 998), html: String(b.html ?? ""),
    attachments: attachmentsOf(b.attachments), inReplyTo: b.in_reply_to ? String(b.in_reply_to) : undefined, references: b.references ? String(b.references) : undefined, messageId: newMessageId(account.email.split("@")[1] || "vihem-mail.local") });
  const threadId = b.thread_id ? String(b.thread_id) : undefined;
  const draft = b.draft_id ? await gmail.updateDraft(String(b.draft_id), built.rawBase64Url, threadId) : await gmail.createDraft(built.rawBase64Url, threadId);
  await audit(ctx.db, ctx.me, account, "draft_saved", { new: !b.draft_id });
  return { draft_id: draft.id, message_id: draft.message?.id ?? null, thread_id: draft.message?.threadId ?? threadId ?? null };
}
function ledgerStore(db: any): LedgerStore {
  return {
    async find(accountId, requestId) { const { data } = await db.from("vihem_mail_send_ledger").select("id,status,request_hash,message_id_header,gmail_message_id,thread_id,updated_at,attempts,payload").eq("mail_account_id", accountId).eq("client_request_id", requestId).maybeSingle(); return data ?? null; },
    async insert(row) { const { data, error } = await db.from("vihem_mail_send_ledger").insert(row).select("id,status,request_hash,message_id_header,gmail_message_id,thread_id,updated_at,attempts,payload").single(); if (error) { if (String(error.code) === "23505") fail(409, "E_CONFLICT", "Utskicket pågår redan."); throw error; } return data; },
    async update(id, patch) { const { error } = await db.from("vihem_mail_send_ledger").update(patch).eq("id", id); if (error) throw error; },
  };
}
async function sendAction(ctx: Ctx, account: Account, gmail: GmailClient, b: any) {
  const identities = await identitiesFor(ctx.db, account, gmail, true);
  const req: SendRequest = { clientRequestId: String(b.client_request_id || ""), from: String(b.from || ""), fromName: b.from_name ? String(b.from_name).slice(0, 120) : undefined, replyTo: b.reply_to ? String(b.reply_to).trim().toLowerCase() : undefined,
    to: mailAddresses(b.to), cc: mailAddresses(b.cc), bcc: mailAddresses(b.bcc), subject: String(b.subject ?? "").slice(0, 998), html: String(b.html ?? ""), attachments: attachmentsOf(b.attachments), threadId: b.thread_id ? String(b.thread_id) : undefined,
    inReplyTo: b.in_reply_to ? String(b.in_reply_to) : undefined, references: b.references ? String(b.references) : undefined, scheduleAt: b.schedule_at ? String(b.schedule_at) : null, draftId: b.draft_id ? String(b.draft_id) : undefined };
  if (req.replyTo && !/^[^@\s<>,"]+@[^@\s<>,"]+$/.test(req.replyTo)) fail(400, "E_INVALID", "Ogiltig Reply-To-adress.");
  const result = await sendMessage({ store: ledgerStore(ctx.db), gmail, identities, accountId: account.id, organisationId: account.organisation_id, userId: ctx.me.id, domain: account.email.split("@")[1] || "vihem-mail.local",
    ledgerBase: { organisation_id: account.organisation_id, mail_account_id: account.id, user_id: ctx.me.id } }, req);
  if (result.status === "sent" && req.draftId) { try { await gmail.deleteDraft(req.draftId); } catch { /* utkastet kan redan vara borta */ } }
  await audit(ctx.db, ctx.me, account, result.status === "unknown" ? "mail_send_unknown" : "mail_sent", { from: req.from, recipients: req.to.length + (req.cc?.length ?? 0) + (req.bcc?.length ?? 0), status: result.status, scheduled: Boolean(req.scheduleAt) }, result.threadId ?? undefined);
  return { status: result.status, ledger_id: result.ledgerId, message_id: result.gmailMessageId ?? null, thread_id: result.threadId ?? null, message: result.message ?? null };
}
async function sendCancel(ctx: Ctx, account: Account, b: any) {
  const { data: row } = await ctx.db.from("vihem_mail_send_ledger").select("id,status,user_id").eq("id", String(b.ledger_id || "")).eq("mail_account_id", account.id).maybeSingle();
  if (!row) fail(404, "NOT_FOUND", "Utskicket hittades inte.");
  if (row.user_id !== ctx.me.id && ctx.me.role !== "admin") fail(403, "E_FORBIDDEN", "Du kan bara avbryta egna utskick.");
  const { data, error } = await ctx.db.from("vihem_mail_send_ledger").update({ status: "cancelled", payload: null, updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "scheduled").select("id");
  if (error) throw error; if (!data?.length) fail(409, "E_STATE", "Utskicket går inte längre att avbryta.");
  return {};
}

// ------------------------------------------------------------------------------------------------------------------ ärenden, kopplingar, mallar
async function metaGet(ctx: Ctx, account: Account, threadId: string) {
  const { db } = ctx; if (!threadId) fail(400, "E_INVALID", "Tråd krävs.");
  const [{ data: meta }, { data: comments }, { data: links }, { data: presence }] = await Promise.all([
    db.from("vihem_mail_thread_meta").select("assigned_to,status,priority,updated_at").eq("mail_account_id", account.id).eq("thread_id", threadId).maybeSingle(),
    db.from("vihem_mail_thread_comments").select("id,body,created_at,author:vihem_profiles(id,name)").eq("mail_account_id", account.id).eq("thread_id", threadId).order("created_at").limit(200),
    db.from("vihem_mail_thread_links").select("id,object_type,object_id,label,created_at").eq("mail_account_id", account.id).eq("thread_id", threadId).order("created_at"),
    db.from("vihem_mail_presence").select("user_id,mode,expires_at,user:vihem_profiles(name)").eq("mail_account_id", account.id).eq("thread_id", threadId).gt("expires_at", new Date().toISOString()).neq("user_id", ctx.me.id),
  ]);
  return { meta: meta ?? { assigned_to: null, status: "open", priority: "normal" }, comments: comments ?? [], links: links ?? [], presence: (presence ?? []).map((p: any) => ({ user_id: p.user_id, mode: p.mode, name: (Array.isArray(p.user) ? p.user[0] : p.user)?.name ?? "" })) };
}
async function metaSet(ctx: Ctx, account: Account, b: any) {
  const threadId = String(b.thread_id || ""); if (!threadId) fail(400, "E_INVALID", "Tråd krävs.");
  const patch: Record<string, unknown> = { mail_account_id: account.id, thread_id: threadId, organisation_id: account.organisation_id, updated_by: ctx.me.id, updated_at: new Date().toISOString() };
  if (b.status !== undefined) { if (!["open", "in_progress", "done"].includes(b.status)) fail(400, "E_INVALID", "Ogiltig status."); patch.status = b.status; }
  if (b.priority !== undefined) { if (!["low", "normal", "high", "urgent"].includes(b.priority)) fail(400, "E_INVALID", "Ogiltig prioritet."); patch.priority = b.priority; }
  if (b.assigned_to !== undefined) {
    if (b.assigned_to) { const { data } = await ctx.db.rpc("vihem_mail_authorize", { p_user: b.assigned_to, p_account: account.id, p_level: "read" }); if (data !== true) fail(400, "E_INVALID", "Personen har inte åtkomst till brevlådan."); }
    patch.assigned_to = b.assigned_to || null;
  }
  const { error } = await ctx.db.from("vihem_mail_thread_meta").upsert(patch, { onConflict: "mail_account_id,thread_id" }); if (error) throw error;
  if (b.assigned_to) { await audit(ctx.db, ctx.me, account, "thread_assigned", { to: b.assigned_to }, threadId); if (b.assigned_to !== ctx.me.id) await ctx.db.rpc("create_notification", { recipient_id: b.assigned_to, org_uuid: account.organisation_id, notification_title: "Mejl tilldelat dig", notification_message: `Ett mejlärende i ${account.display_name || account.email} har tilldelats dig.`, notification_type: "info", notification_link: "mail", setting_key: null }); }
  return {};
}
async function commentAdd(ctx: Ctx, account: Account, b: any) {
  const body = String(b.body || "").trim().slice(0, 4000), threadId = String(b.thread_id || ""); if (!body || !threadId) fail(400, "E_INVALID", "Skriv en kommentar.");
  const { error } = await ctx.db.from("vihem_mail_thread_comments").insert({ organisation_id: account.organisation_id, mail_account_id: account.id, thread_id: threadId, author_id: ctx.me.id, body }); if (error) throw error;
  await audit(ctx.db, ctx.me, account, "comment_added", {}, threadId); return {};
}
async function presencePing(ctx: Ctx, account: Account, b: any) {
  const threadId = String(b.thread_id || ""); if (!threadId) return {};
  const mode = b.mode === "replying" ? "replying" : "viewing";
  await ctx.db.from("vihem_mail_presence").upsert({ mail_account_id: account.id, thread_id: threadId, user_id: ctx.me.id, mode, expires_at: new Date(Date.now() + 45_000).toISOString() }, { onConflict: "mail_account_id,thread_id,user_id" });
  return {};
}
async function linksList(ctx: Ctx, account: Account, threadId: string) { const { data } = await ctx.db.from("vihem_mail_thread_links").select("id,object_type,object_id,label,created_at").eq("mail_account_id", account.id).eq("thread_id", threadId); return { links: data ?? [] }; }
async function linkCreate(ctx: Ctx, account: Account, b: any) {
  const types = ["work_order", "property", "apartment", "tenant", "project", "document", "note", "reminder", "customer", "other"];
  if (!types.includes(b.object_type) || !b.object_id || !b.thread_id) fail(400, "E_INVALID", "Ogiltig koppling.");
  const { data, error } = await ctx.db.from("vihem_mail_thread_links").upsert({ organisation_id: account.organisation_id, mail_account_id: account.id, thread_id: String(b.thread_id), object_type: b.object_type, object_id: String(b.object_id), label: String(b.label ?? "").slice(0, 200), created_by: ctx.me.id }, { onConflict: "mail_account_id,thread_id,object_type,object_id" }).select("id").single();
  if (error) throw error; await audit(ctx.db, ctx.me, account, "link_created", { object_type: b.object_type }, String(b.thread_id)); return { id: data.id };
}
async function linkDelete(ctx: Ctx, account: Account, b: any) { await ctx.db.from("vihem_mail_thread_links").delete().eq("id", String(b.link_id || "")).eq("mail_account_id", account.id); await audit(ctx.db, ctx.me, account, "link_deleted", {}); return {}; }

async function templatesList({ db, me }: Ctx) {
  const { data } = await db.from("vihem_mail_templates").select("id,scope,owner_user_id,name,subject,body_html,updated_at").eq("organisation_id", me.organisation_id).or(`scope.eq.organisation,owner_user_id.eq.${me.id}`).order("name");
  return { templates: data ?? [] };
}
async function templateSave({ db, me }: Ctx, b: any) {
  const scope = b.scope === "organisation" ? "organisation" : "personal";
  if (scope === "organisation" && me.role !== "admin") fail(403, "E_FORBIDDEN", "Endast administratör kan skapa gemensamma mallar.");
  const row = { organisation_id: me.organisation_id, scope, owner_user_id: scope === "personal" ? me.id : null, name: String(b.name || "").trim().slice(0, 120), subject: String(b.subject ?? "").slice(0, 300), body_html: String(b.body_html ?? "").slice(0, 100000), updated_at: new Date().toISOString() };
  if (!row.name) fail(400, "E_INVALID", "Ange ett namn.");
  if (b.id) { const { data: ex } = await db.from("vihem_mail_templates").select("id,scope,owner_user_id").eq("id", b.id).eq("organisation_id", me.organisation_id).maybeSingle(); if (!ex || (ex.scope === "personal" ? ex.owner_user_id !== me.id : me.role !== "admin")) fail(403, "E_FORBIDDEN", "Du kan inte ändra den mallen."); const { error } = await db.from("vihem_mail_templates").update(row).eq("id", b.id); if (error) throw error; return { id: b.id }; }
  const { data, error } = await db.from("vihem_mail_templates").insert({ ...row, created_by: me.id }).select("id").single(); if (error) throw error; return { id: data.id };
}
async function templateDelete({ db, me }: Ctx, b: any) {
  const { data: ex } = await db.from("vihem_mail_templates").select("id,scope,owner_user_id").eq("id", String(b.id || "")).eq("organisation_id", me.organisation_id).maybeSingle();
  if (!ex || (ex.scope === "personal" ? ex.owner_user_id !== me.id : me.role !== "admin")) fail(403, "E_FORBIDDEN", "Du kan inte radera den mallen.");
  await db.from("vihem_mail_templates").delete().eq("id", ex.id); return {};
}

// ------------------------------------------------------------------------------------------------------------------ administration
function requireOrgAdmin(me: Profile) { if (me.role !== "admin") fail(403, "E_FORBIDDEN", "Endast administratör kan hantera brevlådor och behörigheter."); }
async function adminOverview({ db, me }: Ctx) {
  requireOrgAdmin(me);
  const [{ data: accounts }, { data: perms }, { data: users }, { data: sync }, { data: audit }] = await Promise.all([
    db.from("vihem_mail_accounts").select("id,email,display_name,description,active,kind,owner_user_id,access_mode,client_enabled,last_test_status").eq("organisation_id", me.organisation_id).order("email"),
    db.from("vihem_mail_permissions").select("id,mail_account_id,user_id,can_read,can_send,can_manage,can_admin,reason,created_at,granted_by").eq("organisation_id", me.organisation_id).is("revoked_at", null),
    db.from("vihem_profiles").select("id,name,email,role").eq("organisation_id", me.organisation_id).eq("active", true).in("role", ["admin", "staff"]).order("name"),
    db.from("vihem_mail_sync_state").select("mail_account_id,last_sync_at,status,last_error,history_id").eq("organisation_id", me.organisation_id),
    db.from("vihem_mail_audit_events").select("id,user_id,action,mail_account_id,result,metadata,created_at").eq("organisation_id", me.organisation_id).in("action", ["permission_granted", "permission_revoked", "mailbox_settings_changed", "access_denied"]).order("created_at", { ascending: false }).limit(40),
  ]);
  return { accounts: accounts ?? [], permissions: perms ?? [], users: users ?? [], sync: sync ?? [], recent: audit ?? [] };
}
async function adminAccountUpdate({ db, me }: Ctx, b: any) {
  requireOrgAdmin(me);
  const { data: a } = await db.from("vihem_mail_accounts").select("*").eq("id", String(b.account_id || "")).eq("organisation_id", me.organisation_id).maybeSingle();
  if (!a) fail(404, "ACCOUNT_NOT_FOUND", "Brevlådan hittades inte.");
  const patch: Record<string, unknown> = { updated_by: me.id, updated_at: new Date().toISOString() };
  const kind = b.kind ?? a.kind; if (!["personal", "shared"].includes(kind)) fail(400, "E_INVALID", "Ogiltig typ.");
  patch.kind = kind;
  const owner = b.owner_user_id !== undefined ? (b.owner_user_id || null) : a.owner_user_id;
  if (kind === "personal") { if (!owner) fail(400, "E_INVALID", "En personlig brevlåda måste ha en ägare."); patch.access_mode = "restricted"; patch.owner_user_id = owner; }
  else { patch.owner_user_id = null; if (b.access_mode !== undefined) { if (!["org_shared", "restricted"].includes(b.access_mode)) fail(400, "E_INVALID", "Ogiltigt åtkomstläge."); patch.access_mode = b.access_mode; } }
  if (b.client_enabled !== undefined) patch.client_enabled = Boolean(b.client_enabled);
  if (typeof b.display_name === "string") patch.display_name = b.display_name.slice(0, 120);
  const { error } = await db.from("vihem_mail_accounts").update(patch).eq("id", a.id); if (error) throw error;
  await audit(db, me, a as Account, "mailbox_settings_changed", { kind, access_mode: patch.access_mode ?? a.access_mode, client_enabled: patch.client_enabled ?? a.client_enabled, owner: owner });
  return {};
}
async function adminGrant({ db, me }: Ctx, b: any) {
  requireOrgAdmin(me);
  const { data: a } = await db.from("vihem_mail_accounts").select("id,organisation_id,kind,owner_user_id,email,display_name").eq("id", String(b.account_id || "")).eq("organisation_id", me.organisation_id).maybeSingle();
  if (!a) fail(404, "ACCOUNT_NOT_FOUND", "Brevlådan hittades inte.");
  const { error } = await db.rpc("vihem_mail_grant", { p_actor: me.id, p_account: a.id, p_user: String(b.user_id || ""), p_read: b.read !== false, p_send: Boolean(b.send), p_manage: Boolean(b.manage), p_admin: Boolean(b.admin), p_reason: String(b.reason ?? "") });
  if (error) { const m = /\[(E_[A-Z_]+)\]\s*(.*)$/s.exec(error.message); if (m) fail(m[1] === "E_FORBIDDEN" ? 403 : 400, m[1], m[2]); throw error; }
  // Ägaren av en personlig brevlåda meddelas när någon annan får åtkomst
  if (a.kind === "personal" && a.owner_user_id && a.owner_user_id !== b.user_id && b.read !== false) await db.rpc("create_notification", { recipient_id: a.owner_user_id, org_uuid: me.organisation_id, notification_title: "Åtkomst till din brevlåda", notification_message: `${me.name} har gett en kollega åtkomst till din brevlåda ${a.email}. Orsak: ${String(b.reason ?? "").slice(0, 200)}`, notification_type: "warning", notification_link: "mail", setting_key: null });
  return {};
}
async function adminAudit({ db, me }: Ctx, b: any) {
  requireOrgAdmin(me);
  let q = db.from("vihem_mail_audit_events").select("id,user_id,action,mail_account_id,result,error_code,metadata,thread_id,created_at").eq("organisation_id", me.organisation_id).order("created_at", { ascending: false }).limit(Math.min(Number(b.limit) || 100, 300));
  if (b.account_id) q = q.eq("mail_account_id", String(b.account_id));
  const { data } = await q; return { events: data ?? [] };
}
