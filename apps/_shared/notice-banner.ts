// Driftmeddelanden (planerade uppdateringar och serverunderhåll) som banner överst på Vibogruppens egna appar och sajter.
// Delas av VI-HEM-appen, vi-hem.se, Kompetensportalen, Vibofast, Vibogruppen och ViboRent. Inga beroenden, ren DOM, så den
// fungerar oavsett ramverk och med strikt CSP (ingen inline-kod). Meddelanden skapas i VI-HEM under Ekonomi → Driftmeddelanden.
// Hämtningen misslyckas tyst: en sajt ska aldrig påverkas av att meddelandetjänsten inte svarar.

export type NoticeSurface = 'vihem-app' | 'vihem-site' | 'kompetensportalen' | 'vibofast' | 'vibogruppen' | 'viborent';
export type NoticeSeverity = 'info' | 'warning' | 'critical';

export interface BannerNotice {
  id: string; title: string; body: string; severity: NoticeSeverity; kind: string;
  show_from: string; show_until: string; event_starts_at: string | null; event_ends_at: string | null; updated_at: string;
}

const DISMISS_KEY = 'vihem.dismissedNotices';
const ORDER: Record<NoticeSeverity, number> = { critical: 0, warning: 1, info: 2 };
const COLORS: Record<NoticeSeverity, { bg: string; border: string; fg: string; label: string }> = {
  critical: { bg: '#fef2f2', border: '#fca5a5', fg: '#7f1d1d', label: 'Viktigt' },
  warning: { bg: '#fffbeb', border: '#fcd34d', fg: '#78350f', label: 'Information' },
  info: { bg: '#f0f9ff', border: '#bae6fd', fg: '#0c4a6e', label: 'Information' },
};

export const noticeDismissKey = (notice: Pick<BannerNotice, 'id' | 'updated_at'>) => `${notice.id}:${notice.updated_at}`;

export function isBannerNotice(value: unknown): value is BannerNotice {
  const n = value as Partial<BannerNotice> | null;
  return Boolean(n && typeof n.id === 'string' && typeof n.title === 'string' && typeof n.show_from === 'string' && typeof n.show_until === 'string'
    && (n.severity === 'info' || n.severity === 'warning' || n.severity === 'critical'));
}

// Kritiska meddelanden kan inte döljas. Ett ändrat meddelande (ny updated_at) visas igen även om det dolts tidigare.
export function visibleBannerNotices(notices: BannerNotice[], dismissed: string[], now = new Date()): BannerNotice[] {
  const t = now.getTime();
  return notices
    .filter((n) => t >= new Date(n.show_from).getTime() && t < new Date(n.show_until).getTime())
    .filter((n) => n.severity === 'critical' || !dismissed.includes(noticeDismissKey(n)))
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || new Date(b.show_from).getTime() - new Date(a.show_from).getTime());
}

export function formatNoticeWindow(start: string | null, end: string | null): string {
  if (!start) return '';
  const s = new Date(start);
  const day = (d: Date) => d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });
  const time = (d: Date) => d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  if (!end) return `${day(s)} kl. ${time(s)}`;
  const e = new Date(end);
  return day(s) === day(e) ? `${day(s)} kl. ${time(s)}–${time(e)}` : `${day(s)} kl. ${time(s)} – ${day(e)} kl. ${time(e)}`;
}

function readDismissed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
function writeDismissed(keys: string[]) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(keys.slice(-50))); } catch { /* lagring blockerad: meddelandet visas igen vid nästa laddning */ }
}

async function fetchNotices(url: string, key: string, surface: NoticeSurface): Promise<BannerNotice[]> {
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/vihem_public_notices`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_surface: surface }),
  });
  if (!response.ok) return [];
  const data = await response.json().catch(() => null);
  return Array.isArray(data) ? data.filter(isBannerNotice) : [];
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, style: string, text?: string) {
  const node = document.createElement(tag);
  node.setAttribute('style', style);
  if (text) node.textContent = text;
  return node;
}

function render(host: HTMLElement, notices: BannerNotice[], onDismiss: (notice: BannerNotice) => void) {
  host.replaceChildren();
  host.style.display = notices.length ? 'block' : 'none';
  for (const notice of notices) {
    const c = COLORS[notice.severity];
    const box = element('div', `display:flex;gap:12px;align-items:flex-start;justify-content:space-between;margin:0 0 1px;padding:10px 16px;background:${c.bg};border-bottom:1px solid ${c.border};color:${c.fg};font:14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;`);
    box.setAttribute('role', notice.severity === 'critical' ? 'alert' : 'status');
    const text = element('div', 'min-width:0;');
    text.append(element('div', 'font-weight:600;', notice.title));
    const when = formatNoticeWindow(notice.event_starts_at, notice.event_ends_at);
    if (when) text.append(element('div', '', `${notice.kind === 'maintenance' ? 'Serverunderhåll' : notice.kind === 'update' ? 'Uppdatering' : 'Tidpunkt'}: ${when}`));
    if (notice.body) text.append(element('div', 'white-space:pre-line;', notice.body));
    box.append(text);
    if (notice.severity !== 'critical') {
      const button = element('button', `flex:none;border:0;background:transparent;color:${c.fg};font-size:20px;line-height:1;cursor:pointer;padding:0 4px;`, '×');
      button.setAttribute('type', 'button');
      button.setAttribute('aria-label', 'Dölj meddelandet');
      button.setAttribute('title', 'Dölj meddelandet');
      button.addEventListener('click', () => onDismiss(notice));
      box.append(button);
    }
    host.append(box);
  }
}

// Startar bannern. Anropas en gång från appens startfil. Returnerar en funktion som stoppar den.
// Utan `host` läggs bannern överst i body. Appar med fast sidofält/egen scrollyta anger ett eget element i innehållsytan.
export function startNoticeBanner(options: { url?: string; key?: string; surface: NoticeSurface; host?: HTMLElement | null }): () => void {
  const { url, key, surface } = options;
  if (typeof document === 'undefined' || !url || !key) return () => undefined;
  const host = document.createElement('div');
  host.id = 'vihem-notice-banner';
  host.setAttribute('role', 'region');
  host.setAttribute('aria-label', 'Driftmeddelanden');
  host.style.display = 'none';
  (options.host ?? document.body).prepend(host);

  let notices: BannerNotice[] = [];
  let dismissed = readDismissed();
  const draw = () => render(host, visibleBannerNotices(notices, dismissed), (notice) => { dismissed = [...dismissed, noticeDismissKey(notice)]; writeDismissed(dismissed); draw(); });
  const refresh = () => { fetchNotices(url, key, surface).then((list) => { notices = list; draw(); }).catch(() => undefined); };
  const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };

  refresh();
  const refreshTimer = window.setInterval(refresh, 5 * 60_000);
  const clockTimer = window.setInterval(draw, 30_000); // så att ett meddelande försvinner vid sluttiden även om sidan står öppen
  document.addEventListener('visibilitychange', onVisible);
  return () => { window.clearInterval(refreshTimer); window.clearInterval(clockTimer); document.removeEventListener('visibilitychange', onVisible); host.remove(); };
}
