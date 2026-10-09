import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {decryptSettings,getEncryptionSecret,googleDriveToken} from '../_shared/google-drive-auth.ts';
import {DriveArchiveClient,sha256,archiveLabel} from '../_shared/inspection-drive.ts';
import {validProfileJpeg} from '../vihem-profile-photo/jpeg.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
async function checked(request:any){const result=await request;if(result.error)throw result.error;return result.data;}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const caller=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:req.headers.get('Authorization')||''}}});
 let authorizedJob:any=null,requestedAction='',leased:any=null,leaseToken:string|null=null,step='authentication';
 try {
  const {data:{user}}=await caller.auth.getUser();if(!user)return json({error:'Unauthorized'},401);
  step='profile';
  const profile=await checked(service.from('vihem_profiles').select('id,role,organisation_id,active').eq('id',user.id).single());
  if(!profile.active)return json({error:'Access denied'},403);
  const params=new URL(req.url).searchParams,action=params.get('action')||'archive',id=params.get('job');
  if(!['upload','archive','read'].includes(action))return json({error:'Unknown action'},400);
  if(!id||!/^[0-9a-f-]{36}$/i.test(id))return json({error:'Invalid job'},400);
  step='job';
  const job=await checked(caller.from('vihem_inspection_file_jobs').select('*').eq('id',id).single());
  if(!job||job.organisation_id!==profile.organisation_id)return json({error:'Access denied'},403);
  if(action!=='read'&&!['staff','admin','superadmin'].includes(profile.role))return json({error:'Access denied'},403);
  authorizedJob=job;requestedAction=action;
  step='settings';
  const settings=await checked(service.from('vihem_google_workspace_settings').select('*').eq('organisation_id',profile.organisation_id).maybeSingle());
  if(!settings||!settings.drive_storage_enabled||!settings.drive_root_folder_id)throw Object.assign(Error('Drive configuration missing'),{code:'DRIVE_DISABLED'});
  step='google-auth';
  const secret=getEncryptionSecret(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const credentials=await decryptSettings(settings,secret);if(!credentials)throw Error('Credentials missing');
  const token=await googleDriveToken(JSON.parse(credentials),settings.drive_delegated_user||'','https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly');
  const drive=new DriveArchiveClient(token,settings.drive_shared_drive_id||'');
  if(action==='read'){
   if(job.state!=='verified'||!job.drive_file_id)return json({error:'Not archived'},409);
   const bytes=await drive.bytes(job.drive_file_id);
   if(bytes.length!==Number(job.byte_size)||await sha256(bytes)!==job.sha256)throw Error('Archive integrity mismatch');
   return new Response(bytes,{headers:{...cors,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(job.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
  }
  if(job.state==='verified')return json({ok:true,job});
  step='lease';
  leaseToken=crypto.randomUUID();leased=await checked(service.rpc('vihem_claim_inspection_file',{p_id:id,p_token:leaseToken}));
  if(!leased?.id)return json({error:'Uppladdningen behandlas redan. Försök igen om en stund.'},409);
  let bytes:Uint8Array;
  if(action==='upload'){
   // Read bounded binary stream; never base64-expand photos/PDF in JSON.
   const reader=req.body?.getReader();if(!reader)throw Error('File missing');const chunks:Uint8Array[]=[];let size=0;
   for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>Number(job.byte_size)||size>26214400){await reader.cancel();throw Error('File size mismatch');}chunks.push(next.value);}
   bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   if(size!==Number(job.byte_size)||await sha256(bytes)!==job.sha256)throw Error('File checksum mismatch');
   const text=job.kind==='protocol'?new TextDecoder('ascii').decode(bytes):'';
   if(job.kind==='photo'?!validProfileJpeg(bytes):!text.startsWith('%PDF-')||!text.trimEnd().endsWith('%%EOF'))throw Error('File contents invalid');
   // Duplicate staging upload is accepted only after verifying its existing checksum.
   const upload=await service.storage.from('vihem-inspection-staging').upload(job.stage_path,bytes,{contentType:job.mime_type,upsert:false});
   if(upload.error){const old=await checked(service.storage.from('vihem-inspection-staging').download(job.stage_path));if(await sha256(new Uint8Array(await old.arrayBuffer()))!==job.sha256)throw Error('Staging mismatch');}
  } else if(action==='archive'){
   const staged=await checked(service.storage.from('vihem-inspection-staging').download(job.stage_path));bytes=new Uint8Array(await staged.arrayBuffer());
   if(bytes.length!==Number(job.byte_size)||await sha256(bytes)!==job.sha256)throw Error('Staging mismatch');
  } else return json({error:'Unknown action'},400);
  step='drive-upload';
  const insp=await checked(service.from('vihem_apartment_inspections').select('*,property:vihem_properties(name),apartment:vihem_apartments(apartment_number)').eq('id',job.inspection_id).single());
  async function folder(parent:string,key:string,label:string){
   const old=await checked(service.from('vihem_inspection_drive_folders').select('drive_id').eq('organisation_id',job.organisation_id).eq('logical_key',key).maybeSingle());
   if(!old){const proposed=await drive.allocateId();await checked(service.from('vihem_inspection_drive_folders').upsert({organisation_id:job.organisation_id,logical_key:key,drive_id:proposed},{onConflict:'organisation_id,logical_key',ignoreDuplicates:true}));}
   const row=await checked(service.from('vihem_inspection_drive_folders').select('drive_id').eq('organisation_id',job.organisation_id).eq('logical_key',key).single());
   return drive.folder(parent,key,archiveLabel(label),row.drive_id);
  }
  let parent=await folder(settings.drive_root_folder_id,'archive-root','Besiktningar');
  parent=await folder(parent,`property:${insp.property_id}`,`${insp.property?.name||'Fastighet'} – ${insp.property_id.slice(0,8)}`);
  parent=await folder(parent,`apartment:${insp.apartment_id}`,`Lägenhet ${insp.apartment?.apartment_number||''} – ${insp.apartment_id.slice(0,8)}`);
  parent=await folder(parent,`inspection:${insp.id}`,`${insp.inspection_date} – ${insp.inspection_type} – ${insp.id.slice(0,8)}`);
  parent=await folder(parent,`${insp.id}:${job.kind}`,job.kind==='protocol'?'Protokoll':'Bilder');
  if(job.kind==='photo')parent=await folder(parent,`${insp.id}:room:${job.room_key}`,job.room_key==='general'?'Allmänna bilder':insp.rooms.find((r:any)=>r.id===job.room_key)?.name||'Rum');
  let fileId=job.drive_file_id;
  if(!fileId){fileId=await drive.allocateId();const saved=await checked(service.from('vihem_inspection_file_jobs').update({drive_file_id:fileId}).eq('id',id).eq('lease_token',leaseToken).select('id').single());if(!saved)throw Error('Lease lost');}
  await drive.upload(fileId,parent,job.id,job.filename,job.mime_type,bytes);
  const meta=await drive.verify(fileId,parent,job.id,Number(job.byte_size),job.sha256);
  const result=await checked(service.rpc('vihem_commit_inspection_file',{p_id:id,p_token:leaseToken,p_file:fileId,p_folder:parent,p_web:meta.webViewLink||null}));
  // Drive is now authoritative. Cleanup failure leaves a discoverable temporary copy only.
  await service.storage.from('vihem-inspection-staging').remove([job.stage_path]);
  return json({ok:true,job:result});
 } catch(error){
  if(leased?.id&&leaseToken){await service.from('vihem_inspection_file_jobs').update({state:'failed',error_code:'ARCHIVE_FAILED',lease_token:null,lease_until:null}).eq('id',leased.id).eq('lease_token',leaseToken);}
  if(authorizedJob&&requestedAction!=='read'&&!leased){await service.from('vihem_inspection_file_jobs').update({state:'failed',error_code:'ARCHIVE_FAILED'}).eq('id',authorizedJob.id).eq('state','pending').is('lease_token',null);}
  // Do not log credentials, payloads, filenames or upstream error bodies.
  const code=(error as {code?:string})?.code;
  console.warn('inspection archive request failed',step,code&&/^[A-Z0-9_]{1,12}$/.test(code)?code:'REQUEST_FAILED');
  return json({error:'Filen kunde inte arkiveras. Underlaget behålls för återförsök.',code:code==='DRIVE_DISABLED'?'DRIVE_DISABLED':'ARCHIVE_FAILED'},409);
 }
});
