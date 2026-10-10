import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID}from'node:crypto';import{createClient}from'@supabase/supabase-js';
const c=JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG,'utf8')),url=c.url||'http://127.0.0.1:18880';assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));const clients={};
for(const name of ['oscar','christofer','tenant','outsider']){clients[name]=createClient(url,c.anon,{auth:{persistSession:false}});assert.equal((await clients[name].auth.signInWithPassword({email:c.users[name].email,password:c.user_password})).error,null);}
assert.equal((await clients.oscar.from('vihem_organisations').select('name').eq('id',c.org).single()).data.name,'VI-HEM Chat QA');
const service=createClient(url,c.service,{auth:{persistSession:false}}),apt=(await clients.oscar.from('vihem_apartments').select('id,property_id').limit(1).single()).data,id=randomUUID();
const form={property_id:apt.property_id,apartment_id:apt.id,tenancy_id:null,inspection_type:'routine',inspection_date:'2026-10-10',tenant_present:false,overall_condition:'good',rooms:[{id:randomUUID(),name:'Hall',condition:'good',condition_selected:false,reviewed:false,photos:[],notes:''}],notes:'Revision QA',action_required:'',photo_urls:[],status:'draft'};
try{
 const save=await clients.oscar.rpc('vihem_save_inspection_draft',{p_id:id,p_form:form});assert.equal(save.error,null);assert.equal(save.data.revision,1);
 const retry=await clients.oscar.rpc('vihem_save_inspection_draft',{p_id:id,p_form:form});assert.equal(retry.error,null);assert.equal(retry.data.revision,1);
 const races=await Promise.all([clients.oscar.rpc('vihem_save_inspection_draft',{p_id:id,p_form:{...form,notes:'A'},p_expected:1}),clients.christofer.rpc('vihem_save_inspection_draft',{p_id:id,p_form:{...form,notes:'B'},p_expected:1})]);assert.equal(races.filter(r=>!r.error).length,1);assert.equal(races.filter(r=>r.error?.message==='INSPECTION_REVISION_CONFLICT').length,1);
 assert.ok((await clients.oscar.rpc('vihem_save_inspection',{p_id:id,p_form:form})).error,'old RPC cannot silently overwrite');
 assert.ok((await clients.oscar.from('vihem_apartment_inspections').update({notes:'Old REST write'}).eq('id',id)).error,'older direct update blocked');
 for(const name of ['tenant','outsider'])assert.ok((await clients[name].rpc('vihem_save_inspection_draft',{p_id:id,p_form:form,p_expected:2})).error);
 const before=(await service.from('vihem_apartment_inspections').select('*').eq('id',id).single()).data;
 const photos=[...before.rooms];photos[0]={...photos[0],photos:['vihem-drive:'+randomUUID()]};assert.equal((await service.from('vihem_apartment_inspections').update({rooms:photos}).eq('id',id)).error,null);
 assert.ok((await clients.oscar.rpc('vihem_save_inspection_draft',{p_id:id,p_form:{...before,notes:'Stale photo editor'},p_expected:before.revision})).error);
 const after=(await service.from('vihem_apartment_inspections').select('*').eq('id',id).single()).data;assert.equal(after.rooms[0].photos.length,1);assert.equal(after.revision,before.revision+1);
 console.log('PASS revision QA: identical retry, competing staff, stale photos preserved, legacy RPC/REST denied, tenant/cross-org denied.');
}finally{assert.equal((await service.from('vihem_apartment_inspections').delete().eq('id',id)).error,null);}
