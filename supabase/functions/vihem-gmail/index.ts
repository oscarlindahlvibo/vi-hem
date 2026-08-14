import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

type Profile = { id: string; role: string; organisation_id: string | null };
type MailAccount = { id: string; organisation_id: string; email: string; display_name: string; description: string; active: boolean; search_general: boolean; search_invoices: boolean; last_tested_at: string | null; last_test_status: string; last_test_error_code: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return out({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const db = createClient(url, service);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return out({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    const { data: profile } = await db.from("vihem_profiles").select("id,role,organisation_id").eq("id", user.id).maybeSingle() as { data: Profile | null };
    if (!profile || !profile.organisation_id || !["staff", "admin"].includes(profile.role)) return out({ error: "Saknar behörighet till e-postintegrationen.", code: "FORBIDDEN" }, 403);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "status");
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
        const values = { email, display_name: String(body.display_name || "").trim(), description: String(body.description || "").trim(), active: body.active !== false, search_general: body.search_general !== false, search_invoices: body.search_invoices !== false, updated_by: user.id, updated_at: new Date().toISOString() };
        if (action === "create_account") {
          const { data, error } = await db.from("vihem_mail_accounts").insert({ ...values, organisation_id: profile.organisation_id, created_by: user.id }).select().single();
          if (error) return out({ error: error.message, code: "ACCOUNT_SAVE_FAILED" }, 400); accountId = data.id;
        } else {
          const { error } = await db.from("vihem_mail_accounts").update(values).eq("id", accountId).eq("organisation_id", profile.organisation_id);
          if (error) return out({ error: error.message, code: "ACCOUNT_SAVE_FAILED" }, 400);
        }
        await audit(db, profile, action === "create_account" ? "account_created" : "account_updated", accountId, "ok", "");
      }
      return out({ ok: true, accounts: await loadAccounts(db, profile.organisation_id) });
    }
    if (action === "test") {
      if (profile.role !== "admin") return out({ error: "Endast admin kan testa Gmail-kopplingen.", code: "FORBIDDEN" }, 403);
      const account = await allowedAccount(db, profile.organisation_id, String(body.id || ""));
      if (!account) return out({ error: "Mailboxen hittades inte.", code: "ACCOUNT_NOT_FOUND" }, 404);
      try { await gmail(db, profile.organisation_id, account.email, "/profile"); await updateTest(db, account.id, "ok", ""); await audit(db, profile, "connection_tested", account.id, "ok", ""); return out({ ok: true, code: "OK" }); }
      catch (e) { const code = googleCode(e); await updateTest(db, account.id, "failed", code); await audit(db, profile, "connection_tested", account.id, "failed", code); return out({ ok: false, code, error: friendly(code) }, 400); }
    }
    if (action === "search") {
      const query = String(body.query || "").trim(); if (!query) return out({ error: "Skriv något att söka efter.", code: "EMPTY_QUERY" }, 400);
      const mode = body.mode === "invoice" ? "invoice" : "general";
      const selected = accounts.filter(a => a.active && (mode === "invoice" ? a.search_invoices : a.search_general) && (!body.account_ids?.length || body.account_ids.includes(a.id)));
      const results = (await Promise.all(selected.map(async account => { try { return { account, results: await searchMailbox(db, profile.organisation_id, account, query, mode), error: null }; } catch (e) { const code = googleCode(e); return { account, results: [], error: { code, message: friendly(code) } }; } }))).map(x => ({ account: safeAccount(x.account), results: x.results, error: x.error }));
      await audit(db, profile, "search", null, "ok", { mode, account_count: selected.length });
      return out({ ok: true, query, mode, results });
    }
    const account = await allowedAccount(db, profile.organisation_id, String(body.account_id || ""));
    if (!account) return out({ error: "Mailboxen hittades inte.", code: "ACCOUNT_NOT_FOUND" }, 404);
    if (action === "message") { const message = await gmail(db, profile.organisation_id, account.email, `/messages/${encodeURIComponent(String(body.message_id || ""))}?format=full`); await audit(db, profile, "message_read", account.id, "ok", {}); return out({ ok: true, message: normalizeMessage(message) }); }
    if (action === "attachment") { const attachment = await getAttachment(db, profile.organisation_id, account.email, String(body.message_id || ""), String(body.attachment_id || "")); await audit(db, profile, "attachment_downloaded", account.id, "ok", {}); return out({ ok: true, filename: String(body.filename || "bilaga"), mime_type: String(body.mime_type || "application/octet-stream"), data_base64: attachment }); }
    return out({ error: "Okänd åtgärd.", code: "UNKNOWN_ACTION" }, 400);
  } catch (e) { console.error("vihem-gmail", e); return out({ error: e instanceof Error ? e.message : "Internt fel", code: "INTERNAL_ERROR" }, 500); }
});

