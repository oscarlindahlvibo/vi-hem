import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

type Profile = { id: string; role: string; organisation_id: string | null };
type MailAccount = { id: string; organisation_id: string; email: string; display_name: string; description: string; active: boolean; search_general: boolean; search_invoices: boolean; last_tested_at: string | null; last_test_status: string; last_test_error_code: string };
type WatchRule = { id: string; organisation_id: string; name: string; keywords: string[]; match_mode: "any" | "all"; enabled: boolean; account_ids: string[]; last_run_at: string | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, service);
    const scheduled = await isScheduledWatchRequest(req, db);
    const auth = req.headers.get("Authorization");
    let userId = "";
    let profile: Profile | null = null;
    if (!scheduled) {
      if (!auth) return out({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
      const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return out({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
      userId = user.id;
      const result = await db.from("vihem_profiles").select("id,role,organisation_id").eq("id", user.id).maybeSingle();
      profile = result.data as Profile | null;
      if (!profile || !profile.organisation_id || !["staff", "admin"].includes(profile.role)) return out({ error: "Saknar behörighet till e-postintegrationen.", code: "FORBIDDEN" }, 403);
    }
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "status");
    if (action === "run_watchers") {
      if (!scheduled && profile?.role !== "admin") return out({ error: "Endast admin eller schemalagd körning får starta bevakningen.", code: "FORBIDDEN" }, 403);
      return out({ ok: true, ...(await runWatchers(db)) });
    }
    if (!profile?.organisation_id) return out({ error: "Organisation saknas.", code: "FORBIDDEN" }, 403);
    const accounts = await loadAccounts(db, profile.organisation_id);
    if (action === "status") return out({ ok: true, configured: Boolean(await credentials(db, profile.organisation_id)), scope: SCOPE, accounts });
    if (action === "list_accounts") return out({ ok: true, accounts });
    if (action === "create_account" || action === "update_account" || action === "delete_account") {
      if (profile.role !== "admin") return out({ error: "Endast admin kan hantera mailboxar.", code: "FORBIDDEN" }, 403);
      let accountId = String(body.id || "");
      if (action === "delete_account") {
        await db.from("vihem_mail_accounts").delete().eq("id", accountId).eq("organisation_id", profile.organisation_id);
        await audit(db, profile, "account_deleted", accountId, "ok", "");
      } else {
        const email = String(body.email || "").trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) return out({ error: "Ange en giltig Workspace-adress.", code: "INVALID_EMAIL" }, 400);
        const values = { email, display_name: String(body.display_name || "").trim(), description: String(body.description || "").trim(), active: body.active !== false, search_general: body.search_general !== false, search_invoices: body.search_invoices !== false, updated_by: userId, updated_at: new Date().toISOString() };
        if (action === "create_account") {
          const { data, error } = await db.from("vihem_mail_accounts").insert({ ...values, organisation_id: profile.organisation_id, created_by: userId }).select().single();
          if (error) return out({ error: error.message, code: "ACCOUNT_SAVE_FAILED" }, 400); accountId = data.id;
        } else {
          const { error } = await db.from("vihem_mail_accounts").update(values).eq("id", accountId).eq("organisation_id", profile.organisation_id);
          if (error) return out({ error: error.message, code: "ACCOUNT_SAVE_FAILED" }, 400);
        }
        await audit(db, profile, action === "create_account" ? "account_created" : "account_updated", accountId, "ok", "");
      }
      return out({ ok: true, accounts: await loadAccounts(db, profile.organisation_id) });
    }
    if (["list_watch_rules", "create_watch_rule", "update_watch_rule", "delete_watch_rule"].includes(action)) {
      if (profile.role !== "admin") return out({ error: "Endast admin kan hantera e-postbevakningar.", code: "FORBIDDEN" }, 403);
      if (action === "list_watch_rules") return out({ ok: true, rules: await loadWatchRules(db, profile.organisation_id), hits: await loadWatchHits(db, profile.organisation_id) });
      const ruleId = String(body.id || "");
      if (action === "delete_watch_rule") {
        await db.from("vihem_mail_watch_rules").delete().eq("id", ruleId).eq("organisation_id", profile.organisation_id);
        await audit(db, profile, "watch_rule_deleted", null, "ok", { rule_id: ruleId });
      } else {
        const keywords = parseKeywords(body.keywords);
        const name = String(body.name || "").trim();
        if (!name || keywords.length === 0) return out({ error: "Ange namn och minst ett sökord.", code: "INVALID_WATCH_RULE" }, 400);
        const values = { name, keywords, match_mode: body.match_mode === "all" ? "all" : "any", enabled: body.enabled !== false, account_ids: Array.isArray(body.account_ids) ? body.account_ids.map(String) : [], updated_by: userId, updated_at: new Date().toISOString() };
        if (action === "create_watch_rule") {
          const { data, error } = await db.from("vihem_mail_watch_rules").insert({ ...values, organisation_id: profile.organisation_id, created_by: userId }).select("id").single();
          if (error) return out({ error: error.message, code: "WATCH_RULE_SAVE_FAILED" }, 400);
          await audit(db, profile, "watch_rule_created", null, "ok", { rule_id: data.id });
        } else {
          const { error } = await db.from("vihem_mail_watch_rules").update(values).eq("id", ruleId).eq("organisation_id", profile.organisation_id);
          if (error) return out({ error: error.message, code: "WATCH_RULE_SAVE_FAILED" }, 400);
          await audit(db, profile, "watch_rule_updated", null, "ok", { rule_id: ruleId });
        }
      }
      return out({ ok: true, rules: await loadWatchRules(db, profile.organisation_id), hits: await loadWatchHits(db, profile.organisation_id) });
    }
    if (action === "test") {
      if (profile.role !== "admin") return out({ error: "Endast admin kan testa Gmail-kopplingen.", code: "FORBIDDEN" }, 403);
      const account = await allowedAccount(db, profile.organisation_id, String(body.id || ""));
      if (!account) return out({ error: "Mailboxen hittades inte.", code: "ACCOUNT_NOT_FOUND" }, 404);
      try { await gmail(db, profile.organisation_id, account.email, "/profile"); await updateTest(db, account.id, "ok", ""); await audit(db, profile, "connection_tested", account.id, "ok", ""); return out({ ok: true, code: "OK" }); }
      catch (e) { const code = googleCode(e); await updateTest(db, account.id, "failed", code); await audit(db, profile, "connection_tested", account.id, "failed", code); return out({ ok: false, code, error: friendly(code), details: safeGoogleDetails(e) }, 400); }
    }
    if (action === "search") {
      const query = String(body.query || "").trim();
      const mode = body.mode === "invoice" ? "invoice" : "general";
      const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date_from || "")) ? String(body.date_from) : "";
      const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date_to || "")) ? String(body.date_to) : "";
      if (dateFrom && dateTo && dateFrom > dateTo) return out({ error: "Från-datum måste vara före till-datum.", code: "INVALID_DATE_RANGE" }, 400);
      const sort = body.sort === "date_asc" ? "date_asc" : "date_desc";
      const selected = accounts.filter(a => a.active && (mode === "invoice" ? a.search_invoices : a.search_general) && (!body.account_ids?.length || body.account_ids.includes(a.id)));
      const results = (await Promise.all(selected.map(async account => { try { return { account, results: await searchMailbox(db, profile.organisation_id, account, query, mode, dateFrom, dateTo, sort), error: null }; } catch (e) { const code = googleCode(e); return { account, results: [], error: { code, message: friendly(code) } }; } }))).map(x => ({ account: safeAccount(x.account), results: x.results, error: x.error }));
      await audit(db, profile, "search", null, "ok", { mode, account_count: selected.length });
      return out({ ok: true, query, mode, sort, date_from: dateFrom || null, date_to: dateTo || null, results });
    }
    const account = await allowedAccount(db, profile.organisation_id, String(body.account_id || ""));
    if (!account) return out({ error: "Mailboxen hittades inte.", code: "ACCOUNT_NOT_FOUND" }, 404);
    if (action === "message") { const message = await gmail(db, profile.organisation_id, account.email, `/messages/${encodeURIComponent(String(body.message_id || ""))}?format=full`); await audit(db, profile, "message_read", account.id, "ok", {}); return out({ ok: true, message: normalizeMessage(message) }); }
    if (action === "attachment") { const attachment = await getAttachment(db, profile.organisation_id, account.email, String(body.message_id || ""), String(body.attachment_id || "")); await audit(db, profile, "attachment_downloaded", account.id, "ok", {}); return out({ ok: true, filename: String(body.filename || "bilaga"), mime_type: String(body.mime_type || "application/octet-stream"), data_base64: attachment }); }
    return out({ error: "Okänd åtgärd.", code: "UNKNOWN_ACTION" }, 400);
  } catch (e) { console.error("vihem-gmail", e); return out({ error: e instanceof Error ? e.message : "Internt fel", code: "INTERNAL_ERROR" }, 500); }
});

