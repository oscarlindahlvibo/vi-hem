// Shared server-atomic clock transitions; uncertain results use the same account queue as TimeTrackingPage.
import { supabase } from './supabase';
import { isBreakLike } from './utils';
import { pendingClockOperation, saveClockOperation, executeClockOperation, type ClockOperation } from './clockTransitions';
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

async function perform(user: { id: string; organisation_id?: string | null }, action: 'clockin' | 'switch' | 'clockout', expected: string | null, job: Record<string, unknown>) {
  const org = user.organisation_id;
  if (!org) throw Error('Organisation saknas.');
  if (pendingClockOperation(user.id, org)) throw Error('En stämpling väntar på bekräftelse. Öppna Tidrapportering för återförsök eller serverstatus.');
  const operation: ClockOperation = { p_id: crypto.randomUUID(), p_action: action, p_expected: expected, p_event: new Date().toISOString(), p_job: job, p_comment: '', p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Stockholm' };
  saveClockOperation(user.id, org, operation);
  return executeClockOperation(user.id, org, operation);
}
export async function startOrSwitchToWorkOrder(params: {
  user: { id: string; organisation_id?: string | null };
  workOrder: Pick<WorkOrder, 'id' | 'customer_project_id'>;
  category: TimeCategory; comment?: string;
}): Promise<{ closed: OpenTimeEntry[] }> {
  const { user, workOrder, category, comment } = params;
  if (user.organisation_id && pendingClockOperation(user.id, user.organisation_id)) throw Error('En stämpling väntar på bekräftelse. Öppna Tidrapportering för återförsök eller serverstatus.');
  const open = await fetchOpenTimeEntries(user.id);
  if (open.length > 1) throw Error('Flera öppna pass behöver kontrolleras av en administratör.');
  if (open.some(entry => entry.work_order_id === workOrder.id && !isBreakLike(entry.entry_type))) return { closed: [] };
  await perform(user, open.length ? 'switch' : 'clockin', open[0]?.id || null, {
    work_order_id: workOrder.id, customer_project_id: workOrder.customer_project_id || null,
    category: workOrder.customer_project_id ? 'customer_project' : category,
    // Preserve the former insert's database default for project-linked work orders.
    project_billing_scope: workOrder.customer_project_id ? 'outside_quote' : 'internal',
    opening_comment: comment || '',
  });
  return { closed: open };
}
export async function stopWorkOrderClock(user: { id: string; organisation_id?: string | null }) {
  const open = await fetchOpenTimeEntries(user.id);
  if (open.length !== 1 || !open[0].work_order_id || isBreakLike(open[0].entry_type)) throw Error('Öppna Tidrapportering för att avsluta och kontrollera det pågående passet.');
  return perform(user, 'clockout', open[0].id, { completion_status: 'submitted' });
}
