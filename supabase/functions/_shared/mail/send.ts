// Säkert utskick för VI-HEM Mail: avsändarvalidering, idempotens via utskicksregister och hantering av osäkra utfall.
// Regler (docs/mail/PLAN.md §9): registerrad skapas FÖRE Gmail-anropet; nätverksfel → status "unknown"; ett nytt försök med samma
// client_request_id söker först i Gmail efter vårt eget Message-ID och skickar bara om meddelandet verkligen saknas. Samma id kan aldrig ge två utskick.
import { GmailApiError, type GmailClient, type SendAsIdentity } from './gmail.ts';
import { buildMime, newMessageId, type OutgoingAttachment } from './mime.ts';
import type { MailAddress } from './parse.ts';

export interface SendRequest {
  clientRequestId: string; from: string; fromName?: string; replyTo?: string; to: MailAddress[]; cc?: MailAddress[]; bcc?: MailAddress[]; subject: string; html: string;
  attachments?: OutgoingAttachment[]; threadId?: string; inReplyTo?: string; references?: string; scheduleAt?: string | null; draftId?: string;
}
export interface LedgerRow { id: string; status: 'scheduled' | 'sending' | 'sent' | 'unknown' | 'failed' | 'cancelled'; request_hash: string; message_id_header: string; gmail_message_id: string | null; thread_id: string | null; updated_at: string; attempts: number; payload?: SendRequest | null }
export interface LedgerStore {
  find(accountId: string, requestId: string): Promise<LedgerRow | null>;
  insert(row: Record<string, unknown>): Promise<LedgerRow>;
  update(id: string, patch: Record<string, unknown>): Promise<void>;
}
export class SendError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }

/** Avsändaren måste vara en verifierad Send-As-identitet i den valda brevlådan. Litar aldrig på fromEmail från klienten. */
export function resolveIdentity(identities: SendAsIdentity[], from: string): SendAsIdentity {
  const wanted = from.trim().toLowerCase();
  const match = identities.find((i) => i.email === wanted);
  if (!match) throw new SendError('E_SENDER_FORBIDDEN', 'Avsändaradressen tillhör inte den här brevlådan.', 403);
  if (!match.verified) throw new SendError('E_SENDER_UNVERIFIED', 'Avsändaradressen är inte verifierad i Gmail och kan inte användas.', 403);
  return match;
}

