// Spärrar/avbokar datum i Beds24 för direktbokningar från hemsidan, så att samma datum inte kan säljas på Booking m.fl.
// Egen kompakt kopia av push-logiken i vihem-beds24-push-booking (den kräver en inloggad användare; här anropas vi av
// Stripe-webhooken utan användarsession). Båda skickar referer 'VI-HEM' så att nästa Beds24-synk känner igen bokningen.
const BASE = "https://api.beds24.com/v2";

async function accessToken(admin: any, organisationId: string): Promise<string | null> {
  const { data: connection } = await admin.from("vihem_beds24_connections").select("*").eq("organisation_id", organisationId).maybeSingle();
  if (!connection?.enabled || !connection.refresh_token) return null;
  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
  if (connection.access_token && expiresAt > Date.now() + 5 * 60 * 1000) return connection.access_token;
  const response = await fetch(`${BASE}/authentication/token`, { headers: { accept: "application/json", refreshToken: connection.refresh_token } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.token) throw new Error(data?.error || data?.message || "Kunde inte hämta Beds24 access token.");
  const expiresAtIso = new Date(Date.now() + Math.max(Number(data.expiresIn || 86400) - 300, 60) * 1000).toISOString();
  await admin.from("vihem_beds24_connections").update({ access_token: data.token, access_token_expires_at: expiresAtIso, updated_at: new Date().toISOString() }).eq("id", connection.id);
  return data.token;
}

async function post(token: string, payload: Record<string, unknown>) {
  const response = await fetch(`${BASE}/bookings`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", token },
    body: JSON.stringify([payload]),
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* inte JSON */ }
  if (!response.ok) throw new Error(`Beds24 svarade ${response.status}: ${text.slice(0, 300)}`);
  const item = Array.isArray(data) ? data[0] : data;
  if (item && item.success === false) throw new Error(`Beds24 nekade: ${JSON.stringify(item.errors ?? item.error ?? item).slice(0, 300)}`);
  return item;
}

/** Skickar en korttidsbokning till Beds24. Returnerar Beds24-id, eller null om enheten/anslutningen inte är kopplad. */
export async function pushShortStayBooking(admin: any, shortStayBookingId: string): Promise<string | null> {
  const { data: booking } = await admin.from("vihem_short_stay_bookings").select("*, unit:vihem_short_stay_units(*)").eq("id", shortStayBookingId).maybeSingle();
  if (!booking?.unit?.beds24_enabled || !booking.unit.beds24_room_id) return null;
  const token = await accessToken(admin, booking.organisation_id);
  if (!token) return null;
  const [firstName, ...rest] = String(booking.guest_name || "").trim().split(/\s+/).filter(Boolean);
  const result = await post(token, {
    roomId: Number(booking.unit.beds24_room_id),
    status: "confirmed",
    arrival: booking.start_date,
    departure: booking.end_date,
    referer: "VI-HEM",
    notes: booking.notes || "",
    firstName: firstName || "",
    lastName: rest.join(" ") || (firstName ? "" : "Gäst"),
    email: booking.guest_email || undefined,
    mobile: booking.guest_phone || undefined,
    numAdult: booking.guest_count || 1,
    ...(Number(booking.total_price) > 0 ? { price: Number(booking.total_price) } : {}),
  });
  const newId = result?.new?.id ?? result?.modified?.id ?? result?.id;
  if (!newId) throw new Error("Beds24 svarade utan boknings-id.");
  await admin.from("vihem_short_stay_bookings").update({ beds24_booking_id: String(newId), external_uid: `beds24:${newId}` }).eq("id", booking.id);
  return String(newId);
}

/** Avbokar i Beds24. Anropas INNAN korttidsbokningen raderas lokalt. */
export async function cancelShortStayBookingInBeds24(admin: any, shortStayBookingId: string): Promise<boolean> {
  const { data: booking } = await admin.from("vihem_short_stay_bookings").select("organisation_id, beds24_booking_id, unit:vihem_short_stay_units(beds24_room_id)").eq("id", shortStayBookingId).maybeSingle();
  if (!booking?.beds24_booking_id) return false;
  const token = await accessToken(admin, booking.organisation_id);
  if (!token) return false;
  const unit = Array.isArray(booking.unit) ? booking.unit[0] : booking.unit;
  await post(token, { id: Number(booking.beds24_booking_id), roomId: Number(unit?.beds24_room_id), status: "cancelled" });
  return true;
}
