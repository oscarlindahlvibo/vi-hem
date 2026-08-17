import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, PageHeader, Select } from '../components/ui';
import { Building2, Landmark, RefreshCw, Settings2 } from 'lucide-react';
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
    setCompanyId(current => current || rows[0]?.id || '');
  }, [organisationId]);

  const loadCompanyData = useCallback(async () => {
    if (!companyId) return;
    const [obligationResult, eventResult, integrationResult] = await Promise.all([
      supabase.from('vihem_tax_obligations').select('*').eq('company_id', companyId).order('due_at', { ascending: true }),
      supabase.from('vihem_tax_events').select('*').eq('company_id', companyId).order('event_at', { ascending: false }).limit(20),
      supabase.from('vihem_skatteverket_integrations').select('*').eq('company_id', companyId).maybeSingle(),
    ]);
    if (obligationResult.error) throw obligationResult.error;
    if (eventResult.error) throw eventResult.error;
    if (integrationResult.error) throw integrationResult.error;
    setObligations((obligationResult.data || []) as TaxObligation[]);
    setEvents((eventResult.data || []) as TaxEvent[]);
    setIntegration((integrationResult.data || null) as Integration | null);
  }, [companyId]);

  useEffect(() => { if (!organisationId) return; setLoading(true); loadCompanies().catch(error => setMessage(error.message)).finally(() => setLoading(false)); }, [organisationId, loadCompanies]);
  useEffect(() => { if (!loading) loadCompanyData().catch(error => setMessage(error.message)); }, [companyId, loading, loadCompanyData]);

  const sync = async () => {
    if (!companyId) return;
    setSyncing(true); setMessage('');
    const { error } = await supabase.functions.invoke('vihem-skatteverket', { body: { operation: 'mock-sync', company_id: companyId } });
    if (error) setMessage(error.message || 'Synkningen misslyckades.');
    else { setMessage('Mockad synk klar. Åtaganden och planeringspunkter uppdaterades.'); await loadCompanyData(); }
    setSyncing(false);
  };

  const saveIntegration = async () => {
    if (!companyId) return;
    const { error } = await supabase.from('vihem_skatteverket_integrations').upsert({
      organisation_id: organisationId, company_id: companyId, environment: integration?.environment || 'test', mode: integration?.mode || 'mock',
      client_id: integration?.client_id || '', redirect_uri: integration?.redirect_uri || '', scopes: integration?.scopes || ['read'],
    }, { onConflict: 'organisation_id,company_id' });
    setMessage(error ? error.message : 'Inställningarna sparades. Secrets och OAuth-token hanteras server-side.');
    if (!error) await loadCompanyData();
  };

  if (loading) return <LoadingPage />;
  const company = companies.find(item => item.id === companyId);
  const attention = obligations.filter(item => ['overdue', 'due_soon', 'friday'].includes(getTaxAttentionState(item)));
  const declarations = obligations.filter(item => ['vat', 'agi', 'income_tax', 'preliminary_tax'].includes(item.obligation_type));
  const stats = { open: obligations.filter(item => item.task_status === 'open').length, overdue: obligations.filter(item => getTaxAttentionState(item) === 'overdue').length, dueSoon: attention.length };

  return <div className="space-y-6">
    <PageHeader title="Skatteverket" subtitle="Samlad översikt över bolagens skatteåtaganden och verifierad myndighetssynk." icon={Landmark}
      action={<div className="flex gap-2"><Button variant="secondary" onClick={() => onNavigate('finance')}><Building2 className="h-4 w-4" /> Ekonomi</Button><Button onClick={sync} loading={syncing}><RefreshCw className="h-4 w-4" /> Mockad synk</Button></div>} />
    <Card className="p-4"><div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]"><Select label="Bolag" value={companyId} onChange={e => setCompanyId(e.target.value)} options={companies.map(item => ({ value: item.id, label: item.name }))} /><div className="text-sm text-slate-500 md:pt-7">{company?.organisation_number || 'Organisationsnummer saknas'}<br />Testläge ändrar aldrig officiella uppgifter.</div></div></Card>
    {message && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>}
    <div className="flex flex-wrap gap-2">{(['overview', 'declarations', 'account', 'integration'] as const).map(item => <Button key={item} variant={tab === item ? 'primary' : 'secondary'} onClick={() => setTab(item)}>{({ overview: 'Översikt', declarations: 'Deklarationer', account: 'Skattekonto', integration: 'Integration' }[item])}</Button>)}</div>
    {!companyId ? <EmptyState title="Inga aktiva bolag" description="Lägg till ett bolag under Ekonomi innan Skatteverket kan konfigureras." /> : tab === 'integration' ? <Card className="p-5 space-y-4"><h2 className="text-lg font-bold flex items-center gap-2"><Settings2 className="h-5 w-5 text-blue-600" /> Integration</h2><p className="text-sm text-slate-500">Den första versionen använder mockad data. Officiella API-nycklar, OAuth client secret och certifikat ska läggas som Supabase secrets, aldrig i webbläsaren.</p><div className="grid gap-4 md:grid-cols-2"><Select label="Miljö" value={integration?.environment || 'test'} onChange={e => updateIntegration({ environment: e.target.value as Integration['environment'] })} options={[{ value: 'test', label: 'Test' }, { value: 'production', label: 'Produktion' }]} /><Select label="Anslutningsläge" value={integration?.mode || 'mock'} onChange={e => updateIntegration({ mode: e.target.value as Integration['mode'] })} options={[{ value: 'mock', label: 'Mock / testdata' }, { value: 'oauth', label: 'OAuth (serverkonfigureras)' }, { value: 'certificate', label: 'Certifikat (framtida)' }]} /><Input label="OAuth client ID" value={integration?.client_id || ''} onChange={e => updateIntegration({ client_id: e.target.value })} /><Input label="Redirect URI" value={integration?.redirect_uri || ''} onChange={e => updateIntegration({ redirect_uri: e.target.value })} /></div><Button onClick={saveIntegration}>Spara koppling</Button></Card> : tab === 'account' ? <Card className="p-5"><h2 className="text-lg font-bold">Senaste myndighetshändelser</h2><div className="mt-4 space-y-3">{events.length ? events.map(event => <div key={event.id} className="border-b border-slate-100 pb-3"><div className="font-semibold">{event.title}</div><div className="text-sm text-slate-500">{event.description}</div><div className="text-xs text-slate-400">{new Date(event.event_at).toLocaleString('sv-SE')}</div></div>) : <EmptyState title="Inga händelser" description="Kör en mockad synk för att skapa testdata." />}</div></Card> : <><div className="grid gap-4 md:grid-cols-3"><Card className="p-5"><div className="text-sm text-slate-500">Öppna åtaganden</div><div className="mt-1 text-3xl font-bold">{stats.open}</div></Card><Card className="p-5"><div className="text-sm text-slate-500">Behöver uppmärksamhet</div><div className="mt-1 text-3xl font-bold text-amber-600">{stats.dueSoon}</div></Card><Card className="p-5"><div className="text-sm text-slate-500">Försenade</div><div className="mt-1 text-3xl font-bold text-red-600">{stats.overdue}</div></Card></div><Card className="p-5"><h2 className="text-lg font-bold">{tab === 'declarations' ? 'Deklarationer och arbetsgivarrapporter' : 'Kommande åtaganden'}</h2><div className="mt-4 space-y-3">{(tab === 'declarations' ? declarations : obligations).map(item => { const state = getTaxAttentionState(item); return <div key={item.id || item.official_reference} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold">{item.title}</div><div className="text-sm text-slate-500">{item.period} · {item.description}</div><div className="text-xs text-slate-400">Förfallodag: {item.due_at ? new Date(item.due_at).toLocaleDateString('sv-SE') : 'saknas'} · {formatTaxAmount(item.amount)}</div></div><div className="flex items-center gap-2"><Badge className={stateClass[state]}>{taxAttentionLabel(state)}</Badge><Badge className={item.verification_status === 'verified' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>{item.verification_status === 'verified' ? 'Verifierad' : 'Kontrollera'}</Badge></div></div>; })}</div>{!obligations.length && <EmptyState title="Inga åtaganden ännu" description="Kör en mockad synk eller konfigurera den server-side officiella integrationen." />}</Card></>}
  </div>;
}
