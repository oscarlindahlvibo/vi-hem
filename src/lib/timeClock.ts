// Delad stämpelklock-logik för byte mellan jobb direkt från arbetsorderlistan/detaljvyn.
// Speglar TimeTrackingPage.handleSwitchJob: alla öppna pass avslutas (stämpelklocke-pass
// godkänns automatiskt) och ett nytt arbetspass startar samma sekund -- så att tidrapporter
// varken överlappar eller försvinner. Om det nya passet inte kan skapas återställs de
// avslutade passen, så ett misslyckat byte aldrig lämnar användaren utan pågående tid.
import { supabase } from './supabase';
import { isBreakLike } from './utils';
import type { TimeCategory, TimeEntry, WorkOrder } from '../types';

export type OpenTimeEntry = Pick<TimeEntry, 'id' | 'work_order_id' | 'entry_type' | 'start_time' | 'break_minutes' | 'category' | 'status'>
  & { work_order?: { id: string; title: string } | null };

export async function fetchOpenTimeEntries(userId: string): Promise<OpenTimeEntry[]> {
  const { data, error } = await supabase
    .from('vihem_time_entries')
    .select('id, work_order_id, entry_type, start_time, break_minutes, category, status, work_order:work_order_id(id, title)')
    .eq('user_id', userId)
    .is('end_time', null)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data || []) as unknown as OpenTimeEntry[];
}

function minutesBetween(start: string, end: string, breakMinutes: number) {
  return Math.max(Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60000) - breakMinutes, 0);
}

export async function startOrSwitchToWorkOrder(params: {
  user: { id: string; organisation_id?: string | null };
  workOrder: Pick<WorkOrder, 'id' | 'customer_project_id'>;
  category: TimeCategory;
  comment?: string;
}): Promise<{ closed: OpenTimeEntry[] }> {
  const { user, workOrder, category, comment } = params;
  if (!navigator.onLine) throw new Error('Du måste vara online för att byta arbetsorder.');

  const open = await fetchOpenTimeEntries(user.id);
  if (open.some((entry) => entry.work_order_id === workOrder.id && !isBreakLike(entry.entry_type))) {
    return { closed: [] }; // redan instämplad på just den här arbetsordern
  }

  const now = new Date().toISOString();
  const closed: OpenTimeEntry[] = [];
  try {
    for (const entry of open) {
      const breakMinutes = isBreakLike(entry.entry_type) ? 0 : entry.break_minutes || 0;
      const { error } = await supabase.from('vihem_time_entries').update({
        end_time: now,
        total_minutes: minutesBetween(entry.start_time, now, breakMinutes),
        status: 'approved',
        approved_by: null,
        approved_at: now,
      }).eq('id', entry.id);
      if (error) throw error;
      closed.push(entry);
    }

    const { error: insertError } = await supabase.from('vihem_time_entries').insert({
      user_id: user.id,
      organisation_id: user.organisation_id || null,
      work_order_id: workOrder.id,
      // Arbetsorder i kundprojekt måste även ha customer_project_id (projektets ekonomi summerar på den kolumnen).
      customer_project_id: workOrder.customer_project_id || null,
      category: workOrder.customer_project_id ? 'customer_project' : category,
      entry_type: 'work',
      start_time: now,
      end_time: null,
      break_minutes: 0,
      total_minutes: 0,
      comment: comment || '',
      status: 'draft',
    });
    if (insertError) throw insertError;
    return { closed };
  } catch (err) {
    // Återställ de pass vi hann avsluta.
    await Promise.all(closed.map((entry) => supabase.from('vihem_time_entries').update({
      end_time: null, total_minutes: 0, status: entry.status, approved_by: null, approved_at: null,
    }).eq('id', entry.id)));
    throw err;
  }
}
