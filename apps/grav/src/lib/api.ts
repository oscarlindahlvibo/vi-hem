// Allt mot Vi-hems publika Supabase: innehåll via RPC, offertförfrågan via edge-funktionen (ingen hemlig nyckel i sajten).
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export interface Company { name: string; tagline: string; phone: string; email: string; city: string; address: string; postalCode: string; orgNumber: string; openingHours: string; serviceArea: string }
export interface Service { title: string; description: string; icon?: string }
export interface Faq { question: string; answer: string }
export interface PublicSite {
  content: {
    company: Company; text: Record<string, string>; services: Service[]; faq: Faq[];
    images?: { hero?: string; about?: string; gallery?: { url: string; alt: string }[] };
  };
  settings: { formEnabled: boolean };
}
export const configured = Boolean(url && key);

async function request<T>(path: string, init: RequestInit): Promise<T> {
  if (!url || !key) throw new Error('Hemsidan är inte kopplad till systemet ännu.');
  const response = await fetch(`${url}${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : payload?.message || 'Något gick fel. Försök igen om en stund.');
  return payload as T;
}

export const loadSite = () => request<PublicSite>('/rest/v1/rpc/vihem_grav_public_site', { method: 'POST', body: '{}' });

export interface QuoteInput { name: string; email: string; phone: string; location: string; service: string; message: string; preferred_time: string; consent: boolean; website: string; elapsed_ms: number; images: { type: string; data: string }[] }
export const submitQuote = (input: QuoteInput) => request<{ data: { reference: string } }>('/functions/v1/vihem-grav-quote', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.data.reference);

export const telHref = (phone: string) => 'tel:' + phone.replace(/[^\d+]/g, '').replace(/^0/, '+46');
