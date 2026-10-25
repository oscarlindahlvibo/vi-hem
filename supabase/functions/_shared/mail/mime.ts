// RFC 5322/2045-bygge av utgående meddelanden och utkast för Gmail (raw). Ren TypeScript (Node + Deno).
// Logiken kring mottagare (deduplicering, ingen kopia till avsändaren), References/In-Reply-To-normalisering, inline-bilder via Content-ID
// och rubrikhantering bygger på Zeros utgående MIME-byggare:
// Adapted from Zero (MIT, Copyright (c) 2025 Zero Email) – apps/server/src/lib/driver/outgoing-mime.ts @ 8c170b8. Licens: docs/mail/ZERO-LICENSE.txt
// Egen serialisering (i stället för paketet mimetext) för att undvika extra beroende i edge-miljön och för full kontroll över teckenkodning.
import { encodeBase64Url, type MailAddress } from './parse.ts';

export interface OutgoingAttachment { name: string; type: string; base64: string }
export interface OutgoingMessage {
  from: MailAddress; to: MailAddress[]; cc?: MailAddress[]; bcc?: MailAddress[]; replyTo?: MailAddress | null; subject: string;
  html: string; text?: string; attachments?: OutgoingAttachment[]; inReplyTo?: string; references?: string; messageId: string; extraHeaders?: Record<string, string>;
}
export interface BuiltMime { raw: string; rawBase64Url: string; recipients: string[]; messageId: string }

const CRLF = '\r\n';
const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** Normaliserar en lista Message-ID till `<a@b> <c@d>` (Zero: toMessageIdList). */
export const toMessageIdList = (value: string) => value.split(/\s+/).filter(Boolean).map((ref) => (ref.startsWith('<') ? ref : `<${ref}`)).map((ref) => (ref.endsWith('>') ? ref : `${ref}>`)).join(' ');

function bytesToBase64(bytes: Uint8Array): string { let b = ''; const c = 0x8000; for (let i = 0; i < bytes.length; i += c) b += String.fromCharCode(...bytes.subarray(i, Math.min(i + c, bytes.length))); return btoa(b); }
const wrap76 = (b64: string) => b64.replace(/(.{76})/g, `$1${CRLF}`).replace(new RegExp(`${CRLF}$`), '');
const utf8Base64 = (s: string) => wrap76(bytesToBase64(new TextEncoder().encode(s)));

