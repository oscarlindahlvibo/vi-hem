import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const c=JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG,'utf8')),url=c.url||'http://127.0.0.1:18880';
assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const service=createClient(url,c.service,{auth:{persistSession:false}}),ok=r=>{assert.equal(r.error,null);return r.data;};
assert.equal(ok(await service.from('vihem_organisations').select('name').eq('id',c.org).single()).name,'VI-HEM Chat QA');
const clients={}; const ids=[]; const foreignId=randomUUID(),foreignPropertyId=randomUUID();
try {
 for(const who of ['oscar','tenant','outsider']) {clients[who]=createClient(url,c.anon,{auth:{persistSession:false}});ok(await clients[who].auth.signInWithPassword({email:c.users[who].email,password:c.user_password}));}
 const property=ok(await service.from('vihem_properties').select('id').eq('organisation_id',c.org).limit(1).single());
 ok(await service.from('vihem_properties').insert({id:foreignPropertyId,organisation_id:c.other_org,name:'Pass10 foreign property fixture',address:'Syntetisk QA-adress'}));
 const foreignProperty={id:foreignPropertyId};
 ok(await service.from('vihem_access_entries').insert({property_id:foreignProperty.id,id:foreignId,organisation_id:c.other_org,name:'Pass10 foreign access fixture',entry_type:'teknikrum'})); ids.push(foreignId);
 const body={action:'create',name:'Pass10 access API fixture',entry_type:'teknikrum',property_id:property.id,secret:'SYNTHETIC-QA-ONLY'};
 const created=ok(await clients.oscar.functions.invoke('vihem-access-entries',{body}));assert.equal(created.ok,true);ids.push(created.id);
 assert.equal(ok(await clients.oscar.functions.invoke('vihem-access-entries',{body:{action:'reveal',id:created.id}})).secret,body.secret);
 for(const who of ['tenant','outsider']) {
  const denied=await clients[who].functions.invoke('vihem-access-entries',{body:{action:'reveal',id:created.id}});assert.ok(denied.error||denied.data?.error);
 }
 const attack=await clients.oscar.functions.invoke('vihem-access-entries',{body:{...body,action:'update',id:foreignId}});assert.ok(attack.error||attack.data?.error);
 assert.equal(ok(await service.from('vihem_access_entries').select('name').eq('id',foreignId).single()).name,'Pass10 foreign access fixture');
 assert.equal(ok(await service.from('vihem_access_entry_secrets').select('entry_id').eq('entry_id',foreignId)).length,0);
 const forged=await clients.outsider.functions.invoke('vihem-access-entries',{body});assert.ok(forged.error||forged.data?.error);
 assert.equal(ok(await clients.tenant.from('vihem_access_entries').select('id').eq('id',created.id)).length,0);
 console.log('PASS access create/reveal, tenant/foreign denial, foreign update cannot create secret, cross-org object denied');
} finally {
 if(ids.length) {ok(await service.from('vihem_access_entry_secrets').delete().in('entry_id',ids));ok(await service.from('vihem_audit_events').delete().in('entity_id',ids));ok(await service.from('vihem_access_entries').delete().in('id',ids));}
 ok(await service.from('vihem_properties').delete().eq('id',foreignPropertyId));
 for(const client of Object.values(clients)) await client.auth.signOut();
}
