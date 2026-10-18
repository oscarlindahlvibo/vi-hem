import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { json, errorJson } from "../_shared/vihem-auth.ts";
import {
  acceptsChannelMessages,
  sendGuestMessage,
} from "../_shared/beds24-send-message.ts";
import { normalizeGuestMessage } from "../_shared/beds24-messages.ts";
import {
  automaticText,
  dayShift,
  dueToday,
  providerMatches,
  swedishNow,
} from "../_shared/shortstay-auto-message.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST")
    return errorJson("METHOD_NOT_ALLOWED", "Endast POST", 405);
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: settings, error: settingsError } = await db
    .from("vihem_system_settings")
    .select("value")
    .eq("key", "beds24_scheduled_sync")
    .maybeSingle();
  if (
    settingsError ||
    !settings?.value?.enabled ||
    !settings.value.secret ||
    req.headers.get("x-vihem-sync-secret") !== settings.value.secret
  )
    return errorJson("UNAUTHORIZED", "Saknar behörighet", 401);
  const started = Date.now();
  const { data: rules, error } = await db
    .from("vihem_guest_message_rules")
    .select("*")
    .eq("enabled", true)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(50);
  if (error) return errorJson("LOAD_FAILED", "Kunde inte läsa regler", 500);
  let sent = 0,
    pending = 0,
    failed = 0;
  for (const rule of rules || []) {
    if (Date.now() - started > 45000) break;
    try {
      await db
        .from("vihem_guest_message_rules")
        .update({ last_checked_at: new Date().toISOString(), last_error: "" })
        .eq("id", rule.id);
      const { data: enabled, error: enableError } = await db.rpc(
        "is_short_stay_enabled",
        { org_id: rule.organisation_id },
      );
      if (enableError || !enabled) continue;
      const { data: owner, error: ownerError } = await db
        .from("vihem_profiles")
        .select("active,role")
        .eq("id", rule.updated_by)
        .eq("organisation_id", rule.organisation_id)
        .maybeSingle();
      if (
        ownerError ||
        !owner?.active ||
        !["admin", "superadmin"].includes(owner.role)
      )
        throw Error("Regeln behöver sparas av en aktiv administratör.");

      const { data: template, error: templateError } = await db
        .from("vihem_short_stay_message_templates")
        .select("*")
        .eq("id", rule.template_id)
        .eq("unit_id", rule.unit_id)
        .eq("organisation_id", rule.organisation_id)
        .single();
      const { data: unit, error: unitError } = await db
        .from("vihem_short_stay_units")
        .select("id,beds24_room_id,beds24_property_id,beds24_enabled")
        .eq("id", rule.unit_id)
        .eq("organisation_id", rule.organisation_id)
        .single();
      if (
        templateError ||
        unitError ||
        !unit?.beds24_enabled ||
        !unit.beds24_property_id ||
        !unit.beds24_room_id ||
        !template?.translations?.[rule.language]
      )
        throw Error("Mall, språk eller rummets API-koppling saknas.");
      const today = swedishNow(new Date()).day;
      const { data: bookings, error: bookingError } = await db
        .from("vihem_short_stay_bookings")
        .select("id,beds24_booking_id,start_date,end_date")
        .eq("organisation_id", rule.organisation_id)
        .eq("unit_id", rule.unit_id)
        .eq("booking_type", "booking")
        .not("beds24_booking_id", "is", null)
        .gte(
          rule.event === "arrival" ? "start_date" : "end_date",
          dayShift(today, -7),
        )
        .lte(
          rule.event === "arrival" ? "start_date" : "end_date",
          dayShift(today, 7),
        )
        .order("created_at", { ascending: false })
        .limit(501);
      if (bookingError || (bookings?.length || 0) > 500)
        throw Error("Bokningarna kunde inte kontrolleras.");
      const seen = new Set<string>();
      let due = (bookings || []).filter((b) => {
        if (seen.has(b.beds24_booking_id)) return false;
        seen.add(b.beds24_booking_id);
        return /^\d+$/.test(b.beds24_booking_id) && dueToday(rule, b);
      });
      if (!due.length) continue;
      const { data: existingJobs, error: jobsError } = await db
        .from("vihem_guest_message_jobs")
        .select("beds24_booking_id")
        .eq("rule_id", rule.id)
        .eq("organisation_id", rule.organisation_id)
        .in(
          "beds24_booking_id",
          due.map((b) => b.beds24_booking_id),
        );
      if (jobsError) throw Error("Tidigare utskick kunde inte kontrolleras.");
      const completed = new Set(
        (existingJobs || []).map((j) => j.beds24_booking_id),
      );
      due = due.filter((b) => !completed.has(b.beds24_booking_id));
      if (!due.length) continue;
      const { data: connection, error: connError } = await db
        .from("vihem_beds24_connections")
        .select("*")
        .eq("organisation_id", rule.organisation_id)
        .eq("enabled", true)
        .maybeSingle();
      if (connError || !connection?.refresh_token)
        throw Error("Beds24 är inte anslutet.");
      let token = connection.access_token;
      if (
        !token ||
        Date.parse(connection.access_token_expires_at || "") <=
          Date.now() + 300000 ||
        !connection.access_token_expires_at
      ) {
        const res = await fetch(
          "https://api.beds24.com/v2/authentication/token",
          {
            headers: { refreshToken: connection.refresh_token },
            signal: AbortSignal.timeout(10000),
          },
        );
        const result = await res.json();
        if (!res.ok || !result.token)
          throw Error("Beds24-anslutningen kunde inte förnyas.");
        token = result.token;
        const { error: tokenError } = await db
          .from("vihem_beds24_connections")
          .update({
            access_token: token,
            access_token_expires_at: new Date(
              Date.now() +
                Math.max(Number(result.expiresIn || 86400) - 300, 60) * 1000,
            ).toISOString(),
          })
          .eq("id", connection.id);
        if (tokenError) throw Error("Beds24-anslutningen kunde inte sparas.");
      }
      for (const booking of due) {
        if (Date.now() - started > 45000) break;
        const res = await fetch(
          `https://api.beds24.com/v2/bookings?id=${booking.beds24_booking_id}`,
          { headers: { token }, signal: AbortSignal.timeout(10000) },
        );
        if (!res.ok)
          throw Error("Bokningen kunde inte kontrolleras hos Beds24.");
        const data = await res.json();
        const live = data.data?.find(
          (b: { id: number }) => String(b.id) === booking.beds24_booking_id,
        );
        if (
          !live ||
          !providerMatches(live, booking, unit, rule) ||
          !acceptsChannelMessages(live)
        )
          continue;
        const name = [live.firstName, live.lastName].filter(Boolean).join(" ");
        const message = automaticText(
          template.translations[rule.language],
          name,
        );
        const { data: id, error: claimError } = await db.rpc(
          "vihem_claim_guest_message",
          {
            p_rule: rule.id,
            p_revision: rule.revision,
            p_booking: booking.id,
            p_message: message,
            p_template_revision: template.updated_at,
          },
        );
        if (claimError)
          throw Error(
            "Utskicket kunde inte reserveras. Kontrollera eventuella väntande utskick.",
          );
        if (!id) continue;
        const { data: active, error: activeError } = await db
          .from("vihem_guest_message_rules")
          .select("enabled,revision")
          .eq("id", rule.id)
          .single();
        let status: "sent" | "failed" | "pending" = "failed";
        const paused =
          activeError || !active?.enabled || active.revision !== rule.revision;
        if (!paused)
          status = await sendGuestMessage(
            token,
            booking.beds24_booking_id,
            message,
          );
        const note = paused
          ? "Regeln ändrades innan utskick."
          : status === "pending"
            ? "Osäker leverans – kontrollera i Beds24. Skickas inte om automatiskt."
            : status === "failed"
              ? "Beds24 nekade utskicket. Skickas inte om automatiskt."
              : "";
        // Persisting the receipt may fail after a successful POST. Leave the durable claim pending; never repeat the POST.
        const { error: sendError } = await db
          .from("vihem_short_stay_message_sends")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("id", id)
          .eq("organisation_id", rule.organisation_id);
        if (!sendError)
          await db
            .from("vihem_guest_message_jobs")
            .update({
              status: paused ? "skipped" : status,
              note,
              updated_at: new Date().toISOString(),
            })
            .eq("id", id)
            .eq("organisation_id", rule.organisation_id);
        if (sendError || status === "pending") pending++;
        else if (status === "sent") sent++;
        else failed++;
        if (status === "sent") {
          try {
            const mirror = await fetch(
              `https://api.beds24.com/v2/bookings/messages?bookingId=${booking.beds24_booking_id}`,
              { headers: { token }, signal: AbortSignal.timeout(10000) },
            );
            const messages = mirror.ok ? await mirror.json() : {};
            const mapped = (messages.data || [])
              .filter(
                (r: { bookingId: number }) =>
                  String(r.bookingId) === booking.beds24_booking_id,
              )
              .map((r: unknown) =>
                normalizeGuestMessage(r, unit, rule.organisation_id),
              )
              .filter(Boolean);
            if (mapped.length)
              await db.from("vihem_short_stay_messages").upsert(mapped, {
                onConflict: "organisation_id,beds24_message_id",
              });
          } catch {
            /* Scheduled read sync repairs the mirror. */
          }
        }
      }
      await db
        .from("vihem_guest_message_rules")
        .update({ last_error: "", last_checked_at: new Date().toISOString() })
        .eq("id", rule.id);
    } catch (e) {
      await db
        .from("vihem_guest_message_rules")
        .update({
          last_error:
            e instanceof Error
              ? e.message
              : "Utskicket kunde inte kontrolleras.",
          last_checked_at: new Date().toISOString(),
        })
        .eq("id", rule.id);
      failed++;
    }
  }
  return json({ sent, pending, failed });
});
