/** Mount inside Vi-hem using its authenticated Supabase client. Requires a Vibo editor membership. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, PageHeader, Select, Tabs, Modal } from '../../components/ui';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { DriveImagesAdmin } from './DriveImagesAdmin';
import { websiteErrorMessage } from './errors';
import type { SupabaseClient } from '@supabase/supabase-js';
interface Advert { source_id: string; payload: Record<string, unknown>; published: boolean; revision: number; lifecycle: string; ready_from: string | null; available_from: string | null; rent: number; area: number; rooms: number; }
interface Snapshot { content: { content: Record<string, unknown>; revision: number }; adverts: Advert[]; enquiries: unknown[]; }
export function WebsiteAdmin({ client }: { client: SupabaseClient }) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [selected, setSelected] = useState('content');
  const [activeContentTab, setActiveContentTab] = useState('company');
  const [draft, setDraft] = useState('');
  const [readyFrom, setReadyFrom] = useState('');
  const [published, setPublished] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const [baseline, setBaseline] = useState({draft:'',readyFrom:'',published:false});
  const dirty = useUnsavedChanges({draft,readyFrom,published},Boolean(snapshot),baseline);
  const [pendingSelection, setPendingSelection] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await client.rpc('vihem_vibofast_admin_site');
    if (error) throw error;
    return data as Snapshot;
  }, [client]);
  const choose = useCallback((id: string, data: Snapshot) => {
    if (!data) return;
    setSnapshot(data); setSelected(id); setMessage(''); setFailed(false); setNeedsReload(false);
    const advert = data.adverts.find(a => a.source_id === id);
    const nextDraft = JSON.stringify(id === 'content' ? data.content.content : advert?.payload ?? {}, null, 2);
    setDraft(nextDraft); setBaseline({draft:nextDraft,readyFrom:advert?.ready_from ?? '',published:advert?.published ?? false});
    setPublished(advert?.published ?? false);
    setReadyFrom(advert?.ready_from ?? '');
  }, []);
  useEffect(() => { let active=true; void load().then(data => {if(active)choose('content', data);}).catch(e => {if(active){setFailed(true);setMessage(websiteErrorMessage(e, 'Kunde inte läsa hemsidans inställningar.'));}});return()=>{active=false;}; }, [load,choose]);
  async function reload() {
    if(operation.current)return; operation.current=true;setBusy(true);
    try {choose(selected,await load());} catch(e){setFailed(true);setMessage(websiteErrorMessage(e,'Kunde inte hämta innehållet.'));} finally{operation.current=false;setBusy(false);}
  }
  async function save() {
    if (!snapshot || operation.current || needsReload) return;
    operation.current=true;setBusy(true);setFailed(false);setMessage('');
    try {
      const value = JSON.parse(draft);
      const advert = snapshot.adverts.find(a => a.source_id === selected);
      if (selected !== 'content' && !advert) throw new Error('Lägenheten kunde inte hittas. Välj lägenheten igen.');
      if (selected !== 'content' && published) {
        const required = { title: 'Rubrik', slug: 'Annonsens adress (slug)', description: 'Annonsbeskrivning' };
        const missing = Object.entries(required).filter(([key]) => typeof value[key] !== 'string' || !value[key].trim()).map(([, label]) => label);
        if (missing.length) throw new Error('Fyll i ' + missing.join(', ') + ' för publicering. Avmarkera publicering om du vill spara ett utkast.');
      }
      const result = selected === 'content'
        ? await client.rpc('vihem_vibofast_save_content', { p_content: value, p_revision: snapshot.content.revision })
        : await client.rpc('vihem_vibofast_save_advert', { p_source_id: selected, p_payload: value, p_published: published, p_revision: advert!.revision, p_ready_from: readyFrom || null });
      if (result.error) throw result.error;
      try {
        choose(selected, await load());
        setMessage(selected === 'content' || published ? 'Sparat. Hemsidan hämtar ändringarna inom en minut. Lägenhetsannonser visas när avtalsstatusen tillåter det och bilder finns.' : 'Utkast sparat. Annonsen publiceras när publicering aktiveras och den är komplett.');
      } catch (error) {
        setNeedsReload(true);setFailed(true);
        setMessage('Uppgifterna sparades, men vyn kunde inte uppdateras. Ladda om innan du gör fler ändringar. ' + websiteErrorMessage(error, ''));
      }
    } catch (e) { setFailed(true);setMessage(websiteErrorMessage(e, 'Kunde inte spara. Försök igen.')); }
    finally { operation.current=false;setBusy(false); }
  }
  async function upload(file: File) {
    if(operation.current || needsReload || !snapshot)return; operation.current=true;setBusy(true);setFailed(false);setMessage('');
    try {
      const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string,string>)[file.type];
      if (!extension || file.size > 10485760) throw new Error('Välj JPG, PNG eller WebP, högst 10 MB.');
      const path = `${crypto.randomUUID()}.${extension}`;
      const { error } = await client.storage.from('vihem-vibofast-images').upload(path, file);
      if (error) throw error;
      const url = client.storage.from('vihem-vibofast-images').getPublicUrl(path).data.publicUrl;
      const value = JSON.parse(draft);
      if (selected === 'content') { value.text ??= {}; value.text['image.' + path] = url; }
      else { value.images = [...(value.images ?? []), url]; }
      setDraft(JSON.stringify(value, null, 2)); setMessage('Bilden är uppladdad. Spara för att använda den i annonsen. För sidbilder: lägg URL:en på rätt bildnyckel i text.');
    } catch(e) { setFailed(true);setMessage(websiteErrorMessage(e, 'Uppladdning misslyckades.')); }
    finally { operation.current=false;setBusy(false); }
  }
  return <section className="mx-auto max-w-5xl space-y-5 py-4">
    <PageHeader title="Vibo Fastigheter" subtitle="Hantera hemsidans innehåll och annonser. Avtalsstatus och hyra hämtas från VI-HEM." />
    {!snapshot && !message && <p role="status">Hämtar hemsidans innehåll…</p>}
    {message && <div role={failed?'alert':'status'} className={`rounded-xl p-4 text-sm leading-relaxed ${failed?'bg-amber-50 text-amber-900':'bg-green-50 text-green-900'}`}>{message}{(!snapshot||needsReload)&&<Button className="mt-3" variant="secondary" loading={busy} onClick={()=>void reload()}>Hämta igen</Button>}</div>}
    {snapshot && <>
      <Select label="Arbeta med" disabled={busy || needsReload} value={selected} onChange={e=>{if(dirty)setPendingSelection(e.target.value);else choose(e.target.value,snapshot);}} options={[{value:'content',label:'Hemsidans innehåll'},...snapshot.adverts.map(a=>({value:a.source_id,label:`${String(a.payload.title ?? a.source_id)} (${a.lifecycle})`}))]}/>
      <fieldset disabled={busy || needsReload} className="min-w-0 space-y-5">
      {selected !== 'content' && <div className="rounded-xl bg-slate-100 p-4"><label className="flex min-h-11 items-start gap-3 text-sm font-medium"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={published} onChange={e => setPublished(e.target.checked)} />Publicera när lägenheten är ledig eller uppsagd</label><p className="mt-2 text-sm leading-relaxed text-slate-600">Spara som utkast genom att avmarkera publicering. Annonsen visas först när den är komplett och har bilder.</p></div>}
      {selected === 'content' ? <>
        <Tabs tabs={Object.entries({company:'Kontakt',faq:'Kunskapsbank',text:'Sidtexter',images:'Sidbilder'}).map(([key,label])=>({key,label}))} active={activeContentTab} onChange={setActiveContentTab}/>
        <ContentFields draft={draft} setDraft={setDraft} tab={activeContentTab} />
        {activeContentTab==='images' && <DriveImagesAdmin client={client}/>}
      </> : <AdvertFields key={selected} client={client} draft={draft} setDraft={setDraft} readyFrom={readyFrom} setReadyFrom={setReadyFrom} advert={snapshot.adverts.find(a => a.source_id === selected)} />}
      <label className="flex min-h-12 cursor-pointer flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-300 p-4 text-sm font-medium text-slate-700">Ladda upp en hemsidesbild<input disabled={busy || needsReload} type="file" accept="image/jpeg,image/png,image/webp" className="w-full text-sm sm:w-auto" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file);}}/><span className="text-sm font-normal text-slate-500">JPG, PNG eller WebP · högst 10 MB</span></label>
      </fieldset>
      <div className="sticky bottom-24 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 backdrop-blur md:bottom-4"><span role="status" className="text-sm text-slate-500">{busy?'Arbetar…':needsReload?'Hämta sparade uppgifter innan du fortsätter':dirty?'Osparade ändringar':'Inga osparade ändringar'}</span><Button loading={busy} disabled={needsReload} onClick={()=>void save()}>Spara ändringar</Button></div>
      <details className="border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-medium text-slate-600">Inkomna kontaktmeddelanden ({snapshot.enquiries.filter(e=>(e as {kind:string}).kind==='contact').length})</summary><pre className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-600">{JSON.stringify(snapshot.enquiries.filter(e => (e as {kind:string}).kind === 'contact'), null, 2)}</pre></details>
    </>}
    <Modal open={pendingSelection!==undefined} onClose={()=>setPendingSelection(undefined)} title="Lämna osparade ändringar?" footer={<><Button variant="secondary" onClick={()=>setPendingSelection(undefined)}>Fortsätt redigera</Button><Button variant="danger" onClick={()=>{if(snapshot && pendingSelection)choose(pendingSelection,snapshot);setPendingSelection(undefined);}}>Lämna utan att spara</Button></>}><p className="text-sm text-slate-600">Spara det aktuella innehållet innan du byter om du vill behålla ändringarna.</p></Modal>
  </section>;

}

function AdvertFields({ client, draft, setDraft, readyFrom, setReadyFrom, advert }: {
 client: SupabaseClient; draft: string; setDraft: (value: string) => void; readyFrom: string; setReadyFrom: (value: string) => void; advert?: Advert;
}) {
 const [tab,setTab]=useState('description');
 const value = JSON.parse(draft || '{}');
 const update = (key: string, data: unknown) => setDraft(JSON.stringify({ ...value, [key]: data }, null, 2));
 const fieldClass = 'mt-1 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500';
 return <div className="space-y-5">
   <p className="text-sm leading-relaxed text-slate-600">Från Vi-hem: {advert?.rent?.toLocaleString('sv-SE')} kr/mån · {advert?.area} m² · {advert?.rooms} rum. Tillgänglig från: {advert?.available_from ?? 'Publiceras inte med nuvarande avtalsstatus'}.</p>
   <Tabs tabs={[{key:'description',label:'Annons'},{key:'terms',label:'Villkor & tillval'},{key:'photos',label:'Bilder'}]} active={tab} onChange={setTab}/>
   <div className={tab==='description'?'grid gap-4 sm:grid-cols-2':'hidden'}>
   {['title','slug','shortDescription','description','region'].map(key => <label key={key} className={`block min-w-0 text-sm font-medium text-slate-700 ${['title','slug'].includes(key)?'':'sm:col-span-2'}`}>
     {({title:'Rubrik',slug:'Annonsens adress (slug)',shortDescription:'Kort beskrivning',description:'Annonsbeskrivning',region:'Område'} as Record<string,string>)[key]}
     {key === 'description' ? <textarea className={fieldClass} rows={5} value={value[key] ?? ''} onChange={e=>update(key,e.target.value)} /> : <input className={fieldClass} value={value[key] ?? ''} onChange={e=>update(key,e.target.value)} />}
   </label>)}
   </div>
   <div className={tab==='terms'?'grid gap-4 sm:grid-cols-2':'hidden'}>
   <label>Objekttyp<select className={fieldClass} value={value.listingType} onChange={e=>update('listingType',e.target.value)}>
     {Object.entries({apartment:'Lägenhet',commercial:'Lokal',office:'Kontor',retail:'Butik',warehouse:'Lager',storage:'Förråd',garage:'Garage'}).map(([key,label])=><option key={key} value={key}>{label}</option>)}
   </select></label>
   <label>Hyrestyp<select className={fieldClass} value={value.rentType} onChange={e=>update('rentType',e.target.value)}><option value="warmhyra">Varmhyra</option><option value="kallhyra">Kallhyra</option></select></label>
   <label>Avtal<select className={fieldClass} value={value.leaseType} onChange={e=>update('leaseType',e.target.value)}><option value="tillsvidare">Tillsvidare</option><option value="visstid">Visstid</option></select></label>
   <label>Tidigast inflyttning efter eventuell renovering<input className={fieldClass} type="date" value={readyFrom} onChange={e=>setReadyFrom(e.target.value)} /></label>
   <label>Fördelar (en per rad)<textarea className={fieldClass} value={(value.features ?? []).join('\n')} onChange={e=>update('features',e.target.value.split('\n'))} /></label>
   {Object.entries({electricity:'El',water:'Vatten',heating:'Värme',fiber:'Fiber',washingMachine:'Tvättmaskin',dryer:'Torktumlare'}).map(([key,label])=><label key={key}>{label}<select className={fieldClass} value={value.utilities?.[key] ?? 'not-available'} onChange={e=>update('utilities',{...value.utilities,[key]:e.target.value})}>
     <option value="included">Ingår</option><option value="extra-cost">Tilläggskostnad</option><option value="rentable">Kan hyras till</option><option value="not-available">Ej tillgängligt</option>
   </select></label>)}
   </div>
   <div hidden={tab!=='photos'}>
   <DriveImagesAdmin client={client} apartmentId={advert?.source_id}/>
   <div className="mt-4 grid gap-4 sm:grid-cols-2">{(value.images ?? []).map((url: string,i: number)=><div key={url+i}>
     <img src={url} alt={`Annonsbild ${i+1}`} style={{width:160,height:120,objectFit:'cover'}} />
     <Button variant="secondary" className="mt-2" disabled={i===0} onClick={()=>{const images=[...value.images]; [images[i-1],images[i]]=[images[i],images[i-1]];update('images',images);}}>Flytta fram</Button>
     <Button variant="ghost" onClick={()=>update('images',value.images.filter((_: string,index: number)=>index!==i))}>Ta bort från annons</Button>
   </div>)}</div>
   </div>
 </div>;
}

const contentLabels: Record<string,string> = {name:'Namn',legalName:'Juridiskt namn',tagline:'Slogan',description:'Beskrivning',phone:'Telefon',phoneMobile:'Mobil',email:'E-post',contactPerson:'Kontaktperson',officeHours:'Öppettider',emergencyPhone:'Jourtelefon',address:'Adress',street:'Gata',postalCode:'Postnummer',city:'Ort',region:'Område',county:'Län',country:'Land',viHemUrl:'Hyresgästportal',areas:'Områden',policies:'Policyer',rental:'Uthyrning',youthDiscount:'Ungdomsrabatt',smoking:'Rökning',title:'Rubrik',slug:'Adress (slug)',icon:'Ikon',articles:'Artiklar',excerpt:'Kort beskrivning',content:'Artikeltext',updatedAt:'Uppdateringsdatum'};
function ContentFields({ draft, setDraft, tab }: { draft: string; setDraft: (value: string)=>void; tab: string }) {
 const value=JSON.parse(draft || '{}');
 function change(path: (string|number)[], updated: unknown) {
  const copy=structuredClone(value);let target=copy;
  for(const key of path.slice(0,-1)) target=target[key];
  target[path[path.length-1]]=updated;setDraft(JSON.stringify(copy,null,2));
 }
 function fields(data: unknown,path: (string|number)[]): ReactNode {
  const key=String(path[path.length-1]);
  if (typeof data==='string') return <label className="my-4 block text-sm font-medium text-slate-700" key={path.join('.')}>
    {contentLabels[key] ?? (path[0]==='text' ? data.slice(0,90) || 'Sidtext' : key)}
    <textarea className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500" rows={data.length>200?5:2} value={data} readOnly={key==='viHemUrl'} onChange={e=>change(path,e.target.value)} />
  </label>;
  if(Array.isArray(data))return <div>{data.map((item,i)=><details key={i} className="my-4 border-b border-slate-200 pb-4">
    <summary>{typeof item==='object' && item ? item.title ?? item.name ?? `${contentLabels[key] ?? key} ${i+1}` : `Textstycke ${i+1}`}</summary>
    {fields(item,[...path,i])}<Button variant="ghost" onClick={()=>change(path,data.filter((_,index)=>index!==i))}>Ta bort</Button>
  </details>)}<Button variant="secondary" onClick={()=>{
    const first=data[0];let item: unknown='';
    if(typeof first==='object' && first){item=structuredClone(first);const object=item as Record<string,unknown>;if('id' in object)object.id=crypto.randomUUID();if('slug' in object)object.slug='ny-'+crypto.randomUUID().slice(0,8);if('title' in object)object.title='Ny rubrik';if('articles' in object)object.articles=[];}
    else if(key==='faq')item={id:crypto.randomUUID(),slug:'ny-'+crypto.randomUUID().slice(0,8),title:'Ny kategori',icon:'FileText',description:'',articles:[]};
    else if(key==='articles')item={id:crypto.randomUUID(),slug:'ny-'+crypto.randomUUID().slice(0,8),title:'Ny artikel',excerpt:'',content:['']};
    change(path,[...data,item]);
  }}>Lägg till {key==='faq'?'kategori':key==='articles'?'artikel':'textstycke'}</Button></div>;
  if(data && typeof data==='object')return <div>{Object.entries(data).filter(([child])=>child!=='id').map(([child,item])=>typeof item==='object'?<details key={child} className="my-3"><summary>{contentLabels[child] ?? child}</summary>{fields(item,[...path,child])}</details>:fields(item,[...path,child]))}</div>;
  return null;
 }
 if(tab==='text' || tab==='images') return <div>{Object.entries(value.text ?? {}).filter(([key])=>key.startsWith('image.') === (tab==='images')).map(([key,item])=>fields(item,['text',key]))}</div>;
 return <>{fields(value[tab],[tab])}</>;
}
