import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, PageHeader, SearchInput, Select, EmptyState } from '../../components/ui';
import { Inbox as InboxIcon } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';

interface Interest { id: string; created_at: string; status: string; revision: number; payload: Record<string, string>; }
interface Inbox { items: Interest[]; total: number; }
const statuses: Record<string,string> = { new: 'Ny', contacted: 'Kontaktad', archived: 'Arkiverad' };
const propertyTypes: Record<string,string> = { apartment: 'Lägenhet', commercial: 'Lokal', office: 'Kontor', retail: 'Butik', warehouse: 'Lager', storage: 'Förråd', garage: 'Garage' };

export function InterestsAdmin({ client, initialId, onNavigate }: { client: SupabaseClient; initialId?: string; onNavigate: (page: string)=>void }) {
  const [inbox,setInbox]=useState<Inbox>({items:[],total:0});
  const [offset,setOffset]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState<string>();
  const [query,setQuery]=useState('');
  const [statusFilter,setStatusFilter]=useState('all');
  const request=useRef(0);
  const mutation=useRef(false);
  const load=useCallback(async()=>{
    const generation=++request.current;
    const {data,error:failure}=await client.rpc('vihem_vibofast_interests',{p_offset:offset,p_id:initialId || null});
    if(failure)throw failure;
    if(generation===request.current) setInbox(data as Inbox);
  },[client,offset,initialId]);
  useEffect(()=>{
    let active=true;
    const generationCounter=request;
    const refresh=()=>void load().catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    setLoading(true);setError('');refresh();
    const timer=window.setInterval(refresh,30000);
    window.addEventListener('focus',refresh);
    return ()=>{active=false;++generationCounter.current;window.clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[load]);
  async function update(interest: Interest,status: string) {
    if(mutation.current)return;mutation.current=true;
    setSaving(interest.id);setError('');
    try {
      const {error:failure}=await client.rpc('vihem_vibofast_set_interest_status',{p_id:interest.id,p_status:status,p_revision:interest.revision});
      if(failure)throw failure;
      await load();
    }catch(e){setError(e instanceof Error ? e.message : (e as {message?:string}).message || 'Kunde inte uppdatera status.');}
    finally{mutation.current=false;setSaving(undefined);}
  }
  const visible=inbox.items.filter(item=>(statusFilter==='all'||item.status===statusFilter)&&[item.payload.name,item.payload.email,item.payload.phone,item.payload.message].some(text=>String(text||'').toLocaleLowerCase('sv').includes(query.toLocaleLowerCase('sv'))));
  return <section className="mx-auto max-w-5xl space-y-5 py-4">
    <PageHeader title="Intresseanmälningar" subtitle="Följ upp bostadsönskemål från Vibo Fastigheters hemsida." action={<Button variant="secondary" onClick={()=>{setError('');setLoading(true);void load().catch(()=>setError('Kunde inte hämta anmälningarna. Försök igen.')).finally(()=>setLoading(false));}}>Uppdatera</Button>}/>
    {initialId && <Button variant="secondary" onClick={()=>onNavigate('vibofast-interests')}>Visa alla intresseanmälningar</Button>}
    <div className="grid gap-3 sm:grid-cols-[1fr_12rem]"><SearchInput value={query} onChange={setQuery} placeholder="Sök namn, kontakt eller önskemål"/><Select label="Status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} options={[{value:'all',label:'Alla'},...Object.entries(statuses).map(([value,label])=>({value,label}))]}/></div>
    <p className="text-sm text-slate-500">{inbox.total} anmälningar totalt · Sökning och filter gäller den hämtade sidan.</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
    {loading ? <p role="status">Laddar intresseanmälningar…</p> : visible.length===0 ? <EmptyState icon={<InboxIcon className="h-8 w-8"/>} title={query||statusFilter!=='all'?'Inga träffar':'Inga intresseanmälningar'} description={initialId?'Anmälan kunde inte hittas.':'Ändra filtret eller återkom när ett nytt önskemål har inkommit.'}/> :
      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">{visible.map(item=><article key={item.id} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0"><h2 className="break-words text-base font-semibold text-slate-900">{item.payload.name}</h2><p className="mt-1 text-sm text-slate-500">{new Date(item.created_at).toLocaleString('sv-SE')}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm"><a className="break-all font-medium text-blue-700 hover:underline" href={`mailto:${item.payload.email}`}>{item.payload.email}</a>{item.payload.phone && <a className="font-medium text-blue-700 hover:underline" href={`tel:${item.payload.phone}`}>{item.payload.phone}</a>}</div></div>
          <div className="w-full sm:w-40"><Select label={`Status för ${item.payload.name}`} disabled={Boolean(saving)} value={item.status} onChange={e=>void update(item,e.target.value)} options={Object.entries(statuses).map(([value,label])=>({value,label}))}/></div>
        </div>
        <details className="mt-4" open={Boolean(initialId)}><summary className="cursor-pointer text-sm font-medium text-slate-600">Önskemål · {propertyTypes[item.payload.propertyType] || item.payload.propertyType || 'Objekt'}{item.payload.rooms ? ` · ${item.payload.rooms} rum` : ''}</summary><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">{[['Önskad inflyttning',item.payload.moveInDate],['Antal rum',item.payload.rooms]].filter(([,value])=>value).map(([label,value])=><div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 text-slate-800">{value}</dd></div>)}</dl>{item.payload.message && <p className="mt-3 max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{item.payload.message}</p>}</details>
      </article>)}</div>}
    {!initialId && inbox.total>100 && <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="secondary" disabled={offset===0||loading} onClick={()=>setOffset(Math.max(0,offset-100))}>Föregående</Button><span className="text-sm tabular-nums text-slate-500">{offset+1}–{Math.min(offset+100,inbox.total)} av {inbox.total}</span><Button variant="secondary" disabled={offset+100>=inbox.total||loading} onClick={()=>setOffset(offset+100)}>Nästa</Button></div>}
  </section>;
}
