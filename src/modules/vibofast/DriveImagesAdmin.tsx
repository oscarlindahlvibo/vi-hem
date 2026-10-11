import {useCallback,useEffect,useRef,useState} from 'react';
import {Button,Input} from '../../components/ui';
import type {SupabaseClient} from '@supabase/supabase-js';
interface DriveState {
 settings:{root_folder_id:string;site_folder_id:string;delegated_user:string;enabled:boolean;revision:number;lease_until:string|null;last_error:string|null};
 properties:{id:string;address:string}[];apartments:{id:string;property_id:string}[];
 folders:{kind:string;entity_id:string;folder_id:string;extra:{container_folder_id?:string}}[];
 images:{kind:string;entity_id:string;name:string;position:number;url:string}[];
 runs:{property_id:string;last_success:string|null;error:string|null}[];
}
export function DriveImagesAdmin({client,apartmentId}:{client:SupabaseClient;apartmentId?:string}) {
 const [state,setState]=useState<DriveState>();
 const [root,setRoot]=useState('');const [subject,setSubject]=useState('');const [enabled,setEnabled]=useState(false);const [revision,setRevision]=useState(0);
 const lock=useRef(false);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');
 const load=useCallback(async(reset=false)=>{
  const {data,error:failure}=await client.rpc('vihem_vibofast_drive_state');if(failure)throw failure;
  const next=data as DriveState;setState(next);
  if(reset){setRoot(next.settings.root_folder_id);setSubject(next.settings.delegated_user);setEnabled(next.settings.enabled);setRevision(next.settings.revision);}
  return next;
 },[client]);
 useEffect(()=>{void load(true).catch(e=>setError(e.message)).finally(()=>setLoading(false));const timer=window.setInterval(()=>void load().catch(e=>setError(e.message)),30000);return()=>window.clearInterval(timer);},[load]);
 async function invoke(body:Record<string,unknown>) {
  const {data,error:failure}=await client.functions.invoke('vihem-vibofast-drive',{body});
  if(failure){let detail='';try{detail=(await failure.context.json()).error;}catch{/* use invocation error */}throw new Error(detail || failure.message);}
  if(data.error)throw new Error(data.error);return data;
 }
 async function configure(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');
  try{await invoke({action:'configure',root_folder_id:root,delegated_user:subject,enabled,revision});await load(true);setMessage('Drive-kopplingen är sparad. Mappar och bilder synkas automatiskt.');}
  catch(e){setError(e instanceof Error?e.message:'Kunde inte ansluta Drive.');}finally{lock.current=false;setBusy(false);}
 }
 async function sync(){
  if(!state || lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');
  try{
   const propertyId=state.apartments.find(a=>a.id===apartmentId)?.property_id;
   if(apartmentId && !propertyId)throw new Error('Lägenheten kunde inte kopplas till en fastighet. Hämta uppgifterna igen innan du synkar.');
   const properties=propertyId?state.properties.filter(p=>p.id===propertyId):state.properties;
   for(const property of properties){
    setMessage(`Skapar mappar och synkar ${property.address}…`);
    let result;let restart=true;
    do{
    result=await invoke({action:'sync',property_id:property.id,restart});restart=false;
    if(result.status==='busy')throw new Error('En synkning pågår redan. Försök igen när den är klar.');
    if(result.status==='disabled')throw new Error('Aktivera Drive-kopplingen först.');
    if(result.errors?.length)throw new Error(result.errors.join('\n'));
    await load();
    }while(result.status==='partial');
   }
   setMessage('Mappar och hemsidebilder är uppdaterade. Hemsidan hämtar bildlistan inom en minut.');
  }catch(e){setMessage('');setError(e instanceof Error?e.message:'Synkningen misslyckades.');await load().catch(()=>{});}finally{lock.current=false;setBusy(false);}
 }
 const propertyId=state?.apartments.find(a=>a.id===apartmentId)?.property_id;
 const apartmentFolder=state?.folders.find(f=>f.kind==='apartment' && f.entity_id===apartmentId);
 const commonFolder=state?.folders.find(f=>f.kind==='property' && f.entity_id===propertyId);
 const images=state?.images.filter(i=>(i.kind==='apartment' && i.entity_id===apartmentId) || (i.kind==='property' && i.entity_id===propertyId)).sort((a,b)=>(a.kind==='apartment'?0:1)-(b.kind==='apartment'?0:1) || a.position-b.position) || [];
 const link=(id:string,label:string)=><a className="inline-flex min-h-11 items-center rounded-lg px-2 font-medium text-blue-700 hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-500" href={`https://drive.google.com/drive/folders/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">{label}</a>;
 return <details className="my-6 rounded-xl border bg-white p-4" open={Boolean(apartmentId)}>
  <summary className="cursor-pointer font-semibold">Bilder från Google Drive</summary>
  <p className="my-3 text-sm text-slate-600">Bilder i lägenhetens mapp visas tillsammans med fastighetens Gemensamma bilder. Lägg endast bilder för hemsidan i dessa mappar. JPG, PNG och WebP, högst 10 MB per bild. Filnamn styr ordningen, exempelvis 01-kök.jpg.</p>
  {loading && <p role="status" className="my-3 text-sm text-slate-500">Hämtar bildarkivet…</p>}
  {!state && !loading && <Button variant="secondary" onClick={()=>{setLoading(true);setError('');void load(true).catch(()=>setError('Kunde inte hämta Drive-inställningarna.')).finally(()=>setLoading(false));}}>Försök hämta igen</Button>}
  <div className="grid gap-3 sm:grid-cols-2">
   <Input label="Delad Drive eller huvudmapp" value={root} onChange={e=>setRoot(e.target.value)} placeholder="Klistra in Drive-mapplänken" disabled={busy || !state}/>
   <Input label="Workspace-användare vid delegering" type="email" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Lämna tomt för servicekontot" disabled={busy || !state}/>

  </div>
  <label className="my-3 flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} disabled={busy || !state}/>Aktivera automatisk bildsynkning</label>
  <div className="flex flex-wrap gap-3"><Button loading={busy} disabled={!state || !root} onClick={()=>void configure()}>Spara Drive-koppling</Button><Button variant="secondary" disabled={busy || !state?.settings.enabled} onClick={()=>void sync()}>{apartmentId?'Synka fastighetens bilder':'Skapa mappar och synka alla'}</Button></div>
  {message && <p role="status" className="mt-3 whitespace-pre-wrap text-sm">{message}</p>}
  {(error || state?.settings.last_error) && <p role="alert" className="mt-3 whitespace-pre-wrap text-sm text-red-700">{error || state?.settings.last_error}</p>}
  {apartmentId ? <>
   <div className="my-4 flex flex-wrap gap-4">{apartmentFolder && link(apartmentFolder.folder_id,'Lägenhetens bildmapp')}{commonFolder && link(commonFolder.folder_id,'Fastighetens gemensamma bilder')}</div>
   {state?.settings.enabled && <div className="flex flex-wrap gap-4">{images.map(image=><figure key={image.url}><img loading="lazy" className="h-28 w-40 rounded-lg object-cover" src={image.url} alt={image.name}/><figcaption className="mt-2 max-w-40 break-words text-sm text-slate-500">{image.kind==='property'?'Gemensam bild':'Lägenhetsbild'}: {image.name}</figcaption></figure>)}</div>}
  </> : <ul className="mt-5 divide-y divide-slate-100">{state?.properties.map(p=>{const folder=state.folders.find(f=>f.kind==='property' && f.entity_id===p.id);const run=state.runs.find(r=>r.property_id===p.id);return <li key={p.id} className="py-3 text-sm">{folder?.extra.container_folder_id?link(folder.extra.container_folder_id,p.address):p.address} — {run?.last_success?`Synkad ${new Date(run.last_success).toLocaleString('sv-SE')}`:'Mappar skapas efter att kopplingen aktiverats'}{run?.error && <span className="ml-2 text-red-700">{run.error}</span>}</li>;})}</ul>}
 </details>;
}
