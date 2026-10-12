// Schemalagt kodjobb för ViboRent (körs varje minut via pg_cron -> pg_net, autentiserat med delad hemlighet).
// 1. Utfärdar AlgoPIN hos låsleverantören för bokningar vars utskickstid har kommit (aldrig tidigare).
// 2. Skickar koden via Cellsynt och loggar status utan att koden hamnar i någon logg.
// 3. Stämmer av leveransrapporter, försöker igen med backoff och larmar personal när något kräver manuell åtgärd.
// Race-säkerhet: jobben claimas med FOR UPDATE SKIP LOCKED och avbokning låser samma rader (se vihem_rental_cancel_booking).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptSecret, encryptSecret } from "../_shared/rental-common.ts";
import { IgloohomeProvider, LockProviderError, MockLockProvider, planPin, type LockProvider } from "../_shared/igloohome.ts";
import { sendSms } from "../_shared/cellsynt.ts";

const MAX_ISSUE_ATTEMPTS = 8;
const MAX_SMS_ATTEMPTS = 5;
const backoffMinutes = (attempt: number) => Math.min(30, [1, 2, 5, 10, 15, 20, 30][Math.min(attempt - 1, 6)]);

async function notifyStaff(admin: any, organisationId: string, title: string, message: string) {
  const { data: staff } = await admin.from("vihem_profiles").select("id").eq("organisation_id", organisationId).in("role", ["staff", "admin"]).eq("active", true);
  for (const person of staff ?? []) {
    const { error } = await admin.rpc("create_notification", { recipient_id: person.id, org_uuid: organisationId, notification_title: title, notification_message: message, notification_type: "warning", notification_link: "rental", setting_key: null });
    if (error) console.error("create_notification:", error.message);
  }
}
const event = (admin: any, organisationId: string, bookingId: string, codeId: string, type: string, detail: Record<string, unknown> = {}) =>
  admin.rpc("vihem_rental_log_access_event", { p_org: organisationId, p_booking: bookingId, p_code: codeId, p_type: type, p_detail: detail });

const providerCache = new Map<string, LockProvider | null>();
async function providerFor(admin: any, organisationId: string): Promise<LockProvider | null> {
  if (providerCache.has(organisationId)) return providerCache.get(organisationId)!;
  const { data: integration } = await admin.from("vihem_rental_integrations").select("id,active,settings").eq("organisation_id", organisationId).eq("integration_type", "access").eq("provider", "igloohome").maybeSingle();
  let provider: LockProvider | null = null;
  if (integration?.active) {
    if (integration.settings?.mode === "mock") provider = new MockLockProvider();
    else if (integration.settings?.client_id_enc && integration.settings?.client_secret_enc) {
      provider = new IgloohomeProvider(await decryptSecret(integration.settings.client_id_enc, `integration:${integration.id}:id`), await decryptSecret(integration.settings.client_secret_enc, `integration:${integration.id}:secret`));
    }
  }
  providerCache.set(organisationId, provider);
  return provider;
}

