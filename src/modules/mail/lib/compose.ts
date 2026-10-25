// Ren logik för composern: avsändarförslag (alias), mottagare vid svar/svara alla, citat och vidarebefordran.
import type { MailAddress, ParsedMessage } from './types';

export interface SenderIdentity { email: string; name: string; isPrimary?: boolean; isDefault?: boolean; verified: boolean }
const lc = (s: string) => s.trim().toLowerCase();

/** Väljer avsändare. Svar: det alias mejlet skickades till (Delivered-To, sedan To, sedan Cc). Nytt mejl: senast använda. Annars standard/primär. Overifierade alias väljs aldrig. */
export function suggestSender(identities: SenderIdentity[], original: { deliveredTo: string[]; to: string[]; cc: string[] } | null, lastSender: Record<string, string> | undefined, accountId: string): string {
  const usable = identities.filter((i) => i.verified); if (!usable.length) return '';
  const byEmail = new Map(usable.map((i) => [lc(i.email), i.email] as const));
  if (original) { for (const list of [original.deliveredTo, original.to, original.cc]) for (const a of list) { const hit = byEmail.get(lc(a)); if (hit) return hit; } }
  else { const last = lastSender?.[accountId]; if (last && byEmail.has(lc(last))) return byEmail.get(lc(last))!; }
  return (usable.find((i) => i.isDefault) ?? usable.find((i) => i.isPrimary) ?? usable[0]).email;
}

export function replyRecipients(m: Pick<ParsedMessage, 'from' | 'replyTo' | 'to' | 'cc'>, ownEmails: string[], all: boolean): { to: MailAddress[]; cc: MailAddress[] } {
  const own = new Set(ownEmails.map(lc)); const seen = new Set<string>(); const take = (list: MailAddress[]) => list.filter((a) => { const e = lc(a.email); if (!e || own.has(e) || seen.has(e)) return false; seen.add(e); return true; });
  const primary = take([m.replyTo ?? m.from]);
  // Svar på eget mejl (avsändaren är jag): svara till ursprungliga mottagare
  const to = primary.length ? primary : take(m.to);
  if (!all) return { to, cc: [] };
  return { to: [...to, ...take(m.to)], cc: take(m.cc) };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function quoteHtml(m: Pick<ParsedMessage, 'from' | 'date' | 'html' | 'text'>, sanitize: (html: string) => string): string {
  const who = m.from.name ? `${esc(m.from.name)} &lt;${esc(m.from.email)}&gt;` : esc(m.from.email);
  const body = m.html ? sanitize(m.html) : `<div>${esc(m.text).replace(/\n/g, '<br>')}</div>`;
  return `<br><div class="gmail_quote"><div>${esc(m.date)}, ${who} skrev:</div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${body}</blockquote></div>`;
}
export function forwardHtml(m: Pick<ParsedMessage, 'from' | 'to' | 'date' | 'subject' | 'html' | 'text'>, sanitize: (html: string) => string): string {
  const list = (a: MailAddress[]) => a.map((x) => (x.name ? `${esc(x.name)} &lt;${esc(x.email)}&gt;` : esc(x.email))).join(', ');
  const body = m.html ? sanitize(m.html) : `<div>${esc(m.text).replace(/\n/g, '<br>')}</div>`;
  return `<br><div class="gmail_quote"><div>---------- Vidarebefordrat meddelande ----------<br>Från: ${esc(m.from.name)} &lt;${esc(m.from.email)}&gt;<br>Datum: ${esc(m.date)}<br>Ämne: ${esc(m.subject)}<br>Till: ${list(m.to)}</div><br>${body}</div>`;
}
export const validEmail = (s: string) => /^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$/.test(s.trim());
