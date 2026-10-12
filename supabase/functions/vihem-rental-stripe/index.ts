// ViboRent-betalning (verify_jwt = false, se config.toml – webhooken kan inte skicka JWT; allt autentiseras här).
//  * create_checkout: kräver bokning + hemlig uppslagstoken, organisation härledd ur Origin och retur-URL:er på organisationens egna domäner.
//  * webhook: Stripe-signatur verifieras, händelser hanteras idempotent, belopp/valuta/bokning kontrolleras innan något markeras betalt.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { allow, corsHeaders, hostFromOrigin, hostsForOrganisation, normaliseHost, organisationForHost, text, UUID } from "../_shared/rental-common.ts";
import { issueRefund, stripeConfigured, stripeFetch, stripeGet, verifySignature } from "../_shared/rental-stripe.ts";

async function notifyStaff(admin: any, organisationId: string, title: string, message: string) {
  try {
    const { data: staff } = await admin.from("vihem_profiles").select("id").eq("organisation_id", organisationId).in("role", ["staff", "admin"]).eq("active", true);
    for (const person of staff ?? []) {
      const { error } = await admin.rpc("create_notification", { recipient_id: person.id, org_uuid: organisationId, notification_title: title, notification_message: message, notification_type: "info", notification_link: "rental", setting_key: null });
      if (error) console.error("create_notification:", error.message);
    }
  } catch (error) { console.error("rental notify:", error instanceof Error ? error.message : error); }
}

async function ensurePortalInvite(admin: any, organisationId: string, customerId: string) {
  try {
    const { data: customer } = await admin.from("vihem_rental_customers").select("id,email,auth_user_id").eq("id", customerId).eq("organisation_id", organisationId).maybeSingle();
    if (!customer?.email) return;
    let authUserId = customer.auth_user_id;
    if (!authUserId) {
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(customer.email, { data: { vihem_portal: true, organisation_id: organisationId, customer_id: customerId }, redirectTo: Deno.env.get("VIBORENT_PORTAL_URL") || "https://viborent.se/kundportal" });
      if (!inviteError && invited?.user?.id) authUserId = invited.user.id;
      if (!authUserId) {
        const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        authUserId = listed?.users?.find((u: any) => u.email?.toLowerCase() === customer.email.toLowerCase())?.id || null;
      }
      if (!authUserId) return;
      await admin.from("vihem_rental_customers").update({ auth_user_id: authUserId, updated_at: new Date().toISOString() }).eq("id", customerId).eq("organisation_id", organisationId);
    }
    await admin.from("vihem_rental_portal_users").upsert({ organisation_id: organisationId, customer_id: customerId, auth_user_id: authUserId, status: "invited", invited_at: new Date().toISOString() }, { onConflict: "organisation_id,customer_id" });
  } catch (error) { console.error("portal invite:", error instanceof Error ? error.message : error); }
}

