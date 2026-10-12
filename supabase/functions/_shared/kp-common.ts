// Delat stöd för Kompetensportalens Edge Functions: organisation ur Origin, användare ur JWT, felmappning, kryptering av personnummer.
import { text as clean, UUID as UUID_RE } from "./rental-common.ts";
export { allow, clientIp, fingerprint, UUID, EMAIL } from "./rental-common.ts";
export const text = clean;

export const KP_CORS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Vary": "Origin",
  "Cache-Control": "no-store",
};

export interface KpContext { organisationId: string; settings: Record<string, any>; baseUrl: string }
const ctxCache = new Map<string, { at: number; ctx: KpContext | null }>();

const hostOf = (value: string) => { try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };

/** Organisationen avgörs av Origin-värdens domän (public_base_url i inställningarna) – aldrig av klientens body. */
export async function kpContext(admin: any, request: Request, allowHostParam = false): Promise<KpContext | null> {
  const origin = request.headers.get("origin") || "";
  let host = hostOf(origin);
  if (!host && allowHostParam && request.method === "GET") host = hostOf(new URL(request.url).searchParams.get("hostname") || "");
  if (!host) return null;
  const hit = ctxCache.get(host);
  if (hit && Date.now() - hit.at < 30_000) return hit.ctx;
  const { data } = await admin.from("vihem_kp_settings").select("*").limit(50);
  const row = (data ?? []).find((s: any) => hostOf(s.public_base_url) === host);
  let ctx: KpContext | null = null;
  if (row) {
    const { data: mod } = await admin.from("vihem_organisation_modules").select("enabled").eq("organisation_id", row.organisation_id).eq("module_key", "kompetensportalen").maybeSingle();
    if (mod?.enabled) ctx = { organisationId: row.organisation_id, settings: row, baseUrl: String(row.public_base_url).replace(/\/$/, "") };
  }
  ctxCache.set(host, { at: Date.now(), ctx });
  return ctx;
}

export function corsFor(request: Request, ctx: KpContext | null) {
  const origin = request.headers.get("origin") || "";
  return { ...KP_CORS, ...(ctx && origin && hostOf(origin) === hostOf(ctx.baseUrl) ? { "Access-Control-Allow-Origin": origin } : {}) };
}

export async function userFromRequest(admin: any, request: Request): Promise<{ id: string; email: string; meta: Record<string, any> } | null> {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.email) return null;
  return { id: data.user.id, email: String(data.user.email).toLowerCase(), meta: data.user.user_metadata || {} };
}

/** Skapar/uppdaterar deltagarposten för en inloggad användare och löser in väntande platser som tilldelats e-postadressen. */
export async function ensureParticipant(admin: any, ctx: KpContext, user: { id: string; email: string; meta: Record<string, any> }) {
  const { data: existing } = await admin.from("vihem_kp_participants").select("*").eq("user_id", user.id).maybeSingle();
  let participant = existing;
  if (!existing) {
    const full = String(user.meta.full_name || "").trim();
    const first = String(user.meta.first_name || full.split(" ")[0] || "").slice(0, 120);
    const last = String(user.meta.last_name || full.split(" ").slice(1).join(" ") || "").slice(0, 120);
    const { data } = await admin.from("vihem_kp_participants").insert({ user_id: user.id, organisation_id: ctx.organisationId, email: user.email, first_name: first, last_name: last }).select("*").single();
    participant = data;
  }
  // Lös in platser som tilldelats e-postadressen innan kontot fanns, och aktivera företagsmedlemskap
  const { data: pending } = await admin.from("vihem_kp_seats").select("id").eq("organisation_id", ctx.organisationId).is("assigned_to_user_id", null).ilike("assigned_email", user.email).in("status", ["assigned"]);
  for (const seat of pending ?? []) await admin.rpc("vihem_kp_assign_seat_internal", { p_seat: seat.id, p_user: user.id, p_email: null, p_actor: null });
  await admin.from("vihem_kp_company_members").update({ user_id: user.id, status: "active", joined_at: new Date().toISOString() }).eq("organisation_id", ctx.organisationId).ilike("email", user.email).eq("status", "invited");
  return participant;
}

