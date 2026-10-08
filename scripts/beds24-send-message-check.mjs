import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../supabase/functions/_shared/beds24-send-message.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { sendGuestMessage, acceptsChannelMessages } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
for (const channel of ['booking', 'airbnb', 'expedia', 'agoda']) assert.equal(acceptsChannelMessages({ channel }), true);
for (const channel of [null, '', 'direct', 'airbnbical']) assert.equal(acceptsChannelMessages({ channel }), false);
let calls = 0;
const capture = async (url, options) => {
  calls++; assert.equal(options.method, 'POST'); assert.equal(options.headers.token, 'test-token');
  assert.deepEqual(JSON.parse(options.body), [{ bookingId: 456, message: 'Hej gästen!' }]);
  return new Response('[{"success":true}]', { status: 201 });
};
assert.equal(await sendGuestMessage('test-token', '456', 'Hej gästen!', capture), 'sent'); assert.equal(calls, 1);
for (const [status, body, expected] of [[403,'{}','failed'], [429,'{}','failed'], [500,'{}','pending'], [201,'[{"success":false,"new":{"id":99}}]','pending'], [201,'{}','pending'], [201,'bad json','pending']]) {
  let count = 0;
  assert.equal(await sendGuestMessage('token','456','text',async () => { count++; return new Response(body,{ status }); }),expected);
  assert.equal(count,1,'Uncertain messages must never be automatically retried');
}
assert.equal(await sendGuestMessage('token','456','text',async () => { throw new Error('Connection lost after send'); }), 'pending');
const handlerSource = await readFile(new URL('../supabase/functions/vihem-send-beds24-message/index.ts', import.meta.url), 'utf8');
const handlerCode = ts.transpileModule(handlerSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^import[^\n]*\n/gm, '').replace(/^export \{\};?$/gm, '');
let handler, role = 'staff', enabled = true, previous = null, room = '707223', property = '342334', posts = 0, inserts = 0;
const filters = [];
const db = {
  async rpc() { return { data: enabled }; },
  from(table) { return {
    select() { return this; }, eq(key,value) { filters.push([table,key,value]); return this; },
    async maybeSingle() { return { data: table.endsWith('_sends') ? previous : { id:'connection',access_token:'token',refresh_token:'refresh',access_token_expires_at:'2099-01-01' } }; },
    insert() { inserts++; return Promise.resolve({ error:null }); }, update() { return this; },
    then(resolve) { return Promise.resolve({ data:[{ id:'unit',beds24_room_id:'707223',beds24_property_id:'342334' }],error:null }).then(resolve); },
  }; },
};
const json = (body,status=200) => new Response(JSON.stringify(body),{ status });
new Function('authenticate','isAuthContext','json','errorJson','corsHeaders','sendGuestMessage','acceptsChannelMessages','normalizeGuestMessage','Deno','fetch',handlerCode)(
  async req => req.headers.has('Authorization') ? { callerId:'user',callerProfile:{ role,organisation_id:'own-org' },userClient:db,adminClient:db } : json({},401),
  value => 'callerId' in value,json,(code,message,status)=>json({error:{code,message}},status),{},
  async () => { posts++; return 'sent'; },acceptsChannelMessages,()=>null,{serve: fn=>{handler=fn;}},
  async url => json(url.includes('/bookings/messages') ? {data:[]} : {data:[{id:456,roomId:room,propertyId:property,channel:'booking'}]}),
);
const body={bookingId:'456',requestId:'43c39532-4aa1-4cbd-9a07-8fa5b9e7a40c',message:'Hej',organisation_id:'other-org'};
const request=(value=body,auth=true)=>new Request('https://test.invalid',{method:'POST',headers:auth?{Authorization:'Bearer test'}:{},body:JSON.stringify(value)});
assert.equal((await handler(request(body,false))).status,401);
role='tenant'; assert.equal((await handler(request())).status,403);
role='staff'; enabled=false; assert.equal((await handler(request())).status,403); enabled=true;
assert.equal((await handler(request({...body,message:' '}))).status,400);
property='wrong-property'; assert.equal((await handler(request())).status,403); assert.equal(posts,0); property='342334';
assert.equal((await handler(request({bookingId:'456',action:'context'}))).status,200); assert.equal(posts,0);
assert.equal((await handler(request())).status,200); assert.equal(posts,1); assert.equal(inserts,1);
previous={organisation_id:'own-org',sender_id:'user',beds24_booking_id:'456',message:'Hej',status:'sent'};
assert.equal((await (await handler(request())).json()).status,'sent'); assert.equal(posts,1,'Same request must not send twice');
previous.organisation_id='other-org'; assert.equal((await handler(request())).status,409); assert.equal(posts,1);
assert.ok(!filters.some(([,key,value])=>key==='organisation_id'&&value==='other-org'));
console.log('PASS: manual text sending, channel limits, auth/role/module/org/property isolation, idempotent retries, timeout/partial-success safety. No real guests contacted.');
