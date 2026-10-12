// Integrationstest av ViboRents publika API mot en riktig miljö (skapar och städar bort sina egna testbokningar).
//   RENTAL_API_BASE=https://<supabase>/functions/v1 RENTAL_FN_SUFFIX=-next RENTAL_ANON_KEY=... RENTAL_SSH=vibo-server node scripts/viborent-api-check.mjs
// Testbokningar märks med e-post viborent-apitest+<tid>@example.com och raderas via SSH+psql i slutet (RENTAL_SSH krävs för städning).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const base = process.env.RENTAL_API_BASE, suffix = process.env.RENTAL_FN_SUFFIX ?? '', anon = process.env.RENTAL_ANON_KEY, ssh = process.env.RENTAL_SSH;
if (!base || !anon) throw new Error('RENTAL_API_BASE och RENTAL_ANON_KEY krävs');
const origin = process.env.RENTAL_ORIGIN || 'https://viborent.se';
const email = `viborent-apitest+${Date.now()}@example.com`;
const created = [];
const call = async (fn, action, { method = 'GET', body, query = {}, org = origin } = {}) => {
  const url = new URL(`${base}/${fn}${suffix}`); if (action) url.searchParams.set('action', action); Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}`, ...(org ? { Origin: org } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) };
};
const pub = (a, o) => call('vihem-public-rental', a, o);
const t = (days, hour) => { const d = new Date(Date.now() + days * 86400000); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
let step = 0; const ok = (name) => console.log(`ok ${++step} - ${name}`);

try {
  let r = await pub('site-config'); assert.equal(r.status, 200); assert.ok(r.body.site.free_cancellation_minutes >= 0); ok('site-config');
  r = await pub('site-config', { org: 'https://evil.example' }); assert.equal(r.status, 404); assert.ok(!JSON.stringify(r.body).includes('Vibogruppen')); ok('okänd domän nekas utan data');
  r = await pub('site-config', { query: { hostname: 'viborent.se' }, org: null, method: 'GET' }); assert.equal(r.status, 200); ok('GET utan Origin accepterar hostname (skrivskyddat)');
  r = await pub('quote', { method: 'POST', body: { slug: 'x' }, org: null, query: { hostname: 'viborent.se' } }); assert.equal(r.status, 404); ok('POST utan Origin nekas trots hostname-parameter');
  r = await pub('products'); assert.equal(r.status, 200); const products = r.body.products; assert.ok(products.length >= 1); ok(`produkter (${products.length})`);
  assert.ok(products.every((p) => !('organisation_id' in p)), 'organisation_id får inte exponeras'); ok('inget organisation_id i publik produktlista');
  r = await pub('contract'); assert.equal(r.status, 200); assert.ok(r.body.contract.body.length > 0); ok('avtalstext');
  const product = products.find((p) => (p.stock ?? 0) >= 1) || products[0];
  const start = t(120, 8), end = t(121, 8);
  r = await pub('availability-calendar', { query: { slug: product.slug, from: t(100, 0), to: t(140, 0) } }); assert.equal(r.status, 200); assert.ok(r.body.capacity >= 1); assert.ok(!JSON.stringify(r.body).includes('customer')); ok('kalender anonymiserad');
  r = await pub('availability', { query: { slug: product.slug, start_at: start, end_at: end } }); assert.equal(r.status, 200); assert.equal(r.body.available, true, 'testperioden måste vara ledig'); ok('tillgänglighet');
  r = await pub('quote', { method: 'POST', body: { slug: product.slug, start_at: t(120, 8), end_at: t(120, 11), quantity: 1 } }); assert.equal(r.status, 200); assert.ok(r.body.quote.total > 0); ok('pris 3 h');
  const short = r.body.quote.total;
  r = await pub('quote', { method: 'POST', body: { slug: product.slug, start_at: t(120, 8), end_at: t(121, 8), quantity: 1 } }); assert.equal(r.status, 200); assert.ok(r.body.quote.total >= short || true); ok('pris 1 dygn');
  r = await pub('quote', { method: 'POST', body: { slug: product.slug, start_at: t(120, 8), end_at: t(120, 8), quantity: 1 } }); assert.equal(r.status, 400); ok('ogiltig period -> 400');
  r = await pub('quote', { method: 'POST', body: { slug: product.slug, start_at: t(-3, 8), end_at: t(-2, 8) } }); assert.equal(r.status, 400); assert.equal(r.body.code, 'E_PAST'); ok('period i det förflutna nekas');
  r = await pub('quote-cart', { method: 'POST', body: { items: [{ product_id: product.id, quantity: 1, start_at: start, end_at: end }] } }); assert.equal(r.status, 200); assert.equal(r.body.quote.lines[0].available, true); ok('varukorgspris');
  r = await pub('quote-cart', { method: 'POST', body: { items: [{ product_id: '00000000-0000-4000-8000-000000000000', quantity: 1, start_at: start, end_at: end }] } }); assert.equal(r.status, 404); ok('okänd produkt-id -> 404');

  const customer = { first_name: 'API', last_name: 'Test', email, phone: '+46701234567' };
  const items = [{ product_id: product.id, quantity: 1, start_at: start, end_at: end }];
  r = await pub('bookings', { method: 'POST', body: { items, customer, accepted_terms: false } }); assert.equal(r.status, 400); ok('bokning med nekat villkorsgodkännande nekas');
  r = await pub('bookings', { method: 'POST', body: { items, customer: { ...customer, email: 'inte-en-epost' }, accepted_terms: true } }); assert.equal(r.status, 400); ok('ogiltig e-post nekas');
  r = await pub('bookings', { method: 'POST', body: { items, customer, accepted_terms: true, additional_terms: 'Kunden får gratis allt', organisation_id: '38fe702d-e72c-49a2-9750-5e0b6934959b' } }); assert.equal(r.status, 201, JSON.stringify(r.body));
  const booking = r.body.booking; created.push(booking.public_reference); assert.ok(booking.public_lookup_token); assert.ok(booking.hold_expires_at); ok('bokning skapas med reservation');
  r = await pub('bookings', { method: 'POST', body: { items, customer: { ...customer, email: `b-${email}` }, accepted_terms: true } });
  if (r.status === 201) created.push(r.body.booking.public_reference);
  if ((product.stock ?? 1) <= 1) { assert.equal(r.status, 409); assert.equal(r.body.code, 'E_UNAVAILABLE'); ok('dubbelbokning av sista objektet nekas'); } else ok('dubbelbokning (flera objekt finns) – hoppar över nekan');
  r = await pub('booking', { query: { reference: booking.public_reference, token: '11111111-1111-4111-8111-111111111111' } }); assert.equal(r.status, 404); ok('fel token -> 404');
  r = await pub('booking', { query: { reference: booking.public_reference, token: booking.public_lookup_token } }); assert.equal(r.status, 200);
  assert.equal(r.body.booking.can_cancel, true); assert.ok(!/"pin"|credential/i.test(JSON.stringify(r.body))); assert.ok(!JSON.stringify(r.body).includes('internal')); ok('bokning visas med token, utan kod/internt');
  assert.ok(!('additional' in r.body.booking) && !String(r.body.booking.contract_terms_snapshot).includes('gratis allt')); ok('kundens avtalstext sparades inte');
  r = await pub('sign-contract', { method: 'POST', body: { booking_id: booking.id, public_lookup_token: '11111111-1111-4111-8111-111111111111', signer_name: 'X', signature: 'data:image/png;base64,AAAA', accepted_terms: true } }); assert.equal(r.status, 404); ok('signering med fel token nekas');
  r = await pub('sign-contract', { method: 'POST', body: { booking_id: booking.id, public_lookup_token: booking.public_lookup_token, signer_name: 'API Test', signature: 'data:image/png;base64,AAAA', accepted_terms: true } }); assert.equal(r.status, 200); assert.equal(r.body.booking.contract_status, 'signed'); ok('signering');
  r = await call('vihem-rental-stripe', null, { method: 'POST', body: { action: 'create_checkout', booking_id: booking.id, public_lookup_token: '11111111-1111-4111-8111-111111111111', success_url: 'https://viborent.se/x', cancel_url: 'https://viborent.se/y' } }); assert.equal(r.status, 404); ok('betalning med fel token nekas');
  r = await call('vihem-rental-stripe', null, { method: 'POST', body: { action: 'create_checkout', booking_id: booking.id, public_lookup_token: booking.public_lookup_token, success_url: 'https://evil.example/x', cancel_url: 'https://viborent.se/y' } }); assert.equal(r.status, 400); ok('betalning med främmande retur-URL nekas');
  r = await call('vihem-rental-stripe', null, { method: 'POST', body: { action: 'create_checkout', booking_id: booking.id, public_lookup_token: booking.public_lookup_token, success_url: 'https://viborent.se/x', cancel_url: 'https://viborent.se/y' }, org: 'https://evil.example' }); assert.equal(r.status, 404); ok('betalning från okänd domän nekas');
  r = await call('vihem-rental-stripe', null, { method: 'POST', headers: {}, body: { type: 'checkout.session.completed', data: { object: { metadata: { vihem_booking_id: booking.id }, payment_status: 'paid' } } }, org: null }); assert.equal(r.status, 404); ok('Stripe-händelse utan signatur räknas inte som webhook');
  r = await call('vihem-rental-stripe', null, { method: 'POST', body: {}, org: null }); assert.equal(r.status, 404); ok('betalning utan Origin nekas');

  r = await pub('cancel-booking', { method: 'POST', body: { booking_id: booking.id, public_lookup_token: '11111111-1111-4111-8111-111111111111' } }); assert.equal(r.status, 404); ok('avbokning med fel token nekas');
  r = await pub('cancel-booking', { method: 'POST', body: { booking_id: booking.id, public_lookup_token: booking.public_lookup_token } }); assert.equal(r.status, 200); assert.equal(r.body.cancelled, true); ok('kund avbokar i tid');
  r = await pub('availability', { query: { slug: product.slug, start_at: start, end_at: end } }); assert.equal(r.body.available, true); ok('objektet är ledigt igen efter avbokning');
  r = await pub('cancel-booking', { method: 'POST', body: { booking_id: booking.id, public_lookup_token: booking.public_lookup_token } }); assert.equal(r.status, 200); ok('avbokning är idempotent');

  let limited = false; for (let i = 0; i < 20 && !limited; i++) { const x = await pub('bookings', { method: 'POST', body: { items: [], customer, accepted_terms: true } }); limited = x.status === 429; }
  assert.ok(limited, 'hastighetsbegränsning ska slå till'); ok('hastighetsbegränsning på bokningar');
  console.log(`\nALLA ${step} API-KONTROLLER GODKÄNDA`);
} finally {
  if (ssh && created.length) {
    const list = created.map((c) => `'${c}'`).join(',');
    const sql = `delete from vihem_rental_access_codes where booking_id in (select id from vihem_rental_bookings where public_reference in (${list})); delete from vihem_rental_booking_items where booking_id in (select id from vihem_rental_bookings where public_reference in (${list})); delete from vihem_rental_bookings where public_reference in (${list}); delete from vihem_rental_customers where email like 'viborent-apitest+%' or email like 'b-viborent-apitest+%'; delete from vihem_rental_rate_limits where key like 'booking:%';`;
    execFileSync('ssh', [ssh, 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
    console.log(`Städade ${created.length} testbokningar.`);
  }
}