export async function requestHash(req: SendRequest): Promise<string> {
  const canonical = JSON.stringify({ f: req.from.toLowerCase(), t: req.to.map((a) => a.email.toLowerCase()), c: (req.cc ?? []).map((a) => a.email.toLowerCase()), b: (req.bcc ?? []).map((a) => a.email.toLowerCase()), s: req.subject, h: req.html, a: (req.attachments ?? []).map((x) => [x.name, x.base64.length]), th: req.threadId ?? '', sc: req.scheduleAt ?? '' });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const isUncertain = (e: unknown) => !(e instanceof GmailApiError) || e.status >= 500 || e.status === 408 || e.status === 0;

export interface SendDeps { store: LedgerStore; gmail: GmailClient; identities: SendAsIdentity[]; accountId: string; organisationId: string; userId: string; domain: string; now?: () => number; ledgerBase: Record<string, unknown> }
export interface SendResult { status: 'sent' | 'scheduled' | 'in_progress' | 'unknown' | 'failed'; ledgerId: string; gmailMessageId?: string | null; threadId?: string | null; message?: string }

async function deliver(deps: SendDeps, row: LedgerRow, req: SendRequest, identity: SendAsIdentity): Promise<SendResult> {
  const built = buildMime({ from: { name: req.fromName ?? identity.name, email: identity.email }, to: req.to, cc: req.cc, bcc: req.bcc, replyTo: req.replyTo ? { name: '', email: req.replyTo } : identity.replyTo ? { name: '', email: identity.replyTo } : null,
    subject: req.subject, html: req.html, attachments: req.attachments, inReplyTo: req.inReplyTo, references: req.references, messageId: row.message_id_header });
  await deps.store.update(row.id, { status: 'sending', attempts: row.attempts + 1, updated_at: new Date().toISOString() });
  try {
    const sent = await deps.gmail.send(built.rawBase64Url, req.threadId);
    await deps.store.update(row.id, { status: 'sent', gmail_message_id: sent.id, thread_id: sent.threadId, sent_at: new Date().toISOString(), payload: null, last_error: '', updated_at: new Date().toISOString() });
    return { status: 'sent', ledgerId: row.id, gmailMessageId: sent.id, threadId: sent.threadId };
  } catch (e) {
    const uncertain = isUncertain(e); const message = e instanceof Error ? e.message : String(e);
    await deps.store.update(row.id, { status: uncertain ? 'unknown' : 'failed', last_error: message.slice(0, 500), updated_at: new Date().toISOString() });
    if (uncertain) return { status: 'unknown', ledgerId: row.id, message: 'Utfallet är osäkert – kontrollera Skickat innan du försöker igen. Ett nytt försök skickar inte dubbelt.' };
    throw e;
  }
}

/** Skickar (eller schemalägger) ett meddelande exakt en gång per clientRequestId. */
export async function sendMessage(deps: SendDeps, req: SendRequest): Promise<SendResult> {
  if (!/^[0-9a-f-]{36}$/i.test(req.clientRequestId)) throw new SendError('E_INVALID', 'Ogiltigt begäran-id.');
  const identity = resolveIdentity(deps.identities, req.from);
  if (!req.to?.length && !req.cc?.length && !req.bcc?.length) throw new SendError('E_RECIPIENT', 'Minst en mottagare krävs.');
  const hash = await requestHash(req);
  const now = deps.now?.() ?? Date.now();
  const existing = await deps.store.find(deps.accountId, req.clientRequestId);
  if (existing) {
    if (existing.request_hash !== hash) throw new SendError('E_CONFLICT', 'Samma begäran-id har redan använts för ett annat meddelande.', 409);
    if (existing.status === 'sent') return { status: 'sent', ledgerId: existing.id, gmailMessageId: existing.gmail_message_id, threadId: existing.thread_id };
    if (existing.status === 'scheduled') return { status: 'scheduled', ledgerId: existing.id };
    if (existing.status === 'cancelled') throw new SendError('E_CANCELLED', 'Utskicket är avbrutet.', 409);
    if (existing.status === 'sending' && now - Date.parse(existing.updated_at) < 60_000) return { status: 'in_progress', ledgerId: existing.id, message: 'Utskicket pågår.' };
    // sending (gammalt) / unknown / failed: kontrollera i Gmail innan något nytt skickas
    const found = await deps.gmail.findByMessageId(existing.message_id_header);
    if (found) { await deps.store.update(existing.id, { status: 'sent', gmail_message_id: found.id, thread_id: found.threadId, sent_at: new Date().toISOString(), payload: null, updated_at: new Date().toISOString() }); return { status: 'sent', ledgerId: existing.id, gmailMessageId: found.id, threadId: found.threadId }; }
    return deliver(deps, existing, req, identity);
  }
  const scheduled = req.scheduleAt ? Date.parse(req.scheduleAt) : NaN;
  const isScheduled = Number.isFinite(scheduled) && scheduled > now + 30_000;
  if (req.scheduleAt && !Number.isFinite(scheduled)) throw new SendError('E_INVALID', 'Ogiltig tidpunkt för schemalagd sändning.');
  const row = await deps.store.insert({ ...deps.ledgerBase, client_request_id: req.clientRequestId, status: isScheduled ? 'scheduled' : 'sending', from_email: identity.email, to_emails: [...req.to, ...(req.cc ?? []), ...(req.bcc ?? [])].map((a) => a.email.toLowerCase()), subject: req.subject.slice(0, 300), message_id_header: newMessageId(deps.domain),
    thread_id: req.threadId ?? null, request_hash: hash, scheduled_for: isScheduled ? new Date(scheduled).toISOString() : null, payload: isScheduled ? req : null });
  if (isScheduled) return { status: 'scheduled', ledgerId: row.id };
  return deliver(deps, row, req, identity);
}

/** Arbetaren: skickar förfallna schemalagda meddelanden (samma säkra väg: Message-ID-kontroll innan nytt försök). */
export async function sendDueScheduled(deps: SendDeps, row: LedgerRow): Promise<SendResult> {
  const req = row.payload as SendRequest | null;
  if (!req) throw new SendError('E_STATE', 'Schemalagt utskick saknar innehåll.');
  const found = row.attempts > 0 ? await deps.gmail.findByMessageId(row.message_id_header) : null;
  if (found) { await deps.store.update(row.id, { status: 'sent', gmail_message_id: found.id, thread_id: found.threadId, sent_at: new Date().toISOString(), payload: null }); return { status: 'sent', ledgerId: row.id, gmailMessageId: found.id, threadId: found.threadId }; }
  return deliver(deps, row, req, resolveIdentity(deps.identities, req.from));
}
