import {useEffect,useState} from 'react';
import {client} from './api';
import type {Snapshot} from '../../../supabase/functions/vihem-vibogruppen-charging/monta';
export function ChargingStatus(){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 useEffect(()=>{
  let active=true,pending=false;const unavailable=()=>({status:'unavailable' as const,checkedAt:null,points:[]});
  async function update(){
   if(pending||document.hidden)return;pending=true;
   try {
    if(!client)throw Error('Not configured');
    const {data,error}=await client.functions.invoke('vihem-vibogruppen-charging',{body:{}});
    if(error||data?.status!=='ok'||!Array.isArray(data.points)||!data.points.length||!Number.isFinite(Date.parse(data.checkedAt))||Date.now()-Date.parse(data.checkedAt)>90000)throw Error('Unavailable');
    if(active)setSnapshot(data);
   }catch {if(active)setSnapshot(unavailable());}finally{pending=false;}
  }
  void update();const timer=window.setInterval(()=>{if(active)setSnapshot(s=>s?.checkedAt&&Date.now()-Date.parse(s.checkedAt)>90000?unavailable():s);void update();},30000);
  const resume=()=>{if(!document.hidden){setSnapshot(s=>s?.checkedAt&&Date.now()-Date.parse(s.checkedAt)>90000?unavailable():s);void update();}};document.addEventListener('visibilitychange',resume);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',resume);};
 },[]);
 const labels={available:'Ledig',busy:'Upptagen',unavailable:'Ur drift',unknown:'Status okänd'};
 return <div className="charging-status" role="status" aria-live="polite">
  {!snapshot?<span>Hämtar laddstatus…</span>:snapshot.status!=='ok'?<><strong>Live-status är inte tillgänglig just nu</strong><span>Kontrollera aktuell status i Monta eller ChargeFinder.</span></>:<>
   <strong>{snapshot.points.some(p=>p.status==='unknown')?`${snapshot.points.filter(p=>p.status==='available').length} bekräftat lediga · delvis okänd status`:`${snapshot.points.filter(p=>p.status==='available').length} av ${snapshot.points.length} laddpunkter lediga`}</strong>
   <ul>{snapshot.points.map(p=><li key={p.label}><span>{p.label}{p.maxKw?` · ${p.maxKw} kW`:''}</span><span className={'charging-state charging-'+p.status}>{labels[p.status]}</span></li>)}</ul>
   <span>Hämtat från Monta {new Date(snapshot.checkedAt!).toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})}</span>
  </>}
 </div>;
}
