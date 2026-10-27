// Schemalagd körning för VI-HEM Mail (pg_cron → pg_net, delad hemlighet i vihem_system_settings 'mail_worker'):
// 1) skickar förfallna schemalagda meddelanden (samma säkra utskicksväg som vanliga utskick),
// 2) väcker snoozade trådar tillbaka till inkorgen,
// 3) skapar notiser för nya mejl via Gmail History (bara läsning, gmail.readonly) med användarens egna notisinställningar och utan dubbletter.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createGmail, GmailApiError, type GmailClient } from "../_shared/mail/gmail.ts";
import { gmailRequestFor, type ServiceAccount } from "../_shared/mail/dwd.ts";
import { sendDueScheduled, type LedgerRow, type LedgerStore } from "../_shared/mail/send.ts";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cfg } = await db.from("vihem_system_settings").select("value").eq("key", "mail_worker").maybeSingle();
  const supplied = req.headers.get("x-vihem-mail-worker-secret") || "";
  if (!cfg?.value?.enabled || !cfg.value.secret || supplied !== cfg.value.secret) return json({ error: "Forbidden" }, 403);
  const summary = { scheduled_sent: 0, scheduled_failed: 0, snoozes_woken: 0, notifications: 0, accounts_synced: 0, sync_errors: 0 };
  try {
    const clients = new Map<string, GmailClient>();
    const credsCache = new Map<string, ServiceAccount>();
    const gmailFor = async (account: { id: string; email: string; organisation_id: string }) => {
      let g = clients.get(account.id); if (g) return g;
      let creds = credsCache.get(account.organisation_id);
      if (!creds) { creds = await loadCredentials(db, account.organisation_id); credsCache.set(account.organisation_id, creds); }
      g = createGmail(gmailRequestFor(creds, account.email)); clients.set(account.id, g); return g;
    };
    await sendScheduled(db, gmailFor, summary);
    await wakeSnoozes(db, gmailFor, summary);
    await notifyNewMail(db, gmailFor, summary);
    // Mejlnotiser är bara push: raderna finns för att push-triggern ska ha något att skicka och städas bort här (routingtriggern skriver över category, så raderna identifieras via länk och rubrik).
    await db.from("vihem_notifications").delete().like("link", "mail/%").like("title", "Nytt mejl i %").lt("created_at", new Date(Date.now() - 3 * 60_000).toISOString());
    return json({ ok: true, ...summary });
  } catch (e) { console.error("vihem-mail-worker", e); return json({ ok: false, error: e instanceof Error ? e.message : "fel", ...summary }, 500); }
});

function store(db: any): LedgerStore {
  return {
    async find() { return null; },
    async insert() { throw new Error("not used"); },
    async update(id, patch) { const { error } = await db.from("vihem_mail_send_ledger").update(patch).eq("id", id); if (error) throw error; },
  };
}

async function sendScheduled(db: any, gmailFor: (a: any) => Promise<GmailClient>, summary: Record<string, number>) {
  // Förfallna schemalagda + fastnade (sending/unknown med innehåll kvar sedan > 5 min). Rad "claimas" atomiskt innan något skickas.
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: due } = await db.from("vihem_mail_send_ledger").select("id,mail_account_id,status").or(`and(status.eq.scheduled,scheduled_for.lte.${new Date().toISOString()}),and(status.in.(sending,unknown),payload.not.is.null,updated_at.lt.${staleBefore})`).limit(20);
  for (const d of due ?? []) {
    const { data: claimed } = await db.from("vihem_mail_send_ledger").update({ status: "sending", updated_at: new Date().toISOString() }).eq("id", d.id).in("status", ["scheduled", "sending", "unknown"]).select("id,status,request_hash,message_id_header,gmail_message_id,thread_id,updated_at,attempts,payload,organisation_id,mail_account_id,user_id").maybeSingle();
    if (!claimed) continue;
    try {
      const { data: account } = await db.from("vihem_mail_accounts").select("id,email,organisation_id,active").eq("id", claimed.mail_account_id).maybeSingle();
      if (!account?.active) throw new Error("Brevlådan är inaktiv.");
      // Behörighet kontrolleras även i bakgrundsjobb: avsändaren måste fortfarande få skicka
      const { data: allowed } = await db.rpc("vihem_mail_authorize", { p_user: claimed.user_id, p_account: account.id, p_level: "send" });
      if (allowed !== true) { await db.from("vihem_mail_send_ledger").update({ status: "failed", last_error: "Behörigheten att skicka har återkallats.", payload: null }).eq("id", claimed.id); summary.scheduled_failed++; continue; }
      const gmail = await gmailFor(account); const identities = await gmail.sendAs();
      await sendDueScheduled({ store: store(db), gmail, identities, accountId: account.id, organisationId: account.organisation_id, userId: claimed.user_id, domain: account.email.split("@")[1], ledgerBase: {} }, claimed as LedgerRow);
      summary.scheduled_sent++;
    } catch (e) { summary.scheduled_failed++; await db.from("vihem_mail_send_ledger").update({ status: e instanceof GmailApiError && e.status < 500 ? "failed" : "unknown", last_error: String(e instanceof Error ? e.message : e).slice(0, 500) }).eq("id", claimed.id); }
  }
}

