import { AlarmClock, Archive, CalendarClock, File, Inbox, Layers, Mail, PenSquare, Send, Settings, ShieldAlert, Star, Tag, Trash2, Users, Shield } from 'lucide-react';
import type { Folder } from '../hooks/useThreadList';
import type { GmailLabel, MailAccount } from '../lib/types';

export const FOLDERS: { id: Folder; label: string; icon: typeof Inbox; unreadLabel?: string }[] = [
  { id: 'inbox', label: 'Inkorg', icon: Inbox, unreadLabel: 'INBOX' }, { id: 'starred', label: 'Stjärnmärkta', icon: Star }, { id: 'snoozed', label: 'Snoozade', icon: AlarmClock }, { id: 'sent', label: 'Skickade', icon: Send },
  { id: 'drafts', label: 'Utkast', icon: File, unreadLabel: 'DRAFT' }, { id: 'scheduled', label: 'Schemalagda', icon: CalendarClock }, { id: 'archive', label: 'Arkiv', icon: Archive }, { id: 'all', label: 'All e-post', icon: Mail },
  { id: 'spam', label: 'Skräppost', icon: ShieldAlert, unreadLabel: 'SPAM' }, { id: 'trash', label: 'Papperskorg', icon: Trash2 },
];
interface Props {
  accounts: MailAccount[]; scope: string; onScope: (s: string) => void; folder: Folder; labelId?: string; onFolder: (f: Folder, labelId?: string) => void; labels: GmailLabel[]; unread: Record<string, number>;
  onCompose: () => void; onSettings: () => void; onAdmin?: () => void; onNavigate?: () => void; canCompose: boolean;
}

/** Vänsterkolumn: skriv, brevlådeväljare (samlad inkorg), mappar, egna etiketter och inställningar. Används både som fast kolumn och som drawer på mobil. */
export function Sidebar({ accounts, scope, onScope, folder, labelId, onFolder, labels, unread, onCompose, onSettings, onAdmin, onNavigate, canCompose }: Props) {
  const pick = (f: Folder, l?: string) => { onFolder(f, l); onNavigate?.(); };
  const userLabels = labels.filter((l) => l.type === 'user' && !l.name.startsWith('VI-HEM/')).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  const row = (active: boolean) => `flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${active ? 'bg-blue-50 font-bold text-blue-800' : 'text-slate-700 hover:bg-slate-100'}`;
  return (
    <nav aria-label="E-postmappar" className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <button type="button" disabled={!canCompose} onClick={() => { onCompose(); onNavigate?.(); }} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-40" title={canCompose ? 'Nytt meddelande (c)' : 'Du saknar sändbehörighet'}><PenSquare className="h-4 w-4" />Nytt meddelande</button>
      {accounts.length > 1 && <div className="rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Brevlåda">
        <button type="button" role="radio" aria-checked={scope === 'all'} onClick={() => onScope('all')} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${scope === 'all' ? 'bg-white font-bold shadow-sm' : 'text-slate-600'}`}><Layers className="h-4 w-4" />Samlad inkorg</button>
        {accounts.map((a) => <button key={a.id} type="button" role="radio" aria-checked={scope === a.id} onClick={() => onScope(a.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${scope === a.id ? 'bg-white font-bold shadow-sm' : 'text-slate-600'}`}>
          {a.kind === 'shared' ? <Users className="h-4 w-4 shrink-0" /> : <Mail className="h-4 w-4 shrink-0" />}<span className="min-w-0 flex-1"><span className="block truncate">{a.display_name || a.email}</span>{a.display_name && <span className="block truncate text-[11px] font-normal text-slate-500">{a.email}</span>}</span>
          {unread[a.id] > 0 && <span className="rounded-full bg-blue-600 px-1.5 text-[11px] font-bold text-white">{unread[a.id]}</span>}</button>)}
      </div>}
      <ul className="space-y-0.5">{FOLDERS.map((f) => { const Icon = f.icon; const active = folder === f.id; const n = f.id === 'inbox' ? (scope === 'all' ? Object.values(unread).reduce((x, y) => x + y, 0) : unread[scope] ?? 0) : 0;
        return <li key={f.id}><button type="button" onClick={() => pick(f.id)} aria-current={active ? 'page' : undefined} className={row(active)}><Icon className="h-[18px] w-[18px] shrink-0" /><span className="flex-1 text-left">{f.label}</span>{n > 0 && <span className="text-xs font-bold text-blue-700">{n}</span>}</button></li>; })}</ul>
      {userLabels.length > 0 && scope !== 'all' && <div><div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Etiketter</div><ul className="space-y-0.5">{userLabels.map((l) => <li key={l.id}><button type="button" onClick={() => pick('label', l.id)} className={row(folder === 'label' && labelId === l.id)}><Tag className="h-4 w-4 shrink-0" style={{ color: l.color?.backgroundColor }} /><span className="flex-1 truncate text-left">{l.name}</span></button></li>)}</ul></div>}
      <div className="mt-auto space-y-0.5 border-t border-slate-200 pt-3">
        <button type="button" onClick={() => { onSettings(); onNavigate?.(); }} className={row(false)}><Settings className="h-[18px] w-[18px]" />Inställningar</button>
        {onAdmin && <button type="button" onClick={() => { onAdmin(); onNavigate?.(); }} className={row(false)}><Shield className="h-[18px] w-[18px]" />Brevlådor och behörigheter</button>}
      </div>
    </nav>
  );
}
