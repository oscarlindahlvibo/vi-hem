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

function localNow() {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, hour: "2-digit", minute: "2-digit", weekday: "numeric" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { weekday: Number(values.weekday), minutes: Number(values.hour) * 60 + Number(values.minute), date: new Intl.DateTimeFormat("sv-SE", { timeZone: timezone }).format(new Date()) };
}

function minutes(value: string | null | undefined) {
  if (!value) return null;
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
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
      const hasOpenWork = (openEntries || []).some((entry: any) => entry.entry_type !== "break");
      const hasOpenBreak = (openEntries || []).some((entry: any) => entry.entry_type === "break");
      const dayKey = now.date;
      if (settings.shift_start_reminder && start !== null && now.minutes >= start && now.minutes <= start + 5 && !hasOpenWork) {
        if (await createOnce(client, schedule, `${dayKey}:shift-start`, "shift_start_reminder", "Ditt arbetspass börjar nu", `Hej ${profile.name || ""}, det är dags att stämpla in.`)) created++;
      }
      if (settings.lunch_start_reminder && lunch !== null && now.minutes >= lunch && now.minutes <= lunch + 5 && hasOpenWork) {
        if (await createOnce(client, schedule, `${dayKey}:lunch-start`, "lunch_start_reminder", "Lunch börjar nu", "Det är dags att gå på lunch.")) created++;
      }
      if (settings.lunch_return_reminder && lunch !== null && now.minutes >= lunch + lunchLength && now.minutes <= lunch + lunchLength + 5 && hasOpenBreak) {
        if (await createOnce(client, schedule, `${dayKey}:lunch-return`, "lunch_return_reminder", "Lunchen är slut", "Det är dags att återgå till arbetet.")) created++;
      }
      if (settings.shift_end_reminder && end !== null && now.minutes >= end && now.minutes <= end + 5 && hasOpenWork) {
        if (await createOnce(client, schedule, `${dayKey}:shift-end`, "shift_end_reminder", "Ditt arbetspass slutar nu", "Kom ihåg att stämpla ut om du inte arbetar över.")) created++;
      }
    }
  }
  return json({ ok: true, timezone, created });
});
