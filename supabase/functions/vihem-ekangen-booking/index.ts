// Publik API för Ekängens vandrarhems hemsida (verify_jwt = false, se config.toml).
// Alla priser räknas ut här på servern ur VI-HEM:s korttidspriser minus direktrabatten -- klienten skickar aldrig ett belopp.
// Actions (POST { action, ... }):
//   availability  { start, end, guests }            -> lediga enheter med pris
//   checkout      { unit_id, start, end, guests, name, email, phone, message, accept_terms, return_url } -> { checkout_url }
//   booking       { reference, token }               -> bokningsstatus
//   cancel        { reference, token }               -> gratis avbokning inom fristen (återbetalning via Stripe)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { calculateStayPrice, nightsBetween } from "../_shared/short-stay-pricing.ts";
import { stripeFetch } from "../_shared/ekangen-stripe.ts";
import { cancelShortStayBookingInBeds24 } from "../_shared/ekangen-beds24.ts";
import { emailGuest, notifyAdmins } from "../_shared/ekangen-notify.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ error: { code, message } }, status);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const randomToken = (bytes = 24) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
function reference() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return "EK-" + [...crypto.getRandomValues(new Uint8Array(6))].map((b) => alphabet[b % alphabet.length]).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Endast POST stöds.", 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: any;
  try { body = await req.json(); } catch { return fail("VALIDATION_ERROR", "Ogiltig JSON."); }

  try {
    const { data: ctx } = await admin.rpc("vihem_ekangen_service_context");
    if (!ctx) return fail("NOT_CONFIGURED", "Bokning är inte konfigurerad.", 503);
    const settings = ctx.settings;
    const action = text(body.action, 30);

    if (action === "booking" || action === "cancel") return await bookingAction(admin, ctx, body, action === "cancel");
    if (!settings.booking_enabled) return fail("BOOKING_DISABLED", "Direktbokning är inte öppen just nu.", 403);

    const start = text(body.start, 10), end = text(body.end, 10);
    const guests = Number(body.guests);
    if (!DATE.test(start) || !DATE.test(end) || !Number.isInteger(guests) || guests < 1 || guests > 20) return fail("VALIDATION_ERROR", "Ange giltiga datum och antal gäster.");
    const nights = nightsBetween(start, end);
    const maxAhead = new Date(); maxAhead.setUTCDate(maxAhead.getUTCDate() + 548);
    if (start < today()) return fail("VALIDATION_ERROR", "Ankomstdatum kan inte ligga i det förflutna.");
    if (end <= start || nights < settings.min_nights) return fail("VALIDATION_ERROR", `Minsta vistelse är ${settings.min_nights} natt${settings.min_nights > 1 ? "er" : ""}.`);
    if (nights > settings.max_nights) return fail("VALIDATION_ERROR", `Längsta vistelse via hemsidan är ${settings.max_nights} nätter. Kontakta oss för längre vistelser.`);
    if (start > maxAhead.toISOString().slice(0, 10)) return fail("VALIDATION_ERROR", "Det går inte att boka så långt fram ännu.");

    const quotes = await quoteUnits(admin, ctx, start, end, guests);

    if (action === "availability") {
      return json({ data: { nights, start, end, guests, checkInTime: settings.check_in_time, checkOutTime: settings.check_out_time, freeCancelDays: settings.free_cancel_days, units: quotes } });
    }

    if (action === "checkout") {
      const unitId = text(body.unit_id, 60);
      const quote = quotes.find((q: any) => q.unitId === unitId);
      if (!quote) return fail("UNAVAILABLE", "Boendet är inte längre ledigt för de datumen.", 409);
      const name = text(body.name, 120), email = text(body.email, 200).toLowerCase(), phone = text(body.phone, 40), message = text(body.message, 500);
      if (name.length < 2 || !EMAIL.test(email)) return fail("VALIDATION_ERROR", "Fyll i namn och en giltig e-postadress.");
      if (body.accept_terms !== true) return fail("VALIDATION_ERROR", "Du måste godkänna bokningsvillkoren.");
      const returnUrl = text(body.return_url, 300);
      let site: URL;
      try { site = new URL(returnUrl); } catch { return fail("VALIDATION_ERROR", "Ogiltig återvändningsadress."); }
      if (site.protocol !== "https:" && site.hostname !== "localhost") return fail("VALIDATION_ERROR", "Återvändningsadressen måste vara https.");
      const siteUrl = site.origin;

      const ref = reference(), token = randomToken();
      const { data: holdId, error: holdError } = await admin.rpc("vihem_ekangen_create_hold", {
        p_unit_id: unitId, p_start: start, p_end: end, p_guests: guests, p_name: name, p_email: email, p_phone: phone, p_message: message,
        p_base_total: quote.baseTotal, p_discount_percent: settings.discount_percent, p_total: quote.total,
        p_breakdown: { nights, perNight: quote.perNight, subtotal: quote.subtotal, losPercent: quote.losPercent, losAmount: quote.losAmount, directDiscountPercent: settings.discount_percent, directDiscountAmount: quote.directDiscount },
        p_reference: ref, p_token: token,
      });
      if (holdError) {
        const code = holdError.message || "";
        if (code.includes("dates_unavailable") || code.includes("unit_unavailable")) return fail("UNAVAILABLE", "Boendet hann bokas av någon annan. Välj andra datum eller ett annat rum.", 409);
        if (code.includes("too_many_pending")) return fail("TOO_MANY", "Det finns redan flera påbörjade bokningar på den här adressen. Vänta en stund eller slutför dem först.", 429);
        throw holdError;
      }

      const expiresEpoch = Math.floor(Date.now() / 1000) + 31 * 60;
      try {
        const session = await stripeFetch("checkout/sessions", {
          mode: "payment",
          locale: "sv",
          success_url: `${siteUrl}/bokning/${ref}?token=${token}&betalning=ok`,
          cancel_url: `${siteUrl}/boka?avbruten=1`,
          customer_email: email,
          expires_at: String(expiresEpoch),
          "line_items[0][price_data][currency]": "sek",
          "line_items[0][price_data][product_data][name]": `${quote.title} · ${nights} natt${nights > 1 ? "er" : ""}`,
          "line_items[0][price_data][product_data][description]": `${start} till ${end}, ${guests} gäst${guests > 1 ? "er" : ""}. Bokning ${ref}`,
          "line_items[0][price_data][unit_amount]": String(Math.round(quote.total * 100)),
          "line_items[0][quantity]": "1",
          "payment_intent_data[description]": `Direktbokning ${ref}`,
          "payment_intent_data[receipt_email]": email,
          "metadata[ekangen_booking_id]": holdId,
          "metadata[ekangen_reference]": ref,
        }, `ekangen-${holdId}`);
        await admin.rpc("vihem_ekangen_attach_session", { p_booking_id: holdId, p_session_id: session.id });
        return json({ data: { checkout_url: session.url, reference: ref } });
      } catch (error) {
        await admin.rpc("vihem_ekangen_set_status", { p_booking_id: holdId, p_status: "expired" });
        const msg = error instanceof Error ? error.message : "";
        if (msg === "STRIPE_NOT_CONFIGURED") return fail("PAYMENT_UNAVAILABLE", "Betalning är inte aktiverad ännu.", 503);
        console.error("ekangen checkout:", msg);
        return fail("PAYMENT_FAILED", "Betalningen kunde inte startas. Försök igen om en stund.", 502);
      }
    }
    return fail("VALIDATION_ERROR", "Okänd åtgärd.");
  } catch (error) {
    console.error("vihem-ekangen-booking:", error instanceof Error ? error.message : error);
    return fail("INTERNAL_ERROR", "Något gick fel. Försök igen om en stund.", 500);
  }
});

