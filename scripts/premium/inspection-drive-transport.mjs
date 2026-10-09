import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../supabase/functions/_shared/inspection-drive.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {DriveArchiveClient,sha256,archiveLabel}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const stored=new Map(),sessions=new Map();let creates=0,id=0,nextStatus=0,lost=false;
const respond=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
const request=async (url,init={})=>{
 if(nextStatus){const status=nextStatus;nextStatus=0;return respond({},status);}
 const u=new URL(url);
 if(u.pathname.endsWith('/generateIds'))return respond({ids:['allocated-'+(++id)]});
 if(u.pathname==='/drive/v3/files'&&init.method==='POST'){
  const meta=JSON.parse(init.body);if(stored.has(meta.id))return respond({},409);creates++;stored.set(meta.id,meta);return respond(meta);
 }
 if(u.pathname==='/upload/drive/v3/files'){
  const meta=JSON.parse(init.body);creates++;sessions.set(meta.id,{meta,chunks:[]});return respond({},200,{location:'https://www.googleapis.com/session/'+meta.id});
 }
 if(u.pathname.startsWith('/session/')){
  const session=sessions.get(u.pathname.split('/').pop());session.chunks.push(Buffer.from(init.body));
  const match=String(init.headers['Content-Range']).match(/bytes (\d+)-(\d+)\/(\d+)/);assert.ok(match);
  if(Number(match[2])+1<Number(match[3]))return new Response(null,{status:308});
  const bytes=new Uint8Array(Buffer.concat(session.chunks));stored.set(session.meta.id,{...session.meta,size:String(bytes.length),sha256Checksum:await sha256(bytes),bytes});
  if(lost){lost=false;throw new TypeError('simulated response lost after successful upload');}return respond({id:session.meta.id});
 }
 const file=stored.get(u.pathname.split('/').pop());if(!file)return respond({},404);
 return u.searchParams.get('alt')==='media'?new Response(file.bytes):respond(file);
};
const drive=new DriveArchiveClient('synthetic-token','synthetic-shared',request);
const fid=await drive.allocateId();await drive.folder('root','property:uuid','Fastighet – ÅÄÖ',fid);await drive.folder('root','property:uuid','Nytt namn',fid);assert.equal(creates,1,'stable folder survives rename');
const bytes=new Uint8Array(2*1024*1024+17).fill(7),hash=await sha256(bytes);const file=await drive.allocateId();lost=true;
await assert.rejects(()=>drive.upload(file,fid,'job','Bilder.jpg','image/jpeg',bytes));assert.equal(stored.get(file).bytes.length,bytes.length);
await drive.upload(file,fid,'job','Bilder.jpg','image/jpeg',bytes);assert.equal(creates,2,'lost response/retry creates no duplicate');
await drive.verify(file,fid,'job',bytes.length,hash);
await assert.rejects(()=>drive.verify(file,'foreign-folder','job',bytes.length,hash));
await assert.rejects(()=>drive.verify(file,fid,'foreign-job',bytes.length,hash));
await assert.rejects(()=>drive.verify(file,fid,'job',bytes.length,'a'.repeat(64)));
const old=stored.get(file).bytes;stored.get(file).bytes=old.slice(1);await assert.rejects(()=>drive.verify(file,fid,'job',bytes.length,hash));stored.get(file).bytes=old;
for(const status of [401,429,500,503]){nextStatus=status;await assert.rejects(()=>drive.get(file),error=>error.status===status);}
assert.equal(archiveLabel('../Kök\\Hall\u0000'),'..–Kök–Hall–');
console.log('PASS: mocked Google API stable folders, multi-chunk resumable upload, lost success response/retry, downloaded SHA256/size/parent/job validation, 401/429/5xx. No real Google request made.');
