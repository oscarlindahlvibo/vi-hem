import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
const c = JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG, 'utf8'));
const url = c.url || 'http://127.0.0.1:18880';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const clients = {};
for (const who of ['oscar', 'christofer']) {
 const client = createClient(url, c.anon, {auth:{persistSession:false}});
 const r = await client.auth.signInWithPassword({email:c.users[who].email,password:c.user_password});
 assert.equal(r.error,null); await client.realtime.setAuth(r.data.session.access_token); clients[who]=client;
}
assert.equal((await clients.oscar.from('vihem_organisations').select('name').eq('id',c.org).single()).data?.name,'VI-HEM Chat QA');
async function rpc(who,name,args){const r=await clients[who].rpc(name,args);assert.equal(r.error,null);return r.data;}
const thread=await rpc('oscar','vihem_chat_create',{kind:'group',title:'Realtime rejoin diagnostic QA',recipients:[c.users.christofer.id]});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[];
for(let cycle=0;cycle<12;cycle++){
 const start=Date.now(),events=[],seen=new Set();let readyAt=null,joinedAt=null;
 clients.christofer.realtime.connect();
 const channel=clients.christofer.channel('qa-diagnostic-'+cycle).on('system',{},p=>{
  events.push({ms:Date.now()-start,extension:p.extension,status:p.status});
  if(p.extension==='postgres_changes'&&p.status==='ok')readyAt=Date.now();
 }).on('postgres_changes',{event:'INSERT',schema:'public',table:'vihem_chat_messages',filter:'thread_id=eq.'+thread},p=>seen.add(p.new.id));
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('subscribe timeout')),15000);channel.subscribe(status=>{events.push({ms:Date.now()-start,status});if(status==='SUBSCRIBED'){joinedAt=Date.now();clearTimeout(timer);resolve();}});});
 const immediate=crypto.randomUUID();await rpc('oscar','vihem_chat_send',{thread,client_id:immediate,body:'At socket join QA'});
 for(let i=0;i<300&&!readyAt;i++)await sleep(100);
 assert.ok(readyAt,'CDC ready');
 // Application catches history at both SUBSCRIBED and CDC-ready boundaries.
 assert.ok((await rpc('christofer','vihem_chat_history',{thread})).some(m=>m.id===immediate));
 const after=crypto.randomUUID();await rpc('oscar','vihem_chat_send',{thread,client_id:after,body:'After CDC ready QA'});
 for(let i=0;i<100&&!seen.has(after);i++)await sleep(50);
 assert.ok(seen.has(after),'live event after CDC ready');
 const row={cycle,joinMs:joinedAt-start,cdcMs:readyAt-start,immediateEvent:seen.has(immediate),readyEvent:seen.has(after),events};results.push(row);console.log(JSON.stringify(row));
 await clients.christofer.removeChannel(channel);await sleep(250);
}
fs.mkdirSync('work',{recursive:true});fs.writeFileSync('work/realtime-rejoin-results.json',JSON.stringify(results,null,2));
for(const client of Object.values(clients))await client.removeAllChannels();
console.log('PASS: 12 rejoin cycles, CDC-ready events and authenticated catch-up.');
