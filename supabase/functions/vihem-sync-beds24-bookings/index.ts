import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BEDS24_BASE_URL = "https://api.beds24.com/v2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    const serviceClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));

    let organisationId = String(body.organisation_id || "");
    let syncAllOrganisations = false;
    if (authHeader) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);

      const { data: profile } = await serviceClient
        .from("vihem_profiles")
        .select("id, role, organisation_id")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile || !["admin", "superadmin", "staff"].includes(profile.role)) return json({ error: "Saknar behörighet." }, 403);
      organisationId = profile.role === "superadmin" && organisationId ? organisationId : profile.organisation_id;
      if (!organisationId) return json({ error: "Saknar organisation." }, 400);
    } else {
      const providedSecret = req.headers.get("x-vihem-sync-secret") || "";
      const envSecret = Deno.env.get("VIHEM_INTERNAL_SYNC_SECRET") || "";
      const dbSecret = await readSchedulerSecret(serviceClient);
      if (!providedSecret || (providedSecret !== envSecret && providedSecret !== dbSecret)) {
        return json({ error: "Unauthorized" }, 401);
      }
      syncAllOrganisations = !organisationId;
    }

    const result = syncAllOrganisations
      ? await syncEnabledOrganisations(serviceClient, body)
      : await syncOrganisation(serviceClient, organisationId, body);
    return json(result);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Synk misslyckades." }, 400);
  }
});

async function readSchedulerSecret(serviceClient: any) {
  const { data, error } = await serviceClient
    .from("vihem_system_settings")
    .select("value")
    .eq("key", "beds24_scheduled_sync")
    .maybeSingle();
  if (error || !data?.value?.secret) return "";
  return String(data.value.secret);
}

