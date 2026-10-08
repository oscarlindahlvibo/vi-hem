import { useState } from 'react';
import { CalendarDays, Users } from 'lucide-react';
import { addDaysIso, nightsBetween, todayIso } from '@/lib/api';

export interface Stay { start: string; end: string; guests: number }

/** Datum + antal gäster. Används både på startsidan (skickar vidare till /boka) och på bokningssidan. */
export function StayPicker({ initial, onSubmit, submitLabel = 'Visa lediga rum', busy = false }: { initial?: Partial<Stay>; onSubmit: (stay: Stay) => void; submitLabel?: string; busy?: boolean }) {
  const today = todayIso();
  const [start, setStart] = useState(initial?.start || addDaysIso(today, 1));
  const [end, setEnd] = useState(initial?.end || addDaysIso(today, 2));
  const [guests, setGuests] = useState(initial?.guests || 2);
  const nights = nightsBetween(start, end);
  const invalid = start < today || nights < 1;
  return (
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_8rem_auto] lg:items-end" onSubmit={(e) => { e.preventDefault(); if (!invalid) onSubmit({ start, end, guests }); }}>
      <div>
        <label className="label" htmlFor="stay-start"><CalendarDays className="mr-1 inline h-4 w-4" />Ankomst</label>
        <input id="stay-start" type="date" className="field" min={today} value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value >= end) setEnd(addDaysIso(e.target.value, 1)); }} required />
      </div>
      <div>
        <label className="label" htmlFor="stay-end"><CalendarDays className="mr-1 inline h-4 w-4" />Avresa</label>
        <input id="stay-end" type="date" className="field" min={addDaysIso(start, 1)} value={end} onChange={(e) => setEnd(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="stay-guests"><Users className="mr-1 inline h-4 w-4" />Gäster</label>
        <select id="stay-guests" className="field" value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} gäst{n > 1 ? 'er' : ''}</option>)}
        </select>
      </div>
      <button type="submit" disabled={invalid || busy} className="btn btn-amber sm:col-span-2 lg:col-span-1">{busy ? 'Söker...' : submitLabel}</button>
      {invalid && <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-4">Välj ett ankomstdatum från och med idag och minst en natt.</p>}
    </form>
  );
}
