import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
const fnBase = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
const devHost = import.meta.env.VITE_KP_SITE_HOSTNAME || "";

export class ApiError extends Error { constructor(message: string, public code = "", public status = 0) { super(message); } }

async function call<T>(fn: string, body?: unknown, query: Record<string, string> = {}, authed = false): Promise<T> {
  const url = new URL(`${fnBase}/${fn}`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  if (devHost) url.searchParams.set("hostname", devHost);
  let token = anon;
  if (authed) { const { data } = await supabase.auth.getSession(); if (data.session) token = data.session.access_token; }
  let response: Response;
  try {
    response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new ApiError("Det gick inte att nå servern. Kontrollera anslutningen och försök igen.", "E_NETWORK"); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || "Något gick fel. Försök igen.", data.code || "", response.status);
  return data as T;
}

export type Course = {
  id: string; slug: string; code: string; title: string; subtitle: string; summary: string; category: string; tags: string[]; delivery_form: "self_paced" | "instructor_led" | "hybrid"; language: string;
  estimated_minutes: number; validity_months: number | null; id06_enabled: boolean; certificate_kind: "training_certificate" | "competence_proof"; requires_identity_verification: boolean; image_url: string | null; og_image_url: string | null;
  product: { id: string; price: number; vat_rate: number } | null; next_session_at: string | null; session_count: number; status?: string;
  description?: string; objectives?: string[]; target_audience?: string; prerequisites?: string; exam_info?: string; seo_title?: string; seo_description?: string;
  outline?: Array<{ title: string; description: string; lessons: Array<{ title: string; kind: string; minutes: number }> }>;
  exam?: { title: string; question_count: number; pass_percent: number; time_limit_seconds: number | null; max_attempts: number | null } | null;
  sessions?: SessionInfo[];
};
export type SessionInfo = { id: string; course_id: string; title: string; starts_at: string; ends_at: string; timezone: string; location_kind: "physical" | "online"; location: string; capacity: number; seats_left: number; product_id: string | null; free_cancellation_hours: number };
export type Site = { seller_name: string; seller_org_number: string; seller_vat_number: string; seller_address: string; support_email: string; phone: string; invoice_enabled: boolean; stripe_enabled: boolean; withdrawal_notice: string; bankid_link?: boolean; bankid_login?: boolean };
export type QuoteLine = { product_id: string; name: string; quantity: number; list_price: number; unit_price: number; price_label: string; vat_rate: number; discount: number; net_total: number; vat_amount: number; line_total: number; session_id: string | null };
export type Quote = { lines: QuoteLine[]; subtotal: number; discount_total: number; vat_total: number; total: number; code_applied: boolean };
export type CartItemInput = { product_id: string; quantity: number; session_id?: string | null };

export const pub = {
  site: () => call<{ site: Site }>("vihem-kp-public", undefined, { action: "site" }),
  catalog: () => call<{ courses: Course[] }>("vihem-kp-public", undefined, { action: "catalog" }),
  course: (slug: string) => call<{ course: Course }>("vihem-kp-public", undefined, { action: "course", slug }),
  page: (slug: string) => call<{ page: { slug: string; kind: string; title: string; body: string; version: number; published_at: string } }>("vihem-kp-public", undefined, { action: "page", slug }),
  faq: () => call<{ faq: Array<{ category: string; question: string; answer: string }> }>("vihem-kp-public", undefined, { action: "faq" }),
  verify: (code: string) => call<any>("vihem-kp-public", undefined, { action: "verify", code }),
  quote: (items: CartItemInput[], code?: string, customerId?: string) => call<{ quote: Quote }>("vihem-kp-public", { action: "quote", items, code, customer_id: customerId }, {}, true),
  bankidStart: () => call<BankIdStart>("vihem-kp-public", { action: "bankid_start" }),
  bankidSignup: (p: { order_ref: string; email: string; accepted_privacy: boolean; consent_identity: boolean }) => call<{ ok: boolean; message: string }>("vihem-kp-public", { action: "bankid_signup", ...p }),
  bankidCollect: (orderRef: string) => call<BankIdResult>("vihem-kp-public", { action: "bankid_collect", order_ref: orderRef }),
  contact: (payload: unknown) => call<{ ok: boolean }>("vihem-kp-public", { action: "contact", ...(payload as object) }),
  register: (payload: unknown) => call<{ ok: boolean; message: string }>("vihem-kp-public", { action: "register", ...(payload as object) }),
  verifyEmail: (token: string) => call<{ ok: boolean }>("vihem-kp-public", { action: "verify_email", token }),
  resendVerification: (email: string) => call<{ ok: boolean; message: string }>("vihem-kp-public", { action: "resend_verification", email }),
  requestReset: (email: string) => call<{ ok: boolean; message: string }>("vihem-kp-public", { action: "request_reset", email }),
  resetPassword: (token: string, password: string) => call<{ ok: boolean }>("vihem-kp-public", { action: "reset_password", token, password }),
};
export const learn = <T = any>(action: string, body: Record<string, unknown> = {}) => call<T>("vihem-kp-learn", { action, ...body }, {}, true);
export const checkout = <T = any>(action: string, body: Record<string, unknown> = {}) => call<T>("vihem-kp-checkout", { action, ...body }, {}, true);

export type BankIdStart = { orderRef: string; autoStartToken: string; autoStartUrl: string; qrImage: string | null };
export type BankIdResult = { status: "pending" | "complete" | "failed"; hintCode?: string | null; login_ready?: boolean; token_hash?: string; verified?: boolean; error?: string; signup_available?: boolean; given_name?: string; surname?: string };
