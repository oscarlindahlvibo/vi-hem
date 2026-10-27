import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArrowLeft, Clock, Download, FileDown, Forward, ImageOff, Loader2, Mail, MailOpen, Paperclip, PanelRight, Reply, ReplyAll, Star, Trash2, AlertTriangle, ChevronDown } from 'lucide-react';
import { MessageBody } from './MessageBody';
import { downloadAttachment, previewAttachment, saveAttachmentToDocuments } from './attachments';
import { mailApi, MailApiError } from '../lib/api';
import { avatarColor, displayName, formatBytes, fullDate, initials } from '../lib/format';
import { useToasts } from '../hooks/useToasts';
import type { MailAccount, MailAttachment, ParsedMessage } from '../lib/types';

export interface LoadedThread { id: string; subject: string; messages: ParsedMessage[]; labelIds?: string[] }
export type ReplyMode = 'reply' | 'replyAll' | 'forward';
interface Props {
  account: MailAccount; threadId: string; ownEmails: string[]; remoteImages: 'never' | 'ask' | 'always'; organisationId: string; userId: string; trusted?: boolean;
  onBack: () => void; onAction: (op: string) => void; onSnooze: () => void; onReply: (mode: ReplyMode, thread: LoadedThread, message: ParsedMessage) => void; onLoaded?: (t: LoadedThread) => void; sideOpen?: boolean; onToggleSide?: () => void; reloadKey?: number;
}

const Person = ({ a }: { a: { name: string; email: string } }) => <span title={a.email}>{displayName(a)}</span>;

