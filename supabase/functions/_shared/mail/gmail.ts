// Gmail REST-klient för VI-HEM Mail. Tar emot en `request`-funktion (token + fetch) så att samma kod kan testas med mockade svar.
// Anropsmönster, etikettmappning och utkastshantering följer Zeros Gmail-driver:
// Adapted from Zero (MIT, Copyright (c) 2025 Zero Email) – apps/server/src/lib/driver/google.ts @ 8c170b8. Licens: docs/mail/ZERO-LICENSE.txt
import { parseMessage, summarizeThread, type ParsedMessage, type ThreadSummary } from './parse.ts';

export type GmailRequest = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, opts?: { write?: boolean }) => Promise<any>;

export class GmailApiError extends Error {
  constructor(public status: number, public reason: string, message: string, public retryAfter?: number) { super(message); }
}
/** Mappar HTTP-/Google-fel till stabila koder som UI:t kan visa. */
export function classifyGmailError(status: number, body: any): { code: string; message: string; retryable: boolean } {
  const reason = String(body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? '');
  const message = String(body?.error?.message ?? body?.error_description ?? '');
  if (status === 401) return { code: 'AUTH_EXPIRED', message: 'Google-anslutningen behöver förnyas.', retryable: true };
  if (status === 403 && /insufficient|scope/i.test(reason + message)) return { code: 'SCOPE_NOT_AUTHORIZED', message: 'Google-behörigheten (scope) för den här åtgärden är inte godkänd i Admin Console.', retryable: false };
  if (status === 403 && /rate|quota|userRateLimit/i.test(reason + message)) return { code: 'RATE_LIMITED', message: 'Google begränsar anropen just nu. Försök igen om en stund.', retryable: true };
  if (status === 429) return { code: 'RATE_LIMITED', message: 'Google begränsar anropen just nu. Försök igen om en stund.', retryable: true };
  if (status === 404) return { code: 'NOT_FOUND', message: 'Meddelandet eller tråden finns inte längre.', retryable: false };
  if (status === 400 && /invalid_grant|unauthorized_client/i.test(message + reason)) return { code: 'SCOPE_NOT_AUTHORIZED', message: 'Google-behörigheten är inte godkänd för den här brevlådan.', retryable: false };
  if (status >= 500) return { code: 'GOOGLE_UNAVAILABLE', message: 'Google svarar inte just nu.', retryable: true };
  return { code: 'GOOGLE_ERROR', message: message || 'Google-anropet misslyckades.', retryable: false };
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => { while (true) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i); } });
  await Promise.all(workers); return out;
}

export interface SendAsIdentity { email: string; name: string; replyTo: string; signature: string; isPrimary: boolean; isDefault: boolean; verified: boolean; treatAsAlias: boolean }
export interface GmailLabel { id: string; name: string; type: 'system' | 'user'; color?: { backgroundColor?: string; textColor?: string }; threadsUnread?: number; threadsTotal?: number; labelListVisibility?: string }

const META_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID', 'Content-Type', 'List-Unsubscribe', 'Reply-To'];
const qs = (params: Record<string, string | number | boolean | string[] | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) { if (v === undefined || v === '') continue; if (Array.isArray(v)) v.forEach((x) => p.append(k, x)); else p.set(k, String(v)); }
  const s = p.toString(); return s ? `?${s}` : '';
};

