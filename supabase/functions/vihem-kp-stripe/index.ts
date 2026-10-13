// Stripe-webhook för Kompetensportalen. ENDA vägen till åtkomst för kortköp: signatur verifieras här, själva hanteringen ligger i _shared/kp-webhook.ts
// (belopp/valuta/order kontrolleras, händelser dedupliceras, betalningar och återbetalningar registreras idempotent av databasfunktioner).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifySignature } from "../_shared/kp-stripe.ts";
import { handleStripeEvent } from "../_shared/kp-webhook.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const raw = await request.text();
  if (!(await verifySignature(raw, request.headers.get("stripe-signature")))) return json(400, { error: "Ogiltig signatur." });
  let event: any; try { event = JSON.parse(raw); } catch { return json(400, { error: "Ogiltig JSON." }); }
  const result = await handleStripeEvent(admin, event);
  return json(result.status, result.body);
});
