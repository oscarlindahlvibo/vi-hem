import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const c = JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG, "utf8")),
  url = c.url || "http://127.0.0.1:18880";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const s = createClient(url, c.service, { auth: { persistSession: false } }),
  ok = (r) => {
    assert.equal(r.error, null);
    return r.data;
  },
  clients = {};
assert.equal(
  ok(
    await s.from("vihem_organisations").select("name").eq("id", c.org).single(),
  ).name,
  "VI-HEM Chat QA",
);
for (const who of ["oscar", "christofer", "tenant", "outsider"]) {
  const cl = createClient(url, c.anon, { auth: { persistSession: false } });
  ok(
    await cl.auth.signInWithPassword({
      email: c.users[who].email,
      password: c.user_password,
    }),
  );
  clients[who] = cl;
}
let routine; const instances=[];
try {
 routine=ok(await s.from('vihem_routines').insert({organisation_id:c.org,title:'Disposable routine QA',created_by:c.users.oscar.id}).select('*').single());
 const v=ok(await s.from('vihem_routine_versions').insert({routine_id:routine.id,version_number:1,body:'Svenska ÅÄÖ'}).select('*').single());
 ok(await s.from('vihem_routines').update({current_version_id:v.id}).eq('id',routine.id));
 ok(await s.from('vihem_routine_checklist_templates').insert([{routine_version_id:v.id,label:'Kontrollera dörren',required:true,requires_photo:true,sort_order:0},{routine_version_id:v.id,label:'Dokumentera',required:false,requires_photo:false,sort_order:1}]));
 const args={p_operation:randomUUID(),p_version:v.id};
 const rs=await Promise.all([clients.christofer.rpc('vihem_start_routine_checklist',args),clients.christofer.rpc('vihem_start_routine_checklist',args)]);
 const id=ok(rs[0]);instances.push(id);assert.equal(ok(rs[1]),id);
 const rows=ok(await s.from('vihem_checklist_instance_items').select('*').eq('instance_id',id).order('sort_order'));assert.equal(rows.length,2);assert.equal(rows[0].required,true);assert.equal(rows[0].requires_photo,true);
 for(const who of ['tenant','outsider'])assert.ok((await clients[who].rpc('vihem_start_routine_checklist',{...args,p_operation:randomUUID()})).error);
 assert.equal(ok(await clients.outsider.from('vihem_checklist_instances').select('id').eq('id',id)).length,0);
 const v2=ok(await s.from('vihem_routine_versions').insert({routine_id:routine.id,version_number:2}).select('*').single());
 ok(await s.from('vihem_routines').update({current_version_id:v2.id}).eq('id',routine.id));
 assert.ok((await clients.christofer.rpc('vihem_start_routine_checklist',{...args,p_operation:randomUUID()})).error,'stale version');
 assert.equal(ok(await clients.christofer.rpc('vihem_start_routine_checklist',args)),id,'confirmed old operation remains replayable');
 assert.ok((await clients.christofer.rpc('vihem_start_routine_checklist',{...args,p_version:v2.id})).error,'changed replay');
 assert.ok((await clients.oscar.rpc('vihem_start_routine_checklist',{p_operation:randomUUID(),p_version:v2.id})).error,'empty checklist');
 assert.equal(ok(await s.from('vihem_checklist_instances').select('id').eq('source_routine_version_id',v.id)).length,1);
 console.log('PASS routine checklist: concurrent idempotency, complete template copy including photo/required, stale version, empty template, changed replay, tenant/foreign mutation denial and foreign read denial.');
} finally {
 if(routine){if(instances.length){ok(await s.from('vihem_routine_checklist_operations').delete().in('instance_id',instances));ok(await s.from('vihem_checklist_instance_items').delete().in('instance_id',instances));ok(await s.from('vihem_checklist_instances').delete().in('id',instances));}ok(await s.from('vihem_routines').update({current_version_id:null}).eq('id',routine.id));ok(await s.from('vihem_routine_versions').delete().eq('routine_id',routine.id));ok(await s.from('vihem_routines').delete().eq('id',routine.id));}
}
