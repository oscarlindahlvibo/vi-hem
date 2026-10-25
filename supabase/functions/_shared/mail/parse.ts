// Gmail-meddelandetolkning för VI-HEM Mail. Ren TypeScript utan Deno-/Node-specifika API:er så att den kan enhetstestas i Node.
// Delar av tolkningslogiken (delträd, bilageextrahering, inline-bilder, etikettmappning) bygger på Zeros Gmail-driver
// Adapted from Zero (MIT, Copyright (c) 2025 Zero Email) – apps/server/src/lib/driver/google.ts @ 8c170b8. Licens: docs/mail/ZERO-LICENSE.txt

export interface MailAddress { name: string; email: string }
export interface MailAttachment { id: string; messageId: string; filename: string; mimeType: string; size: number; contentId: string | null; inline: boolean }
export interface ParsedMessage {
  id: string; threadId: string; labelIds: string[]; internalDate: number; snippet: string;
  from: MailAddress; to: MailAddress[]; cc: MailAddress[]; bcc: MailAddress[]; replyTo: MailAddress | null;
  subject: string; date: string; messageIdHeader: string; inReplyTo: string; references: string;
  html: string; text: string; attachments: MailAttachment[]; unread: boolean; starred: boolean; isDraft: boolean; listUnsubscribe: string;
  deliveredTo: string[];
}
export interface ThreadSummary {
  id: string; subject: string; snippet: string; participants: MailAddress[]; from: MailAddress; lastDate: number; messageCount: number;
  unread: boolean; starred: boolean; hasAttachments: boolean; labelIds: string[]; draft: boolean; important: boolean;
}

export function decodeBase64Url(data: string): Uint8Array {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function encodeBase64Url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 2047 (=?charset?B|Q?text?=) i rubriker. */
export function decodeMimeWords(value: string): string {
  if (!value || !value.includes('=?')) return value || '';
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
      try {
        let bytes: Uint8Array;
        if (enc.toLowerCase() === 'b') bytes = decodeBase64Url(text.replace(/\s/g, ''));
        else {
          const raw = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16)));
          bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        }
        return new TextDecoder(charset.toLowerCase() === 'utf8' ? 'utf-8' : charset).decode(bytes);
      } catch { return text; }
    });
}

export function parseAddress(value: string): MailAddress {
  const v = decodeMimeWords((value || '').trim());
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(v);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  const bare = v.replace(/^<|>$/g, '').trim();
  return { name: '', email: bare.toLowerCase() };
}
/** Delar upp en adresslista på kommatecken utanför citattecken/vinkelparenteser. */
export function parseAddressList(value: string | undefined | null): MailAddress[] {
  if (!value) return [];
  const parts: string[] = []; let depth = 0; let quoted = false; let cur = '';
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '<') depth++;
    if (!quoted && ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ',' && !quoted && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map(parseAddress).filter((a) => a.email.includes('@'));
}
export const formatAddress = (a: MailAddress) => (a.name ? `${/[",<>@]/.test(a.name) ? `"${a.name.replace(/"/g, '')}"` : a.name} <${a.email}>` : a.email);

type Header = { name: string; value: string };
const headerOf = (headers: Header[] | undefined, name: string) => (headers ?? []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

function decodeBody(data: string | undefined, contentType: string): string {
  if (!data) return '';
  const charset = /charset="?([^";\s]+)"?/i.exec(contentType)?.[1] ?? 'utf-8';
  const bytes = decodeBase64Url(data);
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

interface Part { partId?: string; mimeType?: string; filename?: string; headers?: Header[]; body?: { attachmentId?: string; size?: number; data?: string }; parts?: Part[] }

function walk(part: Part, ctx: { html: string[]; text: string[]; attachments: MailAttachment[]; messageId: string }) {
  const mime = (part.mimeType ?? '').toLowerCase();
  const contentType = headerOf(part.headers, 'Content-Type') || mime;
  const disposition = headerOf(part.headers, 'Content-Disposition').toLowerCase();
  const contentId = headerOf(part.headers, 'Content-ID').replace(/^<|>$/g, '') || null;
  const isAttachment = Boolean(part.body?.attachmentId) && (Boolean(part.filename) || Boolean(contentId) || !mime.startsWith('text/'));
  if (isAttachment && !mime.startsWith('multipart/')) {
    ctx.attachments.push({ id: part.body!.attachmentId!, messageId: ctx.messageId, filename: decodeMimeWords(part.filename || (contentId ? `${contentId}` : 'bilaga')), mimeType: mime || 'application/octet-stream', size: part.body?.size ?? 0, contentId, inline: Boolean(contentId) && (disposition.startsWith('inline') || !disposition) && mime.startsWith('image/') });
  } else if (mime === 'text/html' && !disposition.startsWith('attachment')) ctx.html.push(decodeBody(part.body?.data, contentType));
  else if (mime === 'text/plain' && !disposition.startsWith('attachment')) ctx.text.push(decodeBody(part.body?.data, contentType));
  for (const child of part.parts ?? []) walk(child, ctx);
}

