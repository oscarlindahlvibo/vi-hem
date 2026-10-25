import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { validEmail } from '../lib/compose';
import type { MailAddress } from '../lib/types';

const parse = (raw: string): MailAddress[] => raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => { const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s); return m ? { name: m[1].trim(), email: m[2].trim().toLowerCase() } : { name: '', email: s.replace(/^<|>$/g, '').toLowerCase() }; });

interface Props { label: string; value: MailAddress[]; onChange: (v: MailAddress[]) => void; suggestions: MailAddress[]; autoFocus?: boolean; disabled?: boolean }
/** Mottagarfält med adresschips, kontaktförslag (från mejlhistoriken i inläst e-post) och inklistring av flera adresser. */
export function RecipientField({ label, value, onChange, suggestions, autoFocus, disabled }: Props) {
  const [text, setText] = useState(''); const [open, setOpen] = useState(false); const [active, setActive] = useState(0); const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => { const q = text.trim().toLowerCase(); if (q.length < 1) return []; const have = new Set(value.map((v) => v.email)); return suggestions.filter((s) => !have.has(s.email) && (s.email.includes(q) || s.name.toLowerCase().includes(q))).slice(0, 6); }, [text, suggestions, value]);
  const commit = (raw: string) => { const add = parse(raw); if (!add.length) return; const have = new Set(value.map((v) => v.email)); onChange([...value, ...add.filter((a) => !have.has(a.email) && have.add(a.email))]); setText(''); setOpen(false); setActive(0); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open && matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length); return; }
    if ((e.key === 'Enter' || e.key === 'Tab') && open && matches[active] && text.trim()) { e.preventDefault(); commit(`${matches[active].name} <${matches[active].email}>`); return; }
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === ' ' && validEmail(text))) { if (text.trim()) { e.preventDefault(); commit(text); } return; }
    if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="relative flex items-start gap-2 border-b border-slate-200 py-1.5 text-sm" onClick={() => input.current?.focus()}>
      <span className="mt-1.5 w-8 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {value.map((a, i) => { const bad = !validEmail(a.email); return <span key={a.email} title={bad ? 'Ogiltig adress' : a.email} className={`inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-[13px] ${bad ? 'bg-red-100 text-red-800 ring-1 ring-red-300' : 'bg-slate-100 text-slate-800'}`}><span className="truncate">{a.name || a.email}</span>{!disabled && <button type="button" aria-label={`Ta bort ${a.email}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((_, j) => j !== i)); }} className="rounded-full p-0.5 hover:bg-black/10"><X className="h-3 w-3" /></button>}</span>; })}
        <input ref={input} value={text} disabled={disabled} autoFocus={autoFocus} aria-label={label} autoComplete="off" inputMode="email" onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }} onKeyDown={onKey} onBlur={() => window.setTimeout(() => { if (text.trim()) commit(text); setOpen(false); }, 120)}
          onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/[,;\n]/.test(t)) { e.preventDefault(); commit(t); } }} className="min-w-[8rem] flex-1 border-0 bg-transparent py-1 text-sm outline-none focus:ring-0" />
      </div>
      {open && matches.length > 0 && <ul role="listbox" className="absolute left-10 top-full z-30 mt-1 w-[min(22rem,calc(100%-3rem))] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">{matches.map((m, i) => <li key={m.email} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); commit(`${m.name} <${m.email}>`); }} className={`cursor-pointer px-3 py-2 text-sm ${i === active ? 'bg-blue-50' : ''}`}><div className="font-semibold text-slate-900">{m.name || m.email}</div>{m.name && <div className="text-xs text-slate-500">{m.email}</div>}</li>)}</ul>}
    </div>
  );
}
