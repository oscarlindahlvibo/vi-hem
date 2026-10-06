/** Mount inside Vi-hem using its authenticated Supabase client. Requires a Vibo editor membership. */
import { useEffect, useState, type ReactNode } from 'react';
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
  async function load() {
    const { data, error } = await client.rpc('vihem_vibofast_admin_site');
    if (error) throw error;
    setSnapshot(data); return data as Snapshot;
  }
  function choose(id: string, data = snapshot) {
    if (!data) return;
    setSelected(id);
    const advert = data.adverts.find(a => a.source_id === id);
    setDraft(JSON.stringify(id === 'content' ? data.content.content : advert?.payload, null, 2));
    setPublished(advert?.published ?? false);
    setReadyFrom(advert?.ready_from ?? '');
  }
  useEffect(() => { void load().then(data => choose('content', data)).catch(e => setMessage(e.message)); }, [client]);
  async function save() {
    if (!snapshot || busy) return;
    setBusy(true);setMessage('');
    try {
      const value = JSON.parse(draft);
      const advert = snapshot.adverts.find(a => a.source_id === selected);
      const result = selected === 'content'
        ? await client.rpc('vihem_vibofast_save_content', { p_content: value, p_revision: snapshot.content.revision })
        : await client.rpc('vihem_vibofast_save_advert', { p_source_id: selected, p_payload: value, p_published: published, p_revision: advert!.revision, p_ready_from: readyFrom || null });
      if (result.error) throw result.error;
      choose(selected, await load()); setMessage('Sparat. Hemsidan hämtar ändringarna inom en minut.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Kunde inte spara.'); }
    finally { setBusy(false); }
  }
  async function upload(file: File) {
    setBusy(true);setMessage('');
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
    } catch(e) { setMessage(e instanceof Error ? e.message : 'Uppladdning misslyckades.'); }
    finally { setBusy(false); }
  }
  return <section style={{ maxWidth: 1000, margin: 'auto', padding: 24 }}>
    <h1>Vibo Fastigheter – hemsida</h1>
    <p>Annonsuppgifter, bilder, texter, kontaktuppgifter och kunskapsbank. Avtalsstatus kommer från Vi-hem.</p>
    <label>Välj innehåll <select disabled={busy} value={selected} onChange={e => choose(e.target.value)}>
      <option value="content">Hemsidans innehåll</option>
      {snapshot?.adverts.map(a => <option key={a.source_id} value={a.source_id}>{String(a.payload.title ?? a.source_id)} ({a.lifecycle})</option>)}
    </select></label>
    {selected !== 'content' && <label><input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} /> Publicera när lägenheten är ledig eller uppsagd</label>}
    {selected === 'content' ? <>
      <div style={{display:'flex',gap:8,margin:'20px 0'}}>{Object.entries({company:'Företag & kontakt',faq:'Kunskapsbank',text:'Sidtexter',images:'Sidbilder'}).map(([key,label])=><button key={key} onClick={()=>setActiveContentTab(key)} disabled={activeContentTab===key}>{label}</button>)}</div>
      <ContentFields draft={draft} setDraft={setDraft} tab={activeContentTab} />
    </> : <AdvertFields draft={draft} setDraft={setDraft} readyFrom={readyFrom} setReadyFrom={setReadyFrom} advert={snapshot?.adverts.find(a => a.source_id === selected)} />}
    <label>Ladda upp bild <input disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const f = e.target.files?.[0]; if(f) void upload(f); }} /></label>
    <button disabled={busy || !snapshot} onClick={() => void save()}>{busy ? 'Arbetar…' : 'Spara'}</button>
    <p role="status">{message}</p>
    <details><summary>Inkomna kontaktmeddelanden</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify((snapshot?.enquiries ?? []).filter(e => (e as {kind:string}).kind === 'contact'), null, 2)}</pre></details>
  </section>;
}

