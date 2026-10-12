// Stripe-hjälpare för ViboRent. Egna nycklar (STRIPE_RENTAL_*) har företräde så att uthyrningen aldrig råkar använda
// Ekängens konto; annars används den gemensamma STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET.
export const stripeKey = () => Deno.env.get("STRIPE_RENTAL_SECRET_KEY") || Deno.env.get("STRIPE_SECRET_KEY") || "";
export const webhookSecret = () => Deno.env.get("STRIPE_RENTAL_WEBHOOK_SECRET") || Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
export const stripeConfigured = () => !!stripeKey();

export async function stripeFetch(path: string, params: Record<string, string>, idempotencyKey?: string) {
  const key = stripeKey();
  if (!key) throw new Error("STRIPE_NOT_CONFIGURED");
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, v);
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Stripe-anropet misslyckades.");
  return data;
}

export async function stripeGet(path: string) {
  const key = stripeKey();
  if (!key) throw new Error("STRIPE_NOT_CONFIGURED");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${key}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Stripe-anropet misslyckades.");
  return data;
}

export async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  const secret = webhookSecret();
  if (!secret || !header) return false;
  const timestamp = header.match(/(?:^|,)t=(\d+)/)?.[1];
  const signatures = [...header.matchAll(/(?:^|,)v1=([0-9a-f]+)/g)].map((m) => m[1]);
  if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
  return signatures.some((s) => s.length === expected.length && s === expected);
}

/** Återbetalning (idempotent per bokning). Vid fel markeras bokningen 'failed' så att personal ser det – aldrig tyst. */
export async function issueRefund(admin: any, bookingId: string, cancelResult: { refund_amount: number; payment_intent?: string | null }): Promise<string> {
  try {
    if (!cancelResult.payment_intent) throw new Error("Ingen Stripe-betalning att återbetala.");
    const pi = await stripeGet(`payment_intents/${encodeURIComponent(cancelResult.payment_intent)}`);
    const received = Number(pi.amount_received || pi.amount || 0);
    const minor = Math.min(received, Math.round(Number(cancelResult.refund_amount) * 100));
    if (minor <= 0) throw new Error("Inget belopp kvar att återbetala.");
    await stripeFetch("refunds", { payment_intent: cancelResult.payment_intent, amount: String(minor) }, `rental-refund-${bookingId}-${minor}`);
    await admin.from("vihem_rental_bookings").update({ refund_status: "succeeded", refund_amount: minor / 100, payment_status: minor >= received ? "refunded" : "partially_refunded" }).eq("id", bookingId);
    return "succeeded";
  } catch (error) {
    console.error("rental refund failed:", error instanceof Error ? error.message : error);
    await admin.from("vihem_rental_bookings").update({ refund_status: "failed" }).eq("id", bookingId);
    return "failed";
  }
}
