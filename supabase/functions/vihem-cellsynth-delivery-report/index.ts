import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const value = (input: unknown, max = 500) => String(input ?? "").trim().slice(0, max);

function deliveryState(raw: string) {
  const status = raw.toLowerCase();
  if (["delivered", "delivery", "success", "ok"].includes(status)) return "delivered";
  if (["failed", "undeliverable", "expired", "rejected", "error", "failure"].includes(status)) return "delivery_failed";
  return "sent";
}

async function requestValues(request: Request) {
  const url = new URL(request.url);
  const result: Record<string, string> = {
    token: value(url.searchParams.get("token"), 200),
    destination: value(url.searchParams.get("destination"), 80),
    trackingid: value(url.searchParams.get("trackingid"), 200),
    status: value(url.searchParams.get("status"), 80),
  };

  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await request.json().catch(() => ({}))
      : Object.fromEntries((await request.text().catch(() => "")).split("&").filter(Boolean).map(part => {
        const [key, raw] = part.split("=");
        return [decodeURIComponent(key || ""), decodeURIComponent((raw || "").replace(/\+/g, " "))];
      }));
    for (const key of ["token", "destination", "trackingid", "status"]) {
      if (!result[key] && body && typeof body === "object") result[key] = value((body as Record<string, unknown>)[key], key === "token" ? 200 : 500);
    }
  }
  return result;
}

Deno.serve(async request => {
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed" }, 405);

  try {
    const values = await requestValues(request);
    if (!values.token) return json({ error: "Missing token" }, 401);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: settings } = await db
      .from("vihem_sms_settings")
      .select("organisation_id,delivery_report_enabled")
      .eq("delivery_report_token", values.token)
      .maybeSingle();

    if (!settings || settings.delivery_report_enabled === false) return json({ error: "Invalid token" }, 401);

    const nextStatus = deliveryState(values.status);
    const receivedAt = new Date().toISOString();
    const update: Record<string, unknown> = {
      status: nextStatus,
      delivery_status: values.status,
      delivery_received_at: receivedAt,
      delivery_raw: JSON.stringify(values),
    };
    if (nextStatus === "delivery_failed") update.error = `Cellsynt leveransstatus: ${values.status || "okänt fel"}`;

    let query = db
      .from("vihem_sms_messages")
      .update(update)
      .eq("organisation_id", settings.organisation_id)
      .eq("external_id", values.trackingid);
    if (values.destination) query = query.eq("recipient", values.destination);
    const { error } = await query;
    if (error) throw error;

    return json({ ok: true });
  } catch (error) {
    console.error("vihem-cellsynth-delivery-report", error);
    return json({ error: "Delivery report could not be processed" }, 500);
  }
});