async function isScheduledWatchRequest(req: Request, db: any) {
  const supplied = req.headers.get("x-vihem-gmail-watch-secret") || "";
  if (!supplied) return false;
  const { data } = await db.from("vihem_system_settings").select("value").eq("key", "gmail_watch_scheduled").maybeSingle();
  return Boolean(data?.value?.enabled && data?.value?.secret && supplied === data.value.secret);
}

function parseKeywords(value: unknown) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[\n,;]/);
  return [...new Set(values.map(v => String(v).trim()).filter(Boolean).slice(0, 30))];
}

async function loadWatchRules(db: any, org: string) {
  const { data } = await db.from("vihem_mail_watch_rules").select("id,organisation_id,name,keywords,match_mode,enabled,account_ids,last_run_at,created_at,updated_at").eq("organisation_id", org).order("name");
  return data || [];
}

async function loadWatchHits(db: any, org: string) {
  const { data } = await db.from("vihem_mail_watch_hits").select("id,rule_id,mail_account_id,gmail_message_id,thread_id,subject,from_address,message_date,matched_keywords,status,created_at").eq("organisation_id", org).order("created_at", { ascending: false }).limit(100);
  return data || [];
}

async function runWatchers(db: any) {
  const { data: rules } = await db.from("vihem_mail_watch_rules").select("*").eq("enabled", true);
  let scanned = 0, created = 0, failed = 0;
  for (const rule of (rules || []) as WatchRule[]) {
    const { data: rawAccounts } = await db.from("vihem_mail_accounts").select("*").eq("organisation_id", rule.organisation_id).eq("active", true);
    const accounts = (rawAccounts || []).filter((a: MailAccount) => !rule.account_ids?.length || rule.account_ids.includes(a.id));
    const from = rule.last_run_at ? dayOf(Date.parse(rule.last_run_at)) : dayOf(Date.now() - 2 * 86400000);
    const query = rule.keywords.map(k => `"${k.replace(/"/g, "")}"`).join(" OR ");
    let ruleCreated = 0, ruleFailed = false;
    try {
      for (const account of accounts) {
        const results = await searchMailbox(db, rule.organisation_id, account, query, "general", from, dayOf(Date.now()), "date_desc");
        scanned += results.length;
        const matches = results.map(result => ({ result, matched: rule.keywords.filter(k => `${result.subject} ${result.from} ${result.snippet}`.toLowerCase().includes(k.toLowerCase())) })).filter(({ matched }) => rule.match_mode === "all" ? matched.length === rule.keywords.length : matched.length > 0);
        for (const { result, matched } of matches) {
          const { data: inserted } = await db.from("vihem_mail_watch_hits").insert({ organisation_id: rule.organisation_id, rule_id: rule.id, mail_account_id: account.id, gmail_message_id: result.id, thread_id: result.thread_id, subject: result.subject, from_address: result.from, message_date: result.timestamp ? new Date(result.timestamp).toISOString() : null, matched_keywords: matched }).select("id").maybeSingle();
          if (!inserted) continue;
          created++; ruleCreated++;
          const { data: recipients } = await db.from("vihem_profiles").select("id").eq("organisation_id", rule.organisation_id).in("role", ["admin", "staff"]);
          if (recipients?.length) await db.from("vihem_notifications").insert(recipients.map((recipient: { id: string }) => ({ user_id: recipient.id, organisation_id: rule.organisation_id, title: `E-postmatchning: ${rule.name}`, message: `${result.subject} · ${account.display_name || account.email}`, type: "info", link: "mail" })));
        }
      }
      await db.from("vihem_mail_watch_rules").update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", rule.id);
    } catch (error) {
      failed++;
      ruleFailed = true;
      console.error("gmail watcher", rule.id, error);
    }
    await db.from("vihem_mail_audit_events").insert({ organisation_id: rule.organisation_id, user_id: null, action: "watch_run", mail_account_id: null, result: ruleFailed ? "failed" : "ok", error_code: "", metadata: { rule_id: rule.id, created: ruleCreated } });
  }
  return { scanned, created, failed };
}