// Felkoder i databasen: "[E_KOD] text". Bara kända koder släpps igenom till klienten.
const STATUS: Record<string, number> = {
  E_EMPTY: 400, E_TOO_MANY: 400, E_ITEM: 400, E_CODE: 400, E_PRODUCT: 404, E_CONFIG: 503, E_CUSTOMER: 403, E_INVOICE: 403, E_FULL: 409, E_SESSION: 409, E_NOT_FOUND: 404, E_STATE: 409, E_FORBIDDEN: 403,
  E_ACCESS: 403, E_LOCKED: 403, E_RULE: 400, E_TOO_FAST: 429, E_PREREQ: 409, E_IDENTITY: 403, E_ATTEMPTS: 403, E_COOLDOWN: 429, E_CLOSED: 409, E_INVALID: 400, E_CANCEL_CLOSED: 409, E_VERSION_LOCKED: 409,
};
export function mapKpError(error: unknown): { status: number; code: string; message: string } {
  const raw = String((error as any)?.message ?? error ?? "");
  const match = raw.match(/\[(E_[A-Z_]+)\]\s*(.*)$/s);
  if (match && STATUS[match[1]]) return { status: STATUS[match[1]], code: match[1], message: match[2].trim() || "Förfrågan kunde inte genomföras." };
  console.error("kp unexpected error:", raw.slice(0, 500));
  return { status: 500, code: "E_INTERNAL", message: "Något gick fel. Försök igen om en stund." };
}

// ---- Kryptering av personnummer (AES-GCM). Kräver särskild nyckel VIHEM_KP_SECRET_KEY – utan den sparas inget. ----
async function aesKey(usage: "encrypt" | "decrypt") {
  const material = Deno.env.get("VIHEM_KP_SECRET_KEY") || "";
  if (!material) throw new Error("[E_CONFIG] Krypteringsnyckel för personuppgifter saknas på servern.");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`vihem-kp-v1:${material}`));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, [usage]);
}
export async function encryptPii(plain: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) }, await aesKey("encrypt"), new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + cipher.length); out.set(iv); out.set(cipher, iv.length);
  return btoa(String.fromCharCode(...out));
}
export async function decryptPii(value: string, context: string): Promise<string> {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(context) }, await aesKey("decrypt"), bytes.slice(12)));
}

/** Giltigt svenskt personnummer (10 eller 12 siffror, Luhn). Returnerar normaliserat 12-siffrigt format eller null. */
export function normalisePersonalNumber(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let full = digits;
  if (digits.length === 10) { const yy = Number(digits.slice(0, 2)); const century = yy > new Date().getFullYear() % 100 ? 19 : 20; full = `${century}${digits}`; }
  if (full.length !== 12) return null;
  const ten = full.slice(2);
  let sum = 0;
  for (let i = 0; i < 10; i++) { let n = Number(ten[i]) * (i % 2 === 0 ? 2 : 1); if (n > 9) n -= 9; sum += n; }
  if (sum % 10 !== 0) return null;
  const month = Number(full.slice(4, 6)), day = Number(full.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || (day > 31 && day < 61) || day > 91) return null;
  return full;
}

export const money = (v: number | string) => new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
export const isUuid = (v: unknown) => typeof v === "string" && UUID_RE.test(v);

export async function notifyStaff(admin: any, orgId: string, title: string, message: string, link = "kompetensportalen") {
  try {
    const { data: staff } = await admin.from("vihem_profiles").select("id").eq("organisation_id", orgId).in("role", ["staff", "admin"]).eq("active", true);
    for (const p of staff ?? []) {
      const { error } = await admin.rpc("create_notification", { recipient_id: p.id, org_uuid: orgId, notification_title: title, notification_message: message, notification_type: "info", notification_link: link, setting_key: null });
      if (error) console.error("create_notification:", error.message);
    }
  } catch (e) { console.error("notifyStaff:", e instanceof Error ? e.message : e); }
}

/** Köar mejl via databasmallarna (idempotent per nyckel). */
export async function queueMail(admin: any, orgId: string, key: string, to: string, name: string, vars: Record<string, string>, idem: string, relatedType?: string, relatedId?: string, attachment?: unknown) {
  const { error } = await admin.rpc("vihem_kp_queue_email", { p_org: orgId, p_key: key, p_to: to, p_name: name, p_vars: vars, p_idem: idem, p_related_type: relatedType ?? null, p_related_id: relatedId ?? null, p_attachment: attachment ?? null });
  if (error) console.error("queue_email:", error.message);
}
