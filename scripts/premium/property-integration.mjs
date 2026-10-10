import fs from'node:fs';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{createClient}from'@supabase/supabase-js';
const c=JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG,'utf8')),url=c.url||'http://127.0.0.1:18880';assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const clients={};for(const who of ['oscar','christofer','tenant','outsider']){const client=createClient(url,c.anon,{auth:{persistSession:false}});assert.equal((await client.auth.signInWithPassword({email:c.users[who].email,password:c.user_password})).error,null);clients[who]=client;}
assert.equal((await clients.oscar.from('vihem_organisations').select('name').eq('id',c.org).single()).data?.name,'VI-HEM Chat QA');
const service=createClient(url,c.service,{auth:{persistSession:false}}),property=randomUUID(),apartment=randomUUID();
try{
 let r=await clients.oscar.from('vihem_properties').insert({id:property,organisation_id:c.org,name:'Premium property QA',address:'Syntetisk testadress',city:'QA',zip:'12345',contact_info:{property_manager:'QA kontakt',phone:'000',email:'qa@example.invalid'}}).select('id').single();assert.equal(r.error,null);
 r=await clients.oscar.from('vihem_apartments').insert({id:apartment,organisation_id:c.org,property_id:property,unit_type:'apartment',apartment_number:'QA-UX-100',size:45,rooms:2,rent:5400,status:'vacant',key_ids:[{id:'QA-key',label:'Test',copies:2}],network_outlet_ids:[{room:'Hall',port_id:'QA-port',switch:'QA-switch',vlan:'1'}]}).select('id').single();assert.equal(r.error,null);
 r=await clients.oscar.from('vihem_apartments').update({technical_notes:'QA sparad anteckning'}).eq('id',apartment).select('rent,key_ids,network_outlet_ids,technical_notes').single();assert.equal(r.error,null);assert.equal(r.data.rent,5400);assert.equal(r.data.key_ids[0].copies,2);assert.equal(r.data.network_outlet_ids[0].port_id,'QA-port');assert.equal(r.data.technical_notes,'QA sparad anteckning');
 for(const who of ['tenant','outsider']){const edit=await clients[who].from('vihem_apartments').update({rent:1}).eq('id',apartment).select('id');assert.ok(edit.error||!edit.data.length,who+' denied editing');}
 assert.deepEqual((await clients.outsider.from('vihem_properties').select('id').eq('id',property)).data,[]);
 assert.deepEqual((await clients.outsider.from('vihem_apartments').select('id').eq('id',apartment)).data,[]);
 assert.equal((await clients.christofer.from('vihem_properties').select('id').eq('id',property)).data?.length,1);
 assert.equal((await clients.oscar.from('vihem_apartments').select('rent').eq('id',apartment).single()).data?.rent,5400);
 console.log('PASS QA property/apartment create, update, keys/network/rent preserved, staff read, tenant/foreign update denied and foreign read denied. No production.');
}finally{assert.equal((await service.from('vihem_apartments').delete().eq('id',apartment).eq('organisation_id',c.org)).error,null);assert.equal((await service.from('vihem_properties').delete().eq('id',property).eq('organisation_id',c.org)).error,null);}
