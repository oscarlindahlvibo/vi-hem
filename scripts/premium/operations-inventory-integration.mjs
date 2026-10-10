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
  };
assert.equal(
  ok(
    await s.from("vihem_organisations").select("name").eq("id", c.org).single(),
  ).name,
  "VI-HEM Chat QA",
);
const ids = [],
  clients = {};
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
let template; const checks=[];
try {
 template=ok(await s.from('vihem_inventory_templates').insert({organisation_id:c.org,name:'Disposable atomic check QA',created_by:c.users.oscar.id}).select('*').single());
 const items=ok(await s.from('vihem_inventory_template_items').insert([{template_id:template.id,label:'ÅÄÖ dukar',desired_quantity:12,unit:'st',sort_order:0},{template_id:template.id,label:'Medel',desired_quantity:2,unit:'fl',sort_order:1}]).select('*'));
 const snapshot=items.sort((a,b)=>a.sort_order-b.sort_order||a.id.localeCompare(b.id)).map(({id,label,desired_quantity,unit})=>({id,label,desired_quantity,unit}));
 const counts=Object.fromEntries(items.map(i=>[i.id,i.desired_quantity-1]));
 const args={p_operation:randomUUID(),p_template:template.id,p_snapshot:snapshot,p_counts:counts};
 const rs=await Promise.all([clients.christofer.rpc('vihem_complete_inventory_check',args),clients.christofer.rpc('vihem_complete_inventory_check',args)]);
 const result=ok(rs[0]);checks.push(result.id); assert.equal(ok(rs[1]).id,result.id);assert.equal(result.items.length,2);assert.equal(result.items[0].shortage,1);
 assert.equal(ok(await s.from('vihem_inventory_checks').select('id').eq('template_id',template.id)).length,1);
 assert.ok((await clients.christofer.rpc('vihem_complete_inventory_check',{...args,p_counts:{}})).error,'changed replay');
 for(const who of ['tenant','outsider']) assert.ok((await clients[who].rpc('vihem_complete_inventory_check',{...args,p_operation:randomUUID()})).error,who+' denied');
 for(const bad of [{}, {[items[0].id]:-1,[items[1].id]:1}, {...counts,[items[0].id]:null}, {...counts,[randomUUID()]:1}]) assert.ok((await clients.oscar.rpc('vihem_complete_inventory_check',{...args,p_operation:randomUUID(),p_counts:bad})).error);
 ok(await s.from('vihem_inventory_template_items').update({desired_quantity:99}).eq('id',items[0].id));
 assert.ok((await clients.oscar.rpc('vihem_complete_inventory_check',{...args,p_operation:randomUUID()})).error,'stale template');
 assert.equal(ok(await s.from('vihem_inventory_checks').select('id').eq('template_id',template.id)).length,1,'failed operations left no partial check');
 assert.equal(ok(await clients.outsider.from('vihem_inventory_checks').select('id').eq('id',result.id)).length,0);
 console.log('PASS inventory check: explicit all counts, atomic rows, generated shortages, concurrent replay, stale template, malformed payload, tenant/foreign mutation isolation, failed operations create no partial check.');
} finally {
 if(template){ok(await s.from('vihem_inventory_check_operations').delete().in('check_id',checks));ok(await s.from('vihem_inventory_check_items').delete().in('check_id',checks));ok(await s.from('vihem_inventory_checks').delete().eq('template_id',template.id));ok(await s.from('vihem_inventory_template_items').delete().eq('template_id',template.id));ok(await s.from('vihem_inventory_templates').delete().eq('id',template.id));}
}
