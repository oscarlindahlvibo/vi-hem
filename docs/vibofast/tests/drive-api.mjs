import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {transform} from 'esbuild';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
async function module(name){const {code}=await transform(await readFile(new URL('../../../supabase/functions/vihem-vibofast-drive/'+name,import.meta.url),'utf8'),{loader:'ts',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));}
const core=await module('core.ts');const {Drive}=await module('google.ts');
assert.equal(core.folderId('https://drive.google.com/drive/folders/abc-123'),'abc-123');
assert.throws(()=>core.folderId('https://unrelated.example/'));
assert.deepEqual(core.sortImages([{id:'b',name:'10-bild.jpg'},{id:'a',name:'02-bild.jpg'}]).map(f=>f.id),['a','b']);
assert.equal(core.imageExtension(new Uint8Array([255,216,255]),'image/jpeg'),'jpg');
assert.throws(()=>core.imageExtension(new TextEncoder().encode('<svg/>'),'image/jpeg'));
const file={id:'file_1',md5Checksum:'rev1',modifiedTime:'2026-10-06'};
const first=await core.imageKey('apartment','00000000-0000-4000-8000-000000000001',file,'jpg');
assert.notEqual(first,await core.imageKey('apartment','00000000-0000-4000-8000-000000000001',{...file,md5Checksum:'rev2'},'jpg'));
let calls=[];
globalThis.fetch=async(url,options={})=>{calls.push({url,options});const u=new URL(url);return new Response(JSON.stringify(u.searchParams.has('pageToken')?{files:[{id:'two',name:'2.jpg'}]}:{files:[{id:'one',name:'1.jpg'}],nextPageToken:'next'}));};
const drive=new Drive('test','shared');
assert.equal((await drive.list('root',"mimeType='image/jpeg'")).length,2);
assert.equal(new URL(calls[0].url).searchParams.get('driveId'),'shared');
assert.equal(new URL(calls[1].url).searchParams.get('pageToken'),'next');
globalThis.fetch=async()=>new Response(JSON.stringify({incompleteSearch:true,files:[]}));
await assert.rejects(drive.list('root',"mimeType='image/jpeg'"),/ofullständig/);
let created=0;
globalThis.fetch=async(url,options={})=>{
 if(options.method==='POST'){created++;assert.equal(JSON.parse(options.body).appProperties.vihem_vibo_key,'apartment_test');return new Response('{"id":"new"}');}
 if(new URL(url).pathname.endsWith('/cached'))return new Response('{"id":"cached","mimeType":"application/vnd.google-apps.folder","trashed":true,"parents":["root"]}');
 return new Response('{"files":[]}');
};
assert.equal(await drive.ensure('root','Lgh 1001','apartment_test','cached'),'new');assert.equal(created,1);
assert(calls.every(c=>!String(c.options.method).includes('DELETE')));
console.log('PASS: folder IDs, image order/types/versioned cache paths, shared-drive pagination, incomplete-result rejection and recovery of trashed folders.');
