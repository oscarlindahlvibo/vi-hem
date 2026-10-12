export type Product = {
  id: string; name: string; slug: string; description: string; short_description: string; category: string; images: string[];
  deposit: number; vat_rate: number | null; minimum_duration: number; maximum_duration: number | null;
  pickup_instructions: string; return_instructions: string; location: string; seo_title: string; seo_description: string;
  price_hint?: { daily: number | null; hourly: number | null }; stock?: number;
};

export type SiteConfig = {
  site_name: string; organisation_name: string; currency: string; customer_support_email: string; customer_support_phone: string;
  terms_url: string; privacy_url: string; timezone: string; minimum_advance_hours?: number; maximum_advance_days?: number;
  free_cancellation_minutes: number; access_dispatch_minutes: number; booking_hold_minutes: number; access_enabled?: boolean;
  contract_version?: { id: string; version: number; title: string } | null;
};

export type CalendarData = {
  product: { id: string; name: string; slug: string };
  capacity: number; buffer_minutes: number;
  assets: Array<{ n: number; busy: Array<[string, string]> }>;
  blocked: Array<[string, string]>;
};

export type QuoteLine = { rule_id?: string; rule_type: string; count: number; unit_price: number; unit_hours?: number; line_total: number };
export type RentalQuote = {
  subtotal: number; vat_amount: number; deposit: number; total: number; currency: string; vat_rate?: number; hours?: number;
  rules?: QuoteLine[]; available?: boolean; short_notice?: boolean;
};
export type CartQuote = RentalQuote & { lines: Array<{ product_id: string; product_name: string; quantity: number; start_at: string; end_at: string; quote: RentalQuote; available: boolean; free_count: number }>; };

export type BookingView = {
  id: string; public_reference: string; status: string; payment_status: string; contract_status: string; contract_signer_name?: string; contract_signed_at?: string;
  contract_terms_snapshot?: string; start_at: string; end_at: string; subtotal: number; vat_amount: number; deposit: number; total: number; currency: string;
  customer_notes?: string; hold_expires_at: string | null; short_notice: boolean; cancelled_at: string | null; refund_status: string; refund_amount: number;
  customer?: { first_name: string; last_name: string; email: string; phone: string };
  items: Array<{ quantity: number; start_at: string; end_at: string; product: { name: string; slug: string; pickup_instructions: string; return_instructions: string; location: string } }>;
  can_cancel: boolean; cancel_until: string;
  access: { scheduled_for: string | null; sent: boolean; failed: boolean } | null;
};

export class ApiError extends Error { constructor(message: string, public code = "", public status = 0) { super(message); } }

const baseUrl = (import.meta.env.VITE_PUBLIC_RENTAL_API_URL || `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vihem-public-rental`).replace(/\/$/, "");
const paymentUrl = baseUrl.replace(/vihem-public-rental$/, "vihem-rental-stripe");
const devHostname = import.meta.env.VITE_RENTAL_SITE_HOSTNAME || "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {}), ...(init.headers || {}) } });
  } catch {
    throw new ApiError("Det gick inte att nå servern. Kontrollera anslutningen och försök igen.", "E_NETWORK");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || "Något gick fel. Försök igen.", body.code || "", response.status);
  return body as T;
}

function request<T>(action: string, init: RequestInit = {}, query: Record<string, string> = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set("action", action);
  if (devHostname) url.searchParams.set("hostname", devHostname);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  return call<T>(url.toString(), init);
}
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const rentalApi = {
  siteConfig: () => request<{ site: SiteConfig }>("site-config"),
  contract: () => request<{ contract: { version: number; title: string; body: string } }>("contract"),
  products: () => request<{ products: Product[] }>("products"),
  availability: (slug: string, startAt: string, endAt: string) => request<{ available: boolean; free_count: number; period_error: string | null }>("availability", {}, { slug, start_at: startAt, end_at: endAt }),
  calendar: (slug: string, from: string, to: string) => request<CalendarData>("availability-calendar", {}, { slug, from, to }),
  quote: (slug: string, startAt: string, endAt: string, quantity = 1) => request<{ quote: RentalQuote }>("quote", post({ slug, start_at: startAt, end_at: endAt, quantity })),
  quoteCart: (items: Array<{ product_id: string; quantity: number; start_at: string; end_at: string }>) => request<{ quote: CartQuote }>("quote-cart", post({ items })),
  createBooking: (payload: unknown) => request<{ booking: { id: string; public_reference: string; public_lookup_token: string; short_notice: boolean; hold_expires_at: string | null; quote: Record<string, number | string> } }>("bookings", post(payload)),
  signContract: (payload: { booking_id: string; public_lookup_token: string; signer_name: string; signature: string; accepted_terms: boolean }) => request<{ booking: { id: string; contract_status: string } }>("sign-contract", post(payload)),
  booking: (reference: string, token: string) => request<{ booking: BookingView }>("booking", {}, { reference, token }),
  cancelBooking: (bookingId: string, token: string, reason?: string) => request<{ ok: boolean; refund_amount: number; refund_status: string }>("cancel-booking", post({ booking_id: bookingId, public_lookup_token: token, reason })),
  startPayment: (bookingId: string, token: string, successUrl: string, cancelUrl: string) => call<{ checkout_url: string }>(paymentUrl, post({ action: "create_checkout", booking_id: bookingId, public_lookup_token: token, success_url: successUrl, cancel_url: cancelUrl })),
};
