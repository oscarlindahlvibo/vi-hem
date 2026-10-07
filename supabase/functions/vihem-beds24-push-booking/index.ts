// Pushes a booking made in VI-HEM (Korttid) to Beds24, so the dates are
// blocked on every channel. The booking sync (vihem-sync-beds24-bookings) is
// Beds24 -> VI-HEM only; without this a booking created here never reached
// Beds24 and could be double-booked.
//
// actions: "upsert" (create or update) and "cancel" (call BEFORE deleting the
// local row -- it needs the row to find the Beds24 id).
//
// Only bookings that originate in VI-HEM are pushed (channel_name 'VI-HEM',
// also sent to Beds24 as `referer`, so the next sync keeps that label). OTA
// bookings are owned by Beds24 and are never written back.
//
// After a successful create the local row gets external_uid 'beds24:<id>' so
// the sync recognises the booking as the same one instead of importing a
// duplicate.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, corsHeaders, errorJson, isAuthContext, json } from "../_shared/vihem-auth.ts";

const BEDS24_BASE_URL = "https://api.beds24.com/v2";
const VIHEM_CHANNEL = "VI-HEM";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return errorJson("METHOD_NOT_ALLOWED", "Endast POST stöds.", 405);

  const auth = await authenticate(req);
  if (!isAuthContext(auth)) return auth;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorJson("VALIDATION_ERROR", "Ogiltig JSON.", 400);
  }
  const action = String(body?.action || "upsert");
  const bookingId = String(body?.booking_id || "");
  if (!bookingId) return errorJson("VALIDATION_ERROR", "booking_id krävs.", 400);
  if (!["upsert", "cancel"].includes(action)) return errorJson("VALIDATION_ERROR", `Okänd action: ${action}`, 400);

  // Read through the caller's own session so RLS decides who may touch it.
  const { data: booking } = await auth.userClient
    .from("vihem_short_stay_bookings")
    .select("*, unit:vihem_short_stay_units(*)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return errorJson("NOT_FOUND", "Bokningen hittades inte.", 404);

  const unit = booking.unit;
  const skip = (reason: string) => json({ data: { pushed: false, reason } });
  if (!unit?.beds24_enabled || !unit?.beds24_room_id) return skip("Enheten är inte kopplad till Beds24.");
  if (booking.channel_name !== VIHEM_CHANNEL) return skip("Bokningen kommer från Beds24/en kanal och styrs därifrån.");

  const { data: connection } = await auth.adminClient
    .from("vihem_beds24_connections")
    .select("*")
    .eq("organisation_id", booking.organisation_id)
    .maybeSingle();
  if (!connection?.enabled || !connection.refresh_token) return skip("Beds24 är inte aktiverat.");

  try {
    const token = await ensureAccessToken(auth.adminClient, connection);
    const existingId = booking.beds24_booking_id ? Number(booking.beds24_booking_id) : null;

    if (action === "cancel") {
      if (!existingId) return skip("Bokningen finns inte i Beds24.");
      await postBooking(token, { id: existingId, roomId: Number(unit.beds24_room_id), status: "cancelled" });
      return json({ data: { pushed: true, cancelled: true } });
    }

    const [firstName, ...rest] = String(booking.guest_name || "").trim().split(/\s+/).filter(Boolean);
    const isBlock = booking.booking_type === "block";
    const payload: Record<string, unknown> = {
      ...(existingId ? { id: existingId } : {}),
      roomId: Number(unit.beds24_room_id),
      status: isBlock ? "black" : "confirmed",
      arrival: booking.start_date,
      departure: booking.end_date,
      referer: VIHEM_CHANNEL,
      notes: booking.notes || booking.title || "",
    };
    if (!isBlock) {
      Object.assign(payload, {
        firstName: firstName || "",
        lastName: rest.join(" ") || (firstName ? "" : booking.title || "Gäst"),
        email: booking.guest_email || undefined,
        mobile: booking.guest_phone || undefined,
        numAdult: booking.guest_count || 1,
        ...(Number(booking.total_price) > 0 ? { price: Number(booking.total_price) } : {}),
      });
    } else {
      payload.firstName = booking.title || "Spärr";
    }

    const result = await postBooking(token, payload);
    const newId = result?.new?.id ?? result?.modified?.id ?? result?.id ?? existingId;
    if (!newId) throw new Error("Beds24 svarade utan boknings-id.");

    if (String(newId) !== String(booking.beds24_booking_id || "")) {
      await auth.adminClient
        .from("vihem_short_stay_bookings")
        .update({ beds24_booking_id: String(newId), external_uid: `beds24:${newId}` })
        .eq("id", booking.id);
    }
    return json({ data: { pushed: true, beds24_booking_id: String(newId) } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("beds24 push failed", bookingId, action, message);
    return errorJson("BEDS24_PUSH_FAILED", `Kunde inte skicka till Beds24: ${message}`, 502);
  }
});

async function postBooking(token: string, payload: Record<string, unknown>) {
  const response = await fetch(`${BEDS24_BASE_URL}/bookings`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", token },
    body: JSON.stringify([payload]),
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch { /* not JSON */ }
  if (!response.ok) throw new Error(`Beds24 svarade ${response.status}: ${text.slice(0, 300)}`);
  const item = Array.isArray(data) ? data[0] : data;
  if (item && item.success === false) {
    throw new Error(`Beds24 nekade: ${JSON.stringify(item.errors ?? item.error ?? item).slice(0, 300)}`);
  }
  return item;
}

async function ensureAccessToken(serviceClient: any, connection: any) {
  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
  if (connection.access_token && expiresAt > Date.now() + 5 * 60 * 1000) return connection.access_token;
  const response = await fetch(`${BEDS24_BASE_URL}/authentication/token`, {
    headers: { accept: "application/json", refreshToken: connection.refresh_token },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.token) throw new Error(data?.error || data?.message || "Kunde inte hämta Beds24 access token.");
  const expiresAtIso = new Date(Date.now() + Math.max(Number(data.expiresIn || 86400) - 300, 60) * 1000).toISOString();
  await serviceClient
    .from("vihem_beds24_connections")
    .update({ access_token: data.token, access_token_expires_at: expiresAtIso, updated_at: new Date().toISOString() })
    .eq("id", connection.id);
  return data.token;
}
