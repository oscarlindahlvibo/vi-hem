import React, { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, ExternalLink, MessageSquare, Play, Repeat, UserCog, Check, Lock, Send } from 'lucide-react';
import { Avatar, Button, Modal, SegmentedControl, Textarea } from '../ui';
import { formatDate } from '../../lib/utils';

const pad = (n: number) => String(n).padStart(2, '0');
export const toDateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (days: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + days); return toDateKey(d); };

// ── Snabbåtgärdsmeny (långtryck / ⋯) ─────────────────────────────────────

export interface QuickAction { key: string; label: string; icon: React.ReactNode; tone?: 'default' | 'success'; hint?: string; onSelect: () => void }

export function WorkOrderActionSheet({ open, onClose, title, actions }: { open: boolean; onClose: () => void; title: string; actions: QuickAction[] }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="-mx-1 space-y-1">
        {actions.map((a) => (
          <button
            key={a.key}
            onClick={() => { onClose(); a.onSelect(); }}
            className="flex min-h-[3.25rem] w-full items-center gap-3 rounded-2xl px-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${a.tone === 'success' ? 'bg-emerald-50 text-vihem-success' : 'bg-blue-50 text-vihem-blue'}`}>{a.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-vihem-ink">{a.label}</span>
              {a.hint && <span className="block truncate text-xs text-vihem-muted">{a.hint}</span>}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export const actionIcons = {
  open: <ExternalLink className="h-5 w-5" />,
  start: <Play className="h-5 w-5" />,
  switch: <Repeat className="h-5 w-5" />,
  assignee: <UserCog className="h-5 w-5" />,
  date: <Calendar className="h-5 w-5" />,
  comment: <MessageSquare className="h-5 w-5" />,
  complete: <CheckCircle2 className="h-5 w-5" />,
};

// ── Förfallodatum ────────────────────────────────────────────────────────

export function DueDateSheet({ open, onClose, current, saving, onPick }: {
  open: boolean; onClose: () => void; current: string | null; saving?: boolean; onPick: (date: string) => void;
}) {
  const [custom, setCustom] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  useEffect(() => { if (open) { setCustom(current || addDays(0)); setShowCustom(false); } }, [open, current]);
  const quick = [
    { label: 'Idag', date: addDays(0) },
    { label: 'Imorgon', date: addDays(1) },
    { label: 'Om 3 dagar', date: addDays(3) },
    { label: 'Nästa vecka', date: addDays(7) },
  ];
  return (
    <Modal open={open} onClose={onClose} title="Förfallodatum" size="sm">
      <div className="space-y-4">
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-vihem-muted">
          Nuvarande: <span className="font-semibold text-vihem-ink">{current ? formatDate(current) : 'Inget förfallodatum'}</span>
        </p>
        <div className="grid grid-cols-2 gap-2">
          {quick.map((q) => (
            <button
              key={q.label}
              disabled={saving}
              onClick={() => onPick(q.date)}
              className={`flex min-h-14 flex-col items-center justify-center rounded-2xl border text-sm font-semibold transition-colors active:scale-[0.98] ${
                current === q.date ? 'border-vihem-blue bg-blue-50 text-vihem-blue' : 'border-slate-200 bg-white text-vihem-ink hover:bg-slate-50'
              }`}
            >
              {q.label}
              <span className="text-xs font-normal text-vihem-muted">{formatDate(q.date)}</span>
            </button>
          ))}
        </div>
        {showCustom ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="wo-custom-date">Välj datum</label>
              <input id="wo-custom-date" type="date" value={custom} onChange={(e) => setCustom(e.target.value)} className="vihem-field vihem-focus w-full rounded-xl border px-3 py-2.5 text-sm" />
            </div>
            <Button onClick={() => custom && onPick(custom)} loading={saving} disabled={!custom}>Spara</Button>
          </div>
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => setShowCustom(true)}><Calendar className="h-4 w-4" />Välj datum</Button>
        )}
      </div>
    </Modal>
  );
}

// ── Ansvarig ─────────────────────────────────────────────────────────────

export function AssigneeSheet({ open, onClose, staff, currentIds, saving, onSave }: {
  open: boolean; onClose: () => void; staff: { id: string; name: string }[]; currentIds: string[]; saving?: boolean; onSave: (ids: string[]) => void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => { if (open) setIds(currentIds); }, [open, currentIds]);
  const toggle = (id: string) => setIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  return (
    <Modal open={open} onClose={onClose} title="Ansvarig" size="sm">
      <div className="space-y-3">
        <div className="max-h-[50dvh] space-y-1 overflow-y-auto">
          {staff.map((s) => {
            const on = ids.includes(s.id);
            return (
              <button key={s.id} onClick={() => toggle(s.id)} className={`flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left transition-colors ${on ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                <Avatar name={s.name} />
                <span className="flex-1 text-[15px] font-semibold text-vihem-ink">{s.name}</span>
                <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${on ? 'border-vihem-blue bg-vihem-blue text-white' : 'border-slate-300'}`}>{on && <Check className="h-3.5 w-3.5" />}</span>
              </button>
            );
          })}
        </div>
        <Button className="w-full" onClick={() => onSave(ids)} loading={saving}>Spara ansvarig</Button>
      </div>
    </Modal>
  );
}

// ── Kommentar ────────────────────────────────────────────────────────────

export function CommentSheet({ open, onClose, saving, onSubmit }: {
  open: boolean; onClose: () => void; saving?: boolean; onSubmit: (text: string, internal: boolean) => void;
}) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'customer' | 'internal'>('internal');
  useEffect(() => { if (open) { setText(''); setMode('internal'); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Lägg till kommentar" size="sm">
      <div className="space-y-3">
        <CommentModeToggle mode={mode} onChange={setMode} />
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={mode === 'internal' ? 'Intern anteckning -- syns bara för personal' : 'Meddelande som kunden kan se'} />
        <Button className="w-full" onClick={() => onSubmit(text.trim(), mode === 'internal')} loading={saving} disabled={!text.trim()}><Send className="h-4 w-4" />Publicera</Button>
      </div>
    </Modal>
  );
}

/** Tydligt val mellan kundsynligt meddelande och intern anteckning. Själva synligheten styrs fortfarande av backend (internal-flaggan + RLS). */
export function CommentModeToggle({ mode, onChange }: { mode: 'customer' | 'internal'; onChange: (m: 'customer' | 'internal') => void }) {
  return (
    <div className="space-y-1.5">
      <SegmentedControl
        value={mode}
        onChange={onChange}
        options={[
          { value: 'customer', label: 'Meddelande till kund', icon: <Send className="h-3.5 w-3.5" /> },
          { value: 'internal', label: 'Intern anteckning', icon: <Lock className="h-3.5 w-3.5" />, tone: 'warning' },
        ]}
      />
      <p className={`text-xs ${mode === 'internal' ? 'text-amber-700' : 'text-vihem-muted'}`}>
        {mode === 'internal' ? 'Bara personal ser den här anteckningen.' : 'Kunden kan läsa det här meddelandet.'}
      </p>
    </div>
  );
}

// ── Byt till detta jobb ──────────────────────────────────────────────────

export function SwitchJobSheet({ open, onClose, currentLabel, currentSince, targetTitle, busy, onConfirm }: {
  open: boolean; onClose: () => void; currentLabel: string; currentSince: string; targetTitle: string; busy?: boolean; onConfirm: () => void;
}) {
  const since = new Date(currentSince);
  const mins = Math.max(Math.floor((Date.now() - since.getTime()) / 60000), 0);
  return (
    <Modal open={open} onClose={onClose} title="Byt till detta jobb" size="sm">
      <div className="space-y-4">
        <div className="rounded-2xl bg-emerald-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Pågår just nu</p>
          <p className="mt-0.5 text-[15px] font-semibold text-vihem-ink">{currentLabel}</p>
          <p className="text-xs text-vihem-muted">Sedan {since.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })} · {Math.floor(mins / 60)} h {mins % 60} min</p>
        </div>
        <div className="rounded-2xl bg-blue-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-vihem-blue">Byt till</p>
          <p className="mt-0.5 text-[15px] font-semibold text-vihem-ink">{targetTitle}</p>
        </div>
        <p className="text-sm text-vihem-muted">Den pågående tidrapporten avslutas nu och en ny startar direkt på den här arbetsordern.</p>
        <Button className="w-full" onClick={onConfirm} loading={busy}><Repeat className="h-4 w-4" />Avsluta och byt</Button>
      </div>
    </Modal>
  );
}
