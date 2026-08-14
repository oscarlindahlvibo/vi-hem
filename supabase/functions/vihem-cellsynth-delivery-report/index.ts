import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const value = (input: unknown, max = 500) => String(input ?? "").trim().slice(0, max);

function deliveryState(raw: string) {
  const status = raw.toLowerCase();
  if (["delivered", "success", "ok"].includes(status)) return "delivered";
  if (["failed", "undeliverable", "expired", "rejected", "error", "failure"].includes(status)) return "delivery_failed";
  return "sent";
}

function firstValue(source: Record<string, unknown>, keys: string[], max = 500) {
  for (const key of keys) {
    const candidate = value(source[key], max);
    if (candidate) return candidate;
  }
  return "";
}

async function requestValues(request: Request) {
  const url = new URL(request.url);
  const result: Record<string, string> = {
    token: value(url.searchParams.get("token"), 200),
    destination: value(url.searchParams.get("destination"), 80),
    trackingid: value(url.searchParams.get("trackingid") || url.searchParams.get("tracking_id") || url.searchParams.get("trackid"), 200),
    status: value(url.searchParams.get("status") || url.searchParams.get("delivery_status"), 80),
  };

  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await request.json().catch(() => ({}))
      : Object.fromEntries(new URLSearchParams(await request.text().catch(() => "")));
    if (body && typeof body === "object") {
      const fields = body as Record<string, unknown>;
      result.token ||= firstValue(fields, ["token"], 200);
      result.destination ||= firstValue(fields, ["destination", "recipient"], 80);
      result.trackingid ||= firstValue(fields, ["trackingid", "tracking_id", "trackid"], 200);
      result.status ||= firstValue(fields, ["status", "delivery_status"], 80);
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

    if (!values.trackingid || !values.status) {
      return json({ error: "trackingid och status krävs" }, 400);
    }

    // Cellsynt can format the destination differently from the number used
    // when sending. The provider tracking id is the stable identifier, so it
    // must be the primary lookup key; destination is only diagnostic data.
    const query = db
      .from("vihem_sms_messages")
      .update(update)
      .eq("organisation_id", settings.organisation_id)
      .eq("external_id", values.trackingid);
    const { data: updated, error } = await query.select("id");
    if (error) throw error;

    if (!updated?.length) {
      console.warn("vihem-cellsynth-delivery-report: no SMS matched tracking id", values.trackingid);
    }
    return json({ ok: true, matched: updated?.length || 0 });
  } catch (error) {
    console.error("vihem-cellsynth-delivery-report", error);
    return json({ error: "Delivery report could not be processed" }, 500);
  }
});
