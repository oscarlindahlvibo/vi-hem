// Stripe-hjälpare för Kompetensportalen (WPE Sweden AB). Egna nycklar STRIPE_KP_*; faller tillbaka på gemensamma STRIPE_* om de saknas.
export const stripeKey = () => Deno.env.get("STRIPE_KP_SECRET_KEY") || Deno.env.get("STRIPE_SECRET_KEY") || "";
export const webhookSecret = () => Deno.env.get("STRIPE_KP_WEBHOOK_SECRET") || Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
export const stripeConfigured = () => !!stripeKey();

export async function stripePost(path: string, params: Record<string, string>, idempotencyKey?: string) {
  const key = stripeKey();
  if (!key) throw new Error("STRIPE_NOT_CONFIGURED");
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, v);
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) }, body });
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
export async function verifySignature(rawBody: string, header: string | null, secretOverride?: string): Promise<boolean> {
  const secret = secretOverride ?? webhookSecret();
  if (!secret || !header) return false;
  const timestamp = header.match(/(?:^|,)t=(\d+)/)?.[1];
  const signatures = [...header.matchAll(/(?:^|,)v1=([0-9a-f]+)/g)].map((m) => m[1]);
  if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
  return signatures.some((s) => s.length === expected.length && s === expected);
}