const fmt = (iso: string, timezone: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

async function issueOne(admin: any, job: any) {
  const { data: ctx } = await admin.from("vihem_rental_access_codes").select("id,organisation_id,booking_id,valid_from,valid_until,attempts,asset:vihem_rental_assets(name),lock:vihem_rental_locks(external_device_id,timezone,active,name),booking:vihem_rental_bookings(public_reference,status,payment_status)").eq("id", job.id).maybeSingle();
  if (!ctx) return;
  const asset: any = Array.isArray(ctx.asset) ? ctx.asset[0] : ctx.asset, lock: any = Array.isArray(ctx.lock) ? ctx.lock[0] : ctx.lock, booking: any = Array.isArray(ctx.booking) ? ctx.booking[0] : ctx.booking;
  const fail = async (status: "failed" | "manual", reason: string, retry: boolean) => {
    const next = retry && ctx.attempts < MAX_ISSUE_ATTEMPTS ? new Date(Date.now() + backoffMinutes(ctx.attempts) * 60000).toISOString() : null;
    const finalStatus = status === "failed" && !next ? "manual" : status;
    await admin.from("vihem_rental_access_codes").update({ status: finalStatus, last_error: reason.slice(0, 300), next_attempt_at: next, locked_until: null, updated_at: new Date().toISOString() }).eq("id", ctx.id);
    await event(admin, ctx.organisation_id, ctx.booking_id, ctx.id, "issue_failed", { attempt: ctx.attempts, reason: reason.slice(0, 200), final: finalStatus === "manual" });
    if (finalStatus === "manual") await notifyStaff(admin, ctx.organisation_id, "Låskod kräver manuell åtgärd", `Bokning ${booking?.public_reference}: koden för ${asset?.name || "objektet"} kunde inte utfärdas automatiskt (${reason.slice(0, 120)}). Utfärda koden manuellt och kontakta kunden.`);
  };
  if (!lock?.active || !lock?.external_device_id) return fail("manual", "Objektet saknar aktivt lås.", false);
  const provider = await providerFor(admin, ctx.organisation_id);
  if (!provider) return fail("manual", "igloohome-integrationen är inte aktiv eller saknar nycklar.", false);
  try { planPin(new Date(ctx.valid_from), new Date(ctx.valid_until)); } catch (error) { return fail("manual", error instanceof Error ? error.message : "Ogiltig period.", false); }
  try {
    const issued = await provider.createPin({ deviceId: lock.external_device_id, start: new Date(ctx.valid_from), end: new Date(ctx.valid_until), accessName: `Bokning ${booking?.public_reference}`.slice(0, 50), timezone: lock.timezone || "Europe/Stockholm" });
    const encrypted = await encryptSecret(issued.pin, `access-code:${ctx.id}`);
    await admin.from("vihem_rental_access_codes").update({ status: "issued", pin_encrypted: encrypted, external_pin_id: issued.pinId, pin_type: issued.pinType, issued_at: new Date().toISOString(), last_error: null, next_attempt_at: null, locked_until: null, sms_status: provider.name === "mock" ? "not_sent" : "pending", updated_at: new Date().toISOString() }).eq("id", ctx.id);
    await event(admin, ctx.organisation_id, ctx.booking_id, ctx.id, "pin_issued", { provider: provider.name, pin_type: issued.pinType, attempt: ctx.attempts });
  } catch (error) {
    const e = error instanceof LockProviderError ? error : new LockProviderError(error instanceof Error ? error.message : "Okänt fel", 0, true);
    await fail("failed", e.message, e.retryable);
  }
}

async function smsOne(admin: any, codeId: string) {
  const { data: row } = await admin.from("vihem_rental_access_codes").select("id,organisation_id,booking_id,status,pin_encrypted,valid_from,valid_until,sms_attempts,sms_status,asset:vihem_rental_assets(name),booking:vihem_rental_bookings(public_reference,status,customer:vihem_rental_customers(first_name,last_name,company_name,phone))").eq("id", codeId).maybeSingle();
  if (!row?.pin_encrypted) return;
  const booking: any = Array.isArray(row.booking) ? row.booking[0] : row.booking, asset: any = Array.isArray(row.asset) ? row.asset[0] : row.asset;
  const customer: any = booking ? (Array.isArray(booking.customer) ? booking.customer[0] : booking.customer) : null;
  if (!booking || booking.status === "cancelled") {
    // Avbokad efter utfärdande: koden skickas aldrig. Personal varnas redan av avbokningen.
    await admin.from("vihem_rental_access_codes").update({ sms_status: "not_sent", updated_at: new Date().toISOString() }).eq("id", row.id);
    await event(admin, row.organisation_id, row.booking_id, row.id, "sms_skipped_cancelled");
    return;
  }
  const { data: settings } = await admin.from("vihem_rental_settings").select("access_sms_template,timezone").eq("organisation_id", row.organisation_id).maybeSingle();
  const tz = settings?.timezone || "Europe/Stockholm";
  const pin = await decryptSecret(row.pin_encrypted, `access-code:${row.id}`);
  const name = (customer?.first_name || customer?.company_name || "").trim();
  const long = new Date(row.valid_until).getTime() - new Date(row.valid_from).getTime() > 24 * 3600_000;
  const build = (pinText: string) => (settings?.access_sms_template || "Hej {{name}}! Din kod till {{asset}} är {{pin}}. Giltig {{from}} – {{until}}. Bokning {{reference}}.")
    .replaceAll("{{name}}", name).replaceAll("{{asset}}", asset?.name || "låset").replaceAll("{{pin}}", pinText).replaceAll("{{from}}", fmt(row.valid_from, tz)).replaceAll("{{until}}", fmt(row.valid_until, tz)).replaceAll("{{reference}}", booking.public_reference)
    + (long ? " OBS: koden måste användas första gången inom 24 timmar efter starttiden." : "");
  const attempt = (row.sms_attempts || 0) + 1;
  await admin.from("vihem_rental_access_codes").update({ sms_attempts: attempt, updated_at: new Date().toISOString() }).eq("id", row.id);
  if (!customer?.phone) {
    await admin.from("vihem_rental_access_codes").update({ sms_status: "failed", last_error: "Kunden saknar telefonnummer.", status: "manual" }).eq("id", row.id);
    await notifyStaff(admin, row.organisation_id, "Låskod kunde inte skickas", `Bokning ${booking.public_reference}: kunden saknar telefonnummer. Koden finns i bokningen i VI-HEM.`);
    return;
  }
  const result = await sendSms(admin, row.organisation_id, customer.phone, build(pin), build("••••"), { type: "rental_access", id: row.id });
  if (result.ok) {
    await admin.from("vihem_rental_access_codes").update({ sms_status: "sent", status: "sent", sms_sent_at: new Date().toISOString(), sms_message_id: result.messageId, last_error: null, updated_at: new Date().toISOString() }).eq("id", row.id);
    await event(admin, row.organisation_id, row.booking_id, row.id, "sms_accepted", { attempt, message_id: result.messageId });
  } else {
    const final = attempt >= MAX_SMS_ATTEMPTS;
    await admin.from("vihem_rental_access_codes").update({ sms_status: "failed", last_error: (result.error || "SMS misslyckades").slice(0, 300), next_attempt_at: final ? null : new Date(Date.now() + backoffMinutes(attempt) * 60000).toISOString(), status: final ? "manual" : "issued", updated_at: new Date().toISOString() }).eq("id", row.id);
    await event(admin, row.organisation_id, row.booking_id, row.id, "sms_failed", { attempt, reason: (result.error || "").slice(0, 200), final });
    if (final) await notifyStaff(admin, row.organisation_id, "Låskod kunde inte skickas", `Bokning ${booking.public_reference}: SMS med kod misslyckades ${attempt} gånger. Skicka koden manuellt från bokningen i VI-HEM.`);
  }
}

Deno.serve(async (request: Request) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const secret = request.headers.get("x-vihem-rental-worker-secret") || "";
  const { data: ok } = await admin.rpc("vihem_rental_worker_secret_ok", { p_secret: secret });
  if (!ok) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });

  const summary = { claimed: 0, sms: 0, reconciled: 0 };
  try {
    // 1. Utfärda koder som är förfallna enligt schema
    const { data: jobs } = await admin.rpc("vihem_rental_claim_access_jobs", { p_limit: 10 });
    summary.claimed = (jobs ?? []).length;
    for (const job of jobs ?? []) { try { await issueOne(admin, job); } catch (error) { console.error("issue job:", error instanceof Error ? error.message : error); } }

    // 2. Skicka SMS för utfärdade koder (och omförsök)
    const { data: pending } = await admin.from("vihem_rental_access_codes").select("id").in("status", ["issued", "sent"]).in("sms_status", ["pending", "failed"]).lt("sms_attempts", MAX_SMS_ATTEMPTS).or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`).limit(10);
    for (const row of pending ?? []) { try { await smsOne(admin, row.id); summary.sms++; } catch (error) { console.error("sms job:", error instanceof Error ? error.message : error); } }

    // 3. Stäm av leveransrapporter från Cellsynt
    const { data: sent } = await admin.from("vihem_rental_access_codes").select("id,organisation_id,booking_id,sms_message_id,sms_sent_at").eq("sms_status", "sent").not("sms_message_id", "is", null).limit(50);
    for (const row of sent ?? []) {
      const { data: msg } = await admin.from("vihem_sms_messages").select("delivery_status").eq("id", row.sms_message_id).maybeSingle();
      if (msg?.delivery_status === "delivered") {
        await admin.from("vihem_rental_access_codes").update({ sms_status: "delivered", updated_at: new Date().toISOString() }).eq("id", row.id);
        await event(admin, row.organisation_id, row.booking_id, row.id, "sms_delivered"); summary.reconciled++;
      } else if (msg?.delivery_status === "delivery_failed") {
        await admin.from("vihem_rental_access_codes").update({ sms_status: "failed", last_error: "Operatören kunde inte leverera SMS:et.", next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
        await event(admin, row.organisation_id, row.booking_id, row.id, "sms_delivery_failed"); summary.reconciled++;
      }
    }

    // 4. Dataminimering: krypterade koder rensas en vecka efter att de gått ut
    await admin.from("vihem_rental_access_codes").update({ pin_encrypted: null }).lt("valid_until", new Date(Date.now() - 7 * 86400000).toISOString()).not("pin_encrypted", "is", null);
    return new Response(JSON.stringify({ ok: true, ...summary }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error("rental worker:", error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
