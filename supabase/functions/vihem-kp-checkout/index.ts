// Köpflöde för Kompetensportalen (verify_jwt = false; användaren autentiseras här via Supabase JWT).
// Order skapas av databasfunktionen (pris, moms, kapacitet, kreditgräns). Åtkomst ges ALDRIG här för kortköp – bara av verifierad Stripe-webhook.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { allow, clientIp, corsFor, ensureParticipant, fingerprint, isTestEmail, isUuid, kpContext, mapKpError, money, queueMail, text, userFromRequest, notifyStaff as notifyStaffReal } from "../_shared/kp-common.ts";
import { stripeConfigured, stripeGet, stripePost } from "../_shared/kp-stripe.ts";
import { createInvoiceForOrder } from "../_shared/kp-accounted.ts";

Deno.serve(async (request: Request) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const ctx = await kpContext(admin, request);
  const base = corsFor(request, ctx);
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...base, "Content-Type": "application/json" } });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: base });
  if (!ctx || request.method !== "POST") return reply(404, { error: "Webbplatsen är inte konfigurerad.", code: "E_DOMAIN" });
  const org = ctx.organisationId;
  try {
    const user = await userFromRequest(admin, request);
    if (!user) return reply(401, { error: "Logga in för att fortsätta.", code: "E_AUTH" });
    if (!(await allow(admin, request, `kp-checkout-${user.id}`, 30, 600))) return reply(429, { error: "För många försök. Försök igen om en stund.", code: "E_RATE" });
    const body = JSON.parse((await request.text()) || "{}");
    const action = text(body.action, 40);
    await ensureParticipant(admin, ctx, user);
    const notifyStaff = (...args: Parameters<typeof notifyStaffReal>) => (isTestEmail(user.email) ? Promise.resolve() : notifyStaffReal(...args));

    if (action === "order_status") {
      const { data: o } = await admin.from("vihem_kp_orders").select("id,order_number,status,payment_method,total,access_enabled,invoice_status").eq("id", body.order_id).eq("buyer_user_id", user.id).maybeSingle();
      if (!o) return reply(404, { error: "Ordern hittades inte.", code: "E_NOT_FOUND" });
      return reply(200, { order: o });
    }

    if (action === "cancel_order") {
      const { data: o } = await admin.from("vihem_kp_orders").select("id,status").eq("id", body.order_id).eq("buyer_user_id", user.id).maybeSingle();
      if (!o || o.status !== "pending_payment") return reply(409, { error: "Ordern kan inte avbrytas.", code: "E_STATE" });
      await admin.from("vihem_kp_orders").update({ status: "cancelled" }).eq("id", o.id).eq("status", "pending_payment");
      await admin.from("vihem_kp_session_bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("status", "held").in("order_item_id", (await admin.from("vihem_kp_order_items").select("id").eq("order_id", o.id)).data?.map((x: any) => x.id) ?? []);
      return reply(200, { ok: true });
    }

    if (action !== "create_order") return reply(404, { error: "Okänd åtgärd.", code: "E_ACTION" });

    // ---- Validera köpet
    const buyerType = body.buyer_type === "company" ? "company" : "private";
    const method = ["stripe", "invoice", "free"].includes(body.payment_method) ? body.payment_method : "stripe";
    const idem = text(body.idempotency_key, 80);
    if (idem.length < 16) return reply(400, { error: "Ogiltig förfrågan (idempotensnyckel saknas).", code: "E_INVALID" });
    if (body.accepted_terms !== true) return reply(400, { error: "Du måste godkänna köpvillkoren.", code: "E_TERMS" });
    if (buyerType === "private" && body.withdrawal_consent !== true) return reply(400, { error: "Du måste samtycka till att den digitala leveransen påbörjas (ångerrätten kan då gå förlorad).", code: "E_TERMS" });
    let customerId: string | null = null;
    if (buyerType === "company") {
      if (!isUuid(body.customer_id)) return reply(400, { error: "Välj företag.", code: "E_CUSTOMER" });
      const { data: m } = await admin.from("vihem_kp_company_members").select("id").eq("customer_id", body.customer_id).eq("user_id", user.id).eq("status", "active").eq("role", "admin").maybeSingle();
      if (!m) return reply(403, { error: "Du är inte administratör för företaget.", code: "E_FORBIDDEN" });
      customerId = body.customer_id;
    }
    if (method === "stripe" && !(stripeConfigured() && ctx.settings.stripe_enabled)) return reply(503, { error: "Kortbetalning är inte aktiverad ännu. Kontakta oss för att beställa.", code: "E_PAYMENTS_OFF" });
    if (method === "invoice" && buyerType !== "company") return reply(403, { error: "Faktura är bara tillgängligt för företagskunder.", code: "E_INVOICE" });

    // Villkor måste vara publicerade (juridisk granskning krävs innan försäljning). Versionerna sparas som godkännandebevis.
    const needed = ["terms", "privacy", ...(buyerType === "private" ? ["withdrawal"] : []), ...(method === "invoice" ? ["invoice_terms"] : [])];
    const { data: pages } = await admin.from("vihem_kp_site_pages").select("kind,version,status").eq("organisation_id", org).in("kind", needed).eq("status", "published");
    const missing = needed.filter((k) => !(pages ?? []).some((p: any) => p.kind === k));
    if (missing.length) return reply(503, { error: "Köpvillkoren är inte publicerade ännu, så försäljning är avstängd.", code: "E_TERMS_NOT_PUBLISHED" });
    const terms = { accepted_at: new Date().toISOString(), versions: Object.fromEntries((pages ?? []).map((p: any) => [p.kind, p.version])), withdrawal_consent: buyerType === "private", client: await fingerprint(clientIp(request) || "unknown"), user_agent: text(request.headers.get("user-agent"), 200) };

    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 30).map((i: any) => ({ product_id: text(i.product_id, 60), quantity: Math.floor(Number(i.quantity) || 0), session_id: isUuid(i.session_id) ? i.session_id : null }));
    const bill = body.billing || {};
    const billing = { name: text(bill.name, 200), address: text(bill.address, 200), postal_code: text(bill.postal_code, 20), city: text(bill.city, 120), country: text(bill.country, 2) || "SE", reference: text(bill.reference, 120) };
    const { data: created, error } = await admin.rpc("vihem_kp_create_order", { p_org: org, p_buyer: user.id, p_customer: customerId, p_buyer_type: buyerType, p_items: items, p_code: text(body.code, 40) || null, p_method: method,
      p_idem: idem, p_contact_email: user.email, p_billing: billing, p_terms: terms });
    if (error) { const m = mapKpError(error); return reply(m.status, { error: m.message, code: m.code }); }
    const orderId = created.order_id as string;
    const portal = `${ctx.baseUrl}/mina-sidor`;
    const { data: order } = await admin.from("vihem_kp_orders").select("*, items:vihem_kp_order_items(description,quantity,line_total)").eq("id", orderId).single();
    const lines = (order.items as any[]).map((i) => `${i.quantity} × ${i.description} – ${money(i.line_total)} kr`).join("\n");
    const { data: participant } = await admin.from("vihem_kp_participants").select("first_name,last_name").eq("user_id", user.id).maybeSingle();
    const name = [participant?.first_name, participant?.last_name].filter(Boolean).join(" ") || user.email;
    const mailVars = { name, order_number: order.order_number, lines, total: money(order.total), portal_url: portal };

    if (created.reused && order.status !== "pending_payment") return reply(200, { order_id: orderId, order_number: order.order_number, status: order.status });

    if (method === "free") {
      await admin.rpc("vihem_kp_apply_payment", { p_order: orderId, p_provider: "manual", p_ref: `free:${orderId}`, p_amount: 0, p_detail: { free: true } });
      await queueMail(admin, org, "order_confirmation", user.email, name, mailVars, `order-${orderId}-confirm`, "order", orderId);
      return reply(201, { order_id: orderId, order_number: order.order_number, status: "fulfilled" });
    }

    if (method === "invoice") {
      await queueMail(admin, org, "order_confirmation", user.email, name, mailVars, `order-${orderId}-confirm`, "order", orderId);
      if (order.status === "invoiced" || !ctx.settings.invoice_requires_approval) {
        const approved = await admin.rpc("vihem_kp_approve_invoice_order", { p_order: orderId, p_actor: null });
        if (approved.error) { const m = mapKpError(approved.error); return reply(m.status, { error: m.message, code: m.code }); }
        const inv = await createInvoiceForOrder(admin, orderId, null);
        if (!inv.ok) { await notifyStaff(admin, org, "Faktura kräver åtgärd", `Order ${order.order_number}: fakturan kunde inte skapas automatiskt (${inv.message}).`); await admin.from("vihem_kp_orders").update({ invoice_status: "needs_action" }).eq("id", orderId); }
        else await queueMail(admin, org, "invoice_info", order.contact_email, name, { name, order_number: order.order_number, due_date: inv.dueDate ?? "", access_note: approved.data?.access_mode === "immediate" ? "Du har tillgång direkt." : "Tillgång öppnas när fakturan är betald." }, `order-${orderId}-invoice`, "order", orderId);
      } else await notifyStaff(admin, org, "Fakturaorder väntar på godkännande", `Order ${order.order_number} (${money(order.total)} kr) från företagskund väntar på godkännande.`);
      return reply(201, { order_id: orderId, order_number: order.order_number, status: (await admin.from("vihem_kp_orders").select("status").eq("id", orderId).single()).data?.status });
    }

    // Kortbetalning: Stripe Checkout. Åtkomst ges först av webhooken.
    if (order.stripe_checkout_session_id) {
      try { const existing = await stripeGet(`checkout/sessions/${encodeURIComponent(order.stripe_checkout_session_id)}`); if (existing.status === "open" && existing.url) return reply(200, { order_id: orderId, order_number: order.order_number, status: order.status, checkout_url: existing.url, resumed: true }); } catch (e) { console.error("kp resume session:", e instanceof Error ? e.message : e); }
      return reply(200, { order_id: orderId, order_number: order.order_number, status: order.status, resumed: true });
    }
    try {
      const params: Record<string, string> = { mode: "payment", success_url: `${ctx.baseUrl}/order/${orderId}?betalning=klar`, cancel_url: `${ctx.baseUrl}/order/${orderId}?betalning=avbruten`, locale: "sv",
        client_reference_id: order.order_number, customer_email: user.email, expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60),
        "metadata[kp_order_id]": orderId, "metadata[kp_order_number]": order.order_number, "payment_intent_data[metadata][kp_order_id]": orderId, "payment_intent_data[description]": `Order ${order.order_number}` };
      (order.items as any[]).forEach((it, idx) => {
        params[`line_items[${idx}][price_data][currency]`] = "sek";
        params[`line_items[${idx}][price_data][unit_amount]`] = String(Math.round(Number(it.line_total) * 100));
        params[`line_items[${idx}][price_data][product_data][name]`] = `${it.quantity} × ${it.description} (inkl. moms)`.slice(0, 250);
        params[`line_items[${idx}][quantity]`] = "1";
      });
      const session = await stripePost("checkout/sessions", params, `kp-order-${orderId}`);
      await admin.from("vihem_kp_orders").update({ stripe_checkout_session_id: session.id, expires_at: new Date(Date.now() + 35 * 60000).toISOString() }).eq("id", orderId);
      return reply(201, { order_id: orderId, order_number: order.order_number, status: "pending_payment", checkout_url: session.url });
    } catch (e) {
      console.error("kp stripe session:", e instanceof Error ? e.message : e);
      await admin.from("vihem_kp_orders").update({ status: "failed" }).eq("id", orderId).eq("status", "pending_payment");
      await admin.from("vihem_kp_session_bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("status", "held").in("order_item_id", (await admin.from("vihem_kp_order_items").select("id").eq("order_id", orderId)).data?.map((x: any) => x.id) ?? []);
      return reply(502, { error: "Betalningen kunde inte startas just nu. Försök igen om en stund.", code: "E_PAYMENT_START" });
    }
  } catch (error) {
    const m = mapKpError(error);
    return reply(m.status, { error: m.message, code: m.code });
  }
});
