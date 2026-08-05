import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Beds24-Secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const secret = url.searchParams.get("secret") || req.headers.get("x-beds24-secret") || "";
    if (!secret) return json({ error: "Missing webhook secret" }, 401);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: connection, error: connectionError } = await serviceClient
      .from("vihem_beds24_connections")
      .select("*")
      .eq("webhook_secret", secret)
      .eq("enabled", true)
      .maybeSingle();

    if (connectionError || !connection) return json({ error: "Invalid webhook secret" }, 401);

    const payload = await req.json().catch(() => ({}));
    const bookings = extractBookings(payload);
    if (bookings.length === 0) {
      await log(serviceClient, {
        organisation_id: connection.organisation_id,
        connection_id: connection.id,
        status: "warning",
        event_type: "webhook",
        message: "Beds24-webhook mottogs utan bokningsdata.",
        metadata: { payload },
      });
      return json({ ok: true, imported: 0 });
    }

    const { data: units, error: unitsError } = await serviceClient
      .from("vihem_short_stay_units")
      .select("*")
      .eq("organisation_id", connection.organisation_id)
      .eq("beds24_enabled", true)
      .eq("is_active", true);
    if (unitsError) throw unitsError;

    let imported = 0;
    const skipped = [];

    for (const booking of bookings) {
      const unit = findUnitForBooking(units || [], booking);
      if (!unit) {
        skipped.push(readBookingId(booking));
        await log(serviceClient, {
          organisation_id: connection.organisation_id,
          connection_id: connection.id,
          status: "warning",
          event_type: "webhook",
          message: "Beds24-bokning saknar matchad korttidsenhet.",
          external_id: String(readBookingId(booking) || ""),
          metadata: { booking },
        });
        continue;
      }

      if (isCancelledBooking(booking)) {
        await serviceClient
          .from("vihem_short_stay_bookings")
          .delete()
          .eq("organisation_id", connection.organisation_id)
          .eq("unit_id", unit.id)
          .eq("external_uid", `beds24:${readBookingId(booking)}`);
        continue;
      }

      const row = normalizeBooking(booking, unit, connection.organisation_id);
      if (!row) continue;

      const { error: upsertError } = await serviceClient
        .from("vihem_short_stay_bookings")
        .upsert(row, { onConflict: "unit_id,external_uid" });
      if (upsertError) throw upsertError;
      imported += 1;
    }

    await serviceClient
      .from("vihem_beds24_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);

    await log(serviceClient, {
      organisation_id: connection.organisation_id,
      connection_id: connection.id,
      status: "success",
      event_type: "webhook",
      message: `Webhook importerade ${imported} Beds24-bokningar.`,
      imported_count: imported,
      metadata: { skipped },
    });

    return json({ ok: true, imported, skipped });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Webhook misslyckades." }, 400);
  }
});

function extractBookings(payload: any) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.bookings)) return payload.bookings;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.booking) return [payload.booking];
  if (payload?.id || payload?.bookId || payload?.bookingId) return [payload];
  return [];
}

function findUnitForBooking(units: any[], booking: any) {
  const roomId = String(booking.roomId || booking.roomid || booking.roomTypeId || booking.roomTypeID || "");
  const propertyId = String(booking.propertyId || booking.propId || booking.propertyID || "");
  return units.find((unit) =>
    (unit.beds24_room_id && roomId && String(unit.beds24_room_id) === roomId) ||
    (!unit.beds24_room_id && unit.beds24_property_id && propertyId && String(unit.beds24_property_id) === propertyId)
  );
}

function normalizeBooking(booking: any, unit: any, organisationId: string) {
  const beds24Id = readBookingId(booking);
  const startDate = readDate(booking.arrival || booking.arrivalDate || booking.firstNight || booking.checkIn || booking.startDate);
  const endDate = readDate(booking.departure || booking.departureDate || booking.lastNight || booking.checkOut || booking.endDate);
  if (!beds24Id || !startDate || !endDate || endDate <= startDate) return null;

  const firstName = booking.firstName || booking.guestFirstName || booking.firstname || "";
  const lastName = booking.lastName || booking.guestName || booking.surname || booking.lastname || "";
  const fullName = `${firstName} ${lastName}`.trim() || booking.name || booking.guest || booking.title || "Beds24-bokning";
  const adults = Number(booking.numAdult ?? booking.adults ?? booking.adult ?? 0);
  const children = Number(booking.numChild ?? booking.children ?? booking.child ?? 0);
  const guests = Number(booking.numGuest ?? booking.guests ?? booking.guestCount ?? 0) || adults + children || 1;
  const channel = booking.referer || booking.channel || booking.apiSource || booking.bookingChannel || "Beds24";

  return {
    organisation_id: organisationId,
    unit_id: unit.id,
    external_uid: `beds24:${beds24Id}`,
    beds24_booking_id: String(beds24Id),
    beds24_status: String(booking.status || booking.bookingStatus || ""),
    channel_number: null,
    channel_name: String(channel || "Beds24"),
    title: fullName,
    description: String(booking.notes || booking.comment || booking.message || ""),
    start_date: startDate,
    end_date: endDate,
    arrival_time: readTime(booking.arrivalTime || booking.checkInTime) || "15:00",
    departure_time: readTime(booking.departureTime || booking.checkOutTime) || "11:00",
    is_manual: false,
    booking_type: "booking",
    guest_name: fullName,
    guest_email: String(booking.email || booking.guestEmail || ""),
    guest_phone: String(booking.phone || booking.mobile || booking.guestPhone || ""),
    guest_count: guests,
    payment_status: mapPaymentStatus(booking),
    notes: String(booking.notes || booking.comment || ""),
    source_payload: booking,
    updated_at: new Date().toISOString(),
  };
}

function readBookingId(booking: any) {
  return booking.id || booking.bookId || booking.bookingId || booking.bookid;
}

function readDate(value: unknown) {
  if (!value) return "";
  const text = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function readTime(value: unknown) {
  if (!value) return "";
  const match = String(value).match(/\d{2}:\d{2}/);
  return match ? match[0] : "";
}

function isCancelledBooking(booking: any) {
  const status = String(booking.status || booking.bookingStatus || "").toLowerCase();
  return status.includes("cancel") || status.includes("deleted");
}

function mapPaymentStatus(booking: any) {
  const status = String(booking.invoiceStatus || booking.paymentStatus || booking.status || "").toLowerCase();
  if (status.includes("paid") || status.includes("complete")) return "paid";
  if (status.includes("partial")) return "partial";
  return "unpaid";
}

async function log(serviceClient: any, row: Record<string, unknown>) {
  await serviceClient.from("vihem_beds24_sync_logs").insert(row);
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
