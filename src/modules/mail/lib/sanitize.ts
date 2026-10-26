// HTML-sanering för visning av mejl (DOMPurify) – skydd mot XSS och osäkra externa resurser. Externa bilder blockeras tills användaren tillåter dem (integritet/spårning).
import DOMPurify from 'dompurify';

const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
let hooksInstalled = false;
let allowRemote = false; let blocked = 0;

function install() {
  if (hooksInstalled) return; hooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
    if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer nofollow'); const href = node.getAttribute('href') || ''; if (/^\s*(javascript|data|vbscript):/i.test(href)) node.removeAttribute('href'); }
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (/^https?:|^\/\//i.test(src) && !allowRemote) { node.setAttribute('data-blocked-src', src); node.setAttribute('src', TRANSPARENT); node.setAttribute('alt', node.getAttribute('alt') || ''); blocked++; }
      node.removeAttribute('srcset'); node.removeAttribute('loading');
    }
    const style = node.getAttribute?.('style');
    if (style) { const cleaned = style.replace(/expression\s*\([^)]*\)/gi, '').replace(/url\(\s*(['"]?)(?!data:image\/)[^)]*\1\s*\)/gi, allowRemote ? '$&' : 'none'); node.setAttribute('style', cleaned); }
  });
}

export interface SanitizeResult { html: string; blockedImages: number }
/** `cidMap` ersätter cid:-referenser med färdiga data-/blob-URL:er (inline-bilder). */
export function sanitizeEmailHtml(html: string, opts: { allowRemoteImages: boolean; cidMap?: Record<string, string> }): SanitizeResult {
  install(); allowRemote = opts.allowRemoteImages; blocked = 0;
  let source = html;
  if (opts.cidMap) source = source.replace(/cid:([^"'\s>)]+)/gi, (m, cid: string) => opts.cidMap![cid] ?? opts.cidMap![decodeURIComponent(cid)] ?? m);
  const clean = DOMPurify.sanitize(source, { USE_PROFILES: { html: true }, FORBID_TAGS: ['form', 'iframe', 'object', 'embed', 'meta', 'link', 'base', 'svg', 'math', 'video', 'audio'], FORBID_ATTR: ['formaction', 'srcdoc'], ALLOW_DATA_ATTR: false, ADD_ATTR: ['target'], FORCE_BODY: true });
  // <style> behålls så att mejlets egen responsiva design (media queries) fungerar som i Gmail. Allt som kan hämta något utifrån tas bort:
  // @import och url() mot nätet. Iframens CSP (default-src 'none', img/font bara data:) är andra spärren, och iframen är sandboxad.
  const cleaned = (clean as unknown as string).replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, css: string) => `<style>${css.replace(/@import[^;]*;?/gi, '').replace(/expression\s*\([^)]*\)/gi, '').replace(/behavior\s*:[^;}]*/gi, '').replace(/url\(\s*(['"]?)(?!data:image\/)[^)]*\1\s*\)/gi, allowRemote ? '$&' : 'none')}</style>`);
  return { html: cleaned, blockedImages: blocked };
}
/** Sanering av innehåll som användaren själv skriver/klistrar in (och citerad text) innan det skickas. */
export function sanitizeComposerHtml(html: string): string { return sanitizeEmailHtml(html, { allowRemoteImages: true }).html; }
export function htmlToText(html: string): string { const d = document.createElement('div'); d.innerHTML = DOMPurify.sanitize(html); return (d.textContent || '').replace(/\s+/g, ' ').trim(); }