async function quoteUnits(admin: any, ctx: any, start: string, end: string, guests: number) {
  const settings = ctx.settings;
  const { data: taken } = await admin.rpc("vihem_ekangen_taken_units", { p_start: start, p_end: end });
  const takenSet = new Set<string>(taken ?? []);
  const candidates = (ctx.units as any[]).filter((u) => !takenSet.has(u.id) && u.max_guests >= guests);
  if (!candidates.length) return [];
  const ids = candidates.map((u) => u.id);
  const [seasons, rates, discounts] = await Promise.all([
    admin.from("vihem_short_stay_seasons").select("id,start_date,end_date,priority").eq("organisation_id", ctx.organisation_id),
    admin.from("vihem_short_stay_rates").select("unit_id,season_id,price_per_night").in("unit_id", ids),
    admin.from("vihem_short_stay_los_discounts").select("unit_id,season_id,min_nights,discount_percent").in("unit_id", ids),
  ]);
  const out: any[] = [];
  for (const unit of candidates) {
    const price = calculateStayPrice(unit.id, start, end, seasons.data ?? [], rates.data ?? [], discounts.data ?? []);
    if (price.missing.length || price.total <= 0) continue; // saknade priser = kan inte säljas
    const directDiscount = Math.round(price.total * (Number(settings.discount_percent) / 100));
    const total = Math.max(Math.round(price.total - directDiscount), 1);
    out.push({
      unitId: unit.id, title: unit.title || unit.name, maxGuests: unit.max_guests,
      perNight: price.perNight, subtotal: price.subtotal, losPercent: price.losPercent, losAmount: price.losAmount,
      baseTotal: price.total, directDiscountPercent: Number(settings.discount_percent), directDiscount, total,
      avgPerNight: Math.round(total / price.nights),
    });
  }
  return out.sort((a, b) => a.total - b.total);
}