async function wakeSnoozes(db: any, gmailFor: (a: any) => Promise<GmailClient>, summary: Record<string, number>) {
  const { data: due } = await db.from("vihem_mail_snoozes").select("id,mail_account_id,thread_id,label_id,user_id").is("woken_at", null).lte("wake_at", new Date().toISOString()).limit(50);
  for (const s of due ?? []) {
    try {
      const { data: account } = await db.from("vihem_mail_accounts").select("id,email,organisation_id,active,display_name").eq("id", s.mail_account_id).maybeSingle();
      if (!account?.active) { await db.from("vihem_mail_snoozes").update({ woken_at: new Date().toISOString() }).eq("id", s.id); continue; }
      const gmail = await gmailFor(account);
      await gmail.modifyThread(s.thread_id, ["INBOX", "UNREAD"], s.label_id ? [s.label_id] : []);
      await db.from("vihem_mail_snoozes").update({ woken_at: new Date().toISOString() }).eq("id", s.id); summary.snoozes_woken++;
      await db.rpc("create_notification", { recipient_id: s.user_id, org_uuid: account.organisation_id, notification_title: "Snoozat mejl är tillbaka", notification_message: `En snoozad tråd i ${account.display_name || account.email} ligger nu i inkorgen igen.`, notification_type: "info", notification_link: "mail", setting_key: null });
    } catch (e) { if (e instanceof GmailApiError && e.status === 404) await db.from("vihem_mail_snoozes").update({ woken_at: new Date().toISOString() }).eq("id", s.id); else console.error("snooze wake", e); }
  }
}

