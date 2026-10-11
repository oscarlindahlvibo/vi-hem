import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {validateImportRows,decodeImportText} from '../../src/lib/importValidation.mjs';
assert.equal(validateImportRows([{article_number:'A',name:'Åäö',initial_quantity:'2'}],['article_number','name'],'inventory_items').length,0);
assert.equal(validateImportRows([{article_number:'A',name:'Åäö',initial_quantity:'NaN'},{article_number:' a ',name:'B',initial_quantity:'-2'}],['article_number','name'],'inventory_items').length,2);
assert.equal(validateImportRows([{email:'invalid'}],['email','name'],'tenants').length,1);
assert.equal(decodeImportText(new TextEncoder().encode('ÅÄÖ åäö')), 'ÅÄÖ åäö');
assert.equal(decodeImportText(new Uint8Array([0xc5,0xc4,0xd6])), 'ÅÄÖ');
console.log('PASS import UTF-8/Windows-1252, required fields, numeric validation, duplicates and Swedish text');
const c=JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG,'utf8')),url=c.url||'http://127.0.0.1:18880';
assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const service=createClient(url,c.service,{auth:{persistSession:false}}),ok=r=>{assert.equal(r.error,null);return r.data;};
assert.equal(ok(await service.from('vihem_organisations').select('name').eq('id',c.org).single()).name,'VI-HEM Chat QA');
const clients={};
for(const who of ['oscar','christofer','tenant','outsider']){const cl=createClient(url,c.anon,{auth:{persistSession:false}});ok(await cl.auth.signInWithPassword({email:c.users[who].email,password:c.user_password}));clients[who]=cl;}
const module=ok(await service.from('vihem_organisation_modules').select('*').eq('organisation_id',c.org).eq('module_key','jour'));
const registry=ok(await service.from('vihem_module_registry').select('module_key').eq('module_key','jour'));
const ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID()],loc=randomUUID(),op=randomUUID();let item;
try {
 if(!registry.length)ok(await service.from('vihem_module_registry').insert({module_key:'jour',name:'Jour QA'}));
 ok(await service.from('vihem_organisation_modules').upsert({organisation_id:c.org,module_key:'jour',enabled:true},{onConflict:'organisation_id,module_key'}));
 ok(await service.from('vihem_inventory_locations').insert({id:loc,organisation_id:c.org,name:'Pass11 QA',type:'warehouse'}));
 const payload={p_operation:op,p_item:{name:'Import QA ÅÄÖ',article_number:randomUUID(),description:'Syntetisk beskrivning',manufacturer:'QA',supplier_article_number:'S-12'},p_quantity:5,p_location:loc};
 const result=await Promise.all([clients.oscar.rpc('vihem_create_inventory_item',payload),clients.oscar.rpc('vihem_create_inventory_item',payload)]);item=ok(result[0]);assert.equal(ok(result[1]),item);
 const saved=ok(await service.from('vihem_inventory_stock_items').select('description,manufacturer,supplier_article_number').eq('id',item).single());assert.deepEqual(saved,{description:'Syntetisk beskrivning',manufacturer:'QA',supplier_article_number:'S-12'});
 assert.equal(ok(await service.from('vihem_inventory_transactions').select('id').eq('item_id',item)).length,1);
 const badArticle=randomUUID();assert.ok((await clients.oscar.rpc('vihem_create_inventory_item',{...payload,p_operation:randomUUID(),p_item:{name:'Rollback',article_number:badArticle},p_location:randomUUID()})).error);
 assert.equal(ok(await service.from('vihem_inventory_stock_items').select('id').eq('article_number',badArticle)).length,0);
 console.log('PASS import inventory metadata, parallel idempotence, startsaldo and rollback');
 const shift=ok(await service.from('vihem_jour_shifts').insert({id:ids[0],organisation_id:c.org,user_id:c.users.oscar.id,duty_type:'fastighet',starts_at:'2033-01-01T08:00:00Z',ends_at:'2033-01-01T16:00:00Z',source:'manual',created_by:c.users.oscar.id}).select().single());
 const split={p_id:shift.id,p_revision:shift.updated_at,p_split:'2033-01-01T12:00:00Z',p_end:shift.ends_at,p_owner:c.users.christofer.id,p_child:ids[1]};
 for(const who of ['christofer','tenant','outsider']){console.log('Testing jour denial:',who);assert.equal((await clients[who].rpc('vihem_split_jour_shift',split)).error?.code,'42501');}
 console.log('Testing jour parallel split');
 assert.equal((await clients.oscar.rpc('vihem_split_jour_shift',{...split,p_owner:c.users.outsider.id})).error?.code,'42501');
 const anonymous=createClient(url,c.anon,{auth:{persistSession:false}});assert.ok((await anonymous.rpc('vihem_split_jour_shift',split)).error);
 const divided=await Promise.all([clients.oscar.rpc('vihem_split_jour_shift',split),clients.oscar.rpc('vihem_split_jour_shift',split)]);assert.equal(ok(divided[0]),ids[1]);assert.equal(ok(divided[1]),ids[1]);
 assert.equal(ok(await service.from('vihem_jour_shifts').select('id').in('id',[ids[0],ids[1]])).length,2);
 assert.ok((await clients.oscar.rpc('vihem_split_jour_shift',{...split,p_owner:c.users.oscar.id})).error);
 console.log('Testing jour rollback');
 const rollback=ok(await service.from('vihem_jour_shifts').insert({id:ids[2],organisation_id:c.org,user_id:c.users.oscar.id,duty_type:'fastighet',starts_at:'2033-01-02T08:00:00Z',ends_at:'2033-01-02T16:00:00Z',source:'manual',created_by:c.users.oscar.id}).select().single());
 const child=randomUUID();
 execFileSync('python3',['../chat-modernisation/apply-qa.py'],{input:`CREATE FUNCTION public.pass11_jour_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${child}'::uuid THEN RAISE EXCEPTION 'QA injected child insert failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER pass11_jour_fail BEFORE INSERT ON public.vihem_jour_shifts FOR EACH ROW EXECUTE FUNCTION public.pass11_jour_fail();`});assert.ok((await clients.oscar.rpc('vihem_split_jour_shift',{...split,p_id:ids[2],p_revision:rollback.updated_at,p_split:'2033-01-02T12:00:00Z',p_end:rollback.ends_at,p_child:child})).error);
 assert.equal(ok(await service.from('vihem_jour_shifts').select('ends_at').eq('id',ids[2]).single()).ends_at,rollback.ends_at);
 assert.equal(ok(await service.from('vihem_jour_shifts').select('id').eq('id',child)).length,0);
 assert.ok((await clients.oscar.rpc('vihem_split_jour_shift',{...split,p_id:ids[2],p_revision:'2000-01-01T00:00:00Z',p_split:'2033-01-02T12:00:00Z',p_end:rollback.ends_at,p_child:child,p_owner:null})).error);
 console.log('PASS jour parallel replay, changed replay, stale revision, role/org denial and injected INSERT rollback');
} finally {
 execFileSync('python3',['../chat-modernisation/apply-qa.py'],{input:'DROP TRIGGER IF EXISTS pass11_jour_fail ON public.vihem_jour_shifts; DROP FUNCTION IF EXISTS public.pass11_jour_fail();'});
 ok(await service.from('vihem_jour_shifts').delete().in('id',ids));
 if(item){ok(await service.from('vihem_inventory_transactions').delete().eq('item_id',item));ok(await service.from('vihem_inventory_create_operations').delete().eq('operation_id',op));ok(await service.from('vihem_inventory_stock_items').delete().eq('id',item));}
 ok(await service.from('vihem_inventory_locations').delete().eq('id',loc));
 if(module.length)ok(await service.from('vihem_organisation_modules').upsert(module));else ok(await service.from('vihem_organisation_modules').delete().eq('organisation_id',c.org).eq('module_key','jour'));
 if(!registry.length)ok(await service.from('vihem_module_registry').delete().eq('module_key','jour'));
 for(const cl of Object.values(clients))await cl.auth.signOut({scope:'local'});
}
