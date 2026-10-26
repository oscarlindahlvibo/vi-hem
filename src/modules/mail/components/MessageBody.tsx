import { useEffect, useMemo, useRef, useState } from 'react';
import { base64UrlToBlob, mailApi } from '../lib/api';
import { sanitizeEmailHtml } from '../lib/sanitize';
import type { ParsedMessage } from '../lib/types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const linkify = (s: string) => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
const textToHtml = (t: string) => `<div style="white-space:pre-wrap;font-family:inherit">${linkify(esc(t))}</div>`;

/** Packar citerad text (Gmail-citat) i <details> så att den kan fällas ut utan JavaScript i den isolerade ramen. */
function collapseQuotes(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const quotes = doc.querySelectorAll('div.gmail_quote, blockquote.gmail_quote');
  if (quotes.length) { const first = quotes[0]; if (!first.closest('details')) { const d = doc.createElement('details'); const s = doc.createElement('summary'); s.textContent = '···'; d.appendChild(s); first.replaceWith(d); d.appendChild(first); } }
  return doc.body.innerHTML;
}

interface Props { message: ParsedMessage; accountId: string; allowRemoteImages: boolean; onBlocked?: (count: number) => void; dark?: boolean }

/** Visar ett mejl i en sandboxad iframe (inga skript, strikt CSP). Externa bilder blockeras tills användaren tillåter dem; inline-bilder (cid:) hämtas och bäddas in. */
export function MessageBody({ message, accountId, allowRemoteImages, onBlocked }: Props) {
  const [cidMap, setCidMap] = useState<Record<string, string>>({}); const [height, setHeight] = useState(0); const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let alive = true; const inline = message.attachments.filter((a) => a.inline && a.contentId && a.size < 1_500_000).slice(0, 12); if (!inline.length || !/cid:/i.test(message.html)) return;
    void Promise.all(inline.map(async (a) => { try { const r = await mailApi<{ data: string }>('attachment_get', { account_id: accountId, message_id: message.id, attachment_id: a.id }); return [a.contentId!, URL.createObjectURL(base64UrlToBlob(r.data, a.mimeType))] as const; } catch { return null; } })).then((pairs) => { if (alive) setCidMap(Object.fromEntries(pairs.filter(Boolean) as [string, string][])); });
    return () => { alive = false; };
  }, [message.id, accountId]); // eslint-disable-line react-hooks/exhaustive-deps
  const { srcDoc, blocked } = useMemo(() => {
    const raw = message.html || textToHtml(message.text || '');
    const { html, blockedImages } = sanitizeEmailHtml(raw, { allowRemoteImages, cidMap });
    const csp = `default-src 'none'; img-src data: blob: ${allowRemoteImages ? 'https: http:' : ''}; style-src 'unsafe-inline'; font-src data:`;
    const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>html,body{margin:0;padding:0}body{font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#1d4ed8}blockquote{margin:0 0 0 .6em;padding-left:.8em;border-left:2px solid #cbd5e1;color:#475569}details>summary{display:inline-block;cursor:pointer;padding:0 8px;border-radius:6px;background:#e2e8f0;color:#475569;line-height:1.2;margin:6px 0;list-style:none}pre{white-space:pre-wrap}</style></head><body>${collapseQuotes(html)}</body></html>`;
    return { srcDoc: doc, blocked: blockedImages };
  }, [message.id, message.html, message.text, allowRemoteImages, cidMap]);
  useEffect(() => { onBlocked?.(blocked); }, [blocked]); // eslint-disable-line react-hooks/exhaustive-deps
  // Passar in innehållet: mejl med fast bredd (t.ex. 600 px-nyhetsbrev utan responsiv CSS) skalas ner så att ingen sidledsscroll behövs.
  const fit = () => {
    const el = ref.current; const d = el?.contentDocument; if (!el || !d?.body) return;
    d.body.style.zoom = ''; const avail = el.clientWidth; const need = Math.max(d.documentElement.scrollWidth, d.body.scrollWidth);
    if (avail > 0 && need > avail + 1) d.body.style.zoom = String(Math.max(0.35, avail / need));
    const h = Math.max(d.documentElement.scrollHeight, d.body.scrollHeight); setHeight(Math.min(Math.max(h + 2, 40), 20000));
  };
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  return <iframe ref={ref} title={`Meddelande: ${message.subject}`} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={srcDoc} onLoad={() => { fit(); observer.current?.disconnect(); const body = ref.current?.contentDocument?.body; if (body && 'ResizeObserver' in window) { observer.current = new ResizeObserver(() => fit()); observer.current.observe(body); observer.current.observe(ref.current!.contentDocument!.documentElement); } const d = ref.current?.contentDocument; const el = ref.current; if (d && el) d.addEventListener('keydown', (e) => { if (e.metaKey || e.ctrlKey || e.altKey) return; el.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, shiftKey: e.shiftKey, bubbles: true, cancelable: true })); }); }} style={{ height: height || 1, visibility: height ? 'visible' : 'hidden' }} className="block w-full border-0 bg-white" />;
}
