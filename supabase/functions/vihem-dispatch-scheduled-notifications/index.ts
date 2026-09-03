import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Cron-Secret",
};

const timezone = Deno.env.get("VIHEM_TIMEZONE") || "Europe/Stockholm";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const WEEKDAY_NUMBERS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function localNow() {
  // "numeric" was never a valid Intl.DateTimeFormat weekday option (only
  // "long"/"short"/"narrow" are) -- some engines silently ignored the
  // invalid value, this edge runtime throws RangeError instead, which is
  // exactly why this function never actually ran successfully even after
  // being wired to cron. Get the day name instead and map it to 1-7
  // (matching vihem_staff_work_schedules.weekday) ourselves.
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(new Date());
  return {
    weekday: WEEKDAY_NUMBERS[weekdayName] ?? 0,
    minutes: Number(values.hour) * 60 + Number(values.minute),
    date: new Intl.DateTimeFormat("sv-SE", { timeZone: timezone }).format(new Date()),
  };
}

function minutes(value: string | null | undefined) {
  if (!value) return null;
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function localMinutesOf(iso: string) {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

// Records the dedup key first (unique per user/day/reminder), then -- only
// if that succeeded -- creates the notification via the shared
// create_notification() RPC, passing setting_key so the recipient's own
// notification preference (falling back to the org's) gates it, same as
// every other notification path in the app.
async function createOnce(client: any, row: { organisation_id: string; user_id: string }, key: string, settingKey: string, title: string, message: string) {
  const { data, error } = await client.from("vihem_notification_delivery_log").insert({ organisation_id: row.organisation_id, user_id: row.user_id, delivery_key: key, notification_type: settingKey }).select("id").maybeSingle();
  if (error?.code === "23505") return false;
  if (error) throw error;
  if (!data) return false;
  const { error: rpcError } = await client.rpc("create_notification", {
    recipient_id: row.user_id,
    org_uuid: row.organisation_id,
    notification_title: title,
    notification_message: message,
    notification_type: "time_entry",
    notification_link: "timetracking",
    setting_key: settingKey,
  });
  if (rpcError) throw rpcError;
  return true;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: cfgRow } = await client.from("vihem_system_settings").select("value").eq("key", "scheduled_notifications_dispatch").maybeSingle();
  const expectedSecret = cfgRow?.value?.secret;
  if (expectedSecret && request.headers.get("X-Cron-Secret") !== expectedSecret) return json({ error: "Unauthorized" }, 401);

  const now = localNow();
  const { data: settingsRows, error: settingsError } = await client.from("vihem_organisation_notification_settings").select("organisation_id,settings");
  if (settingsError) return json({ error: settingsError.message }, 500);

  let created = 0;
  for (const settingsRow of settingsRows || []) {
    const settings = settingsRow.settings || {};
    const { data: schedules } = await client.from("vihem_staff_work_schedules").select("user_id,organisation_id,work_start,work_end,lunch_start,lunch_minutes").eq("organisation_id", settingsRow.organisation_id).eq("weekday", now.weekday).eq("active", true);
    for (const schedule of schedules || []) {
      const { data: profile } = await client.from("vihem_profiles").select("id,name,active").eq("id", schedule.user_id).maybeSingle();
      if (!profile?.active) continue;
      const start = minutes(schedule.work_start);
      const end = minutes(schedule.work_end);
      const lunch = minutes(schedule.lunch_start);
      const lunchLength = Number(schedule.lunch_minutes || settings.default_lunch_return_minutes || 45);
      const { data: openEntries } = await client.from("vihem_time_entries").select("id,entry_type,start_time,end_time").eq("user_id", schedule.user_id).is("end_time", null);
      const hasOpenWork = (openEntries || []).some((entry: any) => entry.entry_type !== "break" && entry.entry_type !== "lunch");
      // 'lunch' is a distinct entry_type from generic 'break' (see
      // 20260902100000_time_entries_lunch_type.sql) precisely so this
      // reminder can key off whether the person is actually on lunch
      // right now, not just any short break.
      const openLunchEntry = (openEntries || []).find((entry: any) => entry.entry_type === "lunch");
      const dayKey = now.date;
      if (settings.shift_start_reminder && start !== null && now.minutes >= start && now.minutes <= start + 5 && !hasOpenWork) {
        if (await createOnce(client, schedule, `${dayKey}:shift-start`, "shift_start_reminder", "Ditt arbetspass börjar nu", `Hej ${profile.name || ""}, det är dags att stämpla in.`)) created++;
      }
      if (settings.lunch_start_reminder && lunch !== null && now.minutes >= lunch && now.minutes <= lunch + 5 && hasOpenWork) {
        if (await createOnce(client, schedule, `${dayKey}:lunch-start`, "lunch_start_reminder", "Lunch börjar nu", "Det är dags att gå på lunch.")) created++;
      }
      if (settings.lunch_return_reminder && openLunchEntry) {
        // Tied to when this person actually clocked in on lunch, not the
        // scheduled lunch_start -- someone who goes to lunch late or early
        // should still get reminded lunchLength minutes after their own
        // clock-in, not at a fixed clock time.
        const lunchClockInMinutes = localMinutesOf(openLunchEntry.start_time);
        if (now.minutes >= lunchClockInMinutes + lunchLength && now.minutes <= lunchClockInMinutes + lunchLength + 5) {
          if (await createOnce(client, schedule, `${dayKey}:lunch-return:${openLunchEntry.id}`, "lunch_return_reminder", "Lunchen är slut", "Det är dags att återgå till arbetet.")) created++;
        }
      }
      if (settings.shift_end_reminder && end !== null && now.minutes >= end && now.minutes <= end + 5 && hasOpenWork) {
        if (await createOnce(client, schedule, `${dayKey}:shift-end`, "shift_end_reminder", "Ditt arbetspass slutar nu", "Kom ihåg att stämpla ut om du inte arbetar över.")) created++;
      }
    }
  }
  return json({ ok: true, timezone, created });
});
