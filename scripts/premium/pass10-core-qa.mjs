import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const c=JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG,'utf8')),url=c.url||'http://127.0.0.1:18880';
assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const service=createClient(url,c.service,{auth:{persistSession:false}}),ok=r=>{assert.equal(r.error,null);return r.data;};
assert.equal(ok(await service.from('vihem_organisations').select('name').eq('id',c.org).single()).name,'VI-HEM Chat QA');
const tenant=createClient(url,c.anon,{auth:{persistSession:false}}),foreign=createClient(url,c.anon,{auth:{persistSession:false}});
for(const [cl,who] of [[tenant,'tenant'],[foreign,'outsider']])ok(await cl.auth.signInWithPassword({email:c.users[who].email,password:c.user_password}));
const id=randomUUID();
try {
 const tenancy=ok(await service.from('vihem_tenancies').select('id').eq('tenant_id',c.users.tenant.id).eq('status','active').limit(1).single());
 const saved=ok(await tenant.from('vihem_termination_requests').insert({id,organisation_id:c.org,tenant_id:c.users.tenant.id,tenancy_id:tenancy.id,requested_move_out_date:'2027-02-01',new_address:'Syntetisk QA-adress',message:'Pass10 ÅÄÖ',status:'submitted'}).select().single());
 assert.equal(saved.requested_move_out_date,'2027-02-01');
 assert.equal(ok(await foreign.from('vihem_termination_requests').select('id').eq('id',id)).length,0);
 console.log('PASS termination insert/select, Swedish text, foreign-org denial');
} finally {ok(await service.from('vihem_termination_requests').delete().eq('id',id));await tenant.auth.signOut();await foreign.auth.signOut();}
