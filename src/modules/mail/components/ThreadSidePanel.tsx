import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, FileText, Link2, Loader2, MessageSquare, Trash2, UserRound, X } from 'lucide-react';
import { mailApi, MailApiError } from '../lib/api';
import { fullDate } from '../lib/format';
import { useToasts } from '../hooks/useToasts';
import type { MailAccount } from '../lib/types';

interface Meta { assigned_to: string | null; status: 'open' | 'in_progress' | 'done'; priority: 'low' | 'normal' | 'high' | 'urgent' }
interface Comment { id: string; body: string; created_at: string; author: { id: string; name: string } | { id: string; name: string }[] | null }
interface LinkRow { id: string; object_type: string; object_id: string; label: string }
interface MetaResp { meta: Meta; comments: Comment[]; links: LinkRow[]; presence: { user_id: string; mode: string; name: string }[]; assignable: { id: string; name: string }[] }
const STATUS: Record<string, string> = { open: 'Ny', in_progress: 'Pågår', done: 'Klar' };
const PRIORITY: Record<string, string> = { low: 'Låg', normal: 'Normal', high: 'Hög', urgent: 'Akut' };
const TYPE_LABEL: Record<string, string> = { work_order: 'Arbetsorder', property: 'Fastighet', apartment: 'Lägenhet', tenant: 'Hyresgäst', project: 'Projekt', document: 'Dokument', note: 'Anteckning', reminder: 'Påminnelse', customer: 'Kund', other: 'Övrigt' };
const PAGE_FOR: Record<string, string> = { work_order: 'workorders', document: 'documents' };

interface Props { account: MailAccount; threadId: string; subject: string; replying?: boolean; onNavigate: (page: string) => void; onCreateWorkOrder: () => void; onClose?: () => void; reloadKey?: number }

