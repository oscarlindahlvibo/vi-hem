// Read-only QA inventory. This command never uploads, changes references or deletes files.
import {legacySource,legacyPdfBytes} from './inspection-legacy-source.mjs';
import fs from 'node:fs'; import assert from 'node:assert/strict'; import {createClient} from '@supabase/supabase-js';
const c=JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG,'utf8')),url=c.url||'http://127.0.0.1:18880';
assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname),'QA only');
const client=createClient(url,c.anon,{auth:{persistSession:false}});
assert.equal((await client.auth.signInWithPassword({email:c.users.oscar.email,password:c.user_password})).error,null);
assert.equal((await client.from('vihem_organisations').select('name').eq('id',c.org).single()).data.name,'VI-HEM Chat QA');
const rows=[];for(let offset=0;;offset+=100){const result=await client.from('vihem_apartment_inspections').select('id,organisation_id,rooms,photo_urls,document_id').eq('organisation_id',c.org).order('id').range(offset,offset+99);assert.equal(result.error,null);rows.push(...result.data);if(result.data.length<100)break;}
async function paged(table,columns,filter){const out=[];for(let offset=0;;offset+=100){let query=client.from(table).select(columns).eq('organisation_id',c.org);if(filter)query=filter(query);const r=await query.order('id').range(offset,offset+99);assert.equal(r.error,null);out.push(...r.data);if(r.data.length<100)break;}return out;}
const registry=await paged('vihem_google_drive_files','id,source_id,source_type,source_key,drive_file_id,sha256,verified_at',q=>q.in('source_type',['inspection_photo','inspection_protocol']));
const documents=await paged('vihem_documents','id,document_type,file_url,file_name,storage_provider,drive_file_id');
const report=[];
for(const row of rows){for(const [room,references] of [['general',row.photo_urls||[]],...(row.rooms||[]).map(r=>[r.id||r.name,r.photos||[]])])for(const reference of references){
 const source=legacySource(reference,url,c.org),path=source.kind==='storage-photo'?source.path:null;
 const copies=registry.filter(file=>file.source_id===row.id&&file.source_type==='inspection_photo'&&(file.source_key===path||file.source_key===reference));
 report.push({kind:'photo',inspection:row.id,room,reference,legacyStoragePath:path,registeredCopies:copies.map(file=>file.drive_file_id),verifiedCopies:copies.filter(file=>file.verified_at&&file.sha256).length,action:source.kind==='job'?'reconcile-job':copies.some(file=>file.verified_at&&file.sha256)?'verify-existing-copy':path?'needs-verified-migration':'manual-review'});
}
 if(row.document_id){const doc=documents.find(d=>d.id===row.document_id),entry={kind:'protocol',inspection:row.id,document:row.document_id,action:'manual-review'};
 if(!doc)entry.reason='Document inaccessible or missing';
 else if(doc.storage_provider==='google_drive'&&doc.drive_file_id){entry.registeredCopies=[doc.drive_file_id];entry.action='verify-existing-copy';}
 else if(legacySource(doc.file_url,url,c.org).kind==='inline-pdf'){try{const value=legacyPdfBytes(doc.file_url);entry.byte_size=value.byte_size;entry.sha256=value.sha256;entry.action='needs-verified-migration';}catch{entry.reason='Invalid or oversized PDF source';}}
 // Never include base64 document payloads in the report. Final/signed originals remain untouched.
 report.push(entry);
}}
const output={mode:'dry-run',organisation:c.org,inspections:rows.length,photos:report.filter(r=>r.kind==='photo').length,protocols:report.filter(r=>r.kind==='protocol').length,files:report,limitations:['No migration is performed. Existing copies require byte/parent verification before reference updates. Production use deliberately blocked. Signed and original document rows are preserved. Storage sources must use own QA origin and organisation path.']};
if(process.env.PREMIUM_INVENTORY_OUTPUT)fs.writeFileSync(process.env.PREMIUM_INVENTORY_OUTPUT,JSON.stringify(output,null,2));
console.log(`PASS read-only QA inventory: ${rows.length} inspections, ${output.photos} photo references, ${output.protocols} protocols. No writes or Google requests.`);
