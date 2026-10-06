import { useCallback, useEffect, useState } from 'react';
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
  const load=useCallback(async()=>{
    const {data,error:failure}=await client.rpc('vihem_vibofast_interests',{p_offset:offset,p_id:initialId || null});
    if(failure)throw failure;
    setInbox(data as Inbox);
  },[client,offset,initialId]);
  useEffect(()=>{
    let active=true;
    const refresh=()=>void load().catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    setLoading(true);setError('');refresh();
    const timer=window.setInterval(refresh,30000);
    window.addEventListener('focus',refresh);
    return ()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[load]);
  async function update(interest: Interest,status: string) {
    setSaving(interest.id);setError('');
    try {
      const {error:failure}=await client.rpc('vihem_vibofast_set_interest_status',{p_id:interest.id,p_status:status,p_revision:interest.revision});
      if(failure)throw failure;
      await load();
    }catch(e){setError(e instanceof Error ? e.message : (e as {message?:string}).message || 'Kunde inte uppdatera status.');}
    finally{setSaving(undefined);}
  }
  return <section className="mx-auto max-w-5xl p-4 sm:p-8">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">Intresseanmälningar</h1><p className="mt-2 text-slate-600">Inkomna bostadsönskemål från Vibo Fastigheters hemsida.</p></div>
      <button className="rounded-lg border px-4 py-2" onClick={()=>{setError('');void load().catch(e=>setError(e.message));}}>Uppdatera</button>
    </div>
    {initialId && <button className="mb-4 text-blue-700 underline" onClick={()=>onNavigate('vibofast-interests')}>Visa alla intresseanmälningar</button>}
    {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
    {loading ? <p role="status">Laddar intresseanmälningar…</p> : inbox.items.length===0 ? <p className="rounded-xl border bg-white p-8">{initialId?'Anmälan hittades inte.':'Inga intresseanmälningar har kommit in ännu.'}</p> :
      <div className="space-y-4">{inbox.items.map(item=><article key={item.id} className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-lg font-semibold">{item.payload.name}</h2><p className="text-sm text-slate-500">{new Date(item.created_at).toLocaleString('sv-SE')}</p></div>
          <label className="text-sm font-medium">Status<select className="ml-2 rounded-lg border p-2" disabled={saving===item.id} value={item.status} onChange={e=>void update(item,e.target.value)}>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div><dt className="text-sm text-slate-500">E-post</dt><dd><a className="text-blue-700 underline" href={`mailto:${item.payload.email}`}>{item.payload.email}</a></dd></div>
          <div><dt className="text-sm text-slate-500">Telefon</dt><dd>{item.payload.phone || 'Ej angivet'}</dd></div>
          <div><dt className="text-sm text-slate-500">Önskad objekttyp</dt><dd>{propertyTypes[item.payload.propertyType] || item.payload.propertyType || 'Ej angivet'}</dd></div>
          <div><dt className="text-sm text-slate-500">Antal rum</dt><dd>{item.payload.rooms || 'Ej angivet'}</dd></div>
          <div><dt className="text-sm text-slate-500">Önskad inflyttning</dt><dd>{item.payload.moveInDate || 'Ej angivet'}</dd></div>
        </dl>
        {item.payload.message && <div className="mt-4"><h3 className="text-sm text-slate-500">Meddelande</h3><p className="mt-1 whitespace-pre-wrap break-words">{item.payload.message}</p></div>}
      </article>)}</div>}
    {!initialId && inbox.total>100 && <div className="mt-6 flex items-center justify-between gap-4">
      <button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-100))}>Föregående</button>
      <span>{offset+1}–{Math.min(offset+100,inbox.total)} av {inbox.total}</span>
      <button disabled={offset+100>=inbox.total} onClick={()=>setOffset(offset+100)}>Nästa</button>
    </div>}
  </section>;
}
