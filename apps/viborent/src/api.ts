export type Product = {
  id: string; name: string; slug: string; description: string; short_description: string;
  category: string; images: string[]; deposit: number; vat_rate: number | null;
  minimum_duration: number; maximum_duration: number | null; pickup_instructions: string;
  return_instructions: string; location: string; seo_title: string; seo_description: string;
};

export type SiteConfig = {
  site_name: string; organisation_name: string; currency: string;
  customer_support_email: string; customer_support_phone: string; terms_url: string; privacy_url: string;
};

const baseUrl = (import.meta.env.VITE_PUBLIC_RENTAL_API_URL || `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vihem-public-rental`).replace(/\/$/, '');
const hostname = import.meta.env.VITE_RENTAL_SITE_HOSTNAME || window.location.hostname;

async function request<T>(action: string, init: RequestInit = {}, query: Record<string, string> = {}): Promise<T> {
  const url = new URL(baseUrl);
  url.searchParams.set('action', action);
  url.searchParams.set('hostname', hostname);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Det gick inte att kontakta ViboRent.');
  return body as T;
}

export const rentalApi = {
  siteConfig: () => request<{ site: SiteConfig }>('site-config'),
  products: () => request<{ products: Product[] }>('products'),
  product: (slug: string) => request<{ products: Product[] }>('product', {}, { slug }),
  availability: (slug: string, startAt: string, endAt: string) => request<{ available: boolean }>('availability', {}, { slug, start_at: startAt, end_at: endAt }),
  quote: (slug: string, startAt: string, endAt: string, quantity = 1) => request<{ quote: { subtotal: number; vat_amount: number; deposit: number; total: number; currency: string } }>('quote', { method: 'POST', body: JSON.stringify({ slug, start_at: startAt, end_at: endAt, quantity }) }),
  createBooking: (payload: unknown) => request<{ booking: { id: string; public_reference: string; public_lookup_token: string; quote: Record<string, number | string> }; }>('bookings', { method: 'POST', body: JSON.stringify(payload) }),
  booking: (reference: string, token: string) => request<{ booking: any }>('booking', {}, { reference, token }),
  startPayment: async (bookingId: string, successUrl: string, cancelUrl: string) => {
    const paymentUrl = baseUrl.replace(/vihem-public-rental$/, 'vihem-rental-stripe');
    const response = await fetch(paymentUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_checkout', booking_id: bookingId, success_url: successUrl, cancel_url: cancelUrl }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Betalningen kunde inte startas.');
    return body as { checkout_url: string };
  },
};
