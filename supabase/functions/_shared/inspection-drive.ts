/** Google transport reused with existing Workspace auth; no permissions.create call. */
export class DriveArchiveClient {
 constructor(private token:string,private sharedDrive:string,private request:typeof fetch=fetch){}
 async raw(path:string,init:RequestInit={}) {
  const response=await this.request(`https://www.googleapis.com${path}`,{...init,headers:{Authorization:`Bearer ${this.token}`,...init.headers},signal:AbortSignal.timeout(45000)});
  if(!response.ok && response.status!==308) throw Object.assign(new Error('Drive request failed'),{status:response.status});
  return response;
 }
 async json(path:string,init:RequestInit={}) {return (await this.raw(path,init)).json();}
 async allocateId():Promise<string> {const r=await this.json('/drive/v3/files/generateIds?count=1&space=drive&type=files');if(!r.ids?.[0])throw Error('Drive ID missing');return r.ids[0];}
 async folder(parent:string,key:string,label:string,id:string):Promise<string> {
  try {const old=await this.get(id);if(old.trashed||!old.parents?.includes(parent)||old.appProperties?.vihemArchiveKey!==key||old.mimeType!=='application/vnd.google-apps.folder')throw Error('Archive folder mismatch');return id;} catch(e){if((e as {status?:number}).status!==404)throw e;}
  try {await this.json('/drive/v3/files?supportsAllDrives=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name:label,mimeType:'application/vnd.google-apps.folder',parents:[parent],appProperties:{vihemArchiveKey:key}})});} catch(e){if((e as {status?:number}).status!==409)throw e;}
  const created=await this.get(id);if(created.id!==id||!created.parents?.includes(parent)||created.appProperties?.vihemArchiveKey!==key)throw Error('Archive folder mismatch');return id;
 }
 async get(id:string){return this.json(`/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,name,size,mimeType,parents,trashed,webViewLink,sha256Checksum,appProperties`);}
 async bytes(id:string){return new Uint8Array(await (await this.raw(`/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`)).arrayBuffer());}
 async upload(id:string,folder:string,key:string,name:string,mime:string,bytes:Uint8Array) {
  try {return await this.get(id);} catch(e){if((e as {status?:number}).status!==404)throw e;}
  const initial=await this.raw('/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':mime,'X-Upload-Content-Length':String(bytes.length)},body:JSON.stringify({id,name,mimeType:mime,parents:[folder],appProperties:{vihemArchiveJob:key}})});
  const location=initial.headers.get('location');
  if(!location||new URL(location).origin!=='https://www.googleapis.com')throw Error('Invalid Drive upload session');
  // Chunked Drive leg. A retry first checks the preallocated ID for a completed file.
  const chunk=1024*1024;
  for(let offset=0;offset<bytes.length;offset+=chunk){
   const end=Math.min(offset+chunk,bytes.length);
   const r=await this.request(location,{method:'PUT',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':mime,'Content-Range':`bytes ${offset}-${end-1}/${bytes.length}`},body:bytes.slice(offset,end),signal:AbortSignal.timeout(45000)});
   if(!r.ok&&r.status!==308)throw Object.assign(new Error('Drive upload failed'),{status:r.status});
   if(end<bytes.length&&r.status!==308)throw Error('Drive prematurely completed upload');
   if(end===bytes.length&&r.status===308)throw Error('Drive upload incomplete');
  }
  return this.get(id);
 }
 async verify(id:string,folder:string,job:string,size:number,sha:string){
  const meta=await this.get(id);
  if(meta.trashed||meta.id!==id||!meta.parents?.includes(folder)||Number(meta.size)!==size||meta.appProperties?.vihemArchiveJob!==job||(meta.sha256Checksum&&meta.sha256Checksum!==sha))throw Error('Drive metadata mismatch');
  const bytes=await this.bytes(id);
  if(bytes.length!==size||await sha256(bytes)!==sha)throw Error('Drive content mismatch');
  return meta;
 }
}
export async function sha256(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.slice().buffer)),b=>b.toString(16).padStart(2,'0')).join('');}
export function archiveLabel(value:string){return value.normalize('NFC').replace(/[\/\\\u0000-\u001f]/g,'–').trim().slice(0,100)||'Objekt';}