Deno.serve(async (request: Request) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // ------------------------------------------------------------------ Webhook
  const signature = request.headers.get("stripe-signature");
  if (signature) {
    const raw = await request.text();
    if (!(await verifySignature(raw, signature))) return new Response(JSON.stringify({ error: "Ogiltig signatur." }), { status: 400, headers: { "Content-Type": "application/json" } });
    let event: any;
    try { event = JSON.parse(raw); } catch { return new Response("{}", { status: 400 }); }
    const object = event.data?.object ?? {};
    const bookingId = text(object.metadata?.vihem_booking_id, 80);
    const done = (outcome: string) => new Response(JSON.stringify({ received: true, outcome }), { status: 200, headers: { "Content-Type": "application/json" } });

    // Bara händelser som hör till en ViboRent-bokning (webhooken kan delas med andra tjänster på samma Stripe-konto).
    let bookingRow: any = null;
    if (UUID.test(bookingId)) {
      const { data } = await admin.from("vihem_rental_bookings").select("id,organisation_id,public_reference,total,currency,customer_id,payment_status,stripe_payment_intent_id,status").eq("id", bookingId).maybeSingle();
      bookingRow = data;
    } else if (event.type === "charge.refunded" && object.payment_intent) {
      const { data } = await admin.from("vihem_rental_bookings").select("id,organisation_id,public_reference,total,currency,customer_id,payment_status,stripe_payment_intent_id,status").eq("stripe_payment_intent_id", String(object.payment_intent)).maybeSingle();
      bookingRow = data;
    }
    if (!bookingRow) return done("ignored");

    const { data: first } = await admin.rpc("vihem_rental_claim_stripe_event", { p_event: String(event.id), p_type: String(event.type), p_booking: bookingRow.id });
    if (first === false) return done("duplicate");

    try {
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
        if (object.payment_status !== "paid") return done("awaiting_payment");
        const expectedMinor = Math.round(Number(bookingRow.total) * 100);
        if (Number(object.amount_total) !== expectedMinor || String(object.currency).toLowerCase() !== String(bookingRow.currency).toLowerCase()) {
          // Belopp/valuta stämmer inte med bokningen: markera aldrig som betald automatiskt.
          console.error("rental webhook amount mismatch", bookingRow.public_reference);
          await admin.from("vihem_rental_bookings").update({ internal_notes: `Stripe-betalning med avvikande belopp (${object.amount_total} ${object.currency}) – kontrollera manuellt.` }).eq("id", bookingRow.id);
          await notifyStaff(admin, bookingRow.organisation_id, "Betalning kräver kontroll", `Bokning ${bookingRow.public_reference}: Stripe-beloppet stämmer inte med bokningen.`);
          return done("mismatch");
        }
        const { data: paid, error } = await admin.rpc("vihem_rental_mark_paid", { p_booking: bookingRow.id, p_session: String(object.id), p_intent: object.payment_intent ? String(object.payment_intent) : null });
        if (error) throw error;
        if (paid?.refund_required) {
          const refund = await issueRefund(admin, bookingRow.id, { refund_amount: Number(bookingRow.total), payment_intent: object.payment_intent ? String(object.payment_intent) : null });
          await notifyStaff(admin, bookingRow.organisation_id, "Sen betalning återbetalad", `Bokning ${bookingRow.public_reference} betalades efter att reservationen förfallit och objektet hunnit bokas av någon annan. Återbetalning: ${refund}.`);
          return done("refunded_late_payment");
        }
        if (!paid?.already_paid) {
          await notifyStaff(admin, bookingRow.organisation_id, "Ny betald uthyrningsbokning", `Bokning ${bookingRow.public_reference} är betald och bekräftad.`);
          if (bookingRow.customer_id) await ensurePortalInvite(admin, bookingRow.organisation_id, bookingRow.customer_id);
        }
        return done("paid");
      }
      if (event.type === "checkout.session.expired") {
        // Kunden lämnade betalningen: släpp reservationen direkt (cron städar inom en minut).
        await admin.from("vihem_rental_bookings").update({ payment_status: "unpaid", hold_expires_at: new Date().toISOString() }).eq("id", bookingRow.id).eq("status", "pending").in("payment_status", ["pending", "unpaid"]);
        return done("expired");
      }
      if (event.type === "checkout.session.async_payment_failed") {
        await admin.from("vihem_rental_bookings").update({ payment_status: "unpaid" }).eq("id", bookingRow.id).neq("payment_status", "paid");
        return done("payment_failed");
      }
      if (event.type === "charge.refunded") {
        const refundedMinor = Number(object.amount_refunded || 0), capturedMinor = Number(object.amount_captured || object.amount || 0);
        await admin.from("vihem_rental_bookings").update({ payment_status: refundedMinor >= capturedMinor ? "refunded" : "partially_refunded", refund_status: "succeeded", refund_amount: refundedMinor / 100 }).eq("id", bookingRow.id);
        return done("refund_recorded");
      }
      return done("ignored_type");
    } catch (error) {
      // Släpp markeringen så att Stripes omförsök kan bearbeta händelsen igen.
      await admin.from("vihem_rental_stripe_events").delete().eq("event_id", String(event.id));
      console.error("rental webhook error:", error instanceof Error ? error.message : error);
      return new Response(JSON.stringify({ error: "retry" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  // ------------------------------------------------------------------ Starta betalning
  const origin = request.headers.get("origin") || "";
  const host = hostFromOrigin(request);
  const organisationId = await organisationForHost(admin, host);
  const headers = { ...corsHeaders(origin, !!organisationId, "POST, OPTIONS"), "Content-Type": "application/json" };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST" || !organisationId) return reply(404, { error: "Webbplatsen är inte konfigurerad." });

  try {
    if (!(await allow(admin, request, "pay", 15, 600))) return reply(429, { error: "För många betalningsförsök. Försök igen om en stund." });
    const body = JSON.parse((await request.text()) || "{}");
    const bookingId = text(body.booking_id, 80), token = text(body.public_lookup_token, 80);
    if (!UUID.test(bookingId) || !UUID.test(token)) return reply(400, { error: "Bokningen kunde inte identifieras." });
    if (!stripeConfigured()) return reply(503, { error: "Kortbetalning är inte aktiverad ännu. Kontakta uthyraren för att slutföra bokningen." });

    const allowedHosts = await hostsForOrganisation(admin, organisationId);
    const validReturn = (value: string) => { try { const u = new URL(value); return u.protocol === "https:" && allowedHosts.has(normaliseHost(u.hostname)) ? u.toString() : null; } catch { return null; } };
    const successUrl = validReturn(text(body.success_url, 1000)), cancelUrl = validReturn(text(body.cancel_url, 1000));
    if (!successUrl || !cancelUrl) return reply(400, { error: "Ogiltig återvändningsadress." });

    const { data: booking } = await admin.from("vihem_rental_bookings")
      .select("id,organisation_id,public_reference,status,payment_status,contract_status,total,currency,hold_expires_at,stripe_checkout_session_id,customer:vihem_rental_customers(email),items:vihem_rental_booking_items(quantity,total_price,start_at,end_at,product:vihem_rental_products(name))")
      .eq("id", bookingId).eq("organisation_id", organisationId).eq("public_lookup_token", token).maybeSingle();
    if (!booking) return reply(404, { error: "Bokningen hittades inte." });
    if (booking.status === "cancelled") return reply(409, { error: "Reservationen har gått ut. Gör en ny bokning." });
    if (booking.payment_status === "paid") return reply(409, { error: "Bokningen är redan betald." });
    if (booking.status !== "pending") return reply(409, { error: "Bokningen kan inte betalas." });
    if (booking.contract_status !== "signed") return reply(409, { error: "Avtalet måste signeras innan betalning." });
    const amount = Math.round(Number(booking.total) * 100);
    if (!(amount > 0)) return reply(400, { error: "Bokningen saknar belopp att betala." });

    // Återanvänd en öppen session i stället för att skapa dubbletter.
    if (booking.stripe_checkout_session_id) {
      try {
        const existing = await stripeGet(`checkout/sessions/${encodeURIComponent(booking.stripe_checkout_session_id)}`);
        if (existing.status === "open" && existing.url) return reply(200, { checkout_url: existing.url, booking_reference: booking.public_reference, reused: true });
      } catch (error) { console.error("rental reuse session:", error instanceof Error ? error.message : error); }
    }

    const customer = Array.isArray(booking.customer) ? booking.customer[0] : booking.customer;
    const grouped = new Map<string, { name: string; quantity: number }>();
    for (const item of booking.items ?? []) { const p: any = Array.isArray(item.product) ? item.product[0] : item.product; const key = p?.name || "Uthyrning"; const g = grouped.get(key) ?? { name: key, quantity: 0 }; g.quantity += item.quantity || 1; grouped.set(key, g); }
    const session = await stripeFetch("checkout/sessions", {
      mode: "payment", success_url: successUrl, cancel_url: cancelUrl, locale: "sv",
      expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60),
      "line_items[0][price_data][currency]": String(booking.currency || "SEK").toLowerCase(),
      "line_items[0][price_data][product_data][name]": `Hyra ${booking.public_reference}: ${[...grouped.values()].map((g) => `${g.name} ×${g.quantity}`).join(", ").slice(0, 200)}`,
      "line_items[0][price_data][unit_amount]": String(amount),
      "line_items[0][quantity]": "1",
      ...(customer?.email ? { customer_email: customer.email } : {}),
      "metadata[vihem_booking_id]": booking.id, "metadata[vihem_organisation_id]": booking.organisation_id, "metadata[vihem_public_reference]": booking.public_reference,
      "payment_intent_data[metadata][vihem_booking_id]": booking.id,
    }, `rental-checkout-${booking.id}-${Math.floor(Date.now() / 600000)}`);

    await admin.from("vihem_rental_bookings").update({ payment_provider: "stripe", payment_status: "pending", stripe_checkout_session_id: session.id, external_payment_id: session.id, hold_expires_at: new Date(Date.now() + 35 * 60000).toISOString(), updated_at: new Date().toISOString() }).eq("id", booking.id).eq("status", "pending");
    return reply(200, { checkout_url: session.url, booking_reference: booking.public_reference });
  } catch (error) {
    console.error("vihem-rental-stripe error:", error instanceof Error ? error.message : error);
    return reply(500, { error: "Betalningen kunde inte startas just nu. Försök igen om en stund." });
  }
});
