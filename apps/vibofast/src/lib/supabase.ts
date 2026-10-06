import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}) : null;
export const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';
export async function submitEnquiry(kind: 'contact' | 'interest', payload: Record<string, string>) {
  if (!supabase || demoMode) throw new Error('Formuläret är inte anslutet ännu. Kontakta oss via telefon eller e-post.');
  const { error } = await supabase.functions.invoke('vihem-vibofast-enquiry', { body: { kind, payload } });
  if (error) throw new Error('Det gick inte att skicka. Försök igen eller kontakta oss via telefon eller e-post.');
}