/** RFC 2047 för icke-ASCII i rubriker (delas så att varje kodat ord <= 75 tecken). */
export function encodeHeaderWord(value: string): string {
  if (isAscii(value)) return value.replace(/[\r\n]+/g, ' ');
  const bytes = new TextEncoder().encode(value.replace(/[\r\n]+/g, ' '));
  const words: string[] = []; let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + 42, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--; // bryt inte mitt i en UTF-8-sekvens
    words.push(`=?UTF-8?B?${bytesToBase64(bytes.subarray(start, end))}?=`); start = end;
  }
  return words.join(`${CRLF} `);
}
const cleanEmail = (e: string) => e.replace(/[\r\n<>,"]/g, '').trim();
export function formatHeaderAddress(a: MailAddress): string {
  const email = cleanEmail(a.email);
  if (!a.name) return email;
  const name = a.name.replace(/[\r\n"]/g, ' ').trim();
  if (!isAscii(name)) return `${encodeHeaderWord(name)} <${email}>`;
  return /[()<>@,;:\\".[\]]/.test(name) ? `"${name}" <${email}>` : `${name} <${email}>`;
}
const addressHeader = (list: MailAddress[]) => list.map(formatHeaderAddress).join(`,${CRLF} `);

export function htmlToPlainText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => (text.replace(/<[^>]+>/g, '').trim() === href ? href : `${text.replace(/<[^>]+>/g, '')} (${href})`)).replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
}

/** Tar bort aktivt innehåll ur utgående HTML (script, event-attribut, javascript:-länkar, iframes). Mottagarens klient sanerar också. */
export function sanitizeOutgoingHtml(html: string): string {
  return html.replace(/<(script|iframe|object|embed|form|meta|link|base)\b[\s\S]*?(<\/\1>|\/?>)/gi, '').replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

/** Extraherar data:-bilder (Tiptap klistrar in bilder så) till Content-ID-bilagor. */
export function extractInlineImages(html: string): { html: string; images: { cid: string; mimeType: string; base64: string }[] } {
  const images: { cid: string; mimeType: string; base64: string }[] = []; let n = 0;
  const out = html.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=\s]+)\2/gi, (_m, pre: string, q: string, mime: string, data: string) => {
    const cid = `img${++n}-${Math.random().toString(36).slice(2, 10)}@vihem-mail`; images.push({ cid, mimeType: mime.toLowerCase(), base64: data.replace(/\s/g, '') }); return `${pre}${q}cid:${cid}${q}`;
  });
  return { html: out, images };
}

const boundary = (tag: string) => `=_${tag}_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;

export function buildMime(msg: OutgoingMessage): BuiltMime {
  if (!msg.to?.length && !msg.cc?.length && !msg.bcc?.length) throw new Error('[E_RECIPIENT] Minst en mottagare krävs.');
  const seen = new Set<string>(); const sender = msg.from.email.toLowerCase();
  const dedupe = (list: MailAddress[] | undefined, skipSender: boolean) => (list ?? []).filter((a) => { const e = cleanEmail(a.email).toLowerCase(); if (!e.includes('@') || seen.has(e) || (skipSender && e === sender)) return false; seen.add(e); return true; });
  const to = dedupe(msg.to, false); const cc = dedupe(msg.cc, true); const bcc = dedupe(msg.bcc, true);
  if (!to.length && !cc.length && !bcc.length) throw new Error('[E_RECIPIENT] Inga giltiga mottagare.');
  const recipients = [...to, ...cc, ...bcc].map((a) => cleanEmail(a.email).toLowerCase());

  const sanitized = sanitizeOutgoingHtml(msg.html || '');
  const { html, images } = extractInlineImages(sanitized);
  const text = msg.text ?? htmlToPlainText(html);
  const header: string[] = [];
  header.push(`From: ${formatHeaderAddress(msg.from)}`);
  if (to.length) header.push(`To: ${addressHeader(to)}`);
  if (cc.length) header.push(`Cc: ${addressHeader(cc)}`);
  if (bcc.length) header.push(`Bcc: ${addressHeader(bcc)}`);
  if (msg.replyTo?.email) header.push(`Reply-To: ${formatHeaderAddress(msg.replyTo)}`);
  header.push(`Subject: ${encodeHeaderWord(msg.subject || '')}`);
  header.push(`Date: ${new Date().toUTCString().replace('GMT', '+0000')}`);
  header.push(`Message-ID: ${msg.messageId.startsWith('<') ? msg.messageId : `<${msg.messageId}>`}`);
  header.push('MIME-Version: 1.0');
  if (msg.inReplyTo) header.push(`In-Reply-To: ${toMessageIdList(msg.inReplyTo)}`);
  if (msg.references) header.push(`References: ${toMessageIdList(msg.references)}`);
  for (const [k, v] of Object.entries(msg.extraHeaders ?? {})) if (/^[A-Za-z0-9-]+$/.test(k) && v) header.push(`${k}: ${v.replace(/[\r\n]+/g, ' ')}`);

  const textPart = ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', utf8Base64(text)].join(CRLF);
  const htmlPart = ['Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', utf8Base64(html)].join(CRLF);
  const altB = boundary('alt');
  const alternative = [`Content-Type: multipart/alternative; boundary="${altB}"`, '', `--${altB}`, textPart, `--${altB}`, htmlPart, `--${altB}--`].join(CRLF);
  let body = alternative;
  if (images.length) {
    const relB = boundary('rel');
    const parts = images.map((im) => ['Content-Type: ' + im.mimeType + `; name="${im.cid}"`, 'Content-Transfer-Encoding: base64', `Content-ID: <${im.cid}>`, 'Content-Disposition: inline', '', wrap76(im.base64)].join(CRLF));
    body = [`Content-Type: multipart/related; boundary="${relB}"; type="multipart/alternative"`, '', `--${relB}`, alternative, ...parts.flatMap((p) => [`--${relB}`, p]), `--${relB}--`].join(CRLF);
  }
  if (msg.attachments?.length) {
    const mixB = boundary('mix');
    const att = msg.attachments.map((a) => {
      const filename = encodeHeaderWord(a.name || 'bilaga').replace(/"/g, '');
      return [`Content-Type: ${/^[\w.+-]+\/[\w.+-]+$/.test(a.type) ? a.type : 'application/octet-stream'}; name="${filename}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${filename}"`, '', wrap76(a.base64.replace(/\s/g, ''))].join(CRLF);
    });
    body = [`Content-Type: multipart/mixed; boundary="${mixB}"`, '', `--${mixB}`, body, ...att.flatMap((p) => [`--${mixB}`, p]), `--${mixB}--`].join(CRLF);
  }
  const raw = header.join(CRLF) + CRLF + body + CRLF;
  return { raw, rawBase64Url: encodeBase64Url(raw), recipients: [...new Set(recipients)], messageId: msg.messageId };
}

/** Utkast: som buildMime men mottagare är valfria. */
export function buildDraftMime(msg: Omit<OutgoingMessage, 'to'> & { to?: MailAddress[] }): BuiltMime {
  const to = msg.to?.length || msg.cc?.length || msg.bcc?.length ? msg.to ?? [] : [{ name: '', email: 'draft@invalid.localhost' }];
  const built = buildMime({ ...msg, to });
  if (to.length === 1 && to[0].email === 'draft@invalid.localhost') {
    const raw = built.raw.replace(/^To: draft@invalid\.localhost\r\n/m, '');
    return { ...built, raw, rawBase64Url: encodeBase64Url(raw), recipients: [] };
  }
  return built;
}

/** Genererar ett Message-ID som vi själva äger (används för att kunna söka upp ett osäkert utskick i Gmail: rfc822msgid:). */
export function newMessageId(domain: string): string { const rnd = crypto.getRandomValues(new Uint8Array(12)); return `<${[...rnd].map((b) => b.toString(16).padStart(2, '0')).join('')}.${Date.now().toString(36)}@${domain.replace(/[^a-z0-9.-]/gi, '') || 'vihem-mail.local'}>`; }
