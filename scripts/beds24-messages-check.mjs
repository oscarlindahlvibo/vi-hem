import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../supabase/functions/_shared/beds24-messages.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { normalizeGuestMessage, fetchRoomMessages } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const unit = { id: 'local-unit', beds24_room_id: '707223', beds24_property_id: '342334' };
const message = { id: 123, bookingId: 456, roomId: 707223, propertyId: 342334, time: '2026-10-08T12:00:00Z', source: 'guest', message: '<script>untrusted</script>', read: false };
for (const source of ['guest', 'host', 'system', 'internalNote']) {
  const row = normalizeGuestMessage({ ...message, source }, unit, 'own-org');
  assert.equal(row.source, source); assert.equal(row.organisation_id, 'own-org');
  assert.equal(row.beds24_message_id, '123'); assert.equal(row.beds24_booking_id, '456');
  assert.equal(row.message, message.message); assert.equal(row.beds24_read, false);
}
assert.equal(normalizeGuestMessage({ ...message, roomId: 42 }, unit, 'own-org'), null);
assert.equal(normalizeGuestMessage({ ...message, propertyId: 42 }, unit, 'own-org'), null);
assert.equal(normalizeGuestMessage({ ...message, id: undefined }, unit, 'own-org'), null);
assert.throws(() => normalizeGuestMessage({ ...message, time: 'invalid' }, unit, 'own-org'), /tid/);
assert.throws(() => normalizeGuestMessage({ ...message, source: 'unknown' }, unit, 'own-org'), /Okänd/);
const attachment = normalizeGuestMessage({ ...message, attachment: 'SGVq', attachmentMimeType: 'application/pdf' }, unit, 'own-org');
assert.equal(attachment.attachment_name, 'bilaga'); assert.equal(attachment.attachment_base64, 'SGVq');
const received = [], requests = [];
await fetchRoomMessages('test-token', unit, async rows => received.push(...rows), async (url, options) => {
  const parsed = new URL(url); const page = Number(parsed.searchParams.get('page'));
  assert.equal(parsed.searchParams.get('roomId'), '707223'); assert.equal(parsed.searchParams.get('propertyId'), '342334');
  assert.equal(options.headers.token, 'test-token'); assert.equal(options.method, undefined, 'Import must never send messages or change read status');
  requests.push(page);
  return new Response(JSON.stringify({ data: page === 1 ? [message] : [{ ...message, id: 124 }], pages: { nextPageExists: page === 1 } }));
});
assert.deepEqual(requests, [1, 2]); assert.deepEqual(received.map(row => row.id), [123, 124]);
for (const status of [401, 403, 429, 500]) await assert.rejects(fetchRoomMessages('token', unit, async () => assert.fail(), async () => new Response('{}', { status })), status < 429 ? /bookings-personal/ : new RegExp(String(status)));
await assert.rejects(fetchRoomMessages('token', unit, async () => assert.fail(), async () => new Response('{}')), /oväntat/);
const handlerSource = await readFile(new URL('../supabase/functions/vihem-sync-beds24-messages/index.ts', import.meta.url), 'utf8');
const handlerCode = ts.transpileModule(handlerSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^import[^\n]*\n/gm, '').replace(/^export \{\};?$/gm, '');
let handler, role = 'admin', enabled = true;
const filters = [];
const db = {
  async rpc(name, params) { assert.equal(name, 'is_short_stay_enabled'); assert.equal(params.org_id, 'own-org'); return { data: enabled }; },
  from(table) {
    return {
      select() { return this; },
      eq(key, value) { filters.push([table, key, value]); return this; },
      neq() { return this; },
      async maybeSingle() { return { data: { value: { secret: 'scheduler-secret' } } }; },
      then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
    };
  },
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const errorJson = (code, message, status) => json({ error: { code, message } }, status);
new Function('createClient', 'authenticate', 'isAuthContext', 'json', 'errorJson', 'corsHeaders', 'fetchRoomMessages', 'normalizeGuestMessage', 'Deno', handlerCode)(
  () => db, async () => ({ callerId: 'user', callerProfile: { role, organisation_id: 'own-org' }, userClient: db }),
  value => 'callerId' in value, json, errorJson, {}, fetchRoomMessages, normalizeGuestMessage,
  { env: { get: () => 'test' }, serve: fn => { handler = fn; } },
);
const request = (headers, body = {}) => new Request('https://example.test', { method: 'POST', headers, body: JSON.stringify(body) });
assert.equal((await handler(request({}))).status, 401);
assert.equal((await handler(request({ 'x-vihem-sync-secret': 'wrong' }))).status, 401);
assert.equal((await handler(request({ 'x-vihem-sync-secret': 'scheduler-secret' }))).status, 200);
role = 'tenant'; assert.equal((await handler(request({ Authorization: 'Bearer test' }))).status, 403);
role = 'staff'; enabled = false; assert.equal((await handler(request({ Authorization: 'Bearer test' }))).status, 403);
enabled = true; filters.length = 0;
await handler(request({ Authorization: 'Bearer test' }, { organisation_id: 'other-org' }));
assert.ok(filters.some(([table, key, value]) => table === 'vihem_beds24_connections' && key === 'organisation_id' && value === 'own-org'));
assert.ok(!filters.some(([, , value]) => value === 'other-org'), 'The client must not be able to select another organisation');
console.log('PASS: organisation/room/property isolation, tenant rejection, scheduler authentication, disabled module, all message sources, attachments, timestamps, read-only pagination and upstream errors.');
