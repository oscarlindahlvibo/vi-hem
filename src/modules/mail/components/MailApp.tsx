import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, ArrowLeft, ChevronDown, Clock, Inbox, Loader2, Mail, MailOpen, Menu, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { ThreadList, threadKey, type RowAction } from './ThreadList';
import { ThreadView, type LoadedThread, type ReplyMode } from './ThreadView';
import { ThreadSidePanel } from './ThreadSidePanel';
import { Composer, type ComposeSeed, type TemplateRow } from './Composer';
import { base64UrlToBlob, mailApi, MailApiError } from '../lib/api';
import { forwardHtml, quoteHtml, replyRecipients } from '../lib/compose';
import { sanitizeComposerHtml } from '../lib/sanitize';
import { nextMonday, nextMorning, toLocalInput } from '../lib/format';
import { scrollAppTo } from '../../../lib/utils';
import { clearListCache, useThreadList, type Folder } from '../hooks/useThreadList';
import { ToastProvider, useToasts } from '../hooks/useToasts';
import type { GmailLabel, MailAccount, MailAddress, MailPrefs, ParsedMessage, SendAsIdentity, ThreadSummary } from '../lib/types';

const MailSettings = lazy(() => import('./MailSettings'));
const AdminMailboxes = lazy(() => import('./AdminMailboxes'));