export function createGmail(request: GmailRequest) {
  const api = {
    profile: () => request('GET', '/profile') as Promise<{ emailAddress: string; historyId: string; messagesTotal: number; threadsTotal: number }>,

    async labels(withCounts = false): Promise<GmailLabel[]> {
      const list = await request('GET', '/labels');
      const labels: GmailLabel[] = (list.labels ?? []).map((l: any) => ({ id: l.id, name: l.name, type: l.type === 'system' ? 'system' : 'user', color: l.color, labelListVisibility: l.labelListVisibility }));
      if (!withCounts) return labels;
      const interesting = labels.filter((l) => ['INBOX', 'DRAFT', 'SPAM', 'STARRED', 'TRASH', 'IMPORTANT', 'SENT'].includes(l.id) || l.type === 'user').slice(0, 60);
      await mapLimit(interesting, 6, async (l) => { try { const d = await request('GET', `/labels/${encodeURIComponent(l.id)}`); l.threadsUnread = d.threadsUnread; l.threadsTotal = d.threadsTotal; } catch { /* räknare är valfria */ } });
      return labels;
    },
    createLabel: (name: string, color?: GmailLabel['color']) => request('POST', '/labels', { name, labelListVisibility: 'labelShow', messageListVisibility: 'show', ...(color ? { color } : {}) }, { write: true }),
    updateLabel: (id: string, patch: { name?: string; color?: GmailLabel['color'] }) => request('PATCH', `/labels/${encodeURIComponent(id)}`, patch, { write: true }),
    deleteLabel: (id: string) => request('DELETE', `/labels/${encodeURIComponent(id)}`, undefined, { write: true }),

    async listThreadIds(p: { labelIds?: string[]; q?: string; maxResults?: number; pageToken?: string; includeSpamTrash?: boolean }) {
      const r = await request('GET', `/threads${qs({ labelIds: p.labelIds, q: p.q, maxResults: Math.min(Math.max(p.maxResults ?? 50, 1), 100), pageToken: p.pageToken, includeSpamTrash: p.includeSpamTrash })}`);
      return { ids: (r.threads ?? []).map((t: any) => ({ id: String(t.id), snippet: String(t.snippet ?? ''), historyId: String(t.historyId ?? '') })), nextPageToken: r.nextPageToken as string | undefined, estimate: Number(r.resultSizeEstimate ?? 0) };
    },
    getThreadMetadata: (id: string) => request('GET', `/threads/${encodeURIComponent(id)}${qs({ format: 'metadata', metadataHeaders: META_HEADERS })}`),
    /** Listsida: trådar med sammanfattning (parallellt, begränsad samtidighet). */
    async listThreads(p: { labelIds?: string[]; q?: string; maxResults?: number; pageToken?: string; includeSpamTrash?: boolean; ownEmails?: string[] }) {
      const page = await api.listThreadIds(p);
      const threads = await mapLimit(page.ids, 8, async (t: { id: string }) => { try { return summarizeThread(await api.getThreadMetadata(t.id), p.ownEmails); } catch (e) { if (e instanceof GmailApiError && e.status === 404) return null; throw e; } });
      return { threads: threads.filter((t): t is ThreadSummary => t !== null), nextPageToken: page.nextPageToken ?? null, estimate: page.estimate };
    },
    async getThread(id: string): Promise<{ id: string; historyId: string; messages: ParsedMessage[] }> {
      const t = await request('GET', `/threads/${encodeURIComponent(id)}${qs({ format: 'full' })}`);
      return { id: String(t.id), historyId: String(t.historyId ?? ''), messages: (t.messages ?? []).map(parseMessage) };
    },
    async getMessage(id: string): Promise<ParsedMessage> { return parseMessage(await request('GET', `/messages/${encodeURIComponent(id)}?format=full`)); },
    async getAttachment(messageId: string, attachmentId: string): Promise<{ data: string; size: number }> {
      const r = await request('GET', `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
      return { data: String(r.data ?? ''), size: Number(r.size ?? 0) };
    },

    modifyThread: (id: string, add: string[], remove: string[]) => request('POST', `/threads/${encodeURIComponent(id)}/modify`, { addLabelIds: add, removeLabelIds: remove }, { write: true }),
    async modifyThreads(ids: string[], add: string[], remove: string[]) { await mapLimit(ids, 6, (id) => api.modifyThread(id, add, remove)); },
    trashThread: (id: string) => request('POST', `/threads/${encodeURIComponent(id)}/trash`, undefined, { write: true }),
    untrashThread: (id: string) => request('POST', `/threads/${encodeURIComponent(id)}/untrash`, undefined, { write: true }),

    createDraft: (rawBase64Url: string, threadId?: string) => request('POST', '/drafts', { message: { raw: rawBase64Url, ...(threadId ? { threadId } : {}) } }, { write: true }),
    updateDraft: (draftId: string, rawBase64Url: string, threadId?: string) => request('PUT', `/drafts/${encodeURIComponent(draftId)}`, { id: draftId, message: { raw: rawBase64Url, ...(threadId ? { threadId } : {}) } }, { write: true }),
    deleteDraft: (draftId: string) => request('DELETE', `/drafts/${encodeURIComponent(draftId)}`, undefined, { write: true }),
    async getDraft(draftId: string): Promise<{ id: string; message: ParsedMessage }> { const d = await request('GET', `/drafts/${encodeURIComponent(draftId)}?format=full`); return { id: String(d.id), message: parseMessage(d.message) }; },
    async listDrafts(pageToken?: string) { const r = await request('GET', `/drafts${qs({ maxResults: 50, pageToken })}`); return { drafts: (r.drafts ?? []).map((d: any) => ({ id: String(d.id), messageId: String(d.message?.id ?? ''), threadId: String(d.message?.threadId ?? '') })), nextPageToken: r.nextPageToken as string | undefined }; },

    send: (rawBase64Url: string, threadId?: string) => request('POST', '/messages/send', { raw: rawBase64Url, ...(threadId ? { threadId } : {}) }, { write: true }) as Promise<{ id: string; threadId: string; labelIds?: string[] }>,
    /** Letar upp ett redan skickat meddelande via vårt eget Message-ID (för osäkra utfall). */
    async findByMessageId(messageIdHeader: string): Promise<{ id: string; threadId: string } | null> {
      const id = messageIdHeader.replace(/^<|>$/g, '');
      const r = await request('GET', `/messages${qs({ q: `rfc822msgid:${id}`, maxResults: 1, includeSpamTrash: true })}`);
      const m = r.messages?.[0]; return m ? { id: String(m.id), threadId: String(m.threadId) } : null;
    },

    async sendAs(): Promise<SendAsIdentity[]> {
      const r = await request('GET', '/settings/sendAs');
      return (r.sendAs ?? []).map((s: any) => ({ email: String(s.sendAsEmail).toLowerCase(), name: String(s.displayName ?? ''), replyTo: String(s.replyToAddress ?? ''), signature: String(s.signature ?? ''), isPrimary: Boolean(s.isPrimary), isDefault: Boolean(s.isDefault), verified: !s.verificationStatus || s.verificationStatus === 'accepted', treatAsAlias: s.treatAsAlias !== false }));
    },

    /** Inkrementell synk: vilka trådar har ändrats sedan historyId. `expired` = historyId för gammalt (Gmail ger 404) → full omladdning. */
    async changesSince(startHistoryId: string, maxPages = 5): Promise<{ changedThreadIds: string[]; historyId: string; expired: boolean; newInboxMessages: { id: string; threadId: string }[] }> {
      const changed = new Set<string>(); const fresh: { id: string; threadId: string }[] = []; let pageToken: string | undefined; let historyId = startHistoryId;
      try {
        for (let page = 0; page < maxPages; page++) {
          const r = await request('GET', `/history${qs({ startHistoryId, pageToken, maxResults: 500 })}`);
          historyId = String(r.historyId ?? historyId);
          for (const h of r.history ?? []) {
            for (const key of ['messagesAdded', 'messagesDeleted', 'labelsAdded', 'labelsRemoved']) for (const x of h[key] ?? []) if (x.message?.threadId) changed.add(String(x.message.threadId));
            for (const x of h.messagesAdded ?? []) if ((x.message?.labelIds ?? []).includes('INBOX') && !(x.message?.labelIds ?? []).includes('SENT')) fresh.push({ id: String(x.message.id), threadId: String(x.message.threadId) });
          }
          pageToken = r.nextPageToken; if (!pageToken) break;
        }
      } catch (e) {
        if (e instanceof GmailApiError && e.status === 404) return { changedThreadIds: [], historyId: startHistoryId, expired: true, newInboxMessages: [] };
        throw e;
      }
      return { changedThreadIds: [...changed], historyId, expired: false, newInboxMessages: fresh };
    },
  };
  return api;
}
export type GmailClient = ReturnType<typeof createGmail>;

/** Systemetiketter som UI:t arbetar med. */
export const FOLDER_LABELS: Record<string, { labelIds: string[]; q?: string; includeSpamTrash?: boolean }> = {
  inbox: { labelIds: ['INBOX'] }, starred: { labelIds: ['STARRED'] }, sent: { labelIds: ['SENT'] }, drafts: { labelIds: ['DRAFT'] },
  spam: { labelIds: ['SPAM'], includeSpamTrash: true }, trash: { labelIds: ['TRASH'], includeSpamTrash: true }, important: { labelIds: ['IMPORTANT'] },
  snoozed: { labelIds: [] }, scheduled: { labelIds: [] }, all: { labelIds: [] },
};
