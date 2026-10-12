// Delat stöd för ViboRent-funktionerna: CORS mot registrerade domäner, organisation härledd från Origin, säkra felmeddelanden,
// hastighetsbegränsning (HMAC-fingeravtryck, aldrig rå IP) och kryptering av hemligheter (AES-GCM).

export const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normaliseHost = (value: unknown) => text(value, 255).toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(":")[0].replace(/^www\./, "");

export function hostFromOrigin(request: Request): string {
  const origin = request.headers.get("origin") || "";
  try { return origin ? normaliseHost(new URL(origin).hostname) : ""; } catch { return ""; }
}

/** Organisation för en registrerad, aktiv domän. Returnerar null om domänen inte är registrerad. */
export async function organisationForHost(admin: any, host: string): Promise<string | null> {
  if (!host) return null;
  const { data } = await admin.from("vihem_rental_domains").select("organisation_id").eq("hostname", host).eq("active", true).maybeSingle();
  return data?.organisation_id ?? null;
}

/** Alla aktiva domäner (apex + www) för en organisation – används för att validera retur-URL:er och CORS. */
export async function hostsForOrganisation(admin: any, organisationId: string): Promise<Set<string>> {
  const { data } = await admin.from("vihem_rental_domains").select("hostname").eq("organisation_id", organisationId).eq("active", true);
  const set = new Set<string>();
  for (const row of data ?? []) { const h = normaliseHost(row.hostname); set.add(h); set.add(`www.${h}`); }
  return set;
}

export function corsHeaders(origin: string, allowed: boolean, methods = "GET, POST, OPTIONS") {
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
  };
  if (allowed && origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

// Felkoder i databasen har formen "[E_KOD] Text för kunden". Bara kända koder släpps igenom; allt annat blir ett generellt fel.
const STATUS: Record<string, number> = {
  E_EMPTY: 400, E_TOO_MANY: 400, E_STATUS: 400, E_ITEM: 400, E_PERIOD: 400, E_PAST: 400, E_ADVANCE: 400, E_ADVANCE_MAX: 400,
  E_MIN_DURATION: 400, E_MAX_DURATION: 400, E_PRODUCT: 404, E_ORG: 400, E_NO_PRICE: 422, E_UNAVAILABLE: 409, E_SHORT_NOTICE: 409,
  E_DISABLED: 403, E_FORBIDDEN: 403, E_NOT_FOUND: 404, E_STATE: 409, E_CANCEL_CLOSED: 409, E_ACTOR: 400,
};
export function mapDbError(error: unknown): { status: number; code: string; message: string } {
  const raw = String((error as any)?.message ?? error ?? "");
  const match = raw.match(/\[(E_[A-Z_]+)\]\s*(.*)$/s);
  if (match && STATUS[match[1]]) return { status: STATUS[match[1]], code: match[1], message: match[2].trim() || "Förfrågan kunde inte genomföras." };
  console.error("rental unexpected error:", raw.slice(0, 500));
  return { status: 500, code: "E_INTERNAL", message: "Något gick fel. Försök igen om en stund." };
}

export async function fingerprint(identity: string): Promise<string> {
  const secret = Deno.env.get("VIBOFAST_RATE_LIMIT_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(identity));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const clientIp = (request: Request) => (request.headers.get("x-real-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0] || "").trim();

/** true = tillåtet. Vid fel i begränsaren släpps anropet igenom (hellre tillgänglig än låst) men felet loggas. */
export async function allow(admin: any, request: Request, bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const key = `${bucket}:${await fingerprint(clientIp(request) || "unknown")}`;
    const { data, error } = await admin.rpc("vihem_rental_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
    if (error) { console.error("rate limit rpc:", error.message); return true; }
    return data !== false;
  } catch (error) { console.error("rate limit:", error instanceof Error ? error.message : error); return true; }
}

// ---- Kryptering av hemligheter (lås-PIN, igloohome-nycklar). Nyckeln härleds ur serverns hemlighet och binds till en kontext. ----
function secretMaterial() {
  return Deno.env.get("VIHEM_RENTAL_SECRET_KEY") || Deno.env.get("VIHEM_CELLSYNT_SECRET_KEY") || Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
async function aesKey(usage: "encrypt" | "decrypt") {
  const material = secretMaterial();
  if (!material) throw new Error("Serverns krypteringsnyckel saknas.");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`vihem-rental-v1:${material}`));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, [usage]);
}
export async function encryptSecret(plain: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) }, await aesKey("encrypt"), new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + cipher.length); out.set(iv); out.set(cipher, iv.length);
  return btoa(String.fromCharCode(...out));
}
export async function decryptSecret(value: string, context: string): Promise<string> {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(context) }, await aesKey("decrypt"), bytes.slice(12));
  return new TextDecoder().decode(plain);
}

/** Maskerar PIN-liknande tal i text som ska loggas. */
export const maskPins = (value: string) => value.replace(/\b\d{4,10}\b/g, "••••");
