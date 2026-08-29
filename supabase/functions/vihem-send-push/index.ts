// Sends a native push notification (iOS via APNs; Android/FCM not wired up
// yet, see the platform switch below) for one vihem_notifications row.
//
// Called by a AFTER INSERT trigger on vihem_notifications (see migration
// 20260829100000_push_notification_dispatch.sql) via pg_net with a shared
// secret header -- same "no Supabase JWT, secret header instead" pattern
// already used by vihem-accounted-healthcheck and vihem-cellsynth-*.
// verify_jwt must be OFF for this function (see supabase/config.toml).
//
// Every notification that lands in vihem_notifications goes through here
// regardless of which feature created it (chat, work orders, inspections,
// fleet, scheduled reminders, ...) -- the trigger is the single place that
// guarantees "everything in the notification tab also becomes a push",
// rather than having to remember to call this from every insert call site.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendApnsPush, type ApnsConfig } from "../_shared/apns.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-VIHEM-Push-Secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function apnsConfigFromEnv(): ApnsConfig | null {
  const authKey = Deno.env.get("APNS_AUTH_KEY");
  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const topic = Deno.env.get("APNS_TOPIC") || "se.vihem.app";
  const environment = Deno.env.get("APNS_ENVIRONMENT") === "production" ? "production" : "development";
  if (!authKey || !keyId || !teamId) return null;
  return { authKey, keyId, teamId, topic, environment };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const expectedSecret = Deno.env.get("VIHEM_PUSH_DISPATCH_SECRET");
  if (expectedSecret && request.headers.get("X-VIHEM-Push-Secret") !== expectedSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const notificationId = String(body?.notification_id || "");
  if (!notificationId) return json({ error: "notification_id krävs." }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: notification, error: notificationError } = await supabase
    .from("vihem_notifications")
    .select("id, user_id, title, message, type, link")
    .eq("id", notificationId)
    .maybeSingle();
  if (notificationError) return json({ error: notificationError.message }, 500);
  if (!notification) return json({ error: "Notis hittades inte." }, 404);

  const { data: tokens, error: tokensError } = await supabase
    .from("vihem_push_tokens")
    .select("id, platform, token")
    .eq("user_id", notification.user_id)
    .eq("active", true);
  if (tokensError) return json({ error: tokensError.message }, 500);
  if (!tokens || tokens.length === 0) return json({ ok: true, sent: 0, reason: "no_active_tokens" });

  const { count: unreadCount } = await supabase
    .from("vihem_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", notification.user_id)
    .is("read_at", null);

  const apnsConfig = apnsConfigFromEnv();

  let sent = 0;
  const deactivated: string[] = [];
  const failures: Array<{ platform: string; status: number; reason?: string }> = [];

  for (const pushToken of tokens) {
    if (pushToken.platform === "ios") {
      if (!apnsConfig) {
        failures.push({ platform: "ios", status: 0, reason: "APNS_NOT_CONFIGURED" });
        continue;
      }
      const result = await sendApnsPush(pushToken.token, {
        title: notification.title || "VI-HEM",
        body: notification.message || "",
        badge: unreadCount ?? undefined,
        data: { notification_id: notification.id, type: notification.type, link: notification.link || "" },
      }, apnsConfig);

      if (result.ok) {
        sent++;
      } else {
        failures.push({ platform: "ios", status: result.status, reason: result.reason });
        if (result.tokenInvalid) {
          await supabase.from("vihem_push_tokens").update({ active: false }).eq("id", pushToken.id);
          deactivated.push(pushToken.id);
        }
      }
    } else {
      // Android/FCM and web push are registered (vihem_push_tokens.platform
      // already supports them) but no sender is wired up yet.
      failures.push({ platform: pushToken.platform, status: 0, reason: "PLATFORM_NOT_IMPLEMENTED" });
    }
  }

  return json({ ok: true, sent, failures, deactivated });
});
