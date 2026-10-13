// Hanterar en (redan signaturverifierad) Stripe-händelse mot Kompetensportalens databas. Separerad från HTTP-lagret så att den kan testas direkt.
import { isUuid, money, notifyStaff, queueMail, text } from "./kp-common.ts";

export interface HandlerResult { status: number; body: Record<string, unknown> }
const out = (status: number, body: Record<string, unknown>): HandlerResult => ({ status, body });

export async function handleStripeEvent(admin: any, event: any, opts: { quiet?: boolean } = {}): Promise<HandlerResult> {
  const obj = event.data?.object ?? {};
  const notify = (org: string, title: string, msg: string) => opts.quiet ? Promise.resolve() : notifyStaff(admin, org, title, msg);
  // Hitta ordern: metadata, annars via betalning/session/charge
  let orderId = text(obj.metadata?.kp_order_id, 60);
  if (!isUuid(orderId)) {
    const pi = text(obj.payment_intent || obj.id, 120);
    const { data: byPi } = pi ? await admin.from("vihem_kp_orders").select("id").or(`stripe_payment_intent_id.eq.${pi},stripe_checkout_session_id.eq.${pi}`).maybeSingle() : { data: null };
    orderId = byPi?.id ?? "";
  }
  if (!isUuid(orderId)) return out(200, { received: true, outcome: "ignored" });
  const { data: order } = await admin.from("vihem_kp_orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return out(200, { received: true, outcome: "ignored" });

  const { data: first } = await admin.rpc("vihem_kp_claim_stripe_event", { p_event: String(event.id), p_type: String(event.type), p_order: orderId });
  if (first === false) return out(200, { received: true, outcome: "duplicate" });

  try {
    const org = order.organisation_id;
    const { data: settings } = await admin.from("vihem_kp_settings").select("*").eq("organisation_id", org).single();
    const { data: participant } = order.buyer_user_id ? await admin.from("vihem_kp_participants").select("first_name,last_name,email").eq("user_id", order.buyer_user_id).maybeSingle() : { data: null };
    const name = [participant?.first_name, participant?.last_name].filter(Boolean).join(" ") || order.contact_email;

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      if (obj.payment_status !== "paid") return out(200, { received: true, outcome: "awaiting_payment" });
      if (Number(obj.amount_total) !== Math.round(Number(order.total) * 100) || String(obj.currency).toLowerCase() !== String(order.currency).toLowerCase()) {
        await admin.from("vihem_kp_orders").update({ internal_notes: `Stripe-betalning med avvikande belopp (${obj.amount_total} ${obj.currency}) – kontrollera manuellt.` }).eq("id", orderId);
        await notify(org, "Betalning kräver kontroll", `Order ${order.order_number}: Stripe-beloppet stämmer inte med ordern. Ingen åtkomst har getts.`);
        return out(200, { received: true, outcome: "mismatch" });
      }
      await admin.from("vihem_kp_orders").update({ stripe_payment_intent_id: obj.payment_intent ? String(obj.payment_intent) : order.stripe_payment_intent_id }).eq("id", orderId);
      const { data: res, error } = await admin.rpc("vihem_kp_apply_payment", { p_order: orderId, p_provider: "stripe", p_ref: String(obj.payment_intent || obj.id), p_amount: Number(obj.amount_total) / 100, p_detail: { session: obj.id } });
      if (error) throw error;
      if (res?.late_payment) {
        await notify(org, "Sen betalning på avbruten order", `Order ${order.order_number} (${money(order.total)} kr) betalades efter att ordern avbrutits. Ingen åtkomst har getts – återbetala eller återöppna manuellt.`);
        return out(200, { received: true, outcome: "late_payment" });
      }
      if (!res?.duplicate) {
        const vars = { name, order_number: order.order_number, total: money(order.total), portal_url: `${String(settings.public_base_url).replace(/\/$/, "")}/mina-sidor`, lines: "" };
        await queueMail(admin, org, "payment_received", order.contact_email, name, vars, `order-${orderId}-paid`, "order", orderId);
        await queueMail(admin, org, "order_confirmation", order.contact_email, name, { ...vars, lines: "Se din order under Mina sidor." }, `order-${orderId}-confirm`, "order", orderId);
        await notify(org, "Ny betald order", `Order ${order.order_number} (${money(order.total)} kr) är betald och aktiverad.`);
      }
      return out(200, { received: true, outcome: "paid" });
    }
    if (event.type === "checkout.session.expired") {
      await admin.from("vihem_kp_orders").update({ status: "expired" }).eq("id", orderId).eq("status", "pending_payment");
      await admin.from("vihem_kp_session_bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("status", "held").in("order_item_id", (await admin.from("vihem_kp_order_items").select("id").eq("order_id", orderId)).data?.map((x: any) => x.id) ?? []);
      return out(200, { received: true, outcome: "expired" });
    }
    if (event.type === "checkout.session.async_payment_failed") {
      await admin.from("vihem_kp_orders").update({ status: "failed" }).eq("id", orderId).eq("status", "pending_payment");
      return out(200, { received: true, outcome: "payment_failed" });
    }
    if (event.type === "charge.refunded") {
      const refunded = Number(obj.amount_refunded || 0) / 100;
      const delta = refunded - Number(order.amount_refunded);
      if (delta > 0) {
        await admin.rpc("vihem_kp_record_refund", { p_order: orderId, p_amount: delta, p_ref: `${obj.id}:${obj.amount_refunded}`, p_reason: "Återbetalning via Stripe", p_kind: "refund", p_actor: null, p_revoke: false });
        await notify(org, "Återbetalning registrerad", `Order ${order.order_number}: ${money(delta)} kr återbetald.`);
      }
      return out(200, { received: true, outcome: "refund_recorded" });
    }
    if (event.type === "charge.dispute.created") {
      await admin.rpc("vihem_kp_record_refund", { p_order: orderId, p_amount: Number(obj.amount || 0) / 100 || Number(order.total), p_ref: `dispute:${obj.id}`, p_reason: "Kortinnehavaren har öppnat en tvist", p_kind: "dispute", p_actor: null, p_revoke: false });
      await notify(org, "Betalningstvist", `Order ${order.order_number}: kortinnehavaren har öppnat en tvist. Åtkomst är återkallad enligt inställningarna.`);
      return out(200, { received: true, outcome: "dispute_recorded" });
    }
    return out(200, { received: true, outcome: "ignored_type" });
  } catch (error) {
    await admin.from("vihem_kp_stripe_events").delete().eq("event_id", String(event.id));
    console.error("kp webhook error:", error instanceof Error ? error.message : error);
    return out(500, { error: "retry" });
  }
}

