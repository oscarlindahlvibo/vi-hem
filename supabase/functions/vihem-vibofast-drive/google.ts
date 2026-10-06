const API='https://www.googleapis.com/drive/v3';
export interface DriveFile {id:string;name:string;mimeType:string;size?:string;md5Checksum?:string;modifiedTime:string;version?:string;parents?:string[];driveId?:string;appProperties?:Record<string,string>;trashed?:boolean;}
const b64=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
export async function googleToken(db:any,organisationId:string,subject:string) {
 const {data,error}=await db.from('vihem_google_workspace_settings').select('encrypted_service_account_json').eq('organisation_id',organisationId).maybeSingle();
 if(error || !data?.encrypted_service_account_json)throw new Error('Google-servicekontot saknas i Vi-hem.');
 const secret=Deno.env.get('VIHEM_GOOGLE_WORKSPACE_SECRET_KEY') || Deno.env.get('VIHEM_OCR_SECRET_KEY') || Deno.env.get('VIHEM_ACCOUNTING_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const encoded=Uint8Array.from(atob(data.encrypted_service_account_json),c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),'AES-GCM',false,['decrypt']);
 const credentials=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:encoded.slice(0,12)},key,encoded.slice(12))));
 const now=Math.floor(Date.now()/1000);
 const claims={iss:credentials.client_email,scope:'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,...(subject?{sub:subject}:{})};
 const unsigned=[{alg:'RS256',typ:'JWT'},claims].map(value=>b64(new TextEncoder().encode(JSON.stringify(value)))).join('.');
 const pem=Uint8Array.from(atob(credentials.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),c=>c.charCodeAt(0));
 const signing=await crypto.subtle.importKey('pkcs8',pem,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const signature=b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',signing,new TextEncoder().encode(unsigned))));
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${signature}`}),signal:AbortSignal.timeout(20000)});
 const token=JSON.parse(await response.text());
 if(!response.ok || !token.access_token)throw new Error('Google kunde inte godkänna Drive-åtkomsten. Kontrollera servicekontots mappåtkomst och eventuell delegering för drive.file och drive.readonly.');
 return token.access_token as string;
}
export class Drive {
 constructor(private token:string,private sharedDriveId=''){}
 async json(path:string,method='GET',body?:unknown):Promise<any>{
  const response=await fetch(API+path,{method,headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const data=JSON.parse(await response.text());
  if(!response.ok)throw new Error(`Google Drive (${response.status}): ${data.error?.message || 'Kunde inte läsa mappen.'}`);
  return data;
 }
 async get(id:string):Promise<DriveFile>{return this.json(`/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,name,mimeType,parents,driveId,appProperties,trashed`);}
 async list(parent:string,query:string):Promise<DriveFile[]>{
  const files:DriveFile[]=[];let page='';
  do{
   const params=new URLSearchParams({q:`'${parent}' in parents and trashed=false and (${query})`,fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,size,md5Checksum,modifiedTime,version,parents,appProperties)',pageSize:'1000',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
   if(this.sharedDriveId){params.set('corpora','drive');params.set('driveId',this.sharedDriveId);}
   if(page)params.set('pageToken',page);
   const data=await this.json('/files?'+params);
   if(data.incompleteSearch)throw new Error('Google returnerade en ofullständig mapp. Befintliga hemsidebilder behålls.');
   files.push(...data.files);page=data.nextPageToken || '';
  }while(page);
  return files;
 }
 async ensure(parent:string,name:string,marker:string,cached?:string):Promise<string>{
  if(cached){
   try{const folder=await this.get(cached);if(!folder.trashed && folder.mimeType==='application/vnd.google-apps.folder' && folder.parents?.includes(parent) && folder.appProperties?.vihem_vibo_key===marker)return folder.id;}
   catch(error){if(!String(error).includes('(404)'))throw error;}
  }
  const existing=await this.list(parent,`mimeType='application/vnd.google-apps.folder' and appProperties has { key='vihem_vibo_key' and value='${marker}' }`);
  if(existing.length>1)throw new Error('Flera Drive-mappar har samma koppling. Kontrollera mapparna innan synkning.');
  if(existing[0])return existing[0].id;
  const created=await this.json('/files?supportsAllDrives=true&fields=id','POST',{name,mimeType:'application/vnd.google-apps.folder',parents:[parent],appProperties:{vihem_vibo_key:marker}});
  return created.id;
 }
 async download(file:DriveFile):Promise<Uint8Array>{
  const response=await fetch(API+`/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${this.token}`},signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error(`Kunde inte hämta bilden ${file.name}. Befintliga bilder behålls.`);
  const chunks:Uint8Array[]=[];let size=0;const reader=response.body!.getReader();
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10485760){await reader.cancel();throw new Error(`${file.name} är större än 10 MB.`);}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
 }
}
