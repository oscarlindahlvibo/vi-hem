import { useEffect, useState } from 'react';
import { ArrowRight, MapPin } from 'lucide-react';
import { supabase } from '../lib/supabase';

type TodayEvent = { id: string; title: string; location: string; starts_at: string; ends_at: string; all_day: boolean; color: string };
const timeLabel = (e: TodayEvent) => (e.all_day ? 'Heldag' : `${new Date(e.starts_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}–${new Date(e.ends_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`);

/** Dagens kalenderhändelser på startsidan. Visas bara när det finns minst en händelse idag (som användaren får se enligt kalenderns behörigheter). */
export function TodayCalendarCard({ onOpen }: { onOpen: () => void }) {
  const [events, setEvents] = useState<TodayEvent[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1);
      const { data, error } = await supabase.from('vihem_calendar_events').select('id,title,location,starts_at,ends_at,all_day,color').lt('starts_at', end.toISOString()).gt('ends_at', start.toISOString()).order('all_day', { ascending: false }).order('starts_at').limit(12);
      if (alive && !error) setEvents((data as TodayEvent[]) || []);
    };
    void load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    const channel = supabase.channel('dashboard-calendar-today').on('postgres_changes', { event: '*', schema: 'public', table: 'vihem_calendar_events' }, () => void load()).subscribe();
    return () => { alive = false; window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, []);
  if (!events.length) return null;
  return (
    <section className="vihem-surface overflow-hidden rounded-card" aria-label="Dagens kalenderhändelser">
      <button onClick={onOpen} className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-5 text-left sm:px-6">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-black text-slate-950">Idag i kalendern</h2>
          <p className="mt-1 truncate text-sm font-medium text-slate-500">{events.length} {events.length === 1 ? 'händelse' : 'händelser'} idag</p>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-slate-300" />
      </button>
      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {events.map(e => (
          <li key={e.id}>
            <button onClick={onOpen} className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 sm:px-6">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: e.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-900">{e.title}</span>
                <span className="flex flex-wrap items-center gap-x-3 text-xs font-medium text-slate-500"><span>{timeLabel(e)}</span>{e.location && <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{e.location}</span></span>}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