async function syncEnabledOrganisations(serviceClient: any, options: any = {}) {
  const { data: connections, error } = await serviceClient
    .from("vihem_beds24_connections")
    .select("organisation_id")
    .eq("enabled", true)
    .neq("refresh_token", "");
  if (error) throw error;

  const results = [];
  let imported = 0;
  for (const connection of connections || []) {
    try {
      const result = await syncOrganisation(serviceClient, connection.organisation_id, options);
      imported += Number(result.imported || 0);
      results.push({ organisation_id: connection.organisation_id, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Synk misslyckades.";
      results.push({ organisation_id: connection.organisation_id, ok: false, error: message });
      await log(serviceClient, {
        organisation_id: connection.organisation_id,
        status: "error",
        event_type: "scheduled_sync",
        message,
      });
    }
  }

  return { ok: true, scheduled: true, organisations: results.length, imported, results };
}

async function syncOrganisation(serviceClient: any, organisationId: string, options: any = {}) {
  const { data: connection, error: connectionError } = await serviceClient
    .from("vihem_beds24_connections")
    .select("*")
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (connectionError) throw connectionError;
  if (!connection?.enabled || !connection.refresh_token) throw new Error("Beds24 är inte aktiverat för organisationen.");

  const { data: units, error: unitsError } = await serviceClient
    .from("vihem_short_stay_units")
    .select("*")
    .eq("organisation_id", organisationId)
    .eq("beds24_enabled", true)
    .eq("is_active", true);
  if (unitsError) throw unitsError;

  const mappedUnits = (units || []).filter((unit: any) => unit.beds24_room_id || unit.beds24_property_id);
  if (mappedUnits.length === 0) throw new Error("Inga korttidsenheter har Beds24 property-id eller room-id.");

  const token = await ensureAccessToken(serviceClient, connection);
  const from = options.from || toDateKey(addDays(new Date(), -14));
  const to = options.to || toDateKey(addDays(new Date(), 370));
  const allResults = [];
  let importedTotal = 0;

  for (const unit of mappedUnits) {
    try {
      const bookings = await fetchBeds24Bookings(token, unit, from, to);
      const activeBookings = bookings.filter((booking: any) => !isCancelledBooking(booking));
      const cancelledBookings = bookings.filter((booking: any) => isCancelledBooking(booking));

      if (cancelledBookings.length > 0) {
        const externalIds = cancelledBookings.map((booking: any) => `beds24:${readBookingId(booking)}`).filter(Boolean);
        if (externalIds.length > 0) {
          await serviceClient
            .from("vihem_short_stay_bookings")
            .delete()
            .eq("organisation_id", organisationId)
            .eq("unit_id", unit.id)
            .in("external_uid", externalIds);
        }
      }

      const rows = activeBookings
        .map((booking: any) => normalizeBooking(booking, unit, organisationId))
        .filter(Boolean);

      if (rows.length > 0) {
        const { error: upsertError } = await serviceClient
          .from("vihem_short_stay_bookings")
          .upsert(rows, { onConflict: "unit_id,external_uid" });
        if (upsertError) throw upsertError;
      }

      importedTotal += rows.length;
      allResults.push({ unit_id: unit.id, unit_name: unit.name, imported: rows.length, cancelled: cancelledBookings.length });
      await log(serviceClient, {
        organisation_id: organisationId,
        connection_id: connection.id,
        unit_id: unit.id,
        status: "success",
        event_type: "sync",
        message: `Importerade ${rows.length} Beds24-bokningar för ${unit.name}.`,
        imported_count: rows.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Okänt fel";
      allResults.push({ unit_id: unit.id, unit_name: unit.name, error: message });
      await log(serviceClient, {
        organisation_id: organisationId,
        connection_id: connection.id,
        unit_id: unit.id,
        status: "error",
        event_type: "sync",
        message,
      });
    }
  }

  await serviceClient
    .from("vihem_beds24_connections")
    .update({
      last_sync_at: new Date().toISOString(),
      last_error: allResults.some((item: any) => item.error) ? "En eller flera enheter kunde inte synkas." : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  return { ok: true, imported: importedTotal, results: allResults };
}

async function fetchBeds24Bookings(token: string, unit: any, from: string, to: string) {
  const params = new URLSearchParams();
  params.set("arrivalFrom", from);
  params.set("arrivalTo", to);
  params.set("departureFrom", from);
  params.set("departureTo", to);
  if (unit.beds24_property_id) params.set("propertyId", unit.beds24_property_id);
  if (unit.beds24_room_id) params.set("roomId", unit.beds24_room_id);

  const response = await fetch(`${BEDS24_BASE_URL}/bookings?${params.toString()}`, {
    headers: { accept: "application/json", token },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Beds24 svarade ${response.status}: ${text.slice(0, 300)}`);
  const data = safeJson(text);
  return Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.bookings) ? data.bookings : [];
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
  const totalPrice = readMoneyValue(
    booking.totalPrice,
    booking.price,
    booking.bookingPrice,
    booking.invoiceTotal,
    booking.roomPrice,
    booking.amount,
    booking.total,
  );
  const paidAmount = readMoneyValue(
    booking.paidAmount,
    booking.paid,
    booking.paymentAmount,
    booking.paymentsTotal,
    sumMoneyList(booking.payments),
  );
  const balanceDue = readMoneyValue(
    booking.balanceDue,
    booking.balance,
    booking.outstanding,
    totalPrice - paidAmount,
  );

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
    total_price: totalPrice,
    paid_amount: paidAmount,
    balance_due: Math.max(balanceDue, 0),
    currency: readCurrency(booking),
    price_breakdown: readPriceBreakdown(booking),
    payment_status: mapPaymentStatus(booking),
    notes: String(booking.notes || booking.comment || ""),
    source_payload: booking,
    updated_at: new Date().toISOString(),
  };
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
    .update({
      access_token: data.token,
      access_token_expires_at: expiresAtIso,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);
  return data.token;
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

function readMoneyValue(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(value, 0);
    if (typeof value === "string") {
      const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
      if (Number.isFinite(parsed)) return Math.max(parsed, 0);
    }
    if (typeof value === "object") {
      const objectValue = value as Record<string, unknown>;
      const parsed = readMoneyValue(
        objectValue.amount,
        objectValue.value,
        objectValue.total,
        objectValue.gross,
        objectValue.price,
      );
      if (parsed > 0) return parsed;
    }
  }
  return 0;
}

function sumMoneyList(value: unknown) {
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, item) => sum + readMoneyValue(item), 0);
}

function readCurrency(booking: any) {
  return String(
    booking.currency ||
    booking.currencyCode ||
    booking.invoiceCurrency ||
    booking.priceCurrency ||
    "SEK",
  ).toUpperCase();
}

function readPriceBreakdown(booking: any) {
  return {
    invoiceItems: booking.invoiceItems || booking.invoice || booking.charges || booking.fees || [],
    payments: booking.payments || [],
    raw: {
      totalPrice: booking.totalPrice,
      price: booking.price,
      bookingPrice: booking.bookingPrice,
      invoiceTotal: booking.invoiceTotal,
      paidAmount: booking.paidAmount,
      balanceDue: booking.balanceDue,
    },
  };
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

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
