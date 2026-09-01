import React, { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { RevealSecret } from './ui';
import { ACCESS_ENTRY_TYPE_LABELS, type AccessEntry, type AccessEntryType, type Routine } from '../lib/operations';
import { OperationsChecklistsPage } from '../pages/OperationsChecklistsPage';

interface Props {
  workOrderId: string;
  propertyId: string | null;
  apartmentId: string | null;
  category: string;
}

/**
 * Lightweight "Åtkomst & rutiner" panel embedded directly in a work
 * order's detail view -- the user should never have to leave the work
 * order to look up the door code or the relevant routine for it. Full
 * management (create/edit) still lives on the dedicated Åtkomst/Rutiner
 * pages and the property's own Driftinformation tab; this is read +
 * reveal only, matching how little screen space a work order modal has.
 */
export function WorkOrderOperationsPanel({ workOrderId, propertyId, apartmentId, category }: Props) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [suggestedRoutines, setSuggestedRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [user?.organisation_id, propertyId, apartmentId, category]);

  async function load() {
    if (!user?.organisation_id || (!propertyId && !apartmentId)) { setLoading(false); return; }
    setLoading(true);

    const orFilter = [
      propertyId ? `property_id.eq.${propertyId}` : null,
      apartmentId ? `apartment_id.eq.${apartmentId}` : null,
    ].filter(Boolean).join(',');

    const [entriesResult, routinesResult] = await Promise.all([
      orFilter
        ? supabase.from('vihem_access_entries').select('*').eq('organisation_id', user.organisation_id).eq('active', true).or(orFilter)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('vihem_routines').select('id,title,summary').eq('organisation_id', user.organisation_id).eq('status', 'published').ilike('category', `%${category}%`).limit(3),
    ]);

    if (!entriesResult.error) setEntries((entriesResult.data || []) as AccessEntry[]);
    if (!routinesResult.error) setSuggestedRoutines((routinesResult.data || []) as Routine[]);
    setLoading(false);
  }

  async function revealSecret(entryId: string): Promise<string> {
    const { data, error } = await supabase.functions.invoke('vihem-access-entries', { body: { action: 'reveal', id: entryId } });
    if (error || data?.error) throw new Error(data?.error || error?.message || 'Kunde inte visa koden.');
    if (data.step_up_required) throw new Error('Kräver extra verifiering (ej aktiverat ännu).');
    return data.secret as string;
  }

  function logCopy(entryId: string) {
    void supabase.functions.invoke('vihem-access-entries', { body: { action: 'log_copy', id: entryId } });
  }

  if (loading || (entries.length === 0 && suggestedRoutines.length === 0)) return null;

  return (
    <div className="space-y-4 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
      <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-blue-700"><KeyRound className="h-3.5 w-3.5" />Åtkomst & rutiner</p>

      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map(entry => (
            <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2.5">
              <div className="min-w-0">
                <p className="text-xs font-black text-slate-500">{ACCESS_ENTRY_TYPE_LABELS[entry.entry_type as AccessEntryType]}</p>
                <p className="truncate text-sm font-bold text-slate-900">{entry.name}</p>
              </div>
              {entry.secret_hint ? (
                <RevealSecret hint={entry.secret_hint} onReveal={() => revealSecret(entry.id)} onCopied={() => logCopy(entry.id)} />
              ) : (
                <p className="text-xs text-slate-500">{entry.instructions || 'Se instruktion'}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {suggestedRoutines.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-black text-slate-500">Relevanta rutiner</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestedRoutines.map(r => (
              <span key={r.id} className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-blue-700">{r.title}</span>
            ))}
          </div>
        </div>
      )}

      <div>
        <OperationsChecklistsPage workOrderId={workOrderId} />
      </div>
    </div>
  );
}
