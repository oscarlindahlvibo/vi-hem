const decodeHtml = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (whole, entity: string) => {
  if (entity.startsWith('#')) { const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : parseInt(entity.slice(1),10); return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole; }
  return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '} as Record<string,string>)[entity.toLowerCase()] || whole;
});
export type Product = { name: string; sku: string; url: string; supplier: string };
export function productUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.length > 2000) throw new Error('Ange en produktlänk från någon av de valda butikerna.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Ange en giltig produktlänk från någon av de valda butikerna.'); }
  const match = url.hostname === 'www.jula.se' && /^\/catalog\/.+-\d+\/$/.test(url.pathname) ? 'Jula'
    : url.hostname === 'www.biltema.se' && /-200\d{7}\/?$/.test(url.pathname) ? 'Biltema'
    : url.hostname === 'www.byggmax.se' && /^\/[^/]+-p\d+\/?$/.test(url.pathname) ? 'Byggmax'
    : url.hostname === 'www.bauhaus.se' && /^\/[a-z0-9]+(?:-[a-z0-9]+)+\/?$/.test(url.pathname) ? 'BAUHAUS'
    : url.hostname === 'www.jemfix.se' && /^\/[^/]+\/\d{4}\/\d{7}\/$/.test(url.pathname) ? 'jem & fix' : '';
  if (!match || url.protocol !== 'https:' || url.port || url.username || url.password) throw new Error('Ange en produktlänk från någon av de valda butikerna.');
  url.hash = ''; url.search = ''; return url;
}
export function parseProducts(html: string, url: URL): Product[] {
  const found: Product[] = [];
  const supplier = ({'www.jula.se':'Jula','www.biltema.se':'Biltema','www.byggmax.se':'Byggmax','www.bauhaus.se':'BAUHAUS','www.jemfix.se':'jem & fix'} as Record<string,string>)[url.hostname];
  const add = (name: unknown, sku: unknown) => {
    if (typeof name !== 'string' || !name.trim() || name.length > 300) return;
    const item = { name: name.trim(), sku: typeof sku === 'string' ? sku.trim().slice(0,80) : '', url: url.href, supplier };
    if (!found.some(p => p.name === item.name && p.sku === item.sku)) found.push(item);
  };
  // Biltema exposes the product's variants as JSON in its public product HTML.
  // Parse the JSON value; never eval the enclosing website script.
  if (supplier === 'Biltema') {
    const match = html.match(/window\.productData\s*=\s*window\.productData\s*\|\|\s*(\{[^\r\n]+\})\s*;/);
    if (match) try {
      const data = JSON.parse(match[1]);
      if (Array.isArray(data.variations)) for (const p of data.variations.slice(0,30)) add(p.name, p.articleNumberFriendlyName || p.articleNumber);
    } catch { /* Changed markup is reported as unavailable below. */ }
  }
  // Byggmax emits a public JSON literal before adding dynamic offer data.
  if (supplier === 'Byggmax') {
    const structured = html.match(/let\s+productStructuredData\s*=\s*(\[[^\r\n]+\])\s*;/);
    if (structured) try {
      const items = JSON.parse(structured[1]);
      for (const p of items.slice(0,30)) if (p['@type'] === 'Product') add(p.name, p.sku);
    } catch { /* No evaluation of retailer JavaScript. */ }
  }
  // BAUHAUS publishes product microdata rather than JSON-LD. Read only the
  // main product heading and SKU; related product cards must not be imported.
  if (supplier === 'BAUHAUS' && /itemtype=["']https?:\/\/schema\.org\/Product["']/.test(html)) {
    const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    const sku = html.match(/<meta\b[^>]*itemprop=["']sku["'][^>]*content=["']([^"']+)["']/i)?.[1];
    if (heading && sku) add(decodeHtml(heading.replace(/<[^>]*>/g,'')), decodeHtml(sku));
  }
  if (!found.length) for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld(?:\+|&#x2b;|&#43;)json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const visit = (value: unknown, depth = 0) => {
      if (depth > 10 || !value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.slice(0,100).forEach(p=>visit(p,depth+1)); return; }
      const p = value as Record<string, unknown>;
      if ([p['@type']].flat().includes('Product') && (!p.url || p.url === url.href)) add(p.name, p.sku);
      if (p['@graph']) visit(p['@graph'],depth+1);
    };
    try { visit(JSON.parse(match[1])); } catch { /* Invalid metadata isn't executed. */ }
  }
  return found.slice(0,30);
}
export async function fetchProducts(raw: unknown, transport: typeof fetch = fetch): Promise<Product[]> {
  const url = productUrl(raw);
  const response = await transport(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { Accept: 'text/html' } });
  if (!response.ok) throw new Error('Butiken tillåter inte hämtning just nu. Öppna produkten i den nya mobilappens butiksvy eller fyll i uppgifterna själv.');
  // No redirects, private hosts, arbitrary URLs, cookies or authentication forwarding.
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/html')) throw new Error('Länken gav ingen produktsida.');
  const reader = response.body?.getReader(); if (!reader) throw new Error('Produktsidan kunde inte läsas.');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) throw new Error('Produktsidan är för stor.'); chunks.push(value); } }
  finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const products = parseProducts(new TextDecoder().decode(bytes), url);
  if (!products.length) throw new Error('Kunde inte hitta produktuppgifter på sidan. Dina inköpsuppgifter finns kvar.');
  return products;
}
