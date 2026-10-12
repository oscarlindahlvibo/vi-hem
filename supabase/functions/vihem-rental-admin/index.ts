// Personal-API för ViboRent (kräver inloggad VI-HEM-användare i rätt organisation). Här ligger allt som behöver serverns hemligheter:
// igloohome-nycklar, låsimport, manuell kodhantering, avbokning med återbetalning. Hemligheter returneras aldrig.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptSecret, encryptSecret, mapDbError, text, UUID } from "../_shared/rental-common.ts";
import { IgloohomeProvider, LockProviderError, MockLockProvider } from "../_shared/igloohome.ts";
import { issueRefund } from "../_shared/rental-stripe.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
    const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } } as any;
    if (!auth?.user) return json({ error: "Du måste logga in." }, 401);
    const { data: profile } = await admin.from("vihem_profiles").select("id,role,organisation_id,active").eq("id", auth.user.id).maybeSingle();
    if (!profile?.active || !["staff", "admin", "superadmin"].includes(profile.role)) return json({ error: "Personalbehörighet krävs." }, 403);
    const organisationId = profile.organisation_id as string;
    const isAdmin = ["admin", "superadmin"].includes(profile.role);
    const { data: moduleRow } = await admin.from("vihem_organisation_modules").select("enabled").eq("organisation_id", organisationId).eq("module_key", "rental_management").maybeSingle();
    if (!moduleRow?.enabled) return json({ error: "Uthyrningsmodulen är inte aktiverad." }, 403);

    const body = JSON.parse((await request.text()) || "{}");
    const action = text(body.action, 40);
    const requireAdmin = () => { if (!isAdmin) throw Object.assign(new Error("[E_FORBIDDEN] Administratörsbehörighet krävs."), {}); };

    const integration = async () => (await admin.from("vihem_rental_integrations").select("id,active,settings,last_tested_at,last_error").eq("organisation_id", organisationId).eq("integration_type", "access").eq("provider", "igloohome").maybeSingle()).data;
    const providerFor = async () => {
      const row = await integration();
      if (!row) throw new LockProviderError("igloohome är inte konfigurerat.");
      if (row.settings?.mode === "mock") return { row, provider: new MockLockProvider() };
      if (!row.settings?.client_id_enc || !row.settings?.client_secret_enc) throw new LockProviderError("igloohome-nycklar saknas.");
      return { row, provider: new IgloohomeProvider(await decryptSecret(row.settings.client_id_enc, `integration:${row.id}:id`), await decryptSecret(row.settings.client_secret_enc, `integration:${row.id}:secret`)) };
    };

    if (action === "integration_status") {
      const row = await integration();
      return json({ configured: !!row, active: !!row?.active, mode: row?.settings?.mode || (row?.settings?.client_id_enc ? "live" : null), has_credentials: !!row?.settings?.client_id_enc, last_tested_at: row?.last_tested_at ?? null, last_error: row?.last_error ?? null });
    }

    if (action === "save_integration") {
      requireAdmin();
      const mode = text(body.mode, 10) === "mock" ? "mock" : "live";
      const existing = await integration();
      let id = existing?.id as string | undefined;
      if (!id) {
        const { data, error } = await admin.from("vihem_rental_integrations").insert({ organisation_id: organisationId, integration_type: "access", provider: "igloohome", active: false, settings: {} }).select("id").single();
        if (error) throw error; id = data.id;
      }
      const settings: Record<string, unknown> = { ...(existing?.settings || {}), mode };
      const clientId = text(body.client_id, 200), clientSecret = text(body.client_secret, 400);
      if (mode === "live" && (clientId || clientSecret)) {
        if (!clientId || !clientSecret) return json({ error: "Ange både Client ID och Client Secret." }, 400);
        settings.client_id_enc = await encryptSecret(clientId, `integration:${id}:id`);
        settings.client_secret_enc = await encryptSecret(clientSecret, `integration:${id}:secret`);
      }
      const active = body.active === true && (mode === "mock" || !!settings.client_id_enc);
      if (body.active === true && !active) return json({ error: "Lägg in nycklar innan integrationen aktiveras." }, 400);
      const { error } = await admin.from("vihem_rental_integrations").update({ settings, active: body.active === undefined ? existing?.active ?? false : active, updated_at: new Date().toISOString(), last_error: null }).eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "test_integration" || action === "sync_locks") {
      requireAdmin();
      let devices;
      try { const { row, provider } = await providerFor(); devices = await provider.listDevices(); await admin.from("vihem_rental_integrations").update({ last_tested_at: new Date().toISOString(), last_error: null }).eq("id", row.id); }
      catch (error) {
        const message = error instanceof Error ? error.message : "Okänt fel";
        await admin.from("vihem_rental_integrations").update({ last_tested_at: new Date().toISOString(), last_error: message.slice(0, 300) }).eq("organisation_id", organisationId).eq("integration_type", "access").eq("provider", "igloohome");
        return json({ ok: false, error: message }, 200);
      }
      if (action === "sync_locks") {
        for (const d of devices) {
          await admin.from("vihem_rental_locks").upsert({ organisation_id: organisationId, provider: "igloohome", external_device_id: d.id, name: d.name, model: d.model || null, last_checked_at: new Date().toISOString(), last_error: null }, { onConflict: "organisation_id,provider,external_device_id", ignoreDuplicates: false });
        }
      }
      return json({ ok: true, devices: devices.map((d) => ({ id: d.id, name: d.name, model: d.model })) });
    }

    // ---- Bokningsåtgärder (alla kontrollerar att bokningen tillhör personalens organisation)
    const booking = async () => {
      const id = text(body.booking_id, 80);
      if (!UUID.test(id)) throw new Error("[E_NOT_FOUND] Bokningen hittades inte.");
      const { data } = await admin.from("vihem_rental_bookings").select("id,organisation_id,public_reference,total,status,payment_status,stripe_payment_intent_id").eq("id", id).eq("organisation_id", organisationId).maybeSingle();
      if (!data) throw new Error("[E_NOT_FOUND] Bokningen hittades inte.");
      return data;
    };

    if (action === "cancel_booking") {
      const b = await booking();
      const { data: result, error } = await admin.rpc("vihem_rental_cancel_booking", { p_booking: b.id, p_actor: "admin", p_reason: text(body.reason, 500) || null, p_actor_user: profile.id });
      if (error) throw error;
      let refund = "none";
      let amount = Number(result.refund_amount) || 0;
      if (body.refund_amount !== undefined && body.refund_amount !== null) amount = Math.max(0, Math.min(amount, Number(body.refund_amount) || 0));
      if (amount > 0) refund = await issueRefund(admin, b.id, { refund_amount: amount, payment_intent: result.payment_intent });
      else if (Number(result.refund_amount) > 0) await admin.from("vihem_rental_bookings").update({ refund_status: "none" }).eq("id", b.id);
      return json({ ok: true, refund_status: refund, refund_amount: amount, offline_pin_warning: result.offline_pin_warning || null });
    }

    if (action === "retry_refund") {
      requireAdmin();
      const b = await booking();
      const amount = Math.max(0, Number(body.amount) || Number(b.total));
      return json({ ok: true, refund_status: await issueRefund(admin, b.id, { refund_amount: amount, payment_intent: b.stripe_payment_intent_id }) });
    }

    if (action === "issue_now" || action === "reissue" || action === "resend_sms" || action === "reveal_pin") {
      const b = await booking();
      const codeId = text(body.code_id, 80);
      let query = admin.from("vihem_rental_access_codes").select("id,status,pin_encrypted,booking_id").eq("booking_id", b.id).eq("organisation_id", organisationId);
      if (UUID.test(codeId)) query = query.eq("id", codeId);
      const { data: codes } = await query;
      if (!codes?.length) return json({ error: "Ingen åtkomstkod hittades för bokningen." }, 404);
      const log = (code: any, type: string) => admin.rpc("vihem_rental_log_access_event", { p_org: organisationId, p_booking: b.id, p_code: code.id, p_type: type, p_detail: { by: profile.id } });
      if (action === "reveal_pin") {
        requireAdmin();
        const out = [];
        for (const code of codes) { if (code.pin_encrypted) { out.push({ code_id: code.id, pin: await decryptSecret(code.pin_encrypted, `access-code:${code.id}`) }); await log(code, "pin_revealed"); } }
        return json({ ok: true, codes: out });
      }
      if (["cancelled"].includes(b.status)) return json({ error: "Bokningen är avbokad." }, 409);
      for (const code of codes) {
        if (action === "resend_sms") {
          if (!code.pin_encrypted) continue;
          await admin.from("vihem_rental_access_codes").update({ sms_status: "pending", sms_attempts: 0, next_attempt_at: null, status: code.status === "manual" ? "issued" : code.status, updated_at: new Date().toISOString() }).eq("id", code.id);
          await log(code, "sms_resend_requested");
        } else if (action === "issue_now" && ["scheduled", "failed", "manual"].includes(code.status)) {
          await admin.from("vihem_rental_access_codes").update({ status: "scheduled", scheduled_for: new Date().toISOString(), next_attempt_at: null, attempts: 0, last_error: null, updated_at: new Date().toISOString() }).eq("id", code.id);
          await log(code, "issue_now_requested");
        } else if (action === "reissue" && ["failed", "manual", "issued", "sent"].includes(code.status)) {
          requireAdmin();
          await admin.from("vihem_rental_access_codes").update({ status: "scheduled", scheduled_for: new Date().toISOString(), next_attempt_at: null, attempts: 0, pin_encrypted: null, external_pin_id: null, sms_status: "not_sent", sms_attempts: 0, last_error: null, warning: code.status === "issued" || code.status === "sent" ? "En tidigare kod har utfärdats och kan fortfarande fungera tills den löper ut." : null, updated_at: new Date().toISOString() }).eq("id", code.id);
          await log(code, "reissue_requested");
        }
      }
      return json({ ok: true, note: "Åtgärden är köad och utförs inom en minut." });
    }

    return json({ error: "Okänd åtgärd." }, 404);
  } catch (error) {
    const m = mapDbError(error);
    return json({ error: m.message, code: m.code }, m.status);
  }
});
