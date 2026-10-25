import { memo, useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { Archive, Check, Clock, MailOpen, Mail, Paperclip, Star, Trash2, AlertTriangle } from 'lucide-react';
import { avatarColor, displayName, initials, listDate } from '../lib/format';
import type { MailAccount, ThreadSummary } from '../lib/types';

export type RowAction = 'archive' | 'trash' | 'read' | 'unread' | 'star' | 'unstar' | 'snooze' | 'spam' | 'untrash';
const ROW = 84;

interface RowProps { t: ThreadSummary; selected: boolean; checked: boolean; focused: boolean; showAccount: boolean; accountColor: string; mine: string[]; canManage: boolean; folder: string; onOpen: () => void; onCheck: () => void; onAction: (a: RowAction) => void }

const Row = memo(function Row({ t, selected, checked, focused, showAccount, accountColor, mine, canManage, folder, onOpen, onCheck, onAction }: RowProps) {
  const [dx, setDx] = useState(0); const start = useRef<{ x: number; y: number; lock: boolean | null } | null>(null);
  const onStart = (e: TouchEvent) => { if (!canManage) return; start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, lock: null }; };
  const onMove = (e: TouchEvent) => { const s = start.current; if (!s) return; const mx = e.touches[0].clientX - s.x, my = e.touches[0].clientY - s.y; if (s.lock === null && (Math.abs(mx) > 10 || Math.abs(my) > 10)) s.lock = Math.abs(mx) > Math.abs(my) * 1.4; if (s.lock) setDx(Math.max(-140, Math.min(140, mx))); };
  const onEnd = () => { const s = start.current; start.current = null; if (s?.lock) { if (dx <= -80) onAction(folder === 'trash' ? 'untrash' : 'archive'); else if (dx >= 80) onAction(t.unread ? 'read' : 'unread'); } setDx(0); };
  const who = t.draft ? 'Utkast' : (folder === 'sent' ? `Till: ${displayName(t.participants.find((p) => !mine.includes(p.email)) ?? t.from)}` : displayName(t.from));
  const unreadCls = t.unread ? 'font-bold text-slate-950' : 'font-medium text-slate-700';
  return (
    <div className="relative h-full overflow-hidden" style={{ height: ROW }}>
      <div className="absolute inset-0 flex items-center justify-between px-5 text-white" aria-hidden="true">
        <span className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2">{t.unread ? <MailOpen className="h-5 w-5" /> : <Mail className="h-5 w-5" />}</span>
        <span className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2"><Archive className="h-5 w-5" /></span>
      </div>
      <div role="option" aria-selected={selected} tabIndex={-1} data-thread-row onClick={onOpen} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
        className={`group relative flex h-full cursor-pointer items-start gap-3 border-b border-slate-100 px-3 py-2.5 transition-colors duration-150 ${selected ? 'bg-blue-50' : t.unread ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/60 hover:bg-slate-100/70'} ${focused ? 'ring-2 ring-inset ring-blue-400' : ''}`}
        style={{ transform: `translateX(${dx}px)`, transition: dx === 0 ? 'transform .2s ease' : 'none' }}>
        {t.unread && <span className="absolute left-0 top-0 h-full w-1 bg-blue-600" aria-hidden="true" />}
        <button type="button" aria-label={checked ? 'Avmarkera' : 'Markera'} onClick={(e) => { e.stopPropagation(); onCheck(); }} className="relative mt-1 h-9 w-9 shrink-0">
          <span className={`absolute inset-0 flex items-center justify-center rounded-full text-xs font-bold text-white transition-opacity ${checked ? 'opacity-0' : 'group-hover:opacity-0'}`} style={{ backgroundColor: avatarColor(t.from.email || t.id) }}>{initials(t.from.name, t.from.email)}</span>
          <span className={`absolute inset-0 flex items-center justify-center rounded-full border-2 transition-opacity ${checked ? 'border-blue-600 bg-blue-600 text-white opacity-100' : 'border-slate-300 bg-white opacity-0 group-hover:opacity-100'}`}>{checked && <Check className="h-4 w-4" />}</span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2"><span className={`min-w-0 flex-1 truncate text-[15px] ${unreadCls}`}>{who}{t.messageCount > 1 && <span className="ml-1.5 text-xs font-medium text-slate-400">{t.messageCount}</span>}</span>
            <span className={`shrink-0 text-xs tabular-nums ${t.unread ? 'font-bold text-blue-700' : 'text-slate-400'}`}>{listDate(t.lastDate)}</span></div>
          <div className={`truncate text-[14px] ${unreadCls}`}>{t.subject}</div>
          <div className="flex items-center gap-1.5"><span className="min-w-0 flex-1 truncate text-[13px] text-slate-500">{t.snippet}</span>
            {showAccount && t.account_email && <span className="hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white sm:inline" style={{ backgroundColor: accountColor }}>{t.account_email.split('@')[0]}</span>}
            {t.hasAttachments && <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="Har bilaga" />}
            {t.starred && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Stjärnmarkerad" />}</div>
        </div>
        {canManage && <div className="absolute right-2 top-2 hidden items-center gap-0.5 rounded-lg bg-white/95 px-1 py-0.5 shadow ring-1 ring-slate-200 group-hover:flex lg:group-hover:flex">
          {([[folder === 'trash' ? 'untrash' : 'archive', Archive, folder === 'trash' ? 'Återställ' : 'Arkivera'], ['trash', Trash2, 'Radera'], [t.unread ? 'read' : 'unread', t.unread ? MailOpen : Mail, t.unread ? 'Markera som läst' : 'Markera som oläst'], ['snooze', Clock, 'Snooza'], ['spam', AlertTriangle, 'Skräppost']] as [RowAction, typeof Archive, string][]).map(([a, Icon, label]) => (
            <button key={a} type="button" title={label} aria-label={label} onClick={(e) => { e.stopPropagation(); onAction(a); }} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Icon className="h-4 w-4" /></button>))}
        </div>}
      </div>
    </div>
  );
});

interface Props { threads: ThreadSummary[]; accounts: MailAccount[]; ownEmails: string[]; selectedKey: string | null; checked: Set<string>; focusKey: string | null; showAccount: boolean; folder: string; loading: boolean; loadingMore: boolean; hasMore: boolean; error: string; onOpen: (t: ThreadSummary) => void; onCheck: (t: ThreadSummary) => void; onAction: (t: ThreadSummary, a: RowAction) => void; onLoadMore: () => void; onRetry: () => void }
const keyOf = (t: ThreadSummary) => `${t.account_id}:${t.id}`;

export function ThreadList({ threads, accounts, ownEmails, selectedKey, checked, focusKey, showAccount, folder, loading, loadingMore, hasMore, error, onOpen, onCheck, onAction, onLoadMore, onRetry }: Props) {
  const box = useRef<HTMLDivElement>(null); const [scroll, setScroll] = useState(0); const [height, setHeight] = useState(600);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setHeight(el.clientHeight)); ro.observe(el); setHeight(el.clientHeight); return () => ro.disconnect(); }, []);
  const total = threads.length * ROW; const first = Math.max(0, Math.floor(scroll / ROW) - 6); const last = Math.min(threads.length, Math.ceil((scroll + height) / ROW) + 6);
  const onScroll = useCallback(() => { const el = box.current; if (!el) return; setScroll(el.scrollTop); if (el.scrollTop + el.clientHeight > el.scrollHeight - ROW * 8) onLoadMore(); }, [onLoadMore]);
  useEffect(() => { if (!focusKey || !box.current) return; const i = threads.findIndex((t) => keyOf(t) === focusKey); if (i < 0) return; const top = i * ROW, el = box.current; if (top < el.scrollTop) el.scrollTop = top; else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight; }, [focusKey, threads]);
  const colors = Object.fromEntries(accounts.map((a) => [a.id, avatarColor(a.email)]));
  const canManageOf = (id?: string) => Boolean(accounts.find((a) => a.id === id)?.levels.manage);

  if (loading && !threads.length) return <div className="space-y-px" aria-busy="true" aria-label="Laddar mejl">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="flex h-[84px] animate-pulse gap-3 border-b border-slate-100 px-3 py-3"><div className="h-9 w-9 rounded-full bg-slate-200" /><div className="flex-1 space-y-2"><div className="h-3 w-1/3 rounded bg-slate-200" /><div className="h-3 w-2/3 rounded bg-slate-200" /><div className="h-3 w-1/2 rounded bg-slate-100" /></div></div>)}</div>;
  if (error && !threads.length) return <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"><AlertTriangle className="h-8 w-8 text-amber-500" /><p className="max-w-xs text-sm text-slate-600">{error}</p><button type="button" onClick={onRetry} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">Försök igen</button></div>;
  if (!threads.length) return <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center"><Mail className="h-10 w-10 text-slate-300" /><p className="font-bold text-slate-700">{folder === 'inbox' ? 'Inkorgen är tom' : folder === 'search' ? 'Inga träffar' : 'Inga meddelanden här'}</p><p className="text-sm text-slate-500">{folder === 'search' ? 'Prova andra sökord eller sök i alla brevlådor.' : 'Nya meddelanden visas här automatiskt.'}</p></div>;
  return (
    <div ref={box} onScroll={onScroll} role="listbox" aria-label="Meddelanden" className="relative h-full overflow-y-auto overscroll-contain">
      <div style={{ height: total + (hasMore || loadingMore ? ROW : 0), position: 'relative' }}>
        {threads.slice(first, last).map((t, i) => { const idx = first + i; const k = keyOf(t); return (
          <div key={k} style={{ position: 'absolute', top: idx * ROW, left: 0, right: 0, height: ROW }}>
            <Row t={t} selected={selectedKey === k} checked={checked.has(k)} focused={focusKey === k} showAccount={showAccount} accountColor={colors[t.account_id ?? ''] ?? '#64748b'} mine={ownEmails} canManage={canManageOf(t.account_id)} folder={folder} onOpen={() => onOpen(t)} onCheck={() => onCheck(t)} onAction={(a) => onAction(t, a)} />
          </div>); })}
        {(hasMore || loadingMore) && <div style={{ position: 'absolute', top: total, left: 0, right: 0, height: ROW }} className="flex items-center justify-center text-sm text-slate-400">{loadingMore ? 'Hämtar fler…' : <button type="button" onClick={onLoadMore} className="rounded-lg px-3 py-1.5 font-semibold text-blue-700 hover:bg-blue-50">Visa fler</button>}</div>}
      </div>
    </div>
  );
}
export { keyOf as threadKey };
