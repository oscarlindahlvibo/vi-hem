import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const c=JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG,'utf8'));
const url=c.url||'http://127.0.0.1:18880';
assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname),'QA only');
const clients={};
for(const who of ['oscar','christofer','tenant','outsider']) {
 const client=createClient(url,c.anon,{auth:{persistSession:false}});
 assert.equal((await client.auth.signInWithPassword({email:c.users[who].email,password:c.user_password})).error,null);
 clients[who]=client;
}
assert.equal((await clients.oscar.from('vihem_organisations').select('name').eq('id',c.org).single()).data?.name,'VI-HEM Chat QA');
const aptRes=await clients.oscar.from('vihem_apartments').select('id,property_id').eq('organisation_id',c.org).limit(1).single();
assert.equal(aptRes.error,null);
const apt=aptRes.data;
const form={apartment_id:apt.id,property_id:apt.property_id,tenancy_id:null,inspection_type:'routine',inspection_date:'2026-10-09',tenant_present:false,overall_condition:'good',rooms:[{name:'Kök QA',condition:'poor',notes:'Synthetic observation',photos:[],reviewed:true}],notes:'Atomic inspection QA',action_required:'Synthetic follow-up',photo_urls:[],status:'draft'};
const id=randomUUID(),docId=randomUUID();
const call=(who,id,form,doc=null,docId=null)=>clients[who].rpc('vihem_save_inspection',{p_id:id,p_form:form,p_document:doc,p_document_id:docId});
const results=await Promise.all([call('oscar',id,form),call('oscar',id,form)]);
for(const result of results) {assert.equal(result.error,null);assert.equal(result.data.id,id);}
assert.equal((await clients.oscar.from('vihem_apartment_inspections').select('id').eq('id',id)).data.length,1);
const document={title:'Controlled inspection protocol failure QA',file_url:'data:application/pdf;base64,JVBERi0xLjQK',file_name:'qa.pdf',file_size:42,description:'Synthetic QA protocol'};
assert.ok((await call('oscar',randomUUID(),{...form,status:'completed'},{},randomUUID())).error,'missing protocol URL denied');
const failed=await call('oscar',id,{...form,status:'completed'},document,docId);
assert.ok(failed.error,'fixture must reject document');
assert.equal((await clients.oscar.from('vihem_apartment_inspections').select('status,document_id').eq('id',id).single()).data.status,'draft');
assert.equal((await clients.oscar.from('vihem_documents').select('id').eq('id',docId)).data.length,0);
document.title='Atomic inspection protocol QA';
const rollbackId=randomUUID(), rollbackDoc=randomUUID();
assert.ok((await call('oscar',rollbackId,{...form,status:'completed',notes:'Controlled finalization failure QA'},document,rollbackDoc)).error);
assert.equal((await clients.oscar.from('vihem_documents').select('id').eq('id',rollbackDoc)).data.length,0,'document insert rolls back if final inspection insert fails');
assert.equal((await clients.oscar.from('vihem_apartment_inspections').select('id').eq('id',rollbackId)).data.length,0);

const completed=await call('oscar',id,{...form,status:'completed'},document,docId);
assert.equal(completed.error,null);assert.equal(completed.data.document_id,docId);assert.equal(completed.data.status,'completed');
const retried=await call('oscar',id,{...form,status:'completed'},document,docId);
assert.equal(retried.error,null);assert.equal(retried.data.document_id,docId);
assert.equal((await clients.oscar.from('vihem_documents').select('id').eq('id',docId)).data.length,1);
assert.equal((await call('christofer',randomUUID(),form)).error,null,'same-org staff retain create');
for(const who of ['tenant','outsider']) assert.ok((await call(who,randomUUID(),form)).error,'unauthorized creation denied');
const tenancyRes=await clients.oscar.from('vihem_tenancies').select('id').eq('tenant_id',c.users.tenant.id).eq('apartment_id',apt.id).limit(1).maybeSingle();
assert.equal(tenancyRes.error,null);
if(tenancyRes.data) {
 const tenantInspectionId=randomUUID(),tenantDocId=randomUUID();
 assert.equal((await call('oscar',tenantInspectionId,{...form,tenancy_id:tenancyRes.data.id,status:'completed'},document,tenantDocId)).error,null);
 assert.equal((await clients.tenant.from('vihem_apartment_inspections').select('id').eq('id',tenantInspectionId)).data.length,1,'tenant retains own inspection access');
 assert.equal((await clients.tenant.from('vihem_documents').select('id').eq('id',tenantDocId)).data.length,1,'tenant retains own protocol access');
 assert.equal((await clients.outsider.from('vihem_documents').select('id').eq('id',tenantDocId)).data.length,0,'foreign admin cannot read protocol');
} else throw Error('QA tenancy fixture required');
const anon=createClient(url,c.anon,{auth:{persistSession:false}});
assert.ok((await anon.rpc('vihem_save_inspection',{p_id:randomUUID(),p_form:form})).error);
assert.ok((await call('oscar',randomUUID(),{...form,apartment_id:randomUUID()})).error,'invalid/cross-org object denied');
const otherId=randomUUID();
assert.ok((await call('oscar',otherId,{...form,status:'completed'},document,docId)).error,'existing unrelated document cannot be reattached');
assert.equal((await clients.oscar.from('vihem_apartment_inspections').select('id').eq('id',otherId)).data.length,0);
console.log('PASS: inspection parallel retry, protocol rollback, completion/retry, staff, tenant/anonymous/org/object boundaries and unrelated-document protection.');
