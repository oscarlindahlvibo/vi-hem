import fs from 'node:fs';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';import{createClient}from'@supabase/supabase-js';
const c=JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG,'utf8')),url=c.url||'http://127.0.0.1:18880';assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const clients={};for(const who of ['oscar','christofer','tenant','outsider']){const client=createClient(url,c.anon,{auth:{persistSession:false}});assert.equal((await client.auth.signInWithPassword({email:c.users[who].email,password:c.user_password})).error,null);clients[who]=client;}
assert.equal((await clients.oscar.from('vihem_organisations').select('name').eq('id',c.org).single()).data?.name,'VI-HEM Chat QA');
const service=createClient(url,c.service,{auth:{persistSession:false}}),id=c.users.christofer.id;
const profile=(await service.from('vihem_profiles').select('name,phone,role,active,bankid_personal_number,is_system_admin').eq('id',id).single()).data;
const schedules=(await service.from('vihem_staff_work_schedules').select('*').eq('user_id',id)).data;
const grants=(await service.from('vihem_permission_grants').select('*').eq('user_id',id)).data;
const operations=[];
const payload={p_target:id,p_profile:{...profile,is_system_admin:profile.is_system_admin===true},p_schedule:Array.from({length:7},(_,i)=>({weekday:i+1,active:i<5,work_start:'08:00',work_end:'17:00',lunch_start:i<5?'12:00':null,lunch_minutes:i<5?45:0})),p_grant:[],p_revoke:[]};
const call=async(who,p)=>{operations.push(p.p_operation);return clients[who].rpc('vihem_save_staff_editor',p);};
try{
 const op=randomUUID(),p={...payload,p_operation:op,p_profile:{...payload.p_profile,name:'Atomic staff QA'},p_grant:['inventory_management']};
 const concurrent=await Promise.all([call('oscar',p),call('oscar',p)]);for(const r of concurrent)assert.equal(r.error,null);
 assert.equal((await service.from('vihem_staff_save_operations').select('operation_id').eq('operation_id',op)).data.length,1);
 assert.equal((await service.from('vihem_staff_work_schedules').select('weekday').eq('user_id',id)).data.length,7);
 assert.equal((await service.from('vihem_profiles').select('name').eq('id',id).single()).data.name,'Atomic staff QA');
 assert.ok((await call('oscar',{...p,p_profile:{...p.p_profile,name:'Changed retry'}})).error);
 // Invalid lunch violates a DB constraint AFTER profile update: all rows roll back.
 const bad={...p,p_operation:randomUUID(),p_profile:{...p.p_profile,name:'Must roll back'},p_schedule:p.p_schedule.map((r,i)=>i===6?{...r,lunch_minutes:999}:r)};
 assert.ok((await call('oscar',bad)).error);
 assert.equal((await service.from('vihem_profiles').select('name').eq('id',id).single()).data.name,'Atomic staff QA');
 assert.equal((await service.from('vihem_staff_work_schedules').select('lunch_minutes').eq('user_id',id).eq('weekday',7).single()).data.lunch_minutes,0);
 assert.equal((await service.from('vihem_staff_save_operations').select('operation_id').eq('operation_id',bad.p_operation)).data.length,0);
 for(const who of ['christofer','tenant','outsider'])assert.ok((await call(who,{...p,p_operation:randomUUID()})).error);
 assert.ok((await call('oscar',{...p,p_operation:randomUUID(),p_profile:{...p.p_profile,role:'superadmin'}})).error);
 assert.ok((await call('oscar',{...p,p_operation:randomUUID(),p_grant:['unknown']})).error);
 const anon=createClient(url,c.anon,{auth:{persistSession:false}});assert.ok((await anon.rpc('vihem_save_staff_editor',{...p,p_operation:randomUUID()})).error);
 console.log('PASS atomic staff profile/schedule/grants, simultaneous duplicate retry, changed replay denied, constraint rollback after profile write, role/tenant/foreign/anonymous denied. QA data restored.');
}finally{
 assert.equal((await service.from('vihem_profiles').update(profile).eq('id',id)).error,null);
 assert.equal((await service.from('vihem_staff_work_schedules').delete().eq('user_id',id)).error,null);if(schedules.length)assert.equal((await service.from('vihem_staff_work_schedules').insert(schedules)).error,null);
 assert.equal((await service.from('vihem_permission_grants').delete().eq('user_id',id)).error,null);if(grants.length)assert.equal((await service.from('vihem_permission_grants').insert(grants)).error,null);
 assert.equal((await service.from('vihem_staff_save_operations').delete().in('operation_id',operations)).error,null);
}
