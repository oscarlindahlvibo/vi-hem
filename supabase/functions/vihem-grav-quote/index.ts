// Publikt offertformulär för gavirserum.se (verify_jwt = false, se config.toml).
// Tar emot en förfrågan (+ valfria bilder), validerar strikt, sparar den i VI-HEM (privat schema) och notifierar admins.
// Skydd: origin-lista, honeypot + minsta ifyllnadstid, storleks-/typkontroll av bilder (magic bytes), IP-baserad hastighetsbegränsning
// (HMAC-fingeravtryck, aldrig rå IP) i databasen. Inget i svaret avslöjar interna uppgifter.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendGmailMessage } from "../_shared/google-workspace-mailer.ts";

const ORIGINS = new Set((Deno.env.get("GRAV_ALLOWED_ORIGINS") ?? "https://gavirserum.se,https://www.gavirserum.se").split(",").map((s) => s.trim()).filter(Boolean));
const MAX_BODY = 8_000_000;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1_500_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const cors = (origin: string) => ({
  "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://gavirserum.se",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
});

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
function reference() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return "GA-" + [...crypto.getRandomValues(new Uint8Array(6))].map((b) => a[b % a.length]).join("");
}
function sniff(bytes: Uint8Array): { type: string; ext: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: "image/png", ext: "png" };
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { type: "image/webp", ext: "webp" };
  return null;
}
async function fingerprint(secret: string, identity: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(identity));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  const headers = cors(origin);
  const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
  if (!ORIGINS.has(origin)) return reply(403, { error: "Forbidden" });

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return reply(413, { error: "Förfrågan är för stor. Skicka färre eller mindre bilder." });
    const body = JSON.parse(raw);

    const name = clean(body.name, 120), email = clean(body.email, 200).toLowerCase(), phone = clean(body.phone, 40);
    const location = clean(body.location, 200), service = clean(body.service, 100), message = clean(body.message, 4000);
    const preferred = clean(body.preferred_time, 60);
    if (name.length < 2 || !EMAIL.test(email) || phone.length < 5 || message.length < 10 || location.length < 2) {
      return reply(400, { error: "Fyll i namn, e-post, telefon, plats och en beskrivning av jobbet." });
    }
    if (body.consent !== true) return reply(400, { error: "Du behöver godkänna hanteringen av dina uppgifter." });

    // Bottar: honeypot ifyllt eller formuläret skickat orimligt snabbt -> låtsas lyckas utan att spara.
    if (clean(body.website, 200) || !(Number(body.elapsed_ms) >= 3000)) return reply(201, { data: { reference: "GA-OK" } });

    const secret = Deno.env.get("VIBOFAST_RATE_LIMIT_SECRET");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    if (!secret) return reply(503, { error: "Formuläret är inte konfigurerat ännu." });
    const { data: ctx } = await admin.rpc("vihem_grav_service_context");
    if (!ctx) return reply(503, { error: "Formuläret är inte konfigurerat ännu." });
    if (!ctx.settings.form_enabled) return reply(503, { error: "Offertformuläret är tillfälligt stängt. Ring oss gärna." });

    const ip = (req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "").trim();
    const fp = await fingerprint(secret, ip || email);

    const ref = reference();
    const imagesIn = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
    const stored: { path: string; type: string; size: number }[] = [];
    try {
      for (let i = 0; i < imagesIn.length; i++) {
        const b64 = clean((imagesIn[i] as any)?.data, MAX_IMAGE_BYTES * 2);
        if (!b64) continue;
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        if (bytes.length > MAX_IMAGE_BYTES) return reply(413, { error: "En bild är för stor (högst 1,5 MB efter förminskning)." });
        const kind = sniff(bytes);
        if (!kind) return reply(400, { error: "Bifoga bara bilder i formaten JPG, PNG eller WebP." });
        const path = `${ref}/${i + 1}.${kind.ext}`;
        const { error } = await admin.storage.from("vihem-grav-requests").upload(path, bytes, { contentType: kind.type, upsert: false });
        if (error) throw error;
        stored.push({ path, type: kind.type, size: bytes.length });
      }

      const { error: storeError } = await admin.rpc("vihem_grav_store_request", {
        p_reference: ref, p_name: name, p_email: email, p_phone: phone, p_location: location, p_service: service, p_message: message,
        p_preferred_time: preferred, p_images: stored, p_fingerprint: fp,
      });
      if (storeError) throw storeError;
    } catch (error) {
      if (stored.length) await admin.storage.from("vihem-grav-requests").remove(stored.map((s) => s.path));
      const msg = error instanceof Error ? error.message : (error as any)?.message || "";
      if (String(msg).includes("Rate limit")) return reply(429, { error: "Du har skickat flera förfrågningar nyligen. Försök igen om en stund eller ring oss." });
      console.error("vihem-grav-quote store:", msg);
      return reply(500, { error: "Det gick inte att skicka förfrågan just nu. Försök igen eller ring oss." });
    }

    // Notifieringar får aldrig få själva inlämningen att misslyckas.
    const summary = `${name} (${phone}, ${email})\nPlats: ${location}\nTyp: ${service || "-"}\nÖnskad tid: ${preferred || "-"}\nBilder: ${stored.length}\n\n${message}`;
    try {
      const { data: admins } = await admin.from("vihem_profiles").select("id").eq("organisation_id", ctx.organisation_id).in("role", ["admin", "superadmin"]).eq("active", true);
      for (const a of admins ?? []) {
        await admin.rpc("create_notification", {
          recipient_id: a.id, org_uuid: ctx.organisation_id, notification_title: "Ny offertförfrågan",
          notification_message: `${name} – ${service || "förfrågan"} i ${location} (${ref}).`, notification_type: "info", notification_link: "grav-website",
        });
      }
    } catch (error) { console.error("vihem-grav-quote notify:", error instanceof Error ? error.message : error); }

    const from = String(ctx.settings.sender_email || "").trim();
    if (from) {
      const mail = async (to: string, subject: string, text: string) => {
        try { await sendGmailMessage(admin, ctx.organisation_id, { fromEmail: from, fromName: ctx.company_name, toEmail: to, subject, text }); }
        catch (error) { console.error("vihem-grav-quote mail:", error instanceof Error ? error.message : error); }
      };
      const notifyTo = String(ctx.settings.notification_email || "").trim();
      if (notifyTo) await mail(notifyTo, `Ny offertförfrågan ${ref}`, summary);
      if (ctx.settings.confirm_customer) {
        await mail(email, `Vi har tagit emot din förfrågan (${ref})`,
          `Hej ${name},\n\nTack för din förfrågan! Vi har tagit emot den och återkommer så snart vi kan.\n\nDin referens: ${ref}\n\nDet här skickade du:\n${message}\n\nVänliga hälsningar\n${ctx.company_name}`);
      }
    }

    return reply(201, { data: { reference: ref } });
  } catch (error) {
    console.error("vihem-grav-quote:", error instanceof Error ? error.message : error);
    return reply(400, { error: "Ogiltig förfrågan." });
  }
});
