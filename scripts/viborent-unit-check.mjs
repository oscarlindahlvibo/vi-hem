// Enhetstester för ViboRents serverlogik i TypeScript (igloohome-klient, tidsformat, kryptering, felmappning).
// Allt här kör mot en fejkad HTTP-klient / mock – inga riktiga igloohome-anrop. Se supabase/tests för SQL-tester.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(path.join(tmpdir(), 'viborent-unit-'));
const entry = path.join(dir, 'entry.ts');
const root = path.resolve('supabase/functions/_shared');
writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'igloohome.ts'))}; export * from ${JSON.stringify(path.join(root, 'rental-common.ts'))}; export * as stripe from ${JSON.stringify(path.join(root, 'rental-stripe.ts'))};`);
const out = path.join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
globalThis.Deno = { env: { get: (k) => ({ VIHEM_RENTAL_SECRET_KEY: 'unit-test-secret', STRIPE_RENTAL_WEBHOOK_SECRET: 'whsec_test', STRIPE_RENTAL_SECRET_KEY: 'sk_test_x' })[k] } };
const m = await import(pathToFileURL(out).href);

// --- Tidsformat (egen implementation av offset: kontrollerar både sommar- och vintertid) ---
assert.equal(m.formatWithOffset(new Date('2026-10-17T08:00:00Z'), 'Europe/Stockholm'), '2026-10-17T10:00:00+02:00');
assert.equal(m.formatWithOffset(new Date('2026-12-17T08:00:00Z'), 'Europe/Stockholm'), '2026-12-17T09:00:00+01:00');
assert.equal(m.formatWithOffset(new Date('2026-03-29T00:30:00Z'), 'Europe/Stockholm'), '2026-03-29T01:30:00+01:00');
assert.equal(m.formatWithOffset(new Date('2026-03-29T01:30:00Z'), 'Europe/Stockholm'), '2026-03-29T03:30:00+02:00'); // sommartidsbyte

// --- Val av kodtyp ---
const h = 3600_000, t0 = new Date('2026-10-17T10:20:00Z');
let plan = m.planPin(t0, new Date(t0.getTime() + 3 * h));
assert.equal(plan.type, 'hourly'); assert.equal(plan.start.toISOString(), '2026-10-17T10:00:00.000Z'); assert.equal(plan.end.toISOString(), '2026-10-17T14:00:00.000Z');
assert.equal(m.planPin(new Date('2026-10-17T10:00:00Z'), new Date(Date.parse('2026-10-17T10:00:00Z') + 672 * h)).type, 'hourly');
assert.equal(m.planPin(new Date('2026-10-17T10:00:00Z'), new Date(Date.parse('2026-10-17T10:00:00Z') + 29 * 24 * h)).type, 'daily');
assert.throws(() => m.planPin(new Date('2026-10-17T10:00:00Z'), new Date(Date.parse('2026-10-17T10:00:00Z') + 680 * h)), /29 dygn/);
assert.throws(() => m.planPin(new Date('2026-10-17T10:00:00Z'), new Date(Date.parse('2026-10-17T10:00:00Z') + 400 * 24 * h)), /367/);
assert.throws(() => m.planPin(new Date('2026-10-17T10:00:00Z'), new Date('2026-10-17T10:00:00Z')), /timme/);

// --- igloohome-klient mot fejkad fetch ---
const calls = [];
const fakeFetch = (handlers) => async (url, init = {}) => {
  calls.push({ url: String(url), init });
  const h = handlers.shift();
  return { ok: h.status < 400, status: h.status, json: async () => h.body };
};
let ig = new m.IgloohomeProvider('cid', 'csecret', fakeFetch([
  { status: 200, body: { access_token: 'tok', expires_in: 86400 } },
  { status: 200, body: { pin: '123456', pinId: 'p1' } },
  { status: 200, body: { pin: '654321', pinId: 'p2' } },
]));
let pin = await ig.createPin({ deviceId: 'D/1', start: new Date('2026-10-17T08:00:00Z'), end: new Date('2026-10-17T12:00:00Z'), accessName: 'Bokning VR-1', timezone: 'Europe/Stockholm' });
assert.deepEqual(pin, { pin: '123456', pinId: 'p1', pinType: 'hourly' });
assert.equal(calls[0].url, 'https://auth.igloohome.co/oauth2/token');
assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from('cid:csecret').toString('base64')}`);
assert.equal(calls[1].url, 'https://api.igloohome.co/home/devices/D%2F1/algopin/hourly');
assert.equal(calls[1].init.headers.Authorization, 'Bearer tok');
assert.deepEqual(JSON.parse(calls[1].init.body), { accessName: 'Bokning VR-1', startDate: '2026-10-17T10:00:00+02:00', endDate: '2026-10-17T14:00:00+02:00' });
await ig.createPin({ deviceId: 'D', start: new Date('2026-10-17T08:00:00Z'), end: new Date('2026-10-17T09:00:00Z'), accessName: 'x', timezone: 'Europe/Stockholm' });
assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1, 'token ska återanvändas');

