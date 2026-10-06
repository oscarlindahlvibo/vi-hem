import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {BUCKET,MAX_IMAGE_BYTES,folderId,folderLabel,imageExtension,imageKey,sortImages} from './core.ts';
import {Drive,googleToken} from './google.ts';
const origins=new Set(['https://app.vi-hem.se']);
const json=(data:unknown,status=200,origin='')=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':origins.has(origin)?origin:'https://app.vi-hem.se','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'}});
Deno.serve(async req=>{
 const origin=req.headers.get('origin') || '';
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://app.vi-hem.se','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'}});
 if(req.method!=='POST')return json({error:'Method not allowed'},405,origin);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const rpc=async(action:string,data:unknown={})=>{const {data:result,error}=await db.rpc('vihem_vibofast_drive_worker',{p_action:action,p_data:data});if(error)throw new Error(error.message);return result;};
 let lease:string|undefined;
 try{
  const raw=await req.text();if(raw.length>4096)return json({error:'Request too large'},413,origin);
  const body=JSON.parse(raw);
  const suppliedSecret=req.headers.get('x-vibo-drive-sync-secret');
  let userClient:any;
  if(suppliedSecret){
   const expected=(await rpc('secret')).secret;
   const [a,b]=await Promise.all([suppliedSecret,expected].map(value=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
   if(!new Uint8Array(a).every((v,i)=>v===new Uint8Array(b)[i]))return json({error:'Unauthorized'},401,origin);
   if(body.action!=='sync')return json({error:'Forbidden'},403,origin);
  }else{
   const auth=req.headers.get('authorization') || '';
   userClient=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
   const {data:{user}}=await userClient.auth.getUser();
   if(!user)return json({error:'Unauthorized'},401,origin);
   const {data:allowed,error}=await userClient.rpc('vihem_vibofast_is_editor');
   if(error || !allowed)return json({error:'Endast aktiva Vibo-administratörer får hantera hemsidebilder.'},403,origin);
  }
  if(body.action==='configure'){
   const {data:state,error}=await userClient.rpc('vihem_vibofast_drive_state');if(error)throw error;
   const enabled=body.enabled===true;
   const root=folderId(String(body.root_folder_id || state.settings.root_folder_id || ''));
   const subject=String(body.delegated_user || '').trim();
   if(subject && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject))throw new Error('Ange en giltig Google Workspace-adress.');
   let site=state.settings.site_folder_id;let shared=state.settings.shared_drive_id;
   if(enabled || root!==state.settings.root_folder_id){
    const organisationId=(await rpc('site')).organisation_id;
    const drive=new Drive(await googleToken(db,organisationId,subject));
    const parent=await drive.get(root);
    if(parent.mimeType!=='application/vnd.google-apps.folder')throw new Error('Länken måste peka på en Drive-mapp eller delad enhet.');
    shared=parent.driveId || '';
    site=await new Drive(await googleToken(db,organisationId,subject),shared).ensure(root,'Vibo Fastigheter – hemsidebilder','site_'+organisationId,root===state.settings.root_folder_id?site:undefined);
   }
   const {error:failure}=await userClient.rpc('vihem_vibofast_drive_configure',{p_root:root,p_site:site,p_drive:shared,p_user:subject,p_enabled:enabled,p_revision:body.revision});
   if(failure)throw failure;
   return json({ok:true},200,origin);
  }
  if(body.action!=='sync')return json({error:'Unknown action'},400,origin);
  const context=await rpc('claim',{...(body.property_id?{property_id:body.property_id}:{}),restart:body.restart===true});
  if(context.status!=='claimed')return json({ok:true,status:context.status},200,origin);
  lease=context.lease;
  const write=(action:string,data:Record<string,unknown>={})=>rpc(action,{...data,lease});
  const drive=new Drive(await googleToken(db,context.organisation_id,context.settings.delegated_user),context.settings.shared_drive_id);
  const settings=context.settings;const property=context.property;
  const site=await drive.get(settings.site_folder_id);
  if(!site.parents?.includes(settings.root_folder_id) || site.appProperties?.vihem_vibo_key!=='site_'+context.organisation_id)throw new Error('Hemsidans Drive-mapp har flyttats. Välj huvudmappen igen.');
  const known=context.folders.find((f:any)=>f.kind==='property' && f.entity_id===property.id);
  const container=await drive.ensure(site.id,folderLabel(property.address,property.id),'property_'+property.id,known?.extra.container_folder_id);
  const common=await drive.ensure(container,'Gemensamma bilder','common_'+property.id,known?.folder_id);
  const apartments=await drive.ensure(container,'Lägenheter','apartments_'+property.id,known?.extra.apartments_folder_id);
  await write('folder',{kind:'property',entity_id:property.id,folder_id:common,extra:{container_folder_id:container,apartments_folder_id:apartments}});
  const errors:string[]=[];let count=0;
  const syncFolder=async(kind:string,entity:string,folder:string)=>{
   await write('heartbeat');
   try{
    const files=sortImages(await drive.list(folder,"mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/webp'"));
    const cached=context.images.filter((i:any)=>i.kind===kind && i.entity_id===entity);
    const images=[];
    for(const file of files){
     if(Number(file.size)>MAX_IMAGE_BYTES)throw new Error(`${file.name} är större än 10 MB. Gör bilden mindre.`);
     const version=file.md5Checksum || `${file.version}:${file.modifiedTime}`;
     const old=cached.find((i:any)=>i.file_id===file.id && i.version===version);
     let path=old?.storage_path;
     if(!path){
      const bytes=await drive.download(file);
      path=await imageKey(kind,entity,file,imageExtension(bytes,file.mimeType));
      const {error}=await db.storage.from(BUCKET).upload(path,bytes,{contentType:file.mimeType,cacheControl:'31536000',upsert:false});
      if(error && !(String(error.statusCode)==='409' || String(error.message).includes('already exists')))throw new Error(`Kunde inte kopiera bilden ${file.name} till hemsidan.`);
     }
     images.push({file_id:file.id,name:file.name,version,storage_path:path});
     await write('heartbeat');
    }
    // Replace only after every page and every image succeeded. A transient Drive error never empties a gallery.
    const result=await write('images',{kind,entity_id:entity,images});
    if(result.obsolete.length){const {error}=await db.storage.from(BUCKET).remove(result.obsolete);if(error)errors.push('Gamla bildkopior kunde inte rensas. Bildlistan är uppdaterad.');}
    count+=images.length;
   }catch(error){errors.push(`${kind==='property'?'Gemensamma bilder':'Lägenhetsbilder'}: ${error instanceof Error?error.message:'Synkningen misslyckades.'}`);}
  };
  if(context.offset===0)await syncFolder('property',property.id,common);
  for(const apartment of context.apartments){
   await write('heartbeat');
   const existing=context.folders.find((f:any)=>f.kind==='apartment' && f.entity_id===apartment.id);
   const folder=await drive.ensure(apartments,folderLabel('Lgh '+apartment.apartment_number,apartment.id),'apartment_'+apartment.id,existing?.folder_id);
   await write('folder',{kind:'apartment',entity_id:apartment.id,folder_id:folder});
   await syncFolder('apartment',apartment.id,folder);
  }
  const next=context.offset+context.apartments.length;
  const remaining=errors.length===0 && next<context.total?next:0;
  await write('finish',{error:errors.length?errors.join('\n').slice(0,4000):null,next_offset:remaining});lease=undefined;
  return json({ok:errors.length===0,status:remaining?'partial':'synced',property_id:property.id,images:count,errors},200,origin);
 }catch(error){
  const message=error instanceof Error?error.message:'Drive-synkningen misslyckades.';
  if(lease)await rpc('finish',{lease,error:message.slice(0,4000)}).catch(()=>{});
  return json({error:message},400,origin);
 }
});