interface Boot { user: { id: string; name: string; role: string; organisation_id: string }; accounts: MailAccount[]; prefs: MailPrefs; is_org_admin: boolean }
interface Ctx { labels: GmailLabel[]; identities: SendAsIdentity[]; error?: string }
const INVERSE: Record<string, string> = { archive: 'unarchive', trash: 'untrash', untrash: 'trash', spam: 'unspam', read: 'unread', unread: 'read', star: 'unstar', unstar: 'star' };
const reSubject = (s = '') => (/^(re|sv|aw)\s*:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`.trim());
const fwSubject = (s = '') => (/^(fwd?|vb)\s*:/i.test(s.trim()) ? s.trim() : `Fwd: ${s.trim()}`.trim());
const FOLDER_TITLES: Record<string, string> = { inbox: 'Inkorg', starred: 'Stjärnmärkta', snoozed: 'Snoozade', sent: 'Skickade', drafts: 'Utkast', scheduled: 'Schemalagda', archive: 'Arkiv', all: 'All e-post', spam: 'Skräppost', trash: 'Papperskorg', search: 'Sökresultat', label: 'Etikett' };

export default function MailApp({ onNavigate }: { onNavigate: (page: string) => void }) {
  return <ToastProvider><MailShell onNavigate={onNavigate} /></ToastProvider>;
}

function MailShell({ onNavigate }: { onNavigate: (page: string) => void }) {
  const toast = useToasts();
  const [boot, setBoot] = useState<Boot | null>(null); const [bootError, setBootError] = useState('');
  const [ctxs, setCtxs] = useState<Record<string, Ctx>>({}); const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [scope, setScope] = useState('all'); const [folder, setFolder] = useState<Folder>('inbox'); const [labelId, setLabelId] = useState<string | undefined>();
  const [query, setQuery] = useState(''); const [draftQuery, setDraftQuery] = useState('');
  const [selected, setSelected] = useState<ThreadSummary | null>(null); const [checked, setChecked] = useState<Set<string>>(new Set()); const [focusKey, setFocusKey] = useState<string | null>(null);
  const [panel, setPanel] = useState<'mail' | 'settings' | 'admin'>('mail'); const [drawer, setDrawer] = useState(false); const [side, setSide] = useState(false); const [helpOpen, setHelpOpen] = useState(false);
  const [compose, setCompose] = useState<{ key: number; account: MailAccount; seed: ComposeSeed } | null>(null); const [snoozeFor, setSnoozeFor] = useState<ThreadSummary[] | null>(null); const [reloadKey, setReloadKey] = useState(0);
  // E-postytan fyller skärmen och scrollar internt: lås sidans egen scroll så man inte råkar dra hela sidan (särskilt på mobil).
  useEffect(() => {
    scrollAppTo(0); const root = document.getElementById('root'); const prev = [document.body.style.overflow, root?.style.overflow ?? '']; document.body.style.overflow = 'hidden'; if (root) root.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev[0]; if (root) root.style.overflow = prev[1]; };
  }, []);
  // Dölj flytande bottenmenyn när något ligger över sidan (meny, skrivruta, dialoger) så den inte täcker knappar.
  const overlayOpen = drawer || Boolean(compose) || Boolean(snoozeFor) || helpOpen || side;
  useEffect(() => { if (!overlayOpen) return; document.documentElement.setAttribute('data-overlay-open', 'true'); return () => document.documentElement.removeAttribute('data-overlay-open'); }, [overlayOpen]);
  // På mobil/iPad-liggande utan sidomeny får e-post hela skärmen: bottenmenyn döljs medan e-post är öppet och höjden mäts mot visningsytan.
  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.documentElement.setAttribute('data-mail-fullscreen', 'true');
    const fit = () => { const el = shellRef.current; if (!el) return; if (window.innerWidth >= 1024) { el.style.height = ''; return; } const vh = window.visualViewport?.height ?? window.innerHeight; el.style.height = `${Math.max(420, Math.floor(vh - el.getBoundingClientRect().top - 8))}px`; };
    fit(); window.addEventListener('resize', fit); window.visualViewport?.addEventListener('resize', fit); const t = window.setTimeout(fit, 300);
    return () => { document.documentElement.removeAttribute('data-mail-fullscreen'); window.removeEventListener('resize', fit); window.visualViewport?.removeEventListener('resize', fit); window.clearTimeout(t); };
  }, [panel]);
  const composeKey = useRef(1); const searchRef = useRef<HTMLInputElement>(null); const loadedThread = useRef<LoadedThread | null>(null);

  const loadBoot = useCallback(async () => {
    try {
      const b = await mailApi<Boot>('bootstrap'); setBoot(b); setBootError('');
      setScope(b.accounts.length === 1 ? b.accounts[0].id : b.prefs.default_account_id && b.accounts.some((a) => a.id === b.prefs.default_account_id) ? b.prefs.default_account_id : 'all');
      void mailApi<{ templates: { id: string; scope: string; name: string; subject: string; body_html: string }[] }>('templates_list').then((r) => setTemplates(r.templates.map((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body_html, shared: t.scope === 'organisation' })))).catch(() => {});
      await Promise.all(b.accounts.map(async (a) => { try { const c = await mailApi<Ctx>('account_context', { account_id: a.id }); setCtxs((m) => ({ ...m, [a.id]: c })); } catch (e) { setCtxs((m) => ({ ...m, [a.id]: { labels: [], identities: [], error: e instanceof MailApiError ? e.message : 'Fel' } })); } }));
    } catch (e) { setBootError(e instanceof MailApiError ? e.message : 'Kunde inte starta e-post.'); }
  }, []);
  useEffect(() => { void loadBoot(); }, [loadBoot]);

  const accounts = useMemo(() => boot?.accounts ?? [], [boot]);
  const effective = useMemo(() => (scope === 'all' ? accounts : accounts.filter((a) => a.id === scope)), [scope, accounts]);
  const list = useThreadList({ accounts: effective, folder, labelId, query }, panel === 'mail' && Boolean(boot));
  const accountOf = useCallback((id?: string) => accounts.find((a) => a.id === id), [accounts]);
  const unread = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, ctxs[a.id]?.labels.find((l) => l.id === 'INBOX')?.threadsUnread ?? 0])), [accounts, ctxs]);
  const labelsForScope = scope === 'all' ? [] : ctxs[scope]?.labels ?? [];
  const ownFor = useCallback((a: MailAccount) => [a.email, ...(ctxs[a.id]?.identities.map((i) => i.email) ?? [])], [ctxs]);
  const selectedAccount = selected ? accountOf(selected.account_id) : undefined;
  const authFailed = Object.values(ctxs).find((c) => c.error);

  // ------------------------------------------------------------------ trådåtgärder (optimistiska, med ångra)
  const modify = useCallback(async (threads: ThreadSummary[], op: string, extra: Record<string, unknown> = {}, undo = true) => {
    if (!threads.length) return;
    const ids = threads.map((t) => ({ account_id: t.account_id, id: t.id }));
    const removes = (op === 'archive' && ['inbox', 'label', 'snoozed'].includes(folder)) || (op === 'trash' && folder !== 'trash') || (op === 'untrash' && folder === 'trash') || (op === 'spam' && folder !== 'spam') || (op === 'unstar' && folder === 'starred') || (op === 'unspam' && folder === 'spam');
    list.patch(ids, (t) => (removes ? null : { ...t, unread: op === 'unread' ? true : op === 'read' ? false : t.unread, starred: op === 'star' ? true : op === 'unstar' ? false : t.starred }));
    if (removes && selected && ids.some((i) => i.id === selected.id && i.account_id === selected.account_id)) setSelected(null);
    setChecked(new Set());
    const byAccount = new Map<string, string[]>(); for (const t of threads) byAccount.set(t.account_id!, [...(byAccount.get(t.account_id!) ?? []), t.id]);
    try {
      await Promise.all([...byAccount].map(([account_id, thread_ids]) => mailApi('thread_modify', { account_id, thread_ids, op, ...extra })));
      const text = ({ archive: 'Arkiverad', trash: 'Flyttad till papperskorgen', spam: 'Markerad som skräppost', untrash: 'Återställd', unspam: 'Inte skräppost' } as Record<string, string>)[op];
      if (text && undo) toast.show(`${threads.length > 1 ? `${threads.length} trådar` : 'Tråden'}: ${text.toLowerCase()}`, { actionLabel: 'Ångra', onAction: () => void modify(threads, INVERSE[op], {}, false).then(() => list.refresh()) });
    } catch (e) {
      toast.show(e instanceof MailApiError && e.code === 'SCOPE_NOT_AUTHORIZED' ? 'Ändringen sparades inte: Google-behörigheten för att ändra e-post (gmail.modify) är inte godkänd ännu.' : (e as Error).message, { kind: 'error', ms: 9000 }); void list.refresh();
    }
  }, [folder, list, selected, toast]);

  const onRowAction = useCallback((t: ThreadSummary, a: RowAction) => { if (a === 'snooze') setSnoozeFor([t]); else void modify([t], a); }, [modify]);
  const doSnooze = async (threads: ThreadSummary[], at: Date) => {
    setSnoozeFor(null);
    try { await Promise.all(threads.map((t) => mailApi('snooze', { account_id: t.account_id, thread_id: t.id, wake_at: at.toISOString() }))); list.patch(threads.map((t) => ({ account_id: t.account_id, id: t.id })), () => null); if (selected && threads.some((t) => t.id === selected.id)) setSelected(null); toast.show(`Snoozad till ${at.toLocaleString('sv-SE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`, { kind: 'success' }); }
    catch (e) { toast.show((e as Error).message, { kind: 'error' }); }
  };

  // ------------------------------------------------------------------ skriva, svara, vidarebefordra
  const openCompose = useCallback((account: MailAccount | undefined, seed: ComposeSeed = {}) => {
    const acc = account ?? (scope !== 'all' ? accountOf(scope) : undefined) ?? accounts.find((a) => a.levels.send) ;
    if (!acc || !acc.levels.send) { toast.show('Du har inte behörighet att skicka från någon brevlåda.', { kind: 'error' }); return; }
    if (compose && !window.confirm('Ett meddelande är redan öppet. Utkastet sparas automatiskt – byta ändå?')) return;
    setCompose({ key: composeKey.current++, account: acc, seed });
  }, [accounts, accountOf, compose, scope, toast]);
  const startReply = useCallback(async (mode: ReplyMode, thread: LoadedThread, m: ParsedMessage) => {
    const account = selectedAccount ?? accountOf(selected?.account_id); if (!account) return;
    const own = ownFor(account); const hint = { deliveredTo: m.deliveredTo, to: m.to.map((a) => a.email), cc: m.cc.map((a) => a.email) };
    if (mode === 'forward') {
      let attachments: NonNullable<ComposeSeed['attachments']> = [];
      const files = m.attachments.filter((a) => !a.inline && a.size < 10 * 1024 * 1024).slice(0, 10);
      try { attachments = await Promise.all(files.map(async (a) => { const r = await mailApi<{ data: string }>('attachment_get', { account_id: account.id, message_id: m.id, attachment_id: a.id }); const b64 = r.data.replace(/-/g, '+').replace(/_/g, '/'); return { name: a.filename, type: a.mimeType, size: a.size, base64: b64 + '='.repeat((4 - (b64.length % 4)) % 4) }; })); }
      catch { toast.show('Bilagorna kunde inte hämtas och följer inte med.', { kind: 'error' }); }
      openCompose(account, { subject: fwSubject(thread.subject), quoteHtml: forwardHtml(m, sanitizeComposerHtml), attachments, title: 'Vidarebefordra', threadId: undefined });
      return;
    }
    const r = replyRecipients(m, own, mode === 'replyAll');
    const refs = [m.references, m.messageIdHeader].filter(Boolean).join(' ');
    openCompose(account, { to: r.to, cc: r.cc, subject: reSubject(thread.subject), quoteHtml: quoteHtml(m, sanitizeComposerHtml), threadId: thread.id, inReplyTo: m.messageIdHeader, references: refs, senderHint: hint, title: mode === 'reply' ? 'Svar' : 'Svara alla' });
  }, [accountOf, openCompose, ownFor, selected, selectedAccount, toast]);

  useEffect(() => { const h = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.seed && compose === null && accounts[0]) setCompose({ key: composeKey.current++, account: accounts.find((a) => a.id === scope) ?? accounts.find((a) => a.levels.send) ?? accounts[0], seed: d.seed }); }; window.addEventListener('vihem-mail-reopen', h); return () => window.removeEventListener('vihem-mail-reopen', h); }, [accounts, compose, scope]);

  const createWorkOrder = () => {
    if (!selected || !selectedAccount) return; const t = loadedThread.current; const last = t?.messages[t.messages.length - 1];
    const key = `${selected.id}-${Date.now()}`; const description = [`Från e-post: ${t?.subject ?? selected.subject}`, last ? `Avsändare: ${last.from.name} <${last.from.email}>` : '', '', (last?.text || last?.snippet || '').trim().slice(0, 2500)].filter((x, i) => i < 3 ? x !== '' || i === 2 : true).join('\n');
    try { sessionStorage.setItem(`vihem-mail-wo:${key}`, JSON.stringify({ title: t?.subject ?? selected.subject, description, accountId: selectedAccount.id, threadId: selected.id })); onNavigate(`workorder-from-mail/${key}`); } catch { toast.show('Kunde inte förbereda arbetsordern.', { kind: 'error' }); }
  };

  // ------------------------------------------------------------------ navigering och kortkommandon
  const goFolder = (f: Folder, l?: string) => { setFolder(f); setLabelId(l); setQuery(''); setDraftQuery(''); setSelected(null); setChecked(new Set()); setPanel('mail'); };
  const submitSearch = (q: string) => { const v = q.trim(); if (!v) { goFolder('inbox'); return; } setQuery(v); setFolder('search'); setSelected(null); };
  const visible = list.threads;
  const move = useCallback((d: number) => { if (!visible.length) return; const i = Math.max(-1, visible.findIndex((t) => threadKey(t) === focusKey)); const n = visible[Math.min(visible.length - 1, Math.max(0, i + d))]; setFocusKey(threadKey(n)); document.querySelector(`[data-thread-key="${CSS.escape(threadKey(n))}"]`)?.scrollIntoView({ block: 'nearest' }); }, [visible, focusKey]);
  const goPending = useRef<number>();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement; if (el.closest('input,textarea,select,[contenteditable="true"],.ProseMirror') || e.metaKey || e.ctrlKey || e.altKey || compose || panel !== 'mail') return;
      const cur = selected ?? visible.find((t) => threadKey(t) === focusKey) ?? null; const k = e.key;
      if (goPending.current) { window.clearTimeout(goPending.current); goPending.current = undefined; const m: Record<string, Folder> = { i: 'inbox', s: 'starred', t: 'sent', d: 'drafts', a: 'all', b: 'snoozed' }; if (m[k]) { e.preventDefault(); goFolder(m[k]); } return; }
      if (k === 'g') { goPending.current = window.setTimeout(() => { goPending.current = undefined; }, 1200); return; }
      if (k === 'c') { e.preventDefault(); openCompose(undefined); }
      else if (k === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else if (k === '?') setHelpOpen(true);
      else if ((k === 'r' || k === 'a' || k === 'f') && selected && loadedThread.current?.messages.length && selectedAccount?.levels.send) { const t = loadedThread.current; e.preventDefault(); void startReply(k === 'r' ? 'reply' : k === 'a' ? 'replyAll' : 'forward', t, t.messages[t.messages.length - 1]); }
      else if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (k === 'Enter' || k === 'o') { const t = visible.find((x) => threadKey(x) === focusKey); if (t) { e.preventDefault(); setSelected(t); } }
      else if (k === 'Escape') { if (helpOpen) setHelpOpen(false); else if (snoozeFor) setSnoozeFor(null); else if (checked.size) setChecked(new Set()); else if (selected) setSelected(null); }
      else if (cur?.account_id && accountOf(cur.account_id)?.levels.manage) {
        if (k === 'e') { e.preventDefault(); void modify([cur], 'archive'); } else if (k === '#' || k === 'Delete') { e.preventDefault(); void modify([cur], 'trash'); } else if (k === 's') { e.preventDefault(); void modify([cur], cur.starred ? 'unstar' : 'star'); }
        else if (k === 'U') { e.preventDefault(); void modify([cur], 'unread'); } else if (k === 'I') { e.preventDefault(); void modify([cur], 'read'); } else if (k === '!') { e.preventDefault(); void modify([cur], 'spam'); } else if (k === 'b') { e.preventDefault(); setSnoozeFor([cur]); }
        else if (k === 'x') { e.preventDefault(); setChecked((s) => { const n = new Set(s); const kk = threadKey(cur); if (n.has(kk)) n.delete(kk); else n.add(kk); return n; }); }
      }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const ownEmails = selectedAccount ? ownFor(selectedAccount) : [];
  const checkedThreads = visible.filter((t) => checked.has(threadKey(t)));

  if (bootError) return <div className="mx-auto mt-10 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center"><AlertTriangle className="mx-auto h-8 w-8 text-amber-500" /><p className="mt-3 text-sm text-slate-700">{bootError}</p><button onClick={() => { setBootError(''); void loadBoot(); }} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">Försök igen</button></div>;
  if (!boot) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (!accounts.length && !boot.is_org_admin) return <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center"><Mail className="mx-auto h-9 w-9 text-slate-300" /><h1 className="mt-3 text-lg font-bold">Ingen brevlåda tillgänglig</h1><p className="mt-2 text-sm text-slate-600">Du har ännu inte fått åtkomst till någon brevlåda i VI-HEM Mail. Be en administratör ge dig behörighet.</p></div>;

  const sidebar = <Sidebar accounts={accounts} scope={scope} onScope={(s) => { setScope(s); setSelected(null); setChecked(new Set()); }} folder={folder} labelId={labelId} onFolder={goFolder} labels={labelsForScope} unread={unread} canCompose={accounts.some((a) => a.levels.send)}
    onCompose={() => openCompose(undefined)} onSettings={() => setPanel('settings')} onAdmin={boot.is_org_admin ? () => setPanel('admin') : undefined} onNavigate={() => setDrawer(false)} />;

  return (
    <div ref={shellRef} className="relative -mx-4 -mt-3 flex min-h-[26rem] overflow-hidden rounded-none border-y border-slate-200 bg-white shadow-sm sm:mx-0 sm:mt-0 sm:rounded-2xl sm:border lg:h-[calc(100dvh-3.5rem)]">
      <div className="hidden w-60 shrink-0 border-r border-slate-200 bg-slate-50/50 lg:block">{sidebar}</div>
      {drawer && <div className="fixed inset-0 z-[90] lg:hidden"><button aria-label="Stäng meny" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} /><div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white pt-[env(safe-area-inset-top)] shadow-2xl">{sidebar}</div></div>}
      {panel === 'settings' && <Suspense fallback={<Loading />}><MailSettings prefs={boot.prefs} accounts={accounts} templates={templates} isAdmin={boot.is_org_admin} onClose={() => setPanel('mail')} onPrefs={(p) => setBoot({ ...boot, prefs: { ...boot.prefs, ...p } })} onTemplates={setTemplates} /></Suspense>}
      {panel === 'admin' && <Suspense fallback={<Loading />}><AdminMailboxes onClose={() => { setPanel('mail'); void loadBoot(); clearListCache(); }} currentUserId={boot.user.id} /></Suspense>}
      {panel === 'mail' && <>
        <section className={`${selected ? 'hidden md:flex' : 'flex'} min-w-0 flex-1 flex-col border-r border-slate-200 md:w-[22rem] md:flex-none xl:w-[26rem]`} aria-label="Meddelandelista">
          <div className="flex items-center gap-2 border-b border-slate-200 p-2">
            <button type="button" onClick={() => onNavigate('dashboard')} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Tillbaka till VI-HEM"><ArrowLeft className="h-5 w-5" /></button>
            <form className="relative min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); submitSearch(draftQuery); }} role="search"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input ref={searchRef} value={draftQuery} onChange={(e) => setDraftQuery(e.target.value)} placeholder="Sök i e-post (from:, has:attachment …)" aria-label="Sök i e-post" className="w-full rounded-xl border-0 bg-slate-100 py-2 pl-9 pr-8 text-sm focus:bg-white focus:ring-2 focus:ring-blue-500" onKeyDown={(e) => { if (e.key === 'Escape') { setDraftQuery(''); if (folder === 'search') goFolder('inbox'); (e.target as HTMLElement).blur(); } }} />
              {draftQuery && <button type="button" aria-label="Rensa sökning" onClick={() => { setDraftQuery(''); if (folder === 'search') goFolder('inbox'); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>}</form>
            <button type="button" onClick={() => { clearListCache(); void list.refresh(); }} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Uppdatera" title="Uppdatera"><RefreshCw className={`h-4 w-4 ${list.loading ? 'animate-spin' : ''}`} /></button>
            <button type="button" onClick={() => window.dispatchEvent(new Event('vihem-open-main-menu'))} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Öppna huvudmenyn"><Menu className="h-5 w-5" /></button>
          </div>
          {checkedThreads.length > 0 ? <div className="flex items-center gap-1 border-b border-blue-100 bg-blue-50 px-3 py-1.5 text-sm"><span className="mr-auto font-bold text-blue-900">{checkedThreads.length} valda</span>
            <button className="rounded-lg p-2 text-blue-900 hover:bg-blue-100" aria-label="Arkivera valda" onClick={() => void modify(checkedThreads, 'archive')}><Archive className="h-4 w-4" /></button><button className="rounded-lg p-2 text-blue-900 hover:bg-blue-100" aria-label="Radera valda" onClick={() => void modify(checkedThreads, 'trash')}><Trash2 className="h-4 w-4" /></button>
            <button className="rounded-lg p-2 text-blue-900 hover:bg-blue-100" aria-label="Markera som lästa" onClick={() => void modify(checkedThreads, 'read')}><MailOpen className="h-4 w-4" /></button><button className="rounded-lg p-2 text-blue-900 hover:bg-blue-100" aria-label="Snooza valda" onClick={() => setSnoozeFor(checkedThreads)}><Clock className="h-4 w-4" /></button>
            <button className="rounded-lg p-2 text-blue-900 hover:bg-blue-100" aria-label="Avmarkera" onClick={() => setChecked(new Set())}><X className="h-4 w-4" /></button></div>
            : <div className="flex items-center justify-between px-4 py-2 text-xs text-slate-500"><button type="button" onClick={() => setDrawer(true)} className="inline-flex items-center gap-1 font-bold text-slate-800 lg:pointer-events-none" aria-label="Byt mapp eller brevlåda">{folder === 'label' ? labelsForScope.find((l) => l.id === labelId)?.name : folder === 'search' ? `Sökning: ${query}` : FOLDER_TITLES[folder]}{list.unread > 0 && folder === 'inbox' ? ` · ${list.unread} olästa` : ''}<ChevronDown className="h-4 w-4 lg:hidden" /></button><span>{scope === 'all' && accounts.length > 1 ? 'Samlad' : effective[0]?.email}</span></div>}
          {(authFailed || list.errors.length > 0) && <div className="mx-3 mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">{authFailed?.error ?? list.errors.map((e) => `${accountOf(e.account_id)?.email ?? ''}: ${e.error}`).join(' · ')}</div>}
          <ThreadList threads={visible} accounts={accounts} ownEmails={effective.flatMap(ownFor)} selectedKey={selected ? threadKey(selected) : null} checked={checked} focusKey={focusKey} showAccount={scope === 'all' && accounts.length > 1} folder={folder} loading={list.loading} loadingMore={list.loadingMore} hasMore={list.hasMore} error={list.error}
            onOpen={(t) => { setSelected(t); setFocusKey(threadKey(t)); if (t.draft) { void openDraft(t); } }} onCheck={(t) => setChecked((s) => { const n = new Set(s); const k = threadKey(t); if (n.has(k)) n.delete(k); else n.add(k); return n; })} onAction={onRowAction} onLoadMore={list.loadMore} onRetry={() => void list.refresh()} />
        </section>
        <section className={`${selected ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 bg-white`} aria-label="Meddelande">
          {selected && selectedAccount && !selected.draft ? <>
            <ThreadView key={threadKey(selected)} account={selectedAccount} threadId={selected.id} ownEmails={ownEmails} remoteImages={boot.prefs.load_remote_images} organisationId={boot.user.organisation_id} userId={boot.user.id} reloadKey={reloadKey} onLoaded={(t) => { loadedThread.current = t; }}
              onBack={() => setSelected(null)} onAction={(op) => void modify([selected], op)} onSnooze={() => setSnoozeFor([selected])} onReply={(m, t, msg) => void startReply(m, t, msg)} sideOpen={side} onToggleSide={() => setSide((s) => !s)} />
            {side && <div className="fixed inset-y-0 right-0 z-40 w-[22rem] max-w-[92vw] border-l border-slate-200 bg-white shadow-2xl xl:static xl:z-auto xl:w-80 xl:shrink-0 xl:shadow-none"><ThreadSidePanel account={selectedAccount} threadId={selected.id} subject={selected.subject} replying={Boolean(compose)} onNavigate={onNavigate} onCreateWorkOrder={createWorkOrder} onClose={() => setSide(false)} /></div>}
          </> : <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400"><Inbox className="h-10 w-10" /><p className="text-sm">Välj ett meddelande att läsa</p><button onClick={() => setHelpOpen(true)} className="text-xs font-semibold text-slate-500 underline">Kortkommandon (?)</button></div>}
        </section>
      </>}
      {compose && <Composer key={compose.key} account={compose.account} identities={ctxs[compose.account.id]?.identities ?? []} seed={compose.seed} lastSender={boot.prefs.last_sender} templates={templates} suggestions={suggestionsFrom(visible)}
        onClose={() => setCompose(null)} onSent={() => { setCompose((c) => (c?.key === compose.key ? null : c)); clearListCache(); window.setTimeout(() => void list.refresh(), 1500); setReloadKey((k) => k + 1); }} onSenderUsed={(email) => void mailApi('prefs_save', { last_sender: { [compose.account.id]: email } }).catch(() => {})} templateVars={{}} />}
      {snoozeFor && <SnoozeDialog onClose={() => setSnoozeFor(null)} onPick={(d) => void doSnooze(snoozeFor, d)} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </div>
  );

  async function openDraft(t: ThreadSummary) {
    const account = accountOf(t.account_id); if (!account) return;
    try {
      const r = await mailApi<{ thread: LoadedThread }>('thread_get', { account_id: account.id, thread_id: t.id }); const m = r.thread.messages.filter((x) => x.isDraft).pop(); if (!m) { toast.show('Utkastet hittades inte.', { kind: 'error' }); return; }
      const drafts = await mailApi<{ drafts: { id: string; message?: { id: string } }[] }>('drafts_list', { account_id: account.id });
      const d = drafts.drafts?.find((x) => x.message?.id === m.id);
      setSelected(null); openCompose(account, { to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, bodyHtml: m.html || `<p>${m.text}</p>`, threadId: m.threadId, inReplyTo: m.inReplyTo, references: m.references, draftId: d?.id, title: 'Utkast' });
    } catch (e) { toast.show((e as Error).message, { kind: 'error' }); }
  }
}

const Loading = () => <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
/** Kontaktförslag byggs enbart av adresser i redan inlästa trådar (ingen separat kontaktlista / extra Google-behörighet). */
function suggestionsFrom(threads: ThreadSummary[]): MailAddress[] { const m = new Map<string, MailAddress>(); for (const t of threads) for (const p of [...t.participants, t.from]) if (p.email && !m.has(p.email.toLowerCase())) m.set(p.email.toLowerCase(), { name: p.name, email: p.email.toLowerCase() }); return [...m.values()].slice(0, 400); }

function SnoozeDialog({ onClose, onPick }: { onClose: () => void; onPick: (d: Date) => void }) {
  const [custom, setCustom] = useState(toLocalInput(nextMorning(1, 8)));
  const today = new Date(); today.setHours(today.getHours() + 3, 0, 0, 0);
  const opts: [string, Date][] = [['Senare idag', today], ['Imorgon bitti', nextMorning(1, 8)], ['Nästa måndag', nextMonday(8)], ['Om en vecka', nextMorning(7, 8)]];
  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-label="Snooza"><div className="w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
    <h2 className="mb-2 flex items-center gap-2 text-base font-bold"><Clock className="h-4 w-4" />Snooza till …</h2>
    {opts.map(([l, d]) => <button key={l} className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm hover:bg-slate-50" onClick={() => onPick(d)}><span>{l}</span><span className="text-xs text-slate-500">{d.toLocaleString('sv-SE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></button>)}
    <div className="mt-2 flex gap-2 border-t border-slate-100 pt-3"><input type="datetime-local" value={custom} min={toLocalInput(new Date())} onChange={(e) => setCustom(e.target.value)} className="min-w-0 flex-1 rounded-lg border-slate-300 text-sm" aria-label="Egen tidpunkt" /><button className="rounded-lg bg-slate-900 px-4 text-sm font-bold text-white" onClick={() => { const d = new Date(custom); if (d.getTime() > Date.now() + 60000) onPick(d); }}>Snooza</button></div></div></div>;
}
const KEYS: [string, string][] = [['c', 'Nytt meddelande'], ['/', 'Sök'], ['j / k', 'Nästa / föregående'], ['Enter', 'Öppna'], ['e', 'Arkivera'], ['#', 'Radera'], ['s', 'Stjärnmarkera'], ['r / a / f', 'Svara / svara alla / vidarebefordra'], ['Shift+U / Shift+I', 'Markera oläst / läst'], ['b', 'Snooza'], ['!', 'Skräppost'], ['x', 'Välj tråd'], ['g sedan i/s/t/d/a/b', 'Gå till Inkorg, Stjärnmärkta, Skickade, Utkast, All e-post, Snoozade'], ['Ctrl/Cmd+Enter', 'Skicka (i skrivrutan)'], ['Esc', 'Stäng / avmarkera']];
function HelpDialog({ onClose }: { onClose: () => void }) {
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-label="Kortkommandon"><div className="max-h-[80vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
    <div className="mb-3 flex items-center"><h2 className="flex-1 text-base font-bold">Kortkommandon</h2><button onClick={onClose} aria-label="Stäng" className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">{KEYS.map(([k, d]) => <div key={k} className="contents"><dt><kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold">{k}</kbd></dt><dd className="text-slate-600">{d}</dd></div>)}</dl></div></div>;
}
