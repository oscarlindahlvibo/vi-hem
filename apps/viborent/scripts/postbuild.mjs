// Körs efter vite build: skriver sitemap.xml med startsida, katalog och alla publika produkter (hämtas från publika API:t).
// Misslyckas hämtningen byggs ändå en grundläggande sitemap så att publiceringen aldrig blockeras.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const site = (process.env.VITE_RENTAL_SITE_URL || 'https://viborent.se').replace(/\/$/, '');
const host = new URL(site).hostname;
const api = (process.env.VITE_PUBLIC_RENTAL_API_URL || (process.env.VITE_SUPABASE_URL ? `${process.env.VITE_SUPABASE_URL}/functions/v1/vihem-public-rental` : '')).replace(/\/$/, '');
const dist = path.resolve('dist');
if (!existsSync(dist)) mkdirSync(dist, { recursive: true });

let slugs = [];
if (api) {
  try {
    const headers = process.env.VITE_SUPABASE_ANON_KEY ? { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}` } : {};
    const response = await fetch(`${api}?action=products&hostname=${host}`, { headers, signal: AbortSignal.timeout(15000) });
    if (response.ok) slugs = ((await response.json()).products || []).map((p) => p.slug).filter(Boolean);
    else console.warn(`sitemap: API svarade ${response.status}, bygger utan produkter`);
  } catch (error) { console.warn('sitemap: kunde inte hämta produkter:', error.message); }
}
const urls = ['/', '/hyra', ...slugs.map((s) => `/hyra/${encodeURIComponent(s)}`)];
const today = new Date().toISOString().slice(0, 10);
writeFileSync(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${site}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
console.log(`sitemap.xml: ${urls.length} adresser`);