for (const [status, expect, retry] of [[402, /provperiod/, false], [403, /behörighet/, false], [409, /tidszon/, false], [404, /hittades inte/, false], [500, /500/, true], [429, /429/, true]]) {
  ig = new m.IgloohomeProvider('c', 's', fakeFetch([{ status: 200, body: { access_token: 't' } }, { status, body: {} }]));
  await assert.rejects(() => ig.createPin({ deviceId: 'D', start: new Date('2026-10-17T08:00:00Z'), end: new Date('2026-10-17T09:00:00Z'), accessName: 'x', timezone: 'Europe/Stockholm' }),
    (e) => e instanceof m.LockProviderError && expect.test(e.message) && e.retryable === retry);
}
ig = new m.IgloohomeProvider('c', 's', fakeFetch([{ status: 401, body: {} }]));
await assert.rejects(() => ig.listDevices(), /avvisade/);

// --- Mock ---
const mock = new m.MockLockProvider();
const a = await mock.createPin({ deviceId: 'MOCK-LOCK-1', start: t0, end: new Date(t0.getTime() + 2 * h), accessName: 'x', timezone: 'Europe/Stockholm' });
assert.match(a.pin, /^\d{6}$/); assert.equal(a.pinType, 'mock');
mock.failNext = new m.LockProviderError('boom', 500, true);
await assert.rejects(() => mock.createPin({ deviceId: 'x', start: t0, end: new Date(t0.getTime() + h), accessName: 'x', timezone: 'Europe/Stockholm' }), /boom/);

// --- Kryptering ---
const cipher = await m.encryptSecret('482913', 'access-code:abc');
assert.ok(!cipher.includes('482913'));
assert.equal(await m.decryptSecret(cipher, 'access-code:abc'), '482913');
await assert.rejects(() => m.decryptSecret(cipher, 'access-code:other'), undefined, 'kontext måste matcha');
assert.notEqual(await m.encryptSecret('482913', 'access-code:abc'), cipher, 'slumpad IV ger olika chiffertext');

// --- Felmappning: bara kända koder släpps igenom ---
assert.deepEqual(m.mapDbError({ message: 'x [E_UNAVAILABLE] Produkten är inte längre tillgänglig.' }), { status: 409, code: 'E_UNAVAILABLE', message: 'Produkten är inte längre tillgänglig.' });
const hidden = m.mapDbError({ message: 'duplicate key value violates unique constraint "vihem_rental_bookings_pkey"' });
assert.equal(hidden.status, 500); assert.ok(!/duplicate|constraint/.test(hidden.message));
assert.equal(m.mapDbError({ message: '[E_INVENTED] något' }).status, 500);
assert.equal(m.maskPins('Din kod är 482913 ok'), 'Din kod är •••• ok');

// --- Stripe-signatur ---
import { createHmac } from 'node:crypto';
const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
const ts = Math.floor(Date.now() / 1000);
const sig = (secret, t = ts, body = payload) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
assert.equal(await m.stripe.verifySignature(payload, sig('whsec_test')), true);
assert.equal(await m.stripe.verifySignature(payload, sig('annan_hemlighet')), false);
assert.equal(await m.stripe.verifySignature(payload + ' ', sig('whsec_test')), false, 'ändrad body nekas');
assert.equal(await m.stripe.verifySignature(payload, sig('whsec_test', ts - 3600)), false, 'gammal tidsstämpel nekas');
assert.equal(await m.stripe.verifySignature(payload, null), false);
assert.equal(m.stripe.stripeConfigured(), true);

// --- Återbetalning: belopp begränsas till det som faktiskt betalats, fel markeras som failed ---
const updates = [];
const fakeAdmin = { from: () => ({ update: (u) => { updates.push(u); return { eq: async () => ({}) }; } }) };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => url.includes('payment_intents') ? { ok: true, json: async () => ({ amount_received: 47500 }) } : { ok: true, json: async () => ({ id: 're_1', _body: String(init.body) }) };
assert.equal(await m.stripe.issueRefund(fakeAdmin, 'b1', { refund_amount: 9999, payment_intent: 'pi_1' }), 'succeeded');
assert.deepEqual(updates.at(-1), { refund_status: 'succeeded', refund_amount: 475, payment_status: 'refunded' });
assert.equal(await m.stripe.issueRefund(fakeAdmin, 'b1', { refund_amount: 100, payment_intent: 'pi_1' }), 'succeeded');
assert.equal(updates.at(-1).payment_status, 'partially_refunded');
assert.equal(await m.stripe.issueRefund(fakeAdmin, 'b1', { refund_amount: 100, payment_intent: null }), 'failed');
assert.equal(updates.at(-1).refund_status, 'failed');
globalThis.fetch = realFetch;

console.log('ViboRent unit checks passed.');
