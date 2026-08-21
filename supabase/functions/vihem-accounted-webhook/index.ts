// Public inbound receiver for Accounted's outbound webhooks
// (invoice.created / invoice.sent / invoice.paid / credit_note.created).
//
// This endpoint is deliberately NOT gated by Supabase Auth (Accounted has no
// VI-HEM user session to send) -- authenticity comes entirely from the HMAC
// signature Accounted attaches per its documented scheme
// (lib/webhooks/signing.ts): header `X-Gnubok-Signature: t=<unix>,v1=<hex
// hmac-sha256>`, signed payload `${t}.${rawBody}`, secret is the one
// returned exactly once when the subscription was created (see
// vihem-accounted-admin's register_webhooks action) and stored encrypted in
// vihem_accounted_secrets.
//
// Which subscription/secret to verify against is resolved from the
// `?link=<company_link_id>&event=<event_type>` query params on the
// callback URL registered with Accounted -- Accounted's payload itself
// carries no VI-HEM identifiers, so the URL is the only reliable pointer.
//
// Idempotent by construction: every write here is an upsert keyed by the
// Accounted invoice/customer id (never an insert-only path), and delivery
// dedup additionally short-circuits an exact-duplicate delivery via a
// unique (company_link_id, dedupe_key) row in vihem_accounted_webhook_events
// before any business-table write happens.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptAccountedSecret } from "../_shared/accounted-crypto.ts";

const SIGNATURE_HEADER = "x-gnubok-signature";
const TOLERANCE_SECONDS = 5 * 60;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseSignatureHeader(header: string): { t: number; v1: string } | null {
  let t: number | null = null;
  let v1: string | null = null;
  for (const part of header.split(",").map((s) => s.trim())) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    if (k === "t") {
      const parsed = Number.parseInt(v, 10);
      if (Number.isFinite(parsed)) t = parsed;
    } else if (k === "v1") v1 = v;
  }
  if (t === null || !v1) return null;
  return { t, v1 };
}

async function hashHex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const companyLinkId = url.searchParams.get("link") || "";
  const eventType = url.searchParams.get("event") || "";
  if (!companyLinkId || !eventType) return json({ error: "Missing link/event query params" }, 400);

  const rawBody = await req.text();

  const sigHeader = req.headers.get(SIGNATURE_HEADER);
  if (!sigHeader) return json({ error: "Missing signature" }, 401);
  const parsedSig = parseSignatureHeader(sigHeader);
  if (!parsedSig) return json({ error: "Malformed signature header" }, 401);

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parsedSig.t) > TOLERANCE_SECONDS) {
    return json({ error: "Signature timestamp outside tolerance window" }, 401);
  }

  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: subscription, error: subErr } = await adminClient
    .from("vihem_accounted_webhook_subscriptions")
    .select("id, organisation_id, company_link_id, active")
    .eq("company_link_id", companyLinkId)
    .eq("event_type", eventType)
    .maybeSingle();
  if (subErr || !subscription) return json({ error: "Unknown subscription" }, 404);
  if (!subscription.active) return json({ error: "Subscription disabled" }, 403);

  const { data: secretRow, error: secretErr } = await adminClient
    .from("vihem_accounted_secrets")
    .select("encrypted_secret")
    .eq("company_link_id", companyLinkId)
    .eq("secret_type", "webhook_secret")
    .eq("webhook_subscription_id", subscription.id)
    .maybeSingle();
  if (secretErr || !secretRow) return json({ error: "No secret configured" }, 500);

  let secret: string;
  try {
    secret = await decryptAccountedSecret(secretRow.encrypted_secret);
  } catch {
    return json({ error: "Secret decryption failed" }, 500);
  }

  const expected = await hmacHex(secret, `${parsedSig.t}.${rawBody}`);
  if (!timingSafeEqual(expected, parsedSig.v1)) return json({ error: "Invalid signature" }, 401);

  let payload: any;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Dedupe: same event type + payload id (or full-body hash as a fallback)
  // + timestamp. Signature verification already proves authenticity; this
  // only protects against Accounted's documented at-least-once retries
  // reprocessing a delivery we already handled.
  const payloadId = payload?.id || payload?.invoice?.id || payload?.data?.id || "";
  const dedupeKey = await hashHex(`${eventType}:${payloadId}:${parsedSig.t}:${rawBody.length}`);

  const { error: logErr } = await adminClient.from("vihem_accounted_webhook_events").insert({
    organisation_id: subscription.organisation_id,
    company_link_id: companyLinkId,
    subscription_id: subscription.id,
    event_type: eventType,
    dedupe_key: dedupeKey,
    payload,
    status: "received",
  });

  if (logErr) {
    // Unique violation on (company_link_id, dedupe_key) means we've already
    // processed this exact delivery: acknowledge and stop, do not reprocess.
    if (logErr.code === "23505") return json({ received: true, duplicate: true });
    console.error("vihem-accounted-webhook: failed to log delivery", logErr);
    // Still attempt processing below: logging failure shouldn't block a
    // legitimate, newly-verified event from updating the read model.
  }

  await adminClient
    .from("vihem_accounted_webhook_subscriptions")
    .update({ last_delivery_at: new Date().toISOString() })
    .eq("id", subscription.id);

  try {
    await processEvent(adminClient, companyLinkId, eventType, payload);
    await adminClient
      .from("vihem_accounted_webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("company_link_id", companyLinkId)
      .eq("dedupe_key", dedupeKey);
  } catch (err) {
    console.error("vihem-accounted-webhook: processing failed", err);
    await adminClient
      .from("vihem_accounted_webhook_events")
      .update({ status: "failed", error_message: err instanceof Error ? err.message : String(err) })
      .eq("company_link_id", companyLinkId)
      .eq("dedupe_key", dedupeKey);
    // Still return 200: we've durably logged the delivery for reconciliation
    // and returning a 5xx here would just cause Accounted to retry a payload
    // we can already see failed for a local reason (e.g. no matching link).
  }

  return json({ received: true });
});

async function processEvent(adminClient: any, companyLinkId: string, eventType: string, payload: any) {
  if (eventType.startsWith("invoice.") || eventType === "credit_note.created") {
    const invoice = payload?.invoice || payload;
    const accountedInvoiceId = invoice?.id;
    if (!accountedInvoiceId) return;

    // Update every local row pointing at this Accounted invoice, not just
    // one: (company_link_id, accounted_invoice_id) is deliberately NOT
    // unique (see 20260821140000_accounted_v2_invoice_link_many_sources.sql)
    // so that a future collection/merge invoice can have several VI-HEM
    // sources sharing one Accounted invoice id, all needing the same status
    // refresh. An invoice.* event for an id with zero local rows means it
    // wasn't created via Finance V2 (e.g. entered directly in Accounted) --
    // we deliberately do not fabricate a source_type/source_id for it.
    await adminClient
      .from("vihem_accounted_invoice_links")
      .update({
        accounted_invoice_number: invoice.invoice_number ?? undefined,
        status: invoice.status ?? undefined,
        total: invoice.total ?? undefined,
        remaining_amount: invoice.remaining_amount ?? undefined,
        paid_at: invoice.paid_at ?? undefined,
        last_sync_source: "webhook",
        last_synced_at: new Date().toISOString(),
      })
      .eq("company_link_id", companyLinkId)
      .eq("accounted_invoice_id", accountedInvoiceId);
  }
}
