import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createClient} from '@supabase/supabase-js';
const c=JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG,'utf8')),url=c.url||'http://127.0.0.1:18880';assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const service=createClient(url,c.service,{auth:{persistSession:false}}),staff=createClient(url,c.anon,{auth:{persistSession:false}}),outsider=createClient(url,c.anon,{auth:{persistSession:false}});
assert.equal((await staff.auth.signInWithPassword({email:c.users.christofer.email,password:c.user_password})).error,null);assert.equal((await outsider.auth.signInWithPassword({email:c.users.outsider.email,password:c.user_password})).error,null);
assert.equal((await staff.from('vihem_organisations').select('name').eq('id',c.org).single()).data.name,'VI-HEM Chat QA');
assert.equal((await service.from('vihem_time_entries').select('id').eq('user_id',c.users.christofer.id).is('end_time',null)).data.length,0,'never test over an existing open clock');
for(const key of ['general','work_order'])assert.equal((await service.from('vihem_time_categories').upsert({organisation_id:c.org,key,label:'QA '+key,active:true},{onConflict:'organisation_id,key'})).error,null);
const wo=(await staff.from('vihem_work_orders').select('id').eq('organisation_id',c.org).limit(1).single()).data.id;
const foreign=(await service.from('vihem_work_orders').select('id').eq('organisation_id',c.other_org).limit(1).single()).data.id;
const day=new Date(Date.now()-50*60000).toLocaleDateString('sv-SE',{timeZone:'Europe/Stockholm'});
const beforeSummary=await service.from('vihem_daily_work_summaries').select('*').eq('user_id',c.users.christofer.id).eq('work_date',day).maybeSingle();assert.equal(beforeSummary.error,null);
const operations=[],base=Date.now()-3*3600000;let current=null;
const args=(action,minute,job={},comment='')=>{const id=randomUUID();operations.push(id);return{p_id:id,p_action:action,p_expected:current,p_event:new Date(base+minute*60000).toISOString(),p_job:job,p_comment:comment,p_timezone:'Europe/Stockholm'};};
async function perform(action,minute,job={},comment=''){const a=args(action,minute,job,comment);const r=await staff.rpc('vihem_clock_transition',a);assert.equal(r.error,null);current=r.data.current?.id||null;return{a,r};}
try {
 const start=args('clockin',0,{category:'general'},'Start QA');const double=await Promise.all([staff.rpc('vihem_clock_transition',start),staff.rpc('vihem_clock_transition',start)]);for(const r of double)assert.equal(r.error,null);assert.equal(double[0].data.current.id,double[1].data.current.id);current=double[0].data.current.id;
 assert.ok((await staff.rpc('vihem_clock_transition',{...start,p_comment:'Changed identity'})).error);
 assert.ok((await outsider.rpc('vihem_clock_transition',start)).error);
 assert.ok((await staff.from('vihem_clock_operations').update({result:{current:null}}).eq('id',start.p_id)).error);
 const bad=args('switch',30,{category:'work_order',work_order_id:foreign},'Closed first work');assert.ok((await staff.rpc('vihem_clock_transition',bad)).error);assert.equal((await staff.from('vihem_time_entries').select('end_time').eq('id',current).single()).data.end_time,null,'invalid target rolls back close');
 const a=args('switch',30,{category:'work_order',work_order_id:wo},'Closed first work'),b=args('switch',30,{category:'work_order',work_order_id:wo},'Other device');
 const race=await Promise.all([staff.rpc('vihem_clock_transition',a),staff.rpc('vihem_clock_transition',b)]);assert.equal(race.filter(r=>!r.error).length,1);assert.equal(race.filter(r=>r.error?.code==='23505').length,1);current=race.find(r=>!r.error).data.current.id;const workBeforePause=current;
 await perform('break',50);await perform('resume',60);await perform('lunch',85);await perform('resume',115);
 const last=current;const out=await perform('clockout',130,{},'Avslutande QA-kommentar');assert.equal((await staff.rpc('vihem_clock_transition',out.a)).error,null);
 const rows=await staff.from('vihem_time_entries').select('id,entry_type,comment,total_minutes,start_time,end_time,status').in('id',operations);assert.equal(rows.error,null);assert.equal(rows.data.length,6);assert.ok(rows.data.every(row=>row.end_time&&row.status==='approved'));assert.equal(rows.data.reduce((n,row)=>n+row.total_minutes,0),130);assert.equal(rows.data.filter(row=>row.entry_type==='work').reduce((n,row)=>n+row.total_minutes,0),90);
 assert.equal(rows.data.find(row=>row.id===last).comment,'Avslutande QA-kommentar');assert.equal(rows.data.find(row=>row.id===workBeforePause).comment,'','comment not copied to unrelated earlier job');
 assert.equal((await staff.from('vihem_clock_operations').select('event_at,received_at').eq('id',start.p_id).single()).data.event_at,new Date(base).toISOString().replace('.000Z','+00:00').replace('Z','+00:00'));
 const status=await staff.rpc('vihem_clock_operation_status',{p_id:out.a.p_id,p_org:c.org});assert.equal(status.error,null);assert.equal(status.data.operation,out.a.p_id);
 assert.ok((await outsider.rpc('vihem_clock_operation_status',{p_id:out.a.p_id,p_org:c.org})).error);
 const summary=await staff.from('vihem_daily_work_summaries').select('comment').eq('user_id',c.users.christofer.id).eq('work_date',day).single();assert.equal(summary.error,null);assert.equal(summary.data.comment.split('Avslutande QA-kommentar').length-1,1,'retry does not repeat day comment');
 const cp=await staff.from('vihem_customer_projects').select('id').eq('organisation_id',c.org).limit(1).single();assert.equal(cp.error,null);
 await perform('clockin',135,{category:'customer_project',customer_project_id:cp.data.id,project_billing_scope:'outside_quote'},'QA ÄTA');
 await perform('break',140);const resumed=await perform('resume',145);assert.equal(resumed.r.data.current.project_billing_scope,'outside_quote');assert.equal(resumed.r.data.current.customer_project_id,cp.data.id);
 await perform('clockout',150,{},'QA ÄTA avklarad');
 console.log('PASS project pause/resume keeps billing scope; status reconciliation and day comment idempotency.');
 console.log('PASS clock QA: double request, immutable ID, cross-user/target denial, no partial close, competing devices, break/lunch/resume/out, totals, comment isolation, delayed event time.');
} finally {
 if(beforeSummary.data) assert.equal((await service.from('vihem_daily_work_summaries').update({comment:beforeSummary.data.comment}).eq('id',beforeSummary.data.id)).error,null);
 else assert.equal((await service.from('vihem_daily_work_summaries').delete().eq('user_id',c.users.christofer.id).eq('work_date',day)).error,null);
 // Only the explicitly recorded synthetic operation IDs are disposable; never touch existing shifts.
 assert.equal((await service.from('vihem_clock_operations').delete().in('id',operations)).error,null);
 assert.equal((await service.from('vihem_time_entries').delete().in('id',operations)).error,null);
 assert.equal((await service.from('vihem_time_entries').select('id').eq('user_id',c.users.christofer.id).is('end_time',null)).data.length,0,'no QA clock left open');
}
