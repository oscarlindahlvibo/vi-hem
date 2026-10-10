import React, { useEffect, useState, useRef, useCallback } from 'react';
import { AlertTriangle, BookOpen, ClipboardCheck, KeyRound, Package } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Card, LoadingPage, PageHeader, SearchInput, Button } from '../components/ui';
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
  const [error,setError]=useState('');
  const searchSequence=useRef(0);

  const loadOverview=useCallback(async () => {
    if (!user?.organisation_id) { setLoading(false); return; }
    setLoading(true);setError('');

    const [routinesResult, ackResult, checksResult] = await Promise.all([
      supabase.from('vihem_routines').select('*').eq('organisation_id', user.organisation_id).eq('status', 'published').eq('requires_acknowledgement', true),
      supabase.from('vihem_routine_acknowledgements').select('routine_id').eq('user_id', user.id),
      supabase.from('vihem_inventory_check_items').select('id,action,shortage,created_at:check_id').gt('shortage', 0).limit(200),
    ]);

    if(routinesResult.error || ackResult.error || checksResult.error) setError('Översikten kunde inte hämtas helt. Försök igen.');
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
  },[user?.organisation_id,user?.id,user?.role]);

  const runSearch=useCallback(async (query: string, sequence: number) => {
    if (!user?.organisation_id) return;
    setSearching(true);
    const [routinesResult, accessResult] = await Promise.all([
      supabase.from('vihem_routines').select('id,title,summary').eq('organisation_id', user.organisation_id).eq('status', 'published').ilike('title', `%${query}%`).limit(8),
      supabase.from('vihem_access_entries').select('id,name,entry_type,property:vihem_properties(name)').eq('organisation_id', user.organisation_id).eq('active', true).or(`name.ilike.%${query}%,location_note.ilike.%${query}%`).limit(8),
    ]);

    if(sequence!==searchSequence.current)return;
    if(routinesResult.error||accessResult.error){setResults([]);setSearching(false);setError('Sökningen misslyckades. Försök igen.');return;}
    const routineResults: SearchResult[] = (routinesResult.data || []).map((r: any) => ({ kind: 'routine', id: r.id, title: r.title, subtitle: r.summary || 'Rutin' }));
    const accessResults: SearchResult[] = (accessResult.data || []).map((a: any) => ({
      kind: 'access',
      id: a.id,
      title: `${ACCESS_ENTRY_TYPE_LABELS[a.entry_type as AccessEntryType] || a.entry_type} -- ${a.name}`,
      subtitle: a.property?.name || 'Åtkomst',
    }));
    setResults([...routineResults, ...accessResults]);
    setSearching(false);
  },[user?.organisation_id]);

  useEffect(()=>{void loadOverview();},[loadOverview]);
  useEffect(()=>{const sequence=++searchSequence.current;const q=search.trim();setResults([]);setSearching(q.length>=2);if(q.length<2)return;const timer=window.setTimeout(()=>void runSearch(q,sequence),300);return()=>{window.clearTimeout(timer);searchSequence.current=sequence+1;};},[search,runSearch]);

  if (loading) return <LoadingPage />;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Drift & rutiner" subtitle="Åtkomstuppgifter, driftrutiner och checklistor för verksamheten." icon={ClipboardCheck} />

      {error&&<div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}<Button variant="secondary" size="sm" onClick={()=>void loadOverview()}>Försök igen</Button></div>}
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

      {(pendingAckCount>0||shortageCount>0)&&<section className="mb-5 divide-y divide-slate-200"><h2 className="pb-3 text-sm font-semibold">Att följa upp</h2>{pendingAckCount>0&&<button className="vihem-focus flex min-h-12 w-full items-center justify-between py-3 text-left" onClick={()=>onNavigate('operations-routines')}><span>Rutiner att kvittera</span><strong className="tabular-nums">{pendingAckCount}</strong></button>}{shortageCount>0&&<button className="vihem-focus flex min-h-12 w-full items-center justify-between py-3 text-left" onClick={()=>onNavigate('operations-inventory')}><span>Brister som behöver hanteras</span><strong className="tabular-nums text-amber-700">{shortageCount}</strong></button>}</section>}
      <section className="grid gap-2 sm:grid-cols-2" aria-label="Driftverktyg">{[{page:'operations-access',title:'Åtkomst',description:'Hitta nycklar, koder och åtkomstuppgifter.',icon:KeyRound},{page:'operations-routines',title:'Rutiner',description:'Instruktioner och arbetssätt för verksamheten.',icon:BookOpen},{page:'operations-checklists',title:'Checklistor',description:'Genomför kontroller och följ upp resultat.',icon:ClipboardCheck},{page:'operations-inventory',title:'Driftinventarier',description:'Kontrollera utrustning och hantera brister.',icon:Package}].map(item=><button key={item.page} onClick={()=>onNavigate(item.page)} className="vihem-focus flex items-start gap-3 rounded-xl bg-white p-4 text-left ring-1 ring-slate-200 transition-colors hover:bg-blue-50"><item.icon className="mt-1 h-5 w-5 shrink-0 text-blue-700"/><span><strong className="block text-sm text-slate-900">{item.title}</strong><span className="mt-1 block text-sm text-slate-500">{item.description}</span></span></button>)}</section>

    </div>
  );
}
