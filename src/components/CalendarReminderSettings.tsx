import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Modal } from './ui';

type Rule = { id: string; name: string; source_type: string; days_before: number; remind_time: string; recipient_ids: string[]; enabled: boolean };
type Person = { id: string; name: string; role: string };
const DAY_OPTIONS = [[0, 'Samma dag'], [1, 'Dagen före'], [2, '2 dagar före'], [3, '3 dagar före'], [7, '1 vecka före']] as const;
const ROLE_LABEL: Record<string, string> = { admin: 'Administratör', staff: 'Personal' };

/** Admin väljer vilka som får påminnelsenotis för en händelsetyp (t.ex. sophämtning), hur många dagar före och vilken tid. */
export function CalendarReminderSettings() {
  const [open, setOpen] = useState(false); const [rules, setRules] = useState<Rule[]>([]); const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [error, setError] = useState('');
  const load = async () => {
    const [r, p] = await Promise.all([supabase.from('vihem_calendar_reminder_rules').select('*').order('name'), supabase.from('vihem_profiles').select('id,name,role').in('role', ['admin', 'staff']).eq('active', true).order('name')]);
    setRules(((r.data as any[]) || []).map(x => ({ ...x, remind_time: String(x.remind_time).slice(0, 5) }))); setPeople((p.data as Person[]) || []);
  };
  useEffect(() => { if (open) void load(); }, [open]);
  const patch = (id: string, p: Partial<Rule>) => setRules(rs => rs.map(r => (r.id === id ? { ...r, ...p } : r)));
  const save = async (r: Rule) => {
    setBusy(r.id); setError(''); setMsg('');
    const { error: e } = await supabase.from('vihem_calendar_reminder_rules').update({ enabled: r.enabled, days_before: r.days_before, remind_time: r.remind_time, recipient_ids: r.recipient_ids }).eq('id', r.id);
    setBusy(''); if (e) setError(e.message); else setMsg('Sparat.');
  };
  const toggle = (r: Rule, id: string) => patch(r.id, { recipient_ids: r.recipient_ids.includes(id) ? r.recipient_ids.filter(x => x !== id) : [...r.recipient_ids, id] });
  return <>
    <Button variant="secondary" onClick={() => setOpen(true)}><Bell className="h-4 w-4" /> Påminnelser</Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Påminnelser för kalenderhändelser" size="lg" mobileFullscreen>
      <div className="space-y-6">
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}{msg && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</p>}
        {!rules.length && <p className="text-sm text-slate-500">Inga påminnelseregler finns ännu.</p>}
        {rules.map(r => (
          <section key={r.id} className="space-y-3 rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-black text-slate-950">{r.name}</h3>
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={r.enabled} onChange={e => patch(r.id, { enabled: e.target.checked })} /> Påminnelser på</label></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">När<select className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={r.days_before} onChange={e => patch(r.id, { days_before: Number(e.target.value) })}>{DAY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label className="text-sm font-semibold text-slate-700">Klockslag<input type="time" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={r.remind_time} onChange={e => patch(r.id, { remind_time: e.target.value })} /></label>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between"><p className="text-sm font-semibold text-slate-700">Vilka får notisen ({r.recipient_ids.length} valda)</p>
                <span className="text-xs"><button type="button" className="text-blue-700 underline" onClick={() => patch(r.id, { recipient_ids: people.map(p => p.id) })}>Välj alla</button> · <button type="button" className="text-blue-700 underline" onClick={() => patch(r.id, { recipient_ids: [] })}>Ingen</button></span></div>
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-xl border border-slate-200 p-2 sm:grid-cols-2">{people.map(p => <label key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={r.recipient_ids.includes(p.id)} onChange={() => toggle(r, p.id)} /><span className="min-w-0 truncate">{p.name}<span className="text-xs text-slate-400"> · {ROLE_LABEL[p.role] ?? p.role}</span></span></label>)}</div>
              {r.enabled && !r.recipient_ids.length && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Inga mottagare är valda – ingen notis skickas förrän minst en person väljs.</p>}
            </div>
            <div className="flex items-center justify-between gap-3"><p className="text-xs text-slate-500">Notisen kommer {DAY_OPTIONS.find(d => d[0] === r.days_before)?.[1].toLowerCase()} kl. {r.remind_time} till de valda, som app-/pushnotis.</p><Button loading={busy === r.id} onClick={() => save(r)}>Spara</Button></div>
          </section>
        ))}
      </div>
    </Modal>
  </>;
}