export function parseMessage(raw: any): ParsedMessage {
  const payload: Part & { headers?: Header[] } = raw.payload ?? {};
  const headers = payload.headers ?? [];
  const ctx = { html: [] as string[], text: [] as string[], attachments: [] as MailAttachment[], messageId: String(raw.id) };
  // Meddelanden utan delar har kroppen direkt på payload
  if (!payload.parts?.length && payload.body?.data) {
    const mime = (payload.mimeType ?? 'text/plain').toLowerCase();
    const body = decodeBody(payload.body.data, headerOf(headers, 'Content-Type') || mime);
    (mime === 'text/html' ? ctx.html : ctx.text).push(body);
  } else walk(payload, ctx);
  const labels: string[] = raw.labelIds ?? [];
  const toHeader = headerOf(headers, 'To');
  return {
    id: String(raw.id), threadId: String(raw.threadId ?? raw.id), labelIds: labels, internalDate: Number(raw.internalDate ?? 0), snippet: decodeEntities(String(raw.snippet ?? '')),
    from: parseAddress(headerOf(headers, 'From')), to: parseAddressList(toHeader), cc: parseAddressList(headerOf(headers, 'Cc')), bcc: parseAddressList(headerOf(headers, 'Bcc')),
    replyTo: headerOf(headers, 'Reply-To') ? parseAddress(headerOf(headers, 'Reply-To')) : null,
    subject: decodeMimeWords(headerOf(headers, 'Subject')), date: headerOf(headers, 'Date'),
    messageIdHeader: headerOf(headers, 'Message-ID') || headerOf(headers, 'Message-Id'), inReplyTo: headerOf(headers, 'In-Reply-To'), references: headerOf(headers, 'References'),
    html: ctx.html.join(''), text: ctx.text.join('\n'), attachments: ctx.attachments, unread: labels.includes('UNREAD'), starred: labels.includes('STARRED'), isDraft: labels.includes('DRAFT'),
    listUnsubscribe: headerOf(headers, 'List-Unsubscribe'),
    deliveredTo: [...parseAddressList(headerOf(headers, 'Delivered-To')), ...parseAddressList(headerOf(headers, 'X-Original-To'))].map((a) => a.email),
  };
}

export function decodeEntities(s: string): string {
  return s.replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Trådsammanfattning för listvyn från threads.get?format=metadata. */
export function summarizeThread(thread: any, ownEmails: string[] = []): ThreadSummary {
  const messages: any[] = thread.messages ?? [];
  const parsed = messages.map((m) => parseMessage(m));
  const first = parsed[0]; const last = parsed[parsed.length - 1];
  const own = new Set(ownEmails.map((e) => e.toLowerCase()));
  const seen = new Map<string, MailAddress>();
  for (const m of parsed) { const a = m.from; if (a.email && !seen.has(a.email)) seen.set(a.email, a); }
  const others = [...seen.values()].filter((a) => !own.has(a.email));
  const labels = new Set<string>(); for (const m of parsed) for (const l of m.labelIds) labels.add(l);
  const contentTypes = messages.map((m) => headerOf(m.payload?.headers, 'Content-Type').toLowerCase());
  return {
    id: String(thread.id), subject: first?.subject || '(inget ämne)', snippet: last?.snippet || decodeEntities(String(thread.snippet ?? '')),
    participants: [...seen.values()], from: (others.length ? others[others.length - 1] : last?.from) ?? { name: '', email: '' },
    lastDate: last?.internalDate ?? 0, messageCount: parsed.length, unread: parsed.some((m) => m.unread), starred: parsed.some((m) => m.starred),
    hasAttachments: contentTypes.some((c) => c.startsWith('multipart/mixed') || c.startsWith('multipart/related') && c.includes('application')), labelIds: [...labels],
    draft: parsed.some((m) => m.isDraft) && parsed.every((m) => m.isDraft), important: labels.has('IMPORTANT'),
  };
}

/** Normaliserar ämne för trådmatchning (tar bort Sv:/Re:/Fwd:/Vb:). */
export const baseSubject = (subject: string) => subject.replace(/^\s*((re|sv|fwd?|vb|aw|wg)\s*(\[\d+\])?\s*:\s*)+/i, '').trim();
export const replySubject = (subject: string) => (/^\s*(re|sv)\s*:/i.test(subject) ? subject : `Sv: ${subject}`.trim());
export const forwardSubject = (subject: string) => (/^\s*(fwd?|vb)\s*:/i.test(subject) ? subject : `Vb: ${subject}`.trim());