async function notifyNewMail(db: any, gmailFor: (a: any) => Promise<GmailClient>, summary: Record<string, number>) {
  const { data: prefs } = await db.from("vihem_mail_user_prefs").select("user_id,organisation_id,notify_mode,notify_show_sender,important_senders,notify_account_ids").neq("notify_mode", "none");
  if (!prefs?.length) return;
  const accountIds = new Set<string>();
  const perms = new Map<string, any[]>();
  for (const p of prefs) {
    const { data: ps } = await db.from("vihem_mail_permissions").select("mail_account_id").eq("user_id", p.user_id).is("revoked_at", null).eq("can_read", true);
    const list = (ps ?? []).map((x: any) => x.mail_account_id).filter((id: string) => !p.notify_account_ids || p.notify_account_ids.includes(id));
    perms.set(p.user_id, list); list.forEach((id: string) => accountIds.add(id));
  }
  for (const accountId of accountIds) {
    const { data: account } = await db.from("vihem_mail_accounts").select("id,email,display_name,organisation_id,active,client_enabled,kind").eq("id", accountId).maybeSingle();
    if (!account?.active || !account.client_enabled) continue;
    try {
      const gmail = await gmailFor(account);
      const { data: state } = await db.from("vihem_mail_sync_state").select("history_id").eq("mail_account_id", account.id).maybeSingle();
      if (!state?.history_id) { const prof = await gmail.profile(); await db.from("vihem_mail_sync_state").upsert({ mail_account_id: account.id, organisation_id: account.organisation_id, history_id: prof.historyId, last_sync_at: new Date().toISOString(), last_full_sync_at: new Date().toISOString(), status: "ok", last_error: "", consecutive_failures: 0, updated_at: new Date().toISOString() }, { onConflict: "mail_account_id" }); continue; }
      const changes = await gmail.changesSince(state.history_id);
      if (changes.expired) { const prof = await gmail.profile(); await db.from("vihem_mail_sync_state").update({ history_id: prof.historyId, last_full_sync_at: new Date().toISOString(), status: "ok", last_error: "historyId förnyat efter utgång", updated_at: new Date().toISOString() }).eq("mail_account_id", account.id); continue; }
      for (const msg of changes.newInboxMessages.slice(0, 25)) {
        const parsed = await gmail.getMessageMetadata(msg.id).catch(() => null);
        const { data: meta } = await db.from("vihem_mail_thread_meta").select("assigned_to").eq("mail_account_id", account.id).eq("thread_id", msg.threadId).maybeSingle();
        for (const p of prefs) {
          if (!perms.get(p.user_id)?.includes(account.id)) continue;
          const sender = parsed?.from.email ?? "";
          const important = (p.important_senders ?? []).some((s: string) => (s.startsWith("@") ? sender.endsWith(s) : sender === s)) || Boolean(parsed?.labelIds.includes("IMPORTANT"));
          const eligible = p.notify_mode === "all" || (p.notify_mode === "important" && important) || (p.notify_mode === "shared" && account.kind === "shared") || (p.notify_mode === "assigned" && meta?.assigned_to === p.user_id);
          if (!eligible) continue;
          const { error: dupe } = await db.from("vihem_mail_notified").insert({ mail_account_id: account.id, gmail_message_id: msg.id, user_id: p.user_id });
          if (dupe) continue; // redan notifierad
          // Integritet: personliga brevlådor och standardläge visar aldrig avsändare/ämne (låsskärm) – bara om användaren uttryckligen valt det
          const showDetails = p.notify_show_sender && parsed;
          // Push-only: skapas som redan läst så att den aldrig räknas som oläst; aviseringslistan döljer länkar som börjar på "mail" och raden städas bort efter några minuter. Länken öppnar mejlet direkt.
          await db.from("vihem_notifications").insert({ user_id: p.user_id, organisation_id: account.organisation_id, title: `Nytt mejl i ${account.display_name || account.email}`, message: showDetails ? `${parsed!.from.name || parsed!.from.email}: ${parsed!.subject}`.slice(0, 160) : "Du har fått ett nytt mejl.", type: "info", link: `mail/${account.id}/${msg.threadId}`, read_at: new Date().toISOString() });
          summary.notifications++;
        }
      }
      await db.from("vihem_mail_sync_state").update({ history_id: changes.historyId, last_sync_at: new Date().toISOString(), status: "ok", last_error: "", consecutive_failures: 0, updated_at: new Date().toISOString() }).eq("mail_account_id", account.id);
      summary.accounts_synced++;
    } catch (e) {
      summary.sync_errors++;
      const { data: st } = await db.from("vihem_mail_sync_state").select("consecutive_failures").eq("mail_account_id", account.id).maybeSingle();
      await db.from("vihem_mail_sync_state").upsert({ mail_account_id: account.id, organisation_id: account.organisation_id, status: "error", last_error: String(e instanceof Error ? e.message : e).slice(0, 300), consecutive_failures: (st?.consecutive_failures ?? 0) + 1, updated_at: new Date().toISOString() }, { onConflict: "mail_account_id" });
    }
  }
}

async function loadCredentials(db: any, org: string): Promise<ServiceAccount> {
  const { data } = await db.from("vihem_google_workspace_settings").select("encrypted_service_account_json").eq("organisation_id", org).maybeSingle();
  if (data?.encrypted_service_account_json) return JSON.parse(await decryptSecret(data.encrypted_service_account_json, secret()));
  const raw = Deno.env.get("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON") || Deno.env.get("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON_BASE64");
  if (!raw) throw new Error("Google service account saknas.");
  return JSON.parse(raw.startsWith("{") ? raw : atob(raw));
}
async function decryptSecret(value: string, key: string) { const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)); const k = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, k, bytes.slice(12))); }
const secret = () => Deno.env.get("VIHEM_GOOGLE_WORKSPACE_SECRET_KEY") || Deno.env.get("VIHEM_OCR_SECRET_KEY") || Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