async function credentials(db: any, organisationId: string) { const raw = Deno.env.get("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON") || Deno.env.get("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON_BASE64"); if (raw) { try { return JSON.parse(raw.startsWith("{") ? raw : atob(raw)); } catch { return null; } } const { data } = await db.from("vihem_google_workspace_settings").select("encrypted_service_account_json").eq("organisation_id", organisationId).maybeSingle(); if (!data?.encrypted_service_account_json) return null; try { const decrypted = await decryptSecret(data.encrypted_service_account_json, getEncryptionSecret()); return JSON.parse(decrypted); } catch { return null; } }
async function token(db: any, organisationId: string, subject: string) { const c = await credentials(db, organisationId); if (!c?.client_email || !c?.private_key) throw new Error("GOOGLE_CREDENTIALS_MISSING"); const now = Math.floor(Date.now() / 1000); const enc = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v))); const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: c.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", sub: subject, iat: now, exp: now + 3600 })}`; const key = await crypto.subtle.importKey("pkcs8", pem(c.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]); const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)); const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${b64url(new Uint8Array(sig))}` }); if (!response.ok) throw new Error("GOOGLE_TOKEN_FAILED"); return (await response.json()).access_token as string; }
async function gmail(db: any, organisationId: string, user: string, path: string) { const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}${path}`, { headers: { Authorization: `Bearer ${await token(db, organisationId, user)}` } }); if (!response.ok) { const e = await response.text(); throw new Error(`${response.status}:${e.slice(0, 200)}`); } return response.json(); }
async function getAttachment(db: any, organisationId: string, user: string, message: string, attachment: string) { const data = await gmail(db, organisationId, user, `/messages/${encodeURIComponent(message)}/attachments/${encodeURIComponent(attachment)}`); return data.data || ""; }
async function searchMailbox(db: any, organisationId: string, account: MailAccount, query: string, mode: string) { const q = mode === "invoice" ? `${query} (invoice OR faktura OR kvitto OR receipt)`.trim() : query; const list = await gmail(db, organisationId, account.email, `/messages?q=${encodeURIComponent(q)}&maxResults=20&includeSpamTrash=false`); const messages = await Promise.all((list.messages || []).slice(0, 20).map((m: { id: string }) => gmail(db, organisationId, account.email, `/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date&metadataHeaders=Cc`))); return messages.map((m: any) => { const headers = Object.fromEntries((m.payload?.headers || []).map((h: any) => [h.name.toLowerCase(), h.value])); const text = `${headers.subject || ""} ${headers.from || ""} ${m.snippet || ""}`; const score = scoreText(text, query, mode); return { id: m.id, thread_id: m.threadId, subject: headers.subject || "(utan ämne)", from: headers.from || "", to: headers.to || "", date: headers.date || "", snippet: m.snippet || "", score, has_attachments: Boolean(m.sizeEstimate && m.sizeEstimate > 0) }; }).sort((a: any, b: any) => b.score - a.score); }
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
function safeAccount(a: MailAccount) { const { id, email, display_name, description, last_tested_at, last_test_status, last_test_error_code } = a; return { id, email, display_name, description, last_tested_at, last_test_status, last_test_error_code }; }
function googleCode(e: unknown) { const s = String(e); if (s.includes("GOOGLE_CREDENTIALS_MISSING")) return "CREDENTIALS_MISSING"; if (s.startsWith("401")) return "DELEGATION_OR_CREDENTIALS_INVALID"; if (s.startsWith("403")) return "SCOPE_OR_API_NOT_AUTHORIZED"; if (s.startsWith("404")) return "MAILBOX_NOT_FOUND"; return "GOOGLE_API_ERROR"; }
function friendly(c: string) { const m: Record<string, string> = { CREDENTIALS_MISSING: "Google service account saknas i Supabase secrets.", DELEGATION_OR_CREDENTIALS_INVALID: "Service account eller Domain-Wide Delegation kunde inte verifieras.", SCOPE_OR_API_NOT_AUTHORIZED: "Gmail API eller gmail.readonly-scope är inte auktoriserad.", MAILBOX_NOT_FOUND: "Mailboxen kunde inte hittas i Workspace.", GOOGLE_API_ERROR: "Google Gmail API svarade med ett fel." }; return m[c] || "Anslutningen kunde inte verifieras."; }
function out(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } }); }
