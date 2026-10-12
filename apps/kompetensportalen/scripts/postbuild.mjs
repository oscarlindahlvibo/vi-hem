// Efter vite build: sitemap.xml med publika sidor och alla köpbara utbildningar (hämtas ur publika API:t; misslyckas hämtningen byggs grundsidorna ändå).
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const site = (process.env.VITE_KP_SITE_URL || 'https://kompetensportalen.se').replace(/\/$/, '');
const host = new URL(site).hostname;
const api = (process.env.VITE_KP_API_URL || (process.env.VITE_SUPABASE_URL ? `${process.env.VITE_SUPABASE_URL}/functions/v1/vihem-kp-public` : '')).replace(/\/$/, '');
const dist = path.resolve('dist'); if (!existsSync(dist)) mkdirSync(dist, { recursive: true });
let slugs = [];
if (api) {
  try {
    const headers = process.env.VITE_SUPABASE_ANON_KEY ? { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}` } : {};
    const r = await fetch(`${api}?action=catalog&hostname=${host}`, { headers, signal: AbortSignal.timeout(15000) });
    if (r.ok) slugs = ((await r.json()).courses || []).map((c) => c.slug).filter(Boolean); else console.warn(`sitemap: API svarade ${r.status}`);
  } catch (e) { console.warn('sitemap: kunde inte hämta kurser:', e.message); }
}
const urls = ['/', '/utbildningar', '/foretag', '/om-oss', '/vanliga-fragor', '/kontakt', '/verifiera', '/villkor', '/integritet', ...slugs.map((s) => `/utbildningar/${encodeURIComponent(s)}`)];
const today = new Date().toISOString().slice(0, 10);
writeFileSync(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${site}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
console.log(`sitemap.xml: ${urls.length} adresser`);
