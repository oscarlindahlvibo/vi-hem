import { registerPlugin } from '@capacitor/core';

const cleanText = (value: string) => Array.from(value).filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('').trim();

export type SupplierProduct = { name: string; sku: string; url: string; supplier: string };
export const supplierBrowser = registerPlugin<{ open(options: { url: string; script: string; customStore?: boolean }): Promise<{ product?: unknown }> }>('SupplierBrowser');

export function validateSupplierProduct(value: unknown): SupplierProduct {
  const p = value as Record<string, unknown> | null;
  if (!p || typeof p.url !== 'string' || typeof p.name !== 'string') throw new Error('Öppna en produktsida och försök igen.');
  let url: URL;
  try { url = new URL(p.url); } catch { throw new Error('Ange en giltig produktlänk från någon av de valda butikerna.'); }
  const supplier = url.hostname === 'www.jula.se' && /^\/catalog\/.+-\d+\/?$/.test(url.pathname) ? 'Jula'
    : url.hostname === 'www.biltema.se' && /-200\d{7}\/?$/.test(url.pathname) ? 'Biltema'
    : url.hostname === 'www.byggmax.se' && /^\/[^/]+-p\d+\/?$/.test(url.pathname) ? 'Byggmax'
    : url.hostname === 'www.bauhaus.se' && /^\/[a-z0-9]+(?:-[a-z0-9]+)+\/?$/.test(url.pathname) ? 'BAUHAUS'
    : url.hostname === 'www.jemfix.se' && /^\/[^/]+\/\d{4}\/\d{7}\/?$/.test(url.pathname) ? 'jem & fix' : '';
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
  function visit(value, depth = 0) {
    if (depth > 10 || products.length >= 100) return;
    if (Array.isArray(value)) { value.slice(0,100).forEach(item=>visit(item,depth+1)); return; }
    if (!value || typeof value !== 'object') return;
    if ([value['@type']].flat().includes('Product')) products.push(value);
    if (value['@graph']) visit(value['@graph'],depth+1);
  }
  Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0,30).forEach(el => { try { if(el.textContent.length<=500000) visit(JSON.parse(el.textContent)); } catch {} });
  const product = products.find(p => p.name?.trim() === title) || products.find(p => { try { const link = new URL(p.url || p.offers?.url,location.href); return link.origin+link.pathname === location.origin+location.pathname; } catch { return false; } });
  const text = document.querySelector('main')?.innerText || '';
  const sku = document.querySelector('meta[itemprop="sku"]')?.content || text.match(/(?:Artikelnr\\.?|Art\\.?\\s*nr\\.?|Artikelnummer|Article number|Part number|SKU)\\s*:?\\s*([A-Z0-9][A-Z0-9._/-]{1,79})/i)?.[1]?.trim() || product?.sku || '';
  return { name: title || product?.name || '', sku: String(sku), url: location.href, productConfirmed: Boolean(product || (title && document.querySelector('h1')?.closest('[itemtype="https://schema.org/Product"], [itemtype="http://schema.org/Product"]'))) };
})()`;

/** Custom stores are browsed locally; this URL must never go to the import Edge. */
export function customStoreUrl(raw: string): URL {
  if (raw.length > 2000) throw new Error('Webbadressen är för lång.');
  let url: URL;
  try { url = new URL(raw.includes('://') ? raw.trim() : `https://${raw.trim()}`); } catch { throw new Error('Ange en giltig webbadress, till exempel www.autodoc.se.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host) || /\.(local|localhost|internal|test|invalid|example)$/.test(host)) throw new Error('Använd en offentlig HTTPS-butik. Lokala adresser och IP-adresser stöds inte.');
  url.hash = '';return url;
}

export function validateCustomSupplierProduct(value: unknown, initialStore: string): SupplierProduct {
  const p=value as Record<string,unknown> | null;
  if (!p || typeof p.url !== 'string' || typeof p.name !== 'string' || p.productConfirmed !== true) throw new Error('Öppna en produktsida med produktuppgifter och välj artikeln igen.');
  const url=customStoreUrl(p.url),initial=customStoreUrl(initialStore);
  if (url.hostname.replace(/^www\./,'') !== initial.hostname.replace(/^www\./,'')) throw new Error('Produkten måste komma från den butik du öppnade.');
  const name=cleanText(p.name);if (!name || name.length>300) throw new Error('Produkten saknar ett giltigt namn.');
  return {name,sku:typeof p.sku==='string'?cleanText(p.sku).slice(0,80):'',url:url.href,supplier:url.hostname.replace(/^www\./,'')==='autodoc.se'?'Autodoc':url.hostname.replace(/^www\./,'')};
}
