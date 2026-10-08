// Allt går mot Vi-hems publika Supabase: innehåll via RPC, pris/bokning/betalning via edge-funktionen (priser räknas alltid på servern).
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export interface Company { name: string; tagline: string; address: string; postalCode: string; city: string; phone: string; email: string; checkInInfo: string }
export interface Faq { category: string; question: string; answer: string }
export interface UnitListing {
  id: string; maxGuests: number; title: string; slug: string; kind: 'room' | 'apartment'; shortDescription: string; description: string;
  features: string[]; images: { url: string; alt: string }[]; beds: string;
}
export interface SiteSettings { bookingEnabled: boolean; discountPercent: number; freeCancelDays: number; minNights: number; maxNights: number; checkInTime: string; checkOutTime: string }
export interface PublicSite {
  content: { company: Company; text: Record<string, string>; faq: Faq[]; images?: Record<string, string> };
  settings: SiteSettings;
  units: UnitListing[];
}
export interface Quote {
  unitId: string; title: string; maxGuests: number; subtotal: number; losPercent: number; losAmount: number; baseTotal: number;
  directDiscountPercent: number; directDiscount: number; total: number; avgPerNight: number;
}
export interface Availability { nights: number; start: string; end: string; guests: number; checkInTime: string; checkOutTime: string; freeCancelDays: number; units: Quote[] }
export interface BookingView {
  reference: string; status: 'pending' | 'paid' | 'expired' | 'cancelled' | 'refunded' | 'conflict'; unit: string; start: string; end: string;
  guests: number; name: string; total: number; currency: string; freeCancelUntil: string | null; canCancel: boolean; checkInTime: string; checkOutTime: string;
}

export const configured = Boolean(url && key);

async function request<T>(path: string, init: RequestInit): Promise<T> {
  if (!url || !key) throw new Error('Hemsidan är inte kopplad till bokningssystemet ännu.');
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message;
    throw new Error(typeof message === 'string' ? message : 'Något gick fel. Försök igen om en stund.');
  }
  return payload as T;
}

export const loadSite = () => request<PublicSite>('/rest/v1/rpc/vihem_ekangen_public_site', { method: 'POST', body: '{}' });

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const result = await request<{ data: T }>('/functions/v1/vihem-ekangen-booking', { method: 'POST', body: JSON.stringify(body) });
  return result.data;
}
export const checkAvailability = (start: string, end: string, guests: number) => call<Availability>({ action: 'availability', start, end, guests });
export const startCheckout = (body: Record<string, unknown>) => call<{ checkout_url: string; reference: string }>({ action: 'checkout', ...body, return_url: window.location.origin });
export const getBooking = (reference: string, token: string) => call<BookingView>({ action: 'booking', reference, token });
export const cancelBooking = (reference: string, token: string) => call<BookingView>({ action: 'cancel', reference, token });

export const kr = (value: number) => `${Math.round(value).toLocaleString('sv-SE')} kr`;
export const todayIso = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date());
export const addDaysIso = (iso: string, days: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const nightsBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000));
export const fmtDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
