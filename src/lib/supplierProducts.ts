import { registerPlugin } from '@capacitor/core';

const cleanText = (value: string) => Array.from(value).filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('').trim();

export type SupplierProduct = { name: string; sku: string; url: string; supplier: string };
export const supplierBrowser = registerPlugin<{ open(options: { url: string; script: string }): Promise<{ product?: unknown }> }>('SupplierBrowser');

export function validateSupplierProduct(value: unknown): SupplierProduct {
  const p = value as Record<string, unknown> | null;
  if (!p || typeof p.url !== 'string' || typeof p.name !== 'string') throw new Error('Öppna en produktsida och försök igen.');
  let url: URL;
  try { url = new URL(p.url); } catch { throw new Error('Ange en giltig produktlänk från någon av de valda butikerna.'); }
  const supplier = url.hostname === 'www.jula.se' && /^\/catalog\/.+-\d+\/$/.test(url.pathname) ? 'Jula'
    : url.hostname === 'www.biltema.se' && /-200\d{7}\/?$/.test(url.pathname) ? 'Biltema'
    : url.hostname === 'www.byggmax.se' && /^\/[^/]+-p\d+\/?$/.test(url.pathname) ? 'Byggmax'
    : url.hostname === 'www.bauhaus.se' && /^\/[a-z0-9]+(?:-[a-z0-9]+)+\/?$/.test(url.pathname) ? 'BAUHAUS'
    : url.hostname === 'www.jemfix.se' && /^\/[^/]+\/\d{4}\/\d{7}\/$/.test(url.pathname) ? 'jem & fix' : '';
  if (!supplier || url.protocol !== 'https:' || url.port || url.username || url.password) throw new Error('Välj en produkt hos någon av de valda butikerna.');
  const name = cleanText(p.name);
  if (!name || name.length > 300) throw new Error('Produkten saknar ett giltigt namn.');
  url.search = ''; url.hash = '';
  return { name, sku: typeof p.sku === 'string' ? cleanText(p.sku).slice(0, 80) : '', url: url.href, supplier };
}

// Read only public product markup after the user explicitly chooses the page.
// No website code is proxied into VI-HEM and no prices/descriptions/images copied.
export const productExtractionScript = `(() => {
  const title = document.querySelector('main h1')?.textContent?.trim() || document.querySelector('h1')?.textContent?.trim() || '';
  const products = [];
  function visit(value) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    if ([value['@type']].flat().includes('Product')) products.push(value);
    if (value['@graph']) visit(value['@graph']);
  }
  document.querySelectorAll('script[type="application/ld+json"]').forEach(el => { try { visit(JSON.parse(el.textContent)); } catch {} });
  const product = products.find(p => p.name?.trim() === title) || products.find(p => p.url === location.href);
  const text = document.querySelector('main')?.innerText || '';
  const sku = document.querySelector('meta[itemprop="sku"]')?.content || text.match(/(?:Artikelnr\\.?|Art\\.?\\s*nr\\.?|Artikelnummer)\\s*:?\\s*([0-9][0-9 -]{2,20})/i)?.[1]?.trim() || product?.sku || '';
  return { name: title || product?.name || '', sku: String(sku), url: location.href };
})()`;
