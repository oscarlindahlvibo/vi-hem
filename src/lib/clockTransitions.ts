import { supabase } from './supabase';
export type ClockAction = 'clockin' | 'clockout' | 'switch' | 'break' | 'lunch' | 'resume';
export type ClockOperation = { p_id: string; p_action: ClockAction; p_expected: string | null; p_event: string; p_job: Record<string, unknown>; p_comment: string; p_timezone: string };
const key = (user: string, org: string) => `vihem.clock.pending:${user}:${org}`;
export function pendingClockOperation(user: string, org: string): ClockOperation | null {
  try { const raw = localStorage.getItem(key(user, org)); return raw ? JSON.parse(raw) : null; }
  catch { throw Error('Den väntande stämplingen kunde inte läsas. Registrera ingen ny stämpling innan status har kontrollerats.'); }
}
export function saveClockOperation(user: string, org: string, operation: ClockOperation) {
  localStorage.setItem(key(user, org), JSON.stringify(operation));
}
async function clockRpc(name: string, args: Record<string, unknown>) {
  const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), 30000);
  try { return await supabase.rpc(name, args).abortSignal(controller.signal); }
  finally { window.clearTimeout(timer); }
}
export async function executeClockOperation(user: string, org: string, operation: ClockOperation) {
  // Keep the exact UUID, event time, expected state and comment after an uncertain response.
  if (!navigator.onLine) throw Error('Stämplingen väntar på synkronisering. Händelsetiden är sparad lokalt. Försök igen när anslutningen är tillbaka.');
  const { data, error } = await clockRpc('vihem_clock_transition', operation);
  if (error) throw Error(error.message.includes('CLOCK_STATE_CONFLICT') || error.message.includes('OPEN_ENTRY_CONFLICT') ? 'Stämplingsläget har ändrats. Kontrollera serverstatus innan du fortsätter.' : 'Stämplingen kunde inte bekräftas. Åtgärden finns kvar för återförsök.');
  localStorage.removeItem(key(user, org)); return data;
}
export async function reconcileClockOperation(user: string, org: string, operation: ClockOperation) {
  const { data, error } = await clockRpc('vihem_clock_operation_status', { p_id: operation.p_id, p_org: org });
  if (error) throw Error('Serverstatus kunde inte kontrolleras. Den väntande åtgärden behålls.');
  // Preserve an audit copy of unregistered intent before releasing the pending slot.
  if (!data) localStorage.setItem(`${key(user, org)}:unregistered:${operation.p_id}`, JSON.stringify(operation));
  localStorage.removeItem(key(user, org)); return !!data;
}
