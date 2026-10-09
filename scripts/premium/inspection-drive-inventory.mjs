// Read-only QA inventory. This command never uploads, changes references or deletes files.
import fs from 'node:fs'; import assert from 'node:assert/strict'; import {createClient} from '@supabase/supabase-js';
const c=JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG,'utf8')),url=c.url||'http://127.0.0.1:18880';
assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname),'QA only');
const client=createClient(url,c.anon,{auth:{persistSession:false}});
assert.equal((await client.auth.signInWithPassword({email:c.users.oscar.email,password:c.user_password})).error,null);
assert.equal((await client.from('vihem_organisations').select('name').eq('id',c.org).single()).data.name,'VI-HEM Chat QA');
const rows=[];for(let offset=0;;offset+=100){const result=await client.from('vihem_apartment_inspections').select('id,organisation_id,rooms,photo_urls,document_id').eq('organisation_id',c.org).order('id').range(offset,offset+99);assert.equal(result.error,null);rows.push(...result.data);if(result.data.length<100)break;}
const registry=await client.from('vihem_google_drive_files').select('source_key,drive_file_id,sha256,verified_at').eq('organisation_id',c.org).eq('source_type','inspection_photo');assert.equal(registry.error,null);
const report=[];
for(const row of rows){for(const [room,references] of [['general',row.photo_urls||[]],...(row.rooms||[]).map(r=>[r.id||r.name,r.photos||[]])])for(const reference of references){
 let path=null;try{const parsed=new URL(reference);const marker='/storage/v1/object/public/vihem-inspection-photos/';if(parsed.pathname.startsWith(marker))path=decodeURIComponent(parsed.pathname.slice(marker.length));}catch{}
 const copies=registry.data.filter(file=>file.source_key===path||file.source_key===reference);
 report.push({inspection:row.id,room,reference,legacyStoragePath:path,registeredCopies:copies.map(file=>file.drive_file_id),verifiedCopies:copies.filter(file=>file.verified_at&&file.sha256).length,action:reference.startsWith('vihem-drive:')?'reconcile-job':copies.some(file=>file.verified_at&&file.sha256)?'verify-existing-copy':path?'needs-verified-migration':'manual-review'});
}}
const output={mode:'dry-run',organisation:c.org,inspections:rows.length,photos:report.length,files:report,limitations:['No migration is performed. Existing copies require byte/parent verification before reference updates. Production use deliberately blocked.']};
if(process.env.PREMIUM_INVENTORY_OUTPUT)fs.writeFileSync(process.env.PREMIUM_INVENTORY_OUTPUT,JSON.stringify(output,null,2));
console.log(`PASS read-only QA inventory: ${rows.length} inspections, ${report.length} photo references. No writes or Google requests.`);