/** Trådvy: alla meddelanden i tråden (senaste öppet), säker HTML-rendering, bilagor, svara/svara alla/vidarebefordra samt trådåtgärder. */
export function ThreadView({ account, threadId, ownEmails, remoteImages, organisationId, userId, onBack, onAction, onSnooze, onReply, onLoaded, sideOpen, onToggleSide, reloadKey }: Props) {
  const toast = useToasts();
  const [thread, setThread] = useState<LoadedThread | null>(null); const [error, setError] = useState(''); const [open, setOpen] = useState<Set<string>>(new Set()); const [allowed, setAllowed] = useState<Set<string>>(new Set()); const [blocked, setBlocked] = useState<Record<string, number>>({});
  const [busyAtt, setBusyAtt] = useState(''); const topRef = useRef<HTMLDivElement>(null); const canManage = account.levels.manage; const canSend = account.levels.send;
  const load = useCallback(async () => {
    setError('');
    try {
      const r = await mailApi<{ thread: LoadedThread }>('thread_get', { account_id: account.id, thread_id: threadId });
      const msgs = r.thread.messages; const loaded = { ...r.thread, subject: r.thread.subject || msgs.find((m) => m.subject)?.subject || '' }; setThread(loaded); onLoaded?.(loaded);
      const unreadIds = msgs.filter((m) => m.unread).map((m) => m.id);
      setOpen(new Set(msgs.length ? [msgs[msgs.length - 1].id, ...unreadIds] : []));
      if (msgs.some((m) => m.unread) && canManage) void mailApi('thread_modify', { account_id: account.id, thread_ids: [threadId], op: 'read' }).catch(() => {});
    } catch (e) { setError(e instanceof MailApiError ? e.message : 'Kunde inte öppna tråden.'); }
  }, [account.id, threadId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setThread(null); void load(); }, [load, reloadKey]);
  useEffect(() => { topRef.current?.scrollTo({ top: 0 }); }, [threadId]);
  // Långa konversationer: scrolla till det senaste (öppna) meddelandet så man inte hamnar bland de äldre.
  useEffect(() => { if (!thread || thread.messages.length < 4) return; const t = window.setTimeout(() => topRef.current?.querySelector('[data-last="true"]')?.scrollIntoView({ block: 'start' }), 120); return () => window.clearTimeout(t); }, [thread?.id, thread?.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"><AlertTriangle className="h-8 w-8 text-amber-500" /><p className="max-w-sm text-sm text-slate-600">{error}</p><div className="flex gap-2"><button onClick={() => void load()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">Försök igen</button><button onClick={onBack} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Tillbaka</button></div></div>;
  if (!thread) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;

  const msgs = thread.messages; const last = msgs[msgs.length - 1]; const starred = msgs.some((m) => m.starred); const own = new Set(ownEmails.map((e) => e.toLowerCase()));
  const act = (op: string) => onAction(op);
  const iconBtn = 'rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40';
  const saveDoc = async (a: MailAttachment) => { setBusyAtt(a.id); try { await saveAttachmentToDocuments(account.id, threadId, a, { organisationId, userId, subject: thread.subject }); toast.show(`"${a.filename}" sparades i Dokument och kopplades till tråden.`, { kind: 'success' }); } catch (e) { toast.show((e as Error).message || 'Kunde inte spara bilagan.', { kind: 'error' }); } finally { setBusyAtt(''); } };
  const allowImages = (id: string) => setAllowed((s) => new Set(s).add(id));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-1.5 sm:px-3">
        <button type="button" onClick={onBack} className={`${iconBtn} lg:hidden`} aria-label="Tillbaka till listan"><ArrowLeft className="h-5 w-5" /></button>
        <button type="button" disabled={!canManage} onClick={() => act('archive')} className={iconBtn} title="Arkivera (e)" aria-label="Arkivera"><Archive className="h-[18px] w-[18px]" /></button>
        <button type="button" disabled={!canManage} onClick={() => act(thread.labelIds?.includes('TRASH') ? 'untrash' : 'trash')} className={iconBtn} title="Radera (#)" aria-label="Radera"><Trash2 className="h-[18px] w-[18px]" /></button>
        <button type="button" disabled={!canManage} onClick={() => act('spam')} className={`${iconBtn} hidden sm:block`} title="Skräppost (!)" aria-label="Markera som skräppost"><AlertTriangle className="h-[18px] w-[18px]" /></button>
        <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
        <button type="button" disabled={!canManage} onClick={() => act('unread')} className={iconBtn} title="Markera som oläst (u)" aria-label="Markera som oläst"><Mail className="h-[18px] w-[18px]" /></button>
        <button type="button" disabled={!canManage} onClick={onSnooze} className={iconBtn} title="Snooza (b)" aria-label="Snooza"><Clock className="h-[18px] w-[18px]" /></button>
        <button type="button" disabled={!canManage} onClick={() => act(starred ? 'unstar' : 'star')} className={`${iconBtn} ${starred ? '!text-amber-500' : ''}`} title="Stjärnmarkera (s)" aria-label={starred ? 'Ta bort stjärna' : 'Stjärnmarkera'} aria-pressed={starred}><Star className={`h-[18px] w-[18px] ${starred ? 'fill-current' : ''}`} /></button>
        <div className="flex-1" />
        {onToggleSide && <button type="button" onClick={onToggleSide} className={`${iconBtn} ${sideOpen ? 'bg-blue-50 !text-blue-700' : ''}`} title="Ärende och kopplingar" aria-label="Visa ärende och kopplingar" aria-pressed={sideOpen}><PanelRight className="h-[18px] w-[18px]" /></button>}
      </div>
      <div ref={topRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto w-full min-w-0 max-w-3xl px-4 py-5 sm:px-6">
          <h1 className="text-xl font-bold leading-snug text-slate-900 sm:text-2xl">{thread.subject || '(inget ämne)'}</h1>
          <p className="mt-1 text-xs text-slate-500">{msgs.length} {msgs.length === 1 ? 'meddelande' : 'meddelanden'} · {account.email}</p>
          <ol className="mt-5 space-y-3">
            {msgs.map((m, idx) => {
              const isOpen = open.has(m.id); const mine = own.has(m.from.email.toLowerCase()); const toggle = () => setOpen((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; });
              const files = m.attachments.filter((a) => !a.inline || !a.contentId || !/cid:/i.test(m.html));
              return <li key={m.id} data-last={idx === msgs.length - 1 ? 'true' : undefined} className={`min-w-0 overflow-hidden rounded-2xl border ${m.unread ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200'}`}>
                <button type="button" onClick={toggle} aria-expanded={isOpen} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: avatarColor(m.from.email) }} aria-hidden>{initials(m.from.name, m.from.email)}</span>
                  <span className="min-w-0 flex-1"><span className="flex items-baseline gap-2"><span className="truncate text-sm font-bold text-slate-900">{mine ? 'Du' : <Person a={m.from} />}</span>{m.isDraft && <span className="rounded bg-red-100 px-1.5 text-[11px] font-bold text-red-700">Utkast</span>}<span className="ml-auto shrink-0 text-xs text-slate-500">{fullDate(m.internalDate || m.date)}</span></span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">{isOpen ? `till ${m.to.map(displayName).join(', ') || '—'}${m.cc.length ? ` · kopia ${m.cc.map(displayName).join(', ')}` : ''}` : m.snippet}</span></span>
                  <ChevronDown className={`mt-2 h-4 w-4 shrink-0 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                  <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-slate-500"><dt>Från</dt><dd className="break-all">{m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email}</dd><dt>Till</dt><dd className="break-all">{m.to.map((a) => a.email).join(', ') || '—'}</dd>{m.cc.length > 0 && <><dt>Kopia</dt><dd className="break-all">{m.cc.map((a) => a.email).join(', ')}</dd></>}{m.bcc.length > 0 && <><dt>Dold</dt><dd className="break-all">{m.bcc.map((a) => a.email).join(', ')}</dd></>}{m.replyTo && <><dt>Svar till</dt><dd className="break-all">{m.replyTo.email}</dd></>}</dl>
                  {blocked[m.id] > 0 && !allowed.has(m.id) && remoteImages !== 'always' && <div className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900"><ImageOff className="h-4 w-4 shrink-0" /><span className="flex-1">Externa bilder blockerades för att skydda din integritet.</span><button type="button" onClick={() => allowImages(m.id)} className="font-bold underline">Visa bilder</button></div>}
                  <MessageBody message={m} accountId={account.id} allowRemoteImages={remoteImages === 'always' || allowed.has(m.id)} onBlocked={(n) => setBlocked((b) => (b[m.id] === n ? b : { ...b, [m.id]: n }))} />
                  {files.length > 0 && <ul className="mt-4 grid gap-2 sm:grid-cols-2">{files.map((a) => <li key={a.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 text-sm"><Paperclip className="h-4 w-4 shrink-0 text-slate-400" /><button type="button" onClick={() => void previewAttachment(account.id, a).catch((e) => toast.show(e.message, { kind: 'error' }))} className="min-w-0 flex-1 text-left"><div className="truncate font-semibold">{a.filename || 'Bilaga'}</div><div className="text-xs text-slate-500">{formatBytes(a.size)}</div></button>
                    <button type="button" title="Ladda ner" aria-label={`Ladda ner ${a.filename}`} onClick={() => void downloadAttachment(account.id, a).catch((e) => toast.show(e.message, { kind: 'error' }))} className="rounded-lg p-1.5 text-slate-500 hover:bg-white"><Download className="h-4 w-4" /></button>
                    {canManage && <button type="button" title="Spara i Dokument" aria-label={`Spara ${a.filename} i Dokument`} disabled={busyAtt === a.id} onClick={() => void saveDoc(a)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white">{busyAtt === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}</button>}</li>)}</ul>}
                </div>}
              </li>;
            })}
          </ol>
          {canSend && last && <div className="sticky bottom-0 z-10 -mx-4 mt-5 flex flex-wrap gap-2 border-t border-slate-100 bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:-mx-6 sm:px-6 lg:pb-6">
            <button type="button" onClick={() => onReply('reply', thread, last)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"><Reply className="h-4 w-4" />Svara</button>
            {(last.to.length + last.cc.length > 1 || msgs.some((m) => m.cc.length)) && <button type="button" onClick={() => onReply('replyAll', thread, last)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"><ReplyAll className="h-4 w-4" />Svara alla</button>}
            <button type="button" onClick={() => onReply('forward', thread, last)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"><Forward className="h-4 w-4" />Vidarebefordra</button>
          </div>}
          {!canSend && <p className="mt-5 flex items-center gap-2 pb-24 text-xs text-slate-500 lg:pb-6"><MailOpen className="h-4 w-4" />Du har läsbehörighet i den här brevlådan men inte rätt att skicka.</p>}
        </div>
      </div>
    </div>
  );
}
