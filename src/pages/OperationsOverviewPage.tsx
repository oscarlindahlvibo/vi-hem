import React, { useEffect, useState } from 'react';
import { AlertTriangle, BookOpen, ClipboardCheck, KeyRound, Package } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Card, LoadingPage, PageHeader, SearchInput, StatCard } from '../components/ui';
import { ACCESS_ENTRY_TYPE_LABELS, type AccessEntryType, type Routine } from '../lib/operations';

interface SearchResult {
  kind: 'routine' | 'access';
  id: string;
  title: string;
  subtitle: string;
}

export function OperationsOverviewPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [pendingAckCount, setPendingAckCount] = useState(0);
  const [emergencyRoutines, setEmergencyRoutines] = useState<Routine[]>([]);
  const [shortageCount, setShortageCount] = useState(0);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => { loadOverview(); }, [user?.organisation_id, user?.id]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setResults([]); return; }
    const timeout = window.setTimeout(() => runSearch(q), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  async function loadOverview() {
    if (!user?.organisation_id) { setLoading(false); return; }
    setLoading(true);

    const [routinesResult, ackResult, checksResult] = await Promise.all([
      supabase.from('vihem_routines').select('*').eq('organisation_id', user.organisation_id).eq('status', 'published').eq('requires_acknowledgement', true),
      supabase.from('vihem_routine_acknowledgements').select('routine_id').eq('user_id', user.id),
      supabase.from('vihem_inventory_check_items').select('id,action,shortage,created_at:check_id').gt('shortage', 0).limit(200),
    ]);

    const acknowledgedIds = new Set((ackResult.data || []).map((r: any) => r.routine_id));
    const applicableRoutines = (routinesResult.data || []).filter((r: any) => r.applies_to_roles.includes(user.role));
    setPendingAckCount(applicableRoutines.filter((r: any) => !acknowledgedIds.has(r.id)).length);
    setEmergencyRoutines(applicableRoutines.filter((r: any) => r.is_emergency) as Routine[]);

    if (!checksResult.error) {
      setShortageCount((checksResult.data || []).filter((row: any) => row.action === 'none').length);
    }

    const { data: emergencyRows } = await supabase.from('vihem_routines').select('*').eq('organisation_id', user.organisation_id).eq('status', 'published').eq('is_emergency', true);
    setEmergencyRoutines((emergencyRows || []) as Routine[]);

    setLoading(false);
  }

  async function runSearch(query: string) {
    if (!user?.organisation_id) return;
    setSearching(true);
    const [routinesResult, accessResult] = await Promise.all([
      supabase.from('vihem_routines').select('id,title,summary').eq('organisation_id', user.organisation_id).eq('status', 'published').ilike('title', `%${query}%`).limit(8),
      supabase.from('vihem_access_entries').select('id,name,entry_type,property:vihem_properties(name)').eq('organisation_id', user.organisation_id).eq('active', true).or(`name.ilike.%${query}%,location_note.ilike.%${query}%`).limit(8),
    ]);

    const routineResults: SearchResult[] = (routinesResult.data || []).map((r: any) => ({ kind: 'routine', id: r.id, title: r.title, subtitle: r.summary || 'Rutin' }));
    const accessResults: SearchResult[] = (accessResult.data || []).map((a: any) => ({
      kind: 'access',
      id: a.id,
      title: `${ACCESS_ENTRY_TYPE_LABELS[a.entry_type as AccessEntryType] || a.entry_type} -- ${a.name}`,
      subtitle: a.property?.name || 'Åtkomst',
    }));
    setResults([...routineResults, ...accessResults]);
    setSearching(false);
  }

  if (loading) return <LoadingPage />;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Drift & rutiner" subtitle="Åtkomstuppgifter, driftrutiner och checklistor för verksamheten." icon={ClipboardCheck} />

      <div className="mb-5">
        <SearchInput value={search} onChange={setSearch} placeholder='Sök, t.ex. "portkod", "airbnb städ", "pannrum"...' />
        {search.trim().length >= 2 && (
          <Card className="mt-2 p-2">
            {searching ? (
              <p className="p-3 text-sm text-slate-400">Söker...</p>
            ) : results.length === 0 ? (
              <p className="p-3 text-sm text-slate-400">Inga träffar.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {results.map(result => (
                  <button
                    key={`${result.kind}-${result.id}`}
                    onClick={() => onNavigate(result.kind === 'routine' ? 'operations-routines' : 'operations-access')}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-slate-900">{result.title}</span>
                      <span className="block truncate text-xs text-slate-500">{result.subtitle}</span>
                    </span>
                    {result.kind === 'access' && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-500">Visa</span>}
                  </button>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      {emergencyRoutines.length > 0 && (
        <Card className="mb-5 border-red-200 bg-red-50 p-4">
          <p className="mb-2 flex items-center gap-2 font-black text-red-800"><AlertTriangle className="h-4 w-4" />Akut hjälp</p>
          <div className="flex flex-wrap gap-2">
            {emergencyRoutines.map(r => (
              <button key={r.id} onClick={() => onNavigate('operations-routines')} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-bold text-red-700 hover:bg-red-100">{r.title}</button>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Kräver kvittering" value={pendingAckCount} icon={<BookOpen className="h-5 w-5" />} onClick={() => onNavigate('operations-routines')} />
        <StatCard label="Brister ej hanterade" value={shortageCount} icon={<Package className="h-5 w-5" />} onClick={() => onNavigate('operations-inventory')} color="text-amber-600 bg-amber-50" />
        <StatCard label="Åtkomst" value="Öppna" icon={<KeyRound className="h-5 w-5" />} onClick={() => onNavigate('operations-access')} color="text-blue-600 bg-blue-50" />
        <StatCard label="Rutiner" value="Öppna" icon={<BookOpen className="h-5 w-5" />} onClick={() => onNavigate('operations-routines')} color="text-purple-600 bg-purple-50" />
      </div>
    </div>
  );
}