async function bookingAction(admin: any, ctx: any, body: any, cancel: boolean) {
  const ref = text(body.reference, 20), token = text(body.token, 80);
  const { data: booking } = await admin.rpc("vihem_ekangen_booking_by_ref", { p_reference: ref });
  if (!booking || !safeEqual(String(booking.access_token), token)) return fail("NOT_FOUND", "Bokningen hittades inte.", 404);
  const canCancel = booking.status === "paid" && !!booking.free_cancel_until && today() <= booking.free_cancel_until;
  const view = {
    reference: booking.reference, status: booking.status, unit: booking.unit_title || booking.unit_name,
    start: booking.start_date, end: booking.end_date, guests: booking.guests, name: booking.guest_name, total: Number(booking.total),
    currency: booking.currency, freeCancelUntil: booking.free_cancel_until, canCancel,
    checkInTime: ctx.settings.check_in_time, checkOutTime: ctx.settings.check_out_time,
  };
  if (!cancel) return json({ data: view });

  if (!canCancel) return fail("CANCEL_NOT_ALLOWED", "Gratis avbokning är inte längre möjlig. Kontakta oss så hjälper vi dig.", 409);
  if (!booking.stripe_payment_intent) return fail("CANCEL_NOT_ALLOWED", "Bokningen kan inte avbokas automatiskt. Kontakta oss.", 409);
  const notifyCtx = { organisation_id: ctx.organisation_id, settings: ctx.settings, siteUrl: "", companyName: await companyName(admin) };
  try {
    await stripeFetch("refunds", { payment_intent: booking.stripe_payment_intent }, `ekangen-refund-${booking.id}`);
  } catch (error) {
    console.error("ekangen refund:", error instanceof Error ? error.message : error);
    return fail("REFUND_FAILED", "Återbetalningen kunde inte genomföras. Kontakta oss.", 502);
  }
  try { if (booking.short_stay_booking_id) await cancelShortStayBookingInBeds24(admin, booking.short_stay_booking_id); }
  catch (error) { console.error("ekangen beds24 cancel:", error instanceof Error ? error.message : error); await notifyAdmins(admin, notifyCtx, "Kontrollera Beds24: avbokning", `Bokning ${ref} avbokades av gästen men kunde inte avbokas i Beds24. Avboka manuellt.`); }
  await admin.rpc("vihem_ekangen_set_status", { p_booking_id: booking.id, p_status: "refunded" });
  await emailGuest(admin, notifyCtx, booking, "refunded");
  await notifyAdmins(admin, notifyCtx, "Direktbokning avbokad", `${booking.guest_name} avbokade ${booking.unit_title || booking.unit_name} ${booking.start_date}–${booking.end_date} (${ref}). Beloppet återbetalas.`);
  return json({ data: { ...view, status: "refunded", canCancel: false } });
}

async function companyName(admin: any) {
  const { data } = await admin.rpc("vihem_ekangen_public_site");
  return data?.content?.company?.name || "Ekängens vandrarhem";
}