function AdvertFields({ draft, setDraft, readyFrom, setReadyFrom, advert }: {
 draft: string; setDraft: (value: string) => void; readyFrom: string; setReadyFrom: (value: string) => void; advert?: Advert;
}) {
 const value = JSON.parse(draft || '{}');
 const update = (key: string, data: unknown) => setDraft(JSON.stringify({ ...value, [key]: data }, null, 2));
 const fieldStyle = { display: 'block', width: '100%', padding: 10, border: '1px solid #cbd5e1', borderRadius: 8, marginTop: 4 };
 return <div style={{ display: 'grid', gap: 16, margin: '24px 0' }}>
   <p>Från Vi-hem: {advert?.rent} kr/mån · {advert?.area} m² · {advert?.rooms} rum. Tillgänglig från: {advert?.available_from ?? 'Publiceras inte med nuvarande avtalsstatus'}.</p>
   {['title','slug','shortDescription','description','region'].map(key => <label key={key}>
     {({title:'Rubrik',slug:'Annonsens adress (slug)',shortDescription:'Kort beskrivning',description:'Annonsbeskrivning',region:'Område'} as Record<string,string>)[key]}
     {key === 'description' ? <textarea style={fieldStyle} rows={8} value={value[key] ?? ''} onChange={e=>update(key,e.target.value)} /> : <input style={fieldStyle} value={value[key] ?? ''} onChange={e=>update(key,e.target.value)} />}
   </label>)}
   <label>Objekttyp<select style={fieldStyle} value={value.listingType} onChange={e=>update('listingType',e.target.value)}>
     {Object.entries({apartment:'Lägenhet',commercial:'Lokal',office:'Kontor',retail:'Butik',warehouse:'Lager',storage:'Förråd',garage:'Garage'}).map(([key,label])=><option key={key} value={key}>{label}</option>)}
   </select></label>
   <label>Hyrestyp<select style={fieldStyle} value={value.rentType} onChange={e=>update('rentType',e.target.value)}><option value="warmhyra">Varmhyra</option><option value="kallhyra">Kallhyra</option></select></label>
   <label>Avtal<select style={fieldStyle} value={value.leaseType} onChange={e=>update('leaseType',e.target.value)}><option value="tillsvidare">Tillsvidare</option><option value="visstid">Visstid</option></select></label>
   <label>Tidigast inflyttning efter eventuell renovering<input style={fieldStyle} type="date" value={readyFrom} onChange={e=>setReadyFrom(e.target.value)} /></label>
   <label>Fördelar (en per rad)<textarea style={fieldStyle} value={(value.features ?? []).join('\n')} onChange={e=>update('features',e.target.value.split('\n'))} /></label>
   {Object.entries({electricity:'El',water:'Vatten',heating:'Värme',fiber:'Fiber',washingMachine:'Tvättmaskin',dryer:'Torktumlare'}).map(([key,label])=><label key={key}>{label}<select style={fieldStyle} value={value.utilities?.[key] ?? 'not-available'} onChange={e=>update('utilities',{...value.utilities,[key]:e.target.value})}>
     <option value="included">Ingår</option><option value="extra-cost">Tilläggskostnad</option><option value="rentable">Kan hyras till</option><option value="not-available">Ej tillgängligt</option>
   </select></label>)}
   <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>{(value.images ?? []).map((url: string,i: number)=><div key={url+i}>
     <img src={url} alt={`Annonsbild ${i+1}`} style={{width:160,height:120,objectFit:'cover'}} />
     <button disabled={i===0} onClick={()=>{const images=[...value.images]; [images[i-1],images[i]]=[images[i],images[i-1]];update('images',images);}}>Flytta fram</button>
     <button onClick={()=>update('images',value.images.filter((_: string,index: number)=>index!==i))}>Ta bort från annons</button>
   </div>)}</div>
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
  if (typeof data==='string') return <label style={{display:'block',margin:'12px 0'}} key={path.join('.')}>
    {contentLabels[key] ?? (path[0]==='text' ? data.slice(0,90) || 'Sidtext' : key)}
    <textarea style={{display:'block',width:'100%',padding:10,border:'1px solid #cbd5e1',borderRadius:8}} rows={data.length>200?5:2} value={data} readOnly={key==='viHemUrl'} onChange={e=>change(path,e.target.value)} />
  </label>;
  if(Array.isArray(data))return <div>{data.map((item,i)=><details key={i} style={{border:'1px solid #e2e8f0',padding:12,margin:'12px 0'}}>
    <summary>{typeof item==='object' && item ? item.title ?? item.name ?? `${contentLabels[key] ?? key} ${i+1}` : `Textstycke ${i+1}`}</summary>
    {fields(item,[...path,i])}<button onClick={()=>change(path,data.filter((_,index)=>index!==i))}>Ta bort</button>
  </details>)}<button onClick={()=>{
    const first=data[0];let item: unknown='';
    if(typeof first==='object' && first){item=structuredClone(first);const object=item as Record<string,unknown>;if('id' in object)object.id=crypto.randomUUID();if('slug' in object)object.slug='ny-'+crypto.randomUUID().slice(0,8);if('title' in object)object.title='Ny rubrik';if('articles' in object)object.articles=[];}
    else if(key==='faq')item={id:crypto.randomUUID(),slug:'ny-'+crypto.randomUUID().slice(0,8),title:'Ny kategori',icon:'FileText',description:'',articles:[]};
    else if(key==='articles')item={id:crypto.randomUUID(),slug:'ny-'+crypto.randomUUID().slice(0,8),title:'Ny artikel',excerpt:'',content:['']};
    change(path,[...data,item]);
  }}>Lägg till {key==='faq'?'kategori':key==='articles'?'artikel':'textstycke'}</button></div>;
  if(data && typeof data==='object')return <div>{Object.entries(data).filter(([child])=>child!=='id').map(([child,item])=>typeof item==='object'?<details key={child} style={{padding:8}}><summary>{contentLabels[child] ?? child}</summary>{fields(item,[...path,child])}</details>:fields(item,[...path,child]))}</div>;
  return null;
 }
 if(tab==='text' || tab==='images') return <div>{Object.entries(value.text ?? {}).filter(([key])=>key.startsWith('image.') === (tab==='images')).map(([key,item])=>fields(item,['text',key]))}</div>;
 return <>{fields(value[tab],[tab])}</>;
}