/** Delad inkorg: ärendestatus, ansvarig, prioritet, interna kommentarer, kopplingar till andra moduler och vilka som tittar/svarar just nu. */
export function ThreadSidePanel({ account, threadId, replying, onNavigate, onCreateWorkOrder, onClose, reloadKey }: Props) {
  const toast = useToasts(); const [data, setData] = useState<MetaResp | null>(null); const [err, setErr] = useState(''); const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false);
  const canManage = account.levels.manage;
  const load = useCallback(async () => { try { setData(await mailApi<MetaResp>('meta_get', { account_id: account.id, thread_id: threadId })); setErr(''); } catch (e) { setErr(e instanceof MailApiError ? e.message : 'Kunde inte hämta ärendet.'); } }, [account.id, threadId]);
  useEffect(() => { setData(null); void load(); }, [load, reloadKey]);
  // Närvaro: visa att jag tittar/svarar (förfaller efter 45 s) och uppdatera vilka andra som gör det
  const modeRef = useRef(replying ? 'replying' : 'viewing'); modeRef.current = replying ? 'replying' : 'viewing';
  useEffect(() => {
    const ping = () => { if (document.visibilityState === 'visible') void mailApi('presence_ping', { account_id: account.id, thread_id: threadId, mode: modeRef.current }).then(() => load()).catch(() => {}); };
    ping(); const id = window.setInterval(ping, 30_000); return () => window.clearInterval(id);
  }, [account.id, threadId, replying]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setMeta(patch: Partial<Meta>) {
    if (!data) return; const prev = data; setData({ ...data, meta: { ...data.meta, ...patch } });
    try { await mailApi('meta_set', { account_id: account.id, thread_id: threadId, ...patch }); } catch (e) { setData(prev); toast.show((e as Error).message, { kind: 'error' }); }
  }
  async function addComment() { const body = comment.trim(); if (!body) return; setBusy(true); try { await mailApi('comment_add', { account_id: account.id, thread_id: threadId, body }); setComment(''); await load(); } catch (e) { toast.show((e as Error).message, { kind: 'error' }); } finally { setBusy(false); } }
  async function removeLink(id: string) { try { await mailApi('link_delete', { account_id: account.id, link_id: id }); await load(); } catch (e) { toast.show((e as Error).message, { kind: 'error' }); } }
  const sel = 'w-full rounded-lg border-slate-300 bg-white py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-500';

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-slate-200 bg-slate-50/60" aria-label="Ärende och kopplingar">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3"><h2 className="flex-1 text-sm font-bold text-slate-900">Ärende</h2>{onClose && <button type="button" onClick={onClose} aria-label="Stäng panelen" className="rounded-lg p-1 text-slate-500 hover:bg-slate-200"><X className="h-4 w-4" /></button>}</div>
      {err ? <div className="p-4 text-sm text-red-700">{err} <button className="font-bold underline" onClick={() => void load()}>Försök igen</button></div> : !data ? <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div> :
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {data.presence.length > 0 && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900" role="status">{data.presence.map((p) => `${p.name || 'Någon'} ${p.mode === 'replying' ? 'svarar' : 'tittar'}`).join(' · ')} just nu</div>}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-slate-500">Status<select value={data.meta.status} disabled={!canManage} onChange={(e) => void setMeta({ status: e.target.value as Meta['status'] })} className={`${sel} mt-1`}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-500">Prioritet<select value={data.meta.priority} disabled={!canManage} onChange={(e) => void setMeta({ priority: e.target.value as Meta['priority'] })} className={`${sel} mt-1`}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="col-span-2 text-xs font-semibold text-slate-500"><span className="flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />Ansvarig</span><select value={data.meta.assigned_to ?? ''} disabled={!canManage} onChange={(e) => void setMeta({ assigned_to: e.target.value || null })} className={`${sel} mt-1`}><option value="">Ingen</option>{data.assignable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        </div>
        <section aria-label="Kopplingar"><h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500"><Link2 className="h-3.5 w-3.5" />Kopplingar</h3>
          {data.links.length === 0 ? <p className="text-xs text-slate-500">Inga kopplingar ännu.</p> : <ul className="space-y-1.5">{data.links.map((l) => <li key={l.id} className="flex items-center gap-2 rounded-lg bg-white p-2 text-sm ring-1 ring-slate-200">
            {l.object_type === 'document' ? <FileText className="h-4 w-4 shrink-0 text-slate-400" /> : <ClipboardList className="h-4 w-4 shrink-0 text-slate-400" />}
            <button type="button" disabled={!PAGE_FOR[l.object_type]} onClick={() => onNavigate(PAGE_FOR[l.object_type])} className="min-w-0 flex-1 text-left disabled:cursor-default"><div className="truncate font-semibold">{l.label || TYPE_LABEL[l.object_type]}</div><div className="text-xs text-slate-500">{TYPE_LABEL[l.object_type] ?? l.object_type}</div></button>
            {canManage && <button type="button" aria-label="Ta bort koppling" onClick={() => void removeLink(l.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>}</li>)}</ul>}
          {canManage && <button type="button" onClick={onCreateWorkOrder} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"><ClipboardList className="h-4 w-4" />Skapa arbetsorder</button>}
        </section>
        <section aria-label="Interna kommentarer"><h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500"><MessageSquare className="h-3.5 w-3.5" />Interna kommentarer</h3>
          <p className="mb-2 text-[11px] text-slate-500">Syns bara för kollegor med åtkomst – skickas aldrig till avsändaren.</p>
          <ul className="space-y-2">{data.comments.map((c) => { const a = Array.isArray(c.author) ? c.author[0] : c.author; return <li key={c.id} className="rounded-lg bg-white p-2.5 text-sm ring-1 ring-slate-200"><div className="flex justify-between text-xs text-slate-500"><span className="font-bold text-slate-700">{a?.name ?? 'Okänd'}</span><span>{fullDate(c.created_at)}</span></div><p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p></li>; })}</ul>
          <div className="mt-2 flex gap-2"><textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={4000} aria-label="Ny intern kommentar" placeholder="Skriv en kommentar …" className="min-w-0 flex-1 resize-none rounded-lg border-slate-300 text-sm" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void addComment(); } }} />
            <button type="button" disabled={busy || !comment.trim()} onClick={() => void addComment()} className="self-end rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Spara</button></div>
        </section>
      </div>}
    </aside>
  );
}
