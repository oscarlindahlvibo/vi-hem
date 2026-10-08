// Stripe-webhook för Ekängens direktbokning (verify_jwt = false; autentiseras med Stripe-signatur).
// checkout.session.completed / async_payment_succeeded -> bokningen markeras betald, korttidsbokning skapas, Beds24 spärras, mejl + notis.
// checkout.session.expired -> reservationen släpps. charge.refunded -> bokningen avbokas (t.ex. återbetalning gjord i Stripe-panelen).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifySignature } from "../_shared/ekangen-stripe.ts";
import { cancelShortStayBookingInBeds24, pushShortStayBooking } from "../_shared/ekangen-beds24.ts";
import { emailGuest, notifyAdmins } from "../_shared/ekangen-notify.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get("stripe-signature")))) return json({ error: "invalid signature" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const event = JSON.parse(raw);
  const object = event.data?.object ?? {};

  try {
    const { data: ctx } = await admin.rpc("vihem_ekangen_service_context");
    const { data: site } = await admin.rpc("vihem_ekangen_public_site");
    const notifyCtx = ctx ? {
      organisation_id: ctx.organisation_id, settings: ctx.settings,
      siteUrl: String(Deno.env.get("EKANGEN_SITE_URL") || "https://ekangensvandrarhem.se"),
      companyName: site?.content?.company?.name || "Ekängens vandrarhem",
    } : null;

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      if (object.payment_status !== "paid") return json({ received: true, note: "awaiting payment" });
      const { data: result, error } = await admin.rpc("vihem_ekangen_complete_booking", { p_session_id: object.id, p_payment_intent: String(object.payment_intent || "") });
      if (error) throw error;
      if (result?.already || result?.status === "not_found") return json({ received: true, status: result?.status });
      const { data: booking } = await admin.rpc("vihem_ekangen_by_session", { p_session_id: object.id });
      const { data: unit } = booking ? await admin.from("vihem_short_stay_units").select("name").eq("id", booking.unit_id).maybeSingle() : { data: null };
      if (!booking || !notifyCtx) return json({ received: true });
      const label = `${unit?.name || "Enhet"} ${booking.start_date}–${booking.end_date}`;

      if (result.status === "conflict") {
        await notifyAdmins(admin, notifyCtx, "Direktbokning behöver åtgärd", `${booking.guest_name} har betalat för ${label} (${booking.reference}) men datumen hann bli upptagna. Återbetala i Stripe eller kontakta gästen.`);
        return json({ received: true, status: "conflict" });
      }
      try { if (result.short_stay_booking_id) await pushShortStayBooking(admin, result.short_stay_booking_id); }
      catch (error) {
        console.error("ekangen beds24 push:", error instanceof Error ? error.message : error);
        await notifyAdmins(admin, notifyCtx, "Kontrollera Beds24: direktbokning", `Bokning ${booking.reference} (${label}) kunde inte skickas till Beds24 och kan dubbelbokas. Öppna bokningen i Korttid och spara den igen.`);
      }
      await emailGuest(admin, notifyCtx, { ...booking, unit_name: unit?.name }, "confirmed");
      await notifyAdmins(admin, notifyCtx, "Ny direktbokning", `${booking.guest_name}, ${label}, ${booking.guests} gäst(er), ${Number(booking.total)} ${booking.currency}. Bokning ${booking.reference}.`);
      return json({ received: true, status: "paid" });
    }

    if (event.type === "checkout.session.expired") {
      const { data: booking } = await admin.rpc("vihem_ekangen_by_session", { p_session_id: object.id });
      if (booking?.status === "pending") await admin.rpc("vihem_ekangen_set_status", { p_booking_id: booking.id, p_status: "expired" });
      return json({ received: true });
    }

    if (event.type === "charge.refunded") {
      const intent = String(object.payment_intent || "");
      const { data: booking } = intent ? await admin.rpc("vihem_ekangen_by_payment_intent", { p_intent: intent }) : { data: null };
      if (booking && booking.status === "paid" && object.refunded === true) {
        try { if (booking.short_stay_booking_id) await cancelShortStayBookingInBeds24(admin, booking.short_stay_booking_id); } catch (error) { console.error(error); }
        await admin.rpc("vihem_ekangen_set_status", { p_booking_id: booking.id, p_status: "refunded" });
        if (notifyCtx) await notifyAdmins(admin, notifyCtx, "Direktbokning återbetald", `Bokning ${booking.reference} (${booking.guest_name}) är återbetald i Stripe och datumen är lediga igen.`);
      }
      return json({ received: true });
    }
    return json({ received: true, ignored: event.type });
  } catch (error) {
    console.error("vihem-ekangen-stripe-webhook:", error instanceof Error ? error.message : error);
    return json({ error: "processing failed" }, 500); // Stripe försöker igen
  }
});
