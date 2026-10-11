import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, PageHeader, Select, Tabs, SearchInput, Modal } from '../components/ui';
import { Building2, Landmark, RefreshCw, Settings2 } from 'lucide-react';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { formatTaxAmount, getTaxAttentionState, taxAttentionLabel, type TaxAttentionState, type TaxObligation } from '../lib/skatteverket';

type Company = { id: string; name: string; legal_name?: string; organisation_number?: string };
type TaxEvent = { id: string; title: string; description: string; event_at: string; event_type: string };
type Integration = { id?: string; company_id: string; environment: 'test' | 'production'; mode: 'mock' | 'oauth' | 'certificate'; client_id: string; redirect_uri: string; scopes: string[]; last_sync_at?: string | null; last_error?: string };

const stateClass: Record<TaxAttentionState, string> = {
  overdue: 'bg-red-50 text-red-700', due_soon: 'bg-amber-50 text-amber-700', stale: 'bg-purple-50 text-purple-700',
  friday: 'bg-blue-50 text-blue-700', normal: 'bg-slate-100 text-slate-700', done: 'bg-emerald-50 text-emerald-700',
};

export function SkatteverketPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const organisationId = user?.organisation_id || '';
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [obligations, setObligations] = useState<TaxObligation[]>([]);
  const [events, setEvents] = useState<TaxEvent[]>([]);
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [tab, setTab] = useState<'overview' | 'declarations' | 'account' | 'integration'>('overview');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [failed,setFailed]=useState(false);
  const [saving,setSaving]=useState(false);
  const [dataLoaded,setDataLoaded]=useState(false);
  const [dataLoading,setDataLoading]=useState(false);
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('all');
  const [pendingCompany,setPendingCompany]=useState<string>();
  const [baseline,setBaseline]=useState<Integration|null>(null);
  const dirty=useUnsavedChanges(integration,dataLoaded,baseline);
  const request=useRef(0);
  const operation=useRef(false);

  const updateIntegration = (patch: Partial<Integration>) => {
    setIntegration(current => ({
      company_id: companyId,
      environment: 'test',
      mode: 'mock',
      client_id: '',
      redirect_uri: '',
      scopes: ['read'],
      ...current,
      ...patch,
    }));
  };

  const loadCompanies = useCallback(async () => {
    const { data, error } = await supabase.from('vihem_companies').select('id,name,legal_name,organisation_number').eq('organisation_id', organisationId).eq('active', true).order('name');
    if (error) throw error;
    const rows = (data || []) as Company[];
    setCompanies(rows);
    setCompanyId(current => rows.some(row=>row.id===current)?current:rows[0]?.id||'');
  }, [organisationId]);

  const loadCompanyData = useCallback(async () => {
    const generation=++request.current;
    if (!companyId) {setDataLoaded(false);return;}
    setDataLoaded(false);setDataLoading(true);setFailed(false);setMessage('');setObligations([]);setEvents([]);
    try {
    const [obligationResult, eventResult, integrationResult] = await Promise.all([
      supabase.from('vihem_tax_obligations').select('*').eq('company_id', companyId).order('due_at', { ascending: true }),
      supabase.from('vihem_tax_events').select('*').eq('company_id', companyId).order('event_at', { ascending: false }).limit(20),
      supabase.from('vihem_skatteverket_integrations').select('*').eq('company_id', companyId).maybeSingle(),
    ]);
    if(generation!==request.current)return;
    if (obligationResult.error) throw obligationResult.error;
    if (eventResult.error) throw eventResult.error;
    if (integrationResult.error) throw integrationResult.error;
    setObligations((obligationResult.data || []) as TaxObligation[]);
    setEvents((eventResult.data || []) as TaxEvent[]);
    setIntegration((integrationResult.data || null) as Integration | null);setBaseline((integrationResult.data || null) as Integration | null);setDataLoaded(true);return true;
    }catch(error){if(generation===request.current){setFailed(true);setMessage(error instanceof Error?error.message:(error as {message?:string}).message||'Kunde inte hämta bolagets uppgifter.');}}finally{if(generation===request.current)setDataLoading(false);}
  }, [companyId]);

  useEffect(() => { if (!organisationId) return; setLoading(true); loadCompanies().catch(error => {setFailed(true);setMessage(error.message);}).finally(() => setLoading(false)); }, [organisationId, loadCompanies]);
  useEffect(() => { if (!loading) void loadCompanyData();const counter=request;return()=>{++counter.current;}; }, [loading, loadCompanyData]);

  const sync = async () => {
    if (!companyId || operation.current || !dataLoaded) return;
    operation.current=true;setSyncing(true);setFailed(false);setMessage('');
    try {
      const { error } = await supabase.functions.invoke('vihem-skatteverket', { body: { operation: 'mock-sync', company_id: companyId } });
      if(error)throw error;
      if(await loadCompanyData())setMessage('Testsynk utförd. Kontrollera hämtade uppgifter; inget skickades till myndigheten.');
      else setMessage(previous=>'Testsynk utförd men återläsningen misslyckades. '+previous);
    }catch(error){setFailed(true);setMessage(error instanceof Error?error.message:'Testsynkningen misslyckades.');}
    finally{operation.current=false;setSyncing(false);}
  };

  const saveIntegration = async () => {
    if (!companyId || operation.current || !dataLoaded) return;
    operation.current=true;setSaving(true);setFailed(false);setMessage('');
    try {
      const { error } = await supabase.from('vihem_skatteverket_integrations').upsert({
        organisation_id: organisationId, company_id: companyId, environment: integration?.environment || 'test', mode: integration?.mode || 'mock',
        client_id: integration?.client_id || '', redirect_uri: integration?.redirect_uri || '', scopes: integration?.scopes || ['read'],
      }, { onConflict: 'organisation_id,company_id' });
      if(error)throw error;
      if(await loadCompanyData())setMessage('Inställningarna sparades. Kontrollera återlästa uppgifter innan du fortsätter.');
      else setMessage(previous=>'Inställningarna sparades men återläsningen misslyckades. '+previous);
    }catch(error){setFailed(true);setMessage(error instanceof Error?error.message:(error as {message?:string}).message||'Kunde inte spara kopplingen. Ditt utkast finns kvar.');}
    finally{operation.current=false;setSaving(false);}
  };

  if (loading) return <LoadingPage />;
  const company = companies.find(item => item.id === companyId);
  const attention = obligations.filter(item => ['overdue', 'due_soon', 'friday'].includes(getTaxAttentionState(item)));
  const declarations = obligations.filter(item => ['vat', 'agi', 'income_tax', 'preliminary_tax'].includes(item.obligation_type));
  const stats = { open: obligations.filter(item => item.task_status === 'open').length, overdue: obligations.filter(item => getTaxAttentionState(item) === 'overdue').length, dueSoon: attention.length };

  const rows=(tab==='declarations'?declarations:obligations).filter(item=>(filter==='all'||(filter==='open'?item.task_status==='open':attention.includes(item)))&&[item.title,item.period,item.description].join(' ').toLocaleLowerCase('sv').includes(query.toLocaleLowerCase('sv')));
  return <div className="space-y-5">
    <PageHeader title="Skatteverket" subtitle="Bolagens åtaganden och testunderlag. Officiell myndighetsanslutning är inte verifierad." icon={Landmark}
      action={<div className="flex gap-2"><Button variant="secondary" onClick={() => onNavigate('finance')}><Building2 className="h-4 w-4" /> Ekonomi</Button><Button onClick={sync} loading={syncing} disabled={!dataLoaded || saving || dirty}><RefreshCw className="h-4 w-4" /> Mockad synk</Button></div>} />
    <div className="border-b border-slate-200 pb-5"><div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]"><Select label="Bolag" disabled={saving||syncing} value={companyId} onChange={e=>{if(dirty)setPendingCompany(e.target.value);else{++request.current;setCompanyId(e.target.value);}}} options={companies.map(item => ({ value: item.id, label: item.name }))} /><div className="text-sm text-slate-500 md:pt-7">{company?.organisation_number || 'Organisationsnummer saknas'}<br />Testläge ändrar aldrig officiella uppgifter.</div></div></div>
    {message && <div role={failed?'alert':'status'} className={`rounded-xl p-4 text-sm ${failed?'bg-amber-50 text-amber-900':'bg-green-50 text-green-900'}`}>{message}{failed&&!dataLoaded&&<Button className="ml-3" variant="secondary" onClick={()=>void (companies.length?loadCompanyData():loadCompanies()).catch(()=>{setFailed(true);setMessage('Kunde inte hämta bolagen. Försök igen.');})}>Hämta igen</Button>}</div>}
    <Tabs tabs={Object.entries({overview:'Översikt',declarations:'Deklarationer',account:'Skattekonto',integration:'Integration'}).map(([key,label])=>({key,label}))} active={tab} onChange={key=>setTab(key as typeof tab)}/>
    {dataLoading && <p role="status" className="text-sm text-slate-500">Hämtar bolagets uppgifter…</p>}

    {!companyId ? <EmptyState title="Inga aktiva bolag" description="Lägg till ett bolag under Ekonomi innan Skatteverket kan konfigureras." /> : tab === 'integration' ? <Card className="p-5 space-y-4"><fieldset disabled={!dataLoaded||saving||syncing} className="space-y-4"><h2 className="text-lg font-bold flex items-center gap-2"><Settings2 className="h-5 w-5 text-blue-600" /> Integration</h2><p className="text-sm text-slate-500">Den första versionen använder mockad data. Officiella API-nycklar, OAuth client secret och certifikat ska läggas som Supabase secrets, aldrig i webbläsaren.</p><div className="grid gap-4 md:grid-cols-2"><Select label="Miljö" value={integration?.environment || 'test'} onChange={e => updateIntegration({ environment: e.target.value as Integration['environment'] })} options={[{ value: 'test', label: 'Test' }, { value: 'production', label: 'Produktion' }]} /><Select label="Anslutningsläge" value={integration?.mode || 'mock'} onChange={e => updateIntegration({ mode: e.target.value as Integration['mode'] })} options={[{ value: 'mock', label: 'Mock / testdata' }, { value: 'oauth', label: 'OAuth (serverkonfigureras)' }, { value: 'certificate', label: 'Certifikat (framtida)' }]} /><Input label="OAuth client ID" value={integration?.client_id || ''} onChange={e => updateIntegration({ client_id: e.target.value })} /><Input label="Redirect URI" value={integration?.redirect_uri || ''} onChange={e => updateIntegration({ redirect_uri: e.target.value })} /></div><div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-slate-500">{!dataLoaded?'Hämta uppgifterna innan du fortsätter':dirty?'Osparade ändringar':'Inga osparade ändringar'}</span><Button onClick={saveIntegration} loading={saving}>Spara koppling</Button></div></fieldset></Card> : tab === 'account' ? <Card className="p-5"><h2 className="text-lg font-bold">Senaste myndighetshändelser</h2><div className="mt-4 space-y-3">{events.length ? events.map(event => <div key={event.id} className="border-b border-slate-100 pb-3"><div className="font-semibold">{event.title}</div><div className="text-sm text-slate-500">{event.description}</div><div className="text-xs text-slate-400">{new Date(event.event_at).toLocaleString('sv-SE')}</div></div>) : <EmptyState title="Inga händelser" description="Kör en mockad synk för att skapa testdata." />}</div></Card> : <>
      <dl className="grid grid-cols-3 divide-x divide-slate-200 border-y border-slate-200 py-4">{[['Öppna',stats.open],['Att bevaka',stats.dueSoon],['Försenade',stats.overdue]].map(([label,value])=><div key={label} className="px-3 first:pl-0"><dt className="text-sm text-slate-500">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</dd></div>)}</dl>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]"><SearchInput value={query} onChange={setQuery} placeholder="Sök åtagande eller period"/><Select label="Visa" value={filter} onChange={e=>setFilter(e.target.value)} options={[{value:'all',label:'Alla'},{value:'open',label:'Öppna'},{value:'attention',label:'Att bevaka'}]}/></div>
      <h2 className="text-lg font-semibold">{tab==='declarations'?'Deklarationer och arbetsgivarrapporter':'Kommande åtaganden'}</h2>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="hidden grid-cols-[minmax(0,1fr)_8rem_9rem_11rem] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm font-medium text-slate-500 lg:grid"><span>Åtagande / period</span><span>Förfallodag</span><span className="text-right">Belopp</span><span>Status</span></div>
        <div className="divide-y divide-slate-100">{rows.map(item=>{const state=getTaxAttentionState(item);return <article key={item.id||item.official_reference} className="grid gap-3 p-5 lg:grid-cols-[minmax(0,1fr)_8rem_9rem_11rem] lg:items-center lg:gap-4"><div className="min-w-0"><h3 className="break-words font-medium text-slate-900">{item.title}</h3><p className="mt-1 text-sm text-slate-500">{item.period}</p>{item.description&&<details className="mt-2 text-sm text-slate-600"><summary className="cursor-pointer">Visa underlag</summary><p className="mt-2 whitespace-pre-wrap break-words">{item.description}</p></details>}</div><p className="text-sm tabular-nums text-slate-600"><span className="lg:hidden">Förfaller: </span>{item.due_at?new Date(item.due_at).toLocaleDateString('sv-SE'):'Datum saknas'}</p><p className="font-semibold tabular-nums text-slate-900 lg:text-right">{formatTaxAmount(item.amount)}</p><div className="flex flex-wrap gap-2"><Badge className={stateClass[state]}>{taxAttentionLabel(state)}</Badge><span className="text-sm text-slate-500">{item.verification_status==='verified'?'Verifierat underlag':'Behöver kontrolleras'}</span></div></article>;})}</div>
        {!rows.length&&!dataLoading&&<EmptyState title={query||filter!=='all'?'Inga träffar':'Inga åtaganden att visa'} description="Ändra filtret eller hämta testunderlag. Officiella uppgifter kräver en verifierad myndighetsanslutning."/>}
      </div>
    </>}
    <Modal open={pendingCompany!==undefined} onClose={()=>setPendingCompany(undefined)} title="Byta bolag med osparade ändringar?" footer={<><Button variant="secondary" onClick={()=>setPendingCompany(undefined)}>Fortsätt redigera</Button><Button variant="danger" onClick={()=>{++request.current;setCompanyId(pendingCompany||'');setPendingCompany(undefined);}}>Lämna utan att spara</Button></>}><p className="text-sm text-slate-600">Spara kopplingen innan du byter bolag om du vill behålla ändringarna.</p></Modal>

  </div>;
}
