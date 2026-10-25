// Signaturhantering i composern. Gmail lägger inte in sparade signaturer vid API-utskick, så VI-HEM gör det själv.
// Signaturen ligger i ett markerat block (data-vihem-signature=<identitet>, data-vihem-sig-hash=<hash av originalet>) i brödtexten:
//  - byte av avsändare byter signaturblocket men rör aldrig användarens egen text,
//  - manuellt ändrad signatur (hash skiljer sig) skrivs inte över,
//  - högst ett signaturblock finns (ingen dubbel signatur), och vid svar placeras det före det citerade.
const START = /<div\b[^>]*\bdata-vihem-signature=/i;

export function hashHtml(html: string): string {
  let h = 2166136261; const s = html.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`, 'i').exec(tag)?.[1] ?? '';
export const wrapSignature = (sig: string, id: string) => `<div data-vihem-signature="${id}" data-vihem-sig-hash="${hashHtml(sig)}">${sig}</div>`;

/** Hittar det markerade signaturblocket (balanserad <div>-räkning). */
export function findSignatureBlock(html: string): { start: number; end: number; id: string; hash: string; inner: string } | null {
  const m = START.exec(html); if (!m) return null;
  const start = m.index; const openEnd = html.indexOf('>', start); if (openEnd < 0) return null;
  const openTag = html.slice(start, openEnd + 1); let depth = 1; const re = /<(\/?)div\b[^>]*>/gi; re.lastIndex = openEnd + 1; let t: RegExpExecArray | null;
  while ((t = re.exec(html))) { depth += t[1] ? -1 : 1; if (depth === 0) return { start, end: re.lastIndex, id: attr(openTag, 'data-vihem-signature'), hash: attr(openTag, 'data-vihem-sig-hash'), inner: html.slice(openEnd + 1, t.index) }; }
  return null;
}
export function signatureState(html: string): { id: string; edited: boolean } | null {
  const b = findSignatureBlock(html); if (!b) return null; return { id: b.id, edited: hashHtml(b.inner) !== b.hash };
}
export function stripSignature(html: string): string { const b = findSignatureBlock(html); return b ? html.slice(0, b.start) + html.slice(b.end) : html; }

export function applySignature(html: string, sigHtml: string, id: string, opts: { beforeQuote?: boolean; force?: boolean } = {}): string {
  const existing = findSignatureBlock(html);
  const sig = sigHtml.trim();
  if (existing) {
    if (!opts.force && hashHtml(existing.inner) !== existing.hash) return html; // användaren har ändrat signaturen manuellt – skriv inte över
    return html.slice(0, existing.start) + (sig ? wrapSignature(sig, id) : '') + html.slice(existing.end);
  }
  if (!sig) return html;
  const block = wrapSignature(sig, id);
  if (opts.beforeQuote) { const q = /<blockquote\b|<div\b[^>]*class="[^"]*gmail_quote/i.exec(html); if (q) return html.slice(0, q.index) + block + html.slice(q.index); }
  return html + block;
}