async function credentials(db: any, organisationId: string) {
  // Organisationens sparade nyckel ska vinna över en eventuell global fallback-secret.
  const { data } = await db.from("vihem_google_workspace_settings").select("encrypted_service_account_json").eq("organisation_id", organisationId).maybeSingle();
  if (data?.encrypted_service_account_json) {
    try { return JSON.parse(await decryptSecret(data.encrypted_service_account_json, getEncryptionSecret())); } catch { throw new Error("GOOGLE_CREDENTIALS_UNREADABLE"); }
  }
  const raw = Deno.env.get("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON") || Deno.env.get("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON_BASE64");
  if (raw) { try { return JSON.parse(raw.startsWith("{") ? raw : atob(raw)); } catch { throw new Error("GOOGLE_CREDENTIALS_INVALID_JSON"); } }
  return null;
}
async function token(db: any, organisationId: string, subject: string) {
  const c = await credentials(db, organisationId);
  if (!c?.client_email || !c?.private_key) throw new Error("GOOGLE_CREDENTIALS_MISSING");
  const now = Math.floor(Date.now() / 1000); const enc = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: c.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", sub: subject, iat: now, exp: now + 3600 })}`;
  let key: CryptoKey;
  try { key = await crypto.subtle.importKey("pkcs8", pem(c.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]); } catch { throw new Error("GOOGLE_PRIVATE_KEY_INVALID"); }
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${b64url(new Uint8Array(sig))}` });
  if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(`GOOGLE_TOKEN_FAILED:${payload.error || "unknown"}:${payload.error_description || ""}`); }
  const payload = await response.json(); if (!payload.access_token) throw new Error("GOOGLE_TOKEN_FAILED:missing_token:"); return payload.access_token as string;
}
async function gmail(db: any, organisationId: string, user: string, path: string) { const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}${path}`, { headers: { Authorization: `Bearer ${await token(db, organisationId, user)}` } }); if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(`GOOGLE_GMAIL_FAILED:${response.status}:${payload.error?.status || ""}:${payload.error?.message || ""}`); } return response.json(); }
async function getAttachment(db: any, organisationId: string, user: string, message: string, attachment: string) { const data = await gmail(db, organisationId, user, `/messages/${encodeURIComponent(message)}/attachments/${encodeURIComponent(attachment)}`); return data.data || ""; }
async function searchMailbox(db: any, organisationId: string, account: MailAccount, query: string, mode: string, dateFrom = "", dateTo = "", sort = "date_desc") { const dateQuery = `${dateFrom ? ` after:${dateFrom}` : ""}${dateTo ? ` before:${addDay(dateTo)}` : ""}`; const q = `${mode === "invoice" ? `${query} (invoice OR faktura OR kvitto OR receipt)` : query}${dateQuery}`.trim(); const list = await gmail(db, organisationId, account.email, `/messages?q=${encodeURIComponent(q)}&maxResults=50&includeSpamTrash=false`); const messages = await Promise.all((list.messages || []).slice(0, 50).map((m: { id: string }) => gmail(db, organisationId, account.email, `/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date&metadataHeaders=Cc`))); const mapped = messages.map((m: any) => { const headers = Object.fromEntries((m.payload?.headers || []).map((h: any) => [h.name.toLowerCase(), h.value])); const text = `${headers.subject || ""} ${headers.from || ""} ${m.snippet || ""}`; const date = headers.date || ""; const timestamp = Date.parse(date); const score = scoreText(text, query, mode); return { id: m.id, thread_id: m.threadId, subject: headers.subject || "(utan ämne)", from: headers.from || "", to: headers.to || "", date, snippet: m.snippet || "", score, has_attachments: Boolean(m.sizeEstimate && m.sizeEstimate > 0), timestamp }; }).filter((m: any) => (!dateFrom || (m.timestamp && m.timestamp >= Date.parse(`${dateFrom}T00:00:00Z`))) && (!dateTo || (m.timestamp && dayOf(m.timestamp) <= dateTo))).sort((a: any, b: any) => sort === "date_asc" ? a.timestamp - b.timestamp : b.timestamp - a.timestamp); return mapped; }
function dayOf(timestamp: number) { return new Date(timestamp).toISOString().slice(0, 10); }
function addDay(value: string) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }
function scoreText(text: string, query: string, mode: string) { const t = text.toLowerCase(), q = query.toLowerCase(); let score = t.includes(q) ? 50 : 0; for (const word of q.split(/\s+/).filter(Boolean)) if (t.includes(word)) score += 5; if (mode === "invoice" && /(faktura|invoice|kvitto|receipt|ocr|förfall)/i.test(t)) score += 20; return score; }
function normalizeMessage(m: any) { const headers = Object.fromEntries((m.payload?.headers || []).map((h: any) => [h.name.toLowerCase(), h.value])); return { id: m.id, thread_id: m.threadId, subject: headers.subject || "", from: headers.from || "", to: headers.to || "", date: headers.date || "", snippet: m.snippet || "", body: extractBody(m.payload), attachments: collectAttachments(m.payload) }; }
function extractBody(part: any): string { if (!part) return ""; if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data); return (part.parts || []).map(extractBody).filter(Boolean).join("\n").slice(0, 30000); }
function collectAttachments(part: any, out: any[] = []) { if (!part) return out; if (part.filename && part.body?.attachmentId) out.push({ filename: part.filename, mime_type: part.mimeType, attachment_id: part.body.attachmentId, size: part.body.size || 0 }); for (const child of part.parts || []) collectAttachments(child, out); return out; }
function decode(s: string) { try { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))); } catch { return ""; } }
function pem(s: string) { const b = atob(s.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "")); return Uint8Array.from(b, c => c.charCodeAt(0)); }
async function decryptSecret(value: string, secret: string) { const decoder = new TextDecoder(); const encoder = new TextEncoder(); const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0)); const iv = bytes.slice(0, 12); const cipher = bytes.slice(12); const hash = await crypto.subtle.digest("SHA-256", encoder.encode(secret)); const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]); return decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher)); }
function getEncryptionSecret() { return Deno.env.get("VIHEM_GOOGLE_WORKSPACE_SECRET_KEY") || Deno.env.get("VIHEM_OCR_SECRET_KEY") || Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""; }
function b64url(bytes: Uint8Array) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
async function loadAccounts(db: any, org: string) { const { data } = await db.from("vihem_mail_accounts").select("id,organisation_id,email,display_name,description,active,search_general,search_invoices,last_tested_at,last_test_status,last_test_error_code").eq("organisation_id", org).order("email"); return data || []; }
async function allowedAccount(db: any, org: string, id: string) { const { data } = await db.from("vihem_mail_accounts").select("*").eq("organisation_id", org).eq("id", id).maybeSingle(); return data as MailAccount | null; }
async function updateTest(db: any, id: string, status: string, code: string) { await db.from("vihem_mail_accounts").update({ last_tested_at: new Date().toISOString(), last_test_status: status, last_test_error_code: code }).eq("id", id); }
async function audit(db: any, p: Profile, action: string, account: string | null, result: string, metadata: unknown) { await db.from("vihem_mail_audit_events").insert({ organisation_id: p.organisation_id, user_id: p.id, action, mail_account_id: account || null, result, error_code: typeof metadata === "string" ? metadata : "", metadata: typeof metadata === "object" ? metadata : {} }); }
function safeAccount(a: MailAccount) { const { id, email, display_name, description, active, search_general, search_invoices, last_tested_at, last_test_status, last_test_error_code } = a; return { id, email, display_name, description, active, search_general, search_invoices, last_tested_at, last_test_status, last_test_error_code }; }
function googleCode(e: unknown) { const s = String(e); if (s.includes("GOOGLE_CREDENTIALS_MISSING")) return "CREDENTIALS_MISSING"; if (s.includes("GOOGLE_CREDENTIALS_UNREADABLE")) return "CREDENTIALS_UNREADABLE"; if (s.includes("GOOGLE_CREDENTIALS_INVALID_JSON")) return "CREDENTIALS_INVALID_JSON"; if (s.includes("GOOGLE_PRIVATE_KEY_INVALID")) return "PRIVATE_KEY_INVALID"; if (s.includes("invalid_grant")) return "INVALID_GRANT"; if (s.includes("unauthorized_client")) return "UNAUTHORIZED_CLIENT"; if (s.includes("GOOGLE_TOKEN_FAILED")) return "GOOGLE_TOKEN_FAILED"; if (s.includes("GOOGLE_GMAIL_FAILED:401")) return "DELEGATION_OR_CREDENTIALS_INVALID"; if (s.includes("GOOGLE_GMAIL_FAILED:403")) return "SCOPE_OR_API_NOT_AUTHORIZED"; if (s.includes("GOOGLE_GMAIL_FAILED:404")) return "MAILBOX_NOT_FOUND"; return "GOOGLE_API_ERROR"; }
function friendly(c: string) { const m: Record<string, string> = { CREDENTIALS_MISSING: "Google service account saknas. Lägg in JSON-nyckeln i Inställningar.", CREDENTIALS_UNREADABLE: "Den sparade Google-nyckeln kunde inte dekrypteras. Spara om JSON-nyckeln och testa igen.", CREDENTIALS_INVALID_JSON: "Google-nyckeln är inte giltig JSON.", PRIVATE_KEY_INVALID: "Google private_key kunde inte läsas. Använd hela private_key-värdet från service-account JSON.", INVALID_GRANT: "Google avvisade delegeringen. Kontrollera Domain-Wide Delegation, client ID och att gmail.readonly är tillagt.", UNAUTHORIZED_CLIENT: "Google avvisade servicekontot. Kontrollera att Domain-Wide Delegation är aktiverad för rätt service account.", GOOGLE_TOKEN_FAILED: "Google kunde inte utfärda en åtkomsttoken. Kontrollera service account och Domain-Wide Delegation.", DELEGATION_OR_CREDENTIALS_INVALID: "Service account eller Domain-Wide Delegation kunde inte verifieras.", SCOPE_OR_API_NOT_AUTHORIZED: "Gmail API eller gmail.readonly-scope är inte auktoriserad.", MAILBOX_NOT_FOUND: "Mailboxen kunde inte hittas i Workspace.", GOOGLE_API_ERROR: "Google Gmail API svarade med ett fel." }; return m[c] || "Anslutningen kunde inte verifieras."; }
function safeGoogleDetails(e: unknown) { const s = String(e); if (s.includes("GOOGLE_TOKEN_FAILED:")) return s.split(":").slice(1).join(":").trim() || undefined; if (s.includes("GOOGLE_GMAIL_FAILED:")) return s.split(":").slice(1).join(":").trim() || undefined; return undefined; }
function out(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } }); }
