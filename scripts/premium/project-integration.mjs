import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const c = JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG,'utf8'));
const url = c.url || 'http://127.0.0.1:18880';
assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname),'QA only');
const clients = {};
for(const who of ['oscar','christofer','tenant','outsider']) {
  const client = createClient(url,c.anon,{auth:{persistSession:false}});
  assert.equal((await client.auth.signInWithPassword({email:c.users[who].email,password:c.user_password})).error,null);
  clients[who] = client;
}
assert.equal((await clients.oscar.from('vihem_organisations').select('name').eq('id',c.org).single()).data?.name,'VI-HEM Chat QA');
const service = createClient(url,c.service,{auth:{persistSession:false}});
const customerResult = await clients.oscar.from('vihem_project_customers').insert({organisation_id:c.org,name:'Atomic project customer QA',customer_type:'company'}).select('id').single();
assert.equal(customerResult.error,null);
const form = {title:'Atomic project QA',customer_id:customerResult.data.id,project_type:'Renovering',priority:'normal',billing_type:'hourly',hourly_rate:'650',budget_amount:'0',project_manager_id:c.users.oscar.id};
const id = randomUUID();
const request = {p_id:id,p_form:form,p_assigned:[c.users.christofer.id,c.users.christofer.id]};
const results = await Promise.all([clients.oscar.rpc('vihem_create_customer_project',request),clients.oscar.rpc('vihem_create_customer_project',request)]);
for(const r of results){assert.equal(r.error,null,JSON.stringify(r.error));assert.equal(r.data,id);}
const assignments = await clients.oscar.from('vihem_project_assignments').select('user_id,role').eq('project_id',id);
assert.equal(assignments.error,null);assert.equal(assignments.data.length,2,'unique manager + staff');
assert.equal(assignments.data.find(x=>x.user_id===c.users.oscar.id)?.role,'project_manager');
assert.equal((await clients.oscar.from('vihem_project_activity_log').select('id').eq('project_id',id)).data.length,1,'exactly one initial history');
for(const who of ['christofer','tenant','outsider']) assert.ok((await clients[who].rpc('vihem_create_customer_project',{...request,p_id:randomUUID()})).error,who+' cannot create for this org');
const badId=randomUUID();
assert.ok((await clients.oscar.rpc('vihem_create_customer_project',{...request,p_id:badId,p_assigned:[c.users.outsider.id]})).error);
assert.equal((await service.from('vihem_customer_projects').select('id').eq('id',badId)).data.length,0,'foreign assignee cannot leave project');
const rollbackId=randomUUID();
const rollback = await clients.oscar.rpc('vihem_create_customer_project',{...request,p_id:rollbackId,p_form:{...form,title:'Atomic rollback QA'}});
assert.ok(rollback.error,'QA assignment failure trigger must be installed');
for(const [table,col] of [['vihem_customer_projects','id'],['vihem_project_assignments','project_id'],['vihem_project_activity_log','project_id']]) {
  const r=await service.from(table).select('id').eq(col,rollbackId);assert.equal(r.error,null);assert.equal(r.data.length,0,table+' rolls back');
}
const reused=await clients.oscar.rpc('vihem_create_customer_project',{...request,p_id:randomUUID(),p_form:{...form,start_date:'2026-10-12',planned_end_date:'2026-10-01'}});assert.ok(reused.error,'invalid dates rejected in backend');
const anon=createClient(url,c.anon,{auth:{persistSession:false}});assert.ok((await anon.rpc('vihem_create_customer_project',request)).error);
console.log('PASS: concurrent idempotent create, unique participants, single history, assignment rollback, admin/staff/tenant/foreign-org/anonymous boundaries and dates. Synthetic QA rows retained.');
