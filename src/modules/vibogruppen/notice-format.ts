// Hjälpfunktioner för driftmeddelanden (Vibogruppens modul för banners i anslutna kundsystem).
export type NoticeSeverity = 'info' | 'warning' | 'critical';
export type NoticeKind = 'update' | 'maintenance' | 'incident' | 'other';
export type NoticeStatus = 'live' | 'planned' | 'ended' | 'off';

export const severityLabels: Record<NoticeSeverity, string> = { info: 'Information', warning: 'Varning', critical: 'Kritisk' };
export const kindLabels: Record<NoticeKind, string> = { update: 'Uppdatering', maintenance: 'Serverunderhåll', incident: 'Driftstörning', other: 'Övrigt' };

// <input type="datetime-local"> ger lokal tid utan zon; spara alltid som absolut tidpunkt (ISO/UTC).
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function noticeStatus(notice: { active: boolean; show_from: string; show_until: string }, now = new Date()): NoticeStatus {
  if (!notice.active) return 'off';
  const t = now.getTime();
  if (t < new Date(notice.show_from).getTime()) return 'planned';
  if (t >= new Date(notice.show_until).getTime()) return 'ended';
  return 'live';
}

export function validateNoticeForm(form: { title: string; show_from: string; show_until: string; event_starts_at: string; event_ends_at: string; all_customers: boolean; customer_ids: string[] }): string | null {
  if (!form.title.trim()) return 'Ange en rubrik.';
  const from = localInputToIso(form.show_from);
  const until = localInputToIso(form.show_until);
  if (!from || !until) return 'Ange när meddelandet ska börja och sluta visas.';
  if (new Date(until) <= new Date(from)) return 'Sluttiden måste vara efter starttiden.';
  const evStart = localInputToIso(form.event_starts_at);
  const evEnd = localInputToIso(form.event_ends_at);
  if (evStart && evEnd && new Date(evEnd) < new Date(evStart)) return 'Underhållets sluttid kan inte vara före starttiden.';
  if (!form.all_customers && form.customer_ids.length === 0) return 'Välj minst en kund eller låt meddelandet gälla alla.';
  return null;
}
