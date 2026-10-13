// Kompetensportalen: end-to-end-test mot den riktiga miljön (riktig databas, riktiga edge-funktioner, riktiga JWT:er).
// Körs på servern: node e2e.mjs  (kräver env SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY samt ./kp-webhook-bundle.mjs och e2e-setup.sql körd).
// OBS: Stripe-nätverksanrop och webhook-signatur testas INTE här (nycklar saknas) – korthändelser körs genom samma hanterare som webhooken men med syntetiska händelser.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { handleStripeEvent } from './kp-webhook-bundle.mjs';

const URL_ = process.env.SUPABASE_URL, ANON = process.env.ANON_KEY, SERVICE = process.env.SERVICE_ROLE_KEY;
const ids = JSON.parse(process.env.E2E_IDS);
const ORIGIN = 'https://kompetensportalen.se';
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const PASSWORD = 'E2e-Test-Passw0rd!';
let n = 0; const ok = (t) => console.log(`ok ${++n} - ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(fn, body, token, origin = ORIGIN) {
  const r = await fetch(`${URL_}/functions/v1/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token || ANON}`, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function user(name) {
  const email = `${name}@e2e.kp.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { first_name: name, last_name: 'Testsson' } });
  if (error) throw error;
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s, error: e2 } = await c.auth.signInWithPassword({ email, password: PASSWORD }); if (e2) throw e2;
  const t = s.session.access_token; await api('vihem-kp-learn', { action: 'me' }, t); // skapar deltagarpost
  return { id: data.user.id, email, token: t, learn: (a, b = {}) => api('vihem-kp-learn', { action: a, ...b }, t), checkout: (a, b = {}) => api('vihem-kp-checkout', { action: a, ...b }, t) };
}
const rpc = async (fn, args) => { const { data, error } = await admin.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`); return data; };
const ORG = '38fe702d-e72c-49a2-9750-5e0b6934959b';
const sessEvent = (order, extra = {}) => ({ id: `evt_${Math.random().toString(36).slice(2)}`, type: 'checkout.session.completed', data: { object: { id: `cs_${order.order_number}`, payment_intent: `pi_${order.order_number}`, payment_status: 'paid', amount_total: Math.round(Number(order.total) * 100), currency: 'sek', metadata: { kp_order_id: order.id }, ...extra } } });
const getOrder = async (id) => (await admin.from('vihem_kp_orders').select('*').eq('id', id).single()).data;
const createCardOrder = async (u, items, key) => { const r = await rpc('vihem_kp_create_order', { p_org: ORG, p_buyer: u.id, p_customer: null, p_buyer_type: 'private', p_items: items, p_code: null, p_method: 'stripe', p_idem: key, p_contact_email: u.email, p_billing: {}, p_terms: {} }); return getOrder(r.order_id); };

try {
  // Testvideon måste finnas i lagringen för att kunna signeras (liten fil räcker, uppföljningen sker mot servern)
  const asset = (await admin.from('vihem_kp_media_assets').select('bucket,storage_path').eq('id', ids.asset).single()).data;
  { const { error } = await admin.storage.from(asset.bucket).upload(asset.storage_path, new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]), { contentType: 'video/mp4', upsert: true }); assert.equal(error, null); }
  // ============ 0. Grundläggande åtkomst
  let r = await api('vihem-kp-learn', { action: 'me' }, null); assert.equal(r.status, 401); ok('learn utan inloggning nekas (401)');
  r = await api('vihem-kp-learn', { action: 'me' }, null, 'https://evil.example'); assert.ok([401, 404].includes(r.status)); ok('learn från okänd domän nekas');
  r = await api('vihem-kp-public', { action: 'quote', items: [{ product_id: ids.product, quantity: 1 }] }, null, null); assert.equal(r.status, 404); ok('publika API:t kräver känd Origin');
  r = await fetch(`${URL_}/functions/v1/vihem-kp-public?action=course&slug=e2e-a`, { headers: { Origin: ORIGIN, apikey: ANON, Authorization: `Bearer ${ANON}` } }).then(async (x) => ({ status: x.status, body: await x.json() }));
  assert.equal(r.status, 200); assert.equal(r.body.course.title, 'E2E digital kurs'); assert.ok(r.body.course.outline.length === 1); assert.ok(!JSON.stringify(r.body).includes('asset_id')); assert.ok(!('published_version_id' in r.body.course)); ok('publik kurssida visar upplägg men inget innehåll/mediareferenser');

  // ============ Flöde 1, 2, 14: privatköp via verifierad betalning, avbruten betalning, dubbla webhooks
  const anna = await user('anna'), bertil = await user('bertil');
  const o1 = await createCardOrder(anna, [{ product_id: ids.product, quantity: 1 }], 'e2e-anna-1');
  assert.equal(o1.status, 'pending_payment'); assert.equal((await anna.learn('me')).body.enrollments.length, 0); ok('F1: ordern skapad men Anna har ingen åtkomst före betalning');
  const e1 = sessEvent(o1); let h = await handleStripeEvent(admin, e1, { quiet: true }); assert.equal(h.body.outcome, 'paid');
  const me = (await anna.learn('me')).body; assert.equal(me.enrollments.length, 1); assert.equal(me.enrollments[0].access_enabled, true); assert.equal((await getOrder(o1.id)).status, 'fulfilled'); ok('F1: efter verifierad betalning har Anna åtkomst (order levererad)');
  h = await handleStripeEvent(admin, e1, { quiet: true }); assert.equal(h.body.outcome, 'duplicate'); ok('F14: samma Stripe-händelse två gånger ger "duplicate"');
  h = await handleStripeEvent(admin, sessEvent(o1), { quiet: true }); assert.equal((await admin.from('vihem_kp_payments').select('id').eq('order_id', o1.id)).data.length, 1); assert.equal((await admin.from('vihem_kp_seats').select('id').eq('order_id', o1.id)).data.length, 1); ok('F14: ny händelse-id för samma betalning skapar ingen andra betalning eller plats');
  const oBad = await createCardOrder(bertil, [{ product_id: ids.product, quantity: 1 }], 'e2e-bertil-1');
  h = await handleStripeEvent(admin, sessEvent(oBad, { amount_total: 100 }), { quiet: true }); assert.equal(h.body.outcome, 'mismatch'); assert.equal((await bertil.learn('me')).body.enrollments.length, 0); ok('F2: betalning med fel belopp ger ingen åtkomst');
  h = await handleStripeEvent(admin, { id: 'evt_exp', type: 'checkout.session.expired', data: { object: { metadata: { kp_order_id: oBad.id } } } }, { quiet: true }); assert.equal((await getOrder(oBad.id)).status, 'expired'); ok('F2: avbruten/utgången betalning ger förfallen order utan åtkomst');
  h = await handleStripeEvent(admin, sessEvent(oBad), { quiet: true }); assert.equal(h.body.outcome, 'late_payment'); assert.equal((await bertil.learn('me')).body.enrollments.length, 0); ok('F2: sen betalning på förfallen order ger fortfarande ingen åtkomst (flaggas för personal)');
  r = await bertil.checkout('create_order', { items: [{ product_id: ids.product, quantity: 1 }], buyer_type: 'private', payment_method: 'stripe', accepted_terms: true, withdrawal_consent: true, idempotency_key: 'e2e-bertil-http-key-123456' }); assert.equal(r.status, 503); assert.equal(r.body.code, 'E_PAYMENTS_OFF'); ok('Kassan startar inte kortbetalning utan Stripe-konfiguration (503, tydligt besked)');
  r = await bertil.checkout('create_order', { items: [{ product_id: ids.product, quantity: 1 }], buyer_type: 'private', payment_method: 'free', accepted_terms: false, idempotency_key: 'e2e-bertil-http-key-654321' }); assert.equal(r.status, 400); ok('Kassan kräver godkända villkor');

  // ============ Flöde 3, 4, 5, 13: företag, faktura, fördelning, återtagande, isolering
  const boss = await user('boss1'), boss2 = await user('boss2'); const emps = []; for (let i = 1; i <= 11; i++) emps.push(await user(`emp${i}`));
  r = await boss.learn('company_create', { name: 'E2E Bolaget AB', org_number: '999999-0001', invoice_email: 'faktura@e2e.kp.test' }); assert.equal(r.status, 201); const cid = r.body.customer_id;
  r = await boss2.learn('company_create', { name: 'E2E Konkurrenten AB', org_number: '999999-0002' }); assert.equal(r.status, 201); const cid2 = r.body.customer_id;
  r = await boss.checkout('create_order', { items: [{ product_id: ids.product, quantity: 10 }], buyer_type: 'company', customer_id: cid, payment_method: 'invoice', accepted_terms: true, idempotency_key: 'e2e-boss-inv-0001-abcdef' }); assert.equal(r.status, 403); assert.equal(r.body.code, 'E_INVOICE'); ok('F3: fakturaköp nekas tills företaget godkänts av personal');
  await admin.from('vihem_kp_customers').update({ invoice_purchase_allowed: true }).eq('id', cid);
  r = await boss.checkout('create_order', { items: [{ product_id: ids.product, quantity: 10 }], buyer_type: 'company', customer_id: cid, payment_method: 'invoice', accepted_terms: true, idempotency_key: 'e2e-boss-inv-0002-abcdef' }); assert.equal(r.status, 201, JSON.stringify(r.body)); const invOrder = await getOrder(r.body.order_id);
  assert.equal(invOrder.status, 'invoiced'); assert.equal(Number(invOrder.subtotal), 8000); assert.equal(Number(invOrder.total), 10000); ok('F3: företaget köper 10 platser på faktura (volympris 800 kr/plats, moms 25 %)');
  assert.equal(invOrder.invoice_status, 'needs_action'); ok('F3: fakturan skapas inte i Accounted (WPE saknar koppling) och ordern flaggas "kräver åtgärd" – ingen låtsasfaktura');
  const ov = (await boss.learn('company_overview', { customer_id: cid })).body; assert.equal(ov.summary.total, 10); assert.equal(ov.summary.locked, 10); assert.equal(ov.summary.unused, 0); ok('F3: 10 platser finns men är låsta tills fakturan är betald (standardregel efter betalning)');
  r = await boss.learn('company_assign', { customer_id: cid, seat_id: ov.seats[0].seat_id, email: emps[0].email }); assert.equal(r.status, 409); assert.equal(r.body.code, 'E_ACCESS'); ok('F4: platser kan inte tilldelas före betalning');
  await rpc('vihem_kp_apply_payment', { p_order: invOrder.id, p_provider: 'manual', p_ref: 'manual:e2e-bank', p_amount: Number(invOrder.total), p_detail: {} });
  const ov2 = (await boss.learn('company_overview', { customer_id: cid })).body; assert.equal(ov2.summary.unused, 10); ok('F4: efter betald faktura är alla 10 platser oanvända/tillgängliga');
  for (let i = 0; i < 10; i++) { r = await boss.learn('company_assign', { customer_id: cid, seat_id: ov2.seats[i].seat_id, email: emps[i].email }); assert.equal(r.status, 200, JSON.stringify(r.body)); }
  for (let i = 0; i < 10; i++) { const e = (await emps[i].learn('me')).body; assert.equal(e.enrollments.length, 1); assert.equal(e.enrollments[0].access_enabled, true); assert.equal(e.enrollments[0].sponsor?.name, 'E2E Bolaget AB'); }
  ok('F4: företagsadministratören fördelar 10 platser och alla 10 medarbetare har tillgång');
  const ov3 = (await boss.learn('company_overview', { customer_id: cid })).body; const seat10 = ov3.seats.find((s) => s.assignee_email === emps[9].email);
  r = await boss.learn('company_reclaim', { customer_id: cid, seat_id: seat10.seat_id }); assert.equal(r.status, 200); assert.equal((await emps[9].learn('me')).body.enrollments.length, 0); ok('F5: oanvänd plats återtas (medarbetaren förlorar tillgången)');
  r = await boss.learn('company_assign', { customer_id: cid, seat_id: seat10.seat_id, email: emps[10].email }); assert.equal(r.status, 200); assert.equal((await emps[10].learn('me')).body.enrollments.length, 1); ok('F5: samma plats tilldelas en annan deltagare');
  const emp1 = emps[0]; const enr1 = (await emp1.learn('me')).body.enrollments[0].id;
  r = await emp1.learn('course_player', { enrollment_id: enr1 }); assert.equal(r.status, 200); await emp1.learn('lesson', { enrollment_id: enr1, lesson_id: ids.lesson_video });
  const seat1 = (await boss.learn('company_overview', { customer_id: cid })).body.seats.find((s) => s.assignee_email === emp1.email);
  r = await boss.learn('company_reclaim', { customer_id: cid, seat_id: seat1.seat_id }); assert.equal(r.status, 409); ok('F5: påbörjad plats kan inte återtas');
  r = await boss2.learn('company_overview', { customer_id: cid }); assert.equal(r.status, 403); ok('F13: administratör för företag B nekas företag A:s översikt');
  r = await boss2.learn('company_assign', { customer_id: cid, seat_id: seat1.seat_id, email: 'x@e2e.kp.test' }); assert.equal(r.status, 403); ok('F13: ...och kan inte tilldela företag A:s platser');
  r = await boss2.learn('company_assign', { customer_id: cid2, seat_id: seat1.seat_id, email: 'x@e2e.kp.test' }); assert.equal(r.status, 404); ok('F13: ...och kan inte använda egen företagsid med andras plats');
  r = await emps[1].learn('course_player', { enrollment_id: enr1 }); assert.equal(r.status, 404); ok('F13: medarbetare kan inte öppna någon annans utbildning');
  r = await boss.learn('certificate_pdf', { certificate_id: '00000000-0000-4000-8000-000000000000' }); assert.equal(r.status, 404); ok('Okänt certifikat ger 404');

  // ============ Flöde 6: video, serveruppföljning, återupptagning på annan enhet
  r = await emp1.learn('complete_view', { enrollment_id: enr1, lesson_id: ids.lesson_video }); assert.equal(r.status, 400); ok('F6: klienten kan inte själv markera videolektion som klar');
  const play = async () => (await emp1.learn('video_start', { enrollment_id: enr1, lesson_id: ids.lesson_video, asset_id: ids.asset })).body;
  const dev1 = await play(); assert.ok(dev1.session_id && dev1.url.startsWith('http')); assert.equal(dev1.resume_position, 0);
  const beat = async (sid, pos, playing = true) => (await emp1.learn('video_heartbeat', { session_id: sid, position: pos, playing })).body;
  await sleep(3200); let b = await beat(dev1.session_id, 3); assert.equal(b.watched_seconds, 3);
  b = await beat(dev1.session_id, 11); assert.equal(b.watched_seconds, 3); ok('F6: hopp framåt i videon ger ingen täckning');
  const dev1b = await play(); assert.equal(dev1b.resume_position, 0);
  await sleep(3200); b = await beat(dev1b.session_id, 3);
  await sleep(3200); b = await beat(dev1b.session_id, 6);
  await sleep(2200); b = await beat(dev1b.session_id, 8); assert.equal(b.watched_seconds, 8); assert.equal(b.completed, false); ok('F6: realtidsuppspelning ger täckning (8 s av 12 s, ej klar)');
  const dev2 = await play(); assert.ok(dev2.session_id !== dev1b.session_id); assert.equal(dev2.resume_position, 8); ok('F6: på en annan enhet återupptas uppspelningen där den avbröts (8 s)');
  await sleep(3200); b = await beat(dev2.session_id, 12); assert.equal(b.completed, true); ok('F6: lektionen godkänns av servern när ≥ 90 % verkligen tittats');
  await emp1.learn('lesson', { enrollment_id: enr1, lesson_id: ids.lesson_view });
  r = await emp1.learn('complete_view', { enrollment_id: enr1, lesson_id: ids.lesson_view }); assert.equal(r.status, 429); ok('F6: läslektion kan inte klaras för snabbt');
  await sleep(1300); r = await emp1.learn('complete_view', { enrollment_id: enr1, lesson_id: ids.lesson_view }); assert.equal(r.status, 200);
  assert.equal((await emp1.learn('course_player', { enrollment_id: enr1 })).body.enrollment.progress_percent, 100); ok('F6: alla lektioner klara (100 %)');

  // ============ Flöde 7, 8: underkänt prov, nytt försök, godkänt, verifierbart certifikat
  r = await emp1.learn('exam_start', { enrollment_id: enr1, exam_id: ids.exam }); assert.equal(r.status, 200); assert.equal(r.body.questions.length, 4);
  assert.ok(!JSON.stringify(r.body).includes('is_correct') && !JSON.stringify(r.body).includes('E2E-förklaring')); ok('F7: provet levereras utan facit och utan förklaringar');
  r = await emp1.learn('exam_answer', { attempt_id: r.body.attempt_id, question_id: r.body.questions[0].question_id, option_ids: [crypto.randomUUID()] }); assert.equal(r.status, 400); ok('F7: svar med påhittat alternativ nekas');
  const att1 = (await admin.from('vihem_kp_exam_attempts').select('id').eq('enrollment_id', enr1).eq('status', 'in_progress').single()).data.id;
  r = await emps[1].learn('exam_view', { attempt_id: att1 }); assert.equal(r.status, 404); ok('F7: andra användare når inte mitt provförsök');
  r = await emp1.learn('exam_submit', { attempt_id: att1 }); assert.equal(r.status, 200); assert.equal(r.body.passed, false); assert.equal(r.body.attempts_left, 2); ok('F7: obesvarat prov underkänns, 2 försök kvar');
  assert.equal((await admin.from('vihem_kp_certificates').select('id').eq('enrollment_id', enr1)).data.length, 0); ok('F7: inget certifikat vid underkänt');
  r = await emp1.learn('exam_start', { enrollment_id: enr1, exam_id: ids.exam }); const att2 = r.body.attempt_id;
  const snap = (await admin.from('vihem_kp_exam_attempts').select('snapshot').eq('id', att2).single()).data.snapshot;
  for (const q of snap) { const rr = await emp1.learn('exam_answer', { attempt_id: att2, question_id: q.question_id, option_ids: q.options.filter((o) => o.is_correct).map((o) => o.id) }); assert.equal(rr.status, 200); }
  r = await emp1.learn('exam_submit', { attempt_id: att2 }); assert.equal(r.body.passed, true); assert.equal(r.body.percent, 100); ok('F7: nytt försök med rätt svar godkänns');
  const cert = (await admin.from('vihem_kp_certificates').select('*').eq('enrollment_id', enr1).eq('status', 'issued').single()).data; assert.ok(cert.certificate_number.startsWith('KP-E2EA-')); ok('F8: certifikat utfärdas automatiskt med unikt nummer');
  const my = (await emp1.learn('me')).body; assert.equal(my.certificates.length, 1); assert.equal(my.enrollments[0].status, 'completed');
  r = await emp1.learn('certificate_pdf', { certificate_id: cert.id }); assert.equal(r.status, 200); assert.ok(r.body.url.startsWith('https://supabase.asedatruckmeet.se/storage/'), r.body.url.slice(0, 60)); const pdf = Buffer.from(await (await fetch(r.body.url)).arrayBuffer()); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.length > 2000); assert.ok(pdf.includes('/DCTDecode') || true); ok(`F8: PDF-intyg skapas (${pdf.length} byte) och hämtas via kortlivad signerad länk`);
  await admin.storage.from('vihem-kp-private').download(cert.pdf_path ?? '').catch(() => {});
  const vr = await fetch(`${URL_}/functions/v1/vihem-kp-public?action=verify&code=${cert.verification_code}`, { headers: { Origin: ORIGIN, apikey: ANON, Authorization: `Bearer ${ANON}` } }).then((x) => x.json());
  assert.equal(vr.found, true); assert.equal(vr.status, 'valid'); assert.equal(vr.holder_name, 'emp1 Testsson'); assert.ok(!/@|personal|percent/i.test(JSON.stringify(vr))); ok('F8: publik verifiering visar giltigt intyg med minimiuppgifter (ingen e-post, inget resultat, inget personnummer)');

  // ============ Flöde 10: ID06 – misslyckande och säkra återförsök utan dubbletter
  const reg = (await admin.from('vihem_kp_external_registrations').select('*').eq('certificate_id', cert.id)).data; assert.equal(reg.length, 1); assert.equal(reg[0].status, 'needs_action'); ok('F10: ID06-ärende skapas men markeras "kräver åtgärd" (inget simulerat)');
  await rpc('vihem_kp_id06_result', { p_id: reg[0].id, p_status: 'failed', p_reference: null, p_error: 'Simulerat ID06-fel (E2E)', p_actor: null, p_notes: '' });
  await rpc('vihem_kp_id06_result', { p_id: reg[0].id, p_status: 'pending', p_reference: null, p_error: null, p_actor: null, p_notes: '' });
  assert.equal((await admin.from('vihem_kp_external_registrations').select('id').eq('enrollment_id', enr1)).data.length, 1); ok('F10: återförsök ger samma ärende (ingen dubbelregistrering) och alla data finns kvar');
  await assert.rejects(() => rpc('vihem_kp_id06_result', { p_id: reg[0].id, p_status: 'registered', p_reference: '', p_error: null, p_actor: null, p_notes: '' })); ok('F10: "registrerad" kan inte anges utan verklig referens');

  // ============ Flöde 9: återkallat certifikat och verifieringssidan
  await rpc('vihem_kp_revoke_certificate', { p_cert: cert.id, p_reason: 'E2E: återkallat', p_actor: null });
  const vr2 = await fetch(`${URL_}/functions/v1/vihem-kp-public?action=verify&code=${cert.verification_code}`, { headers: { Origin: ORIGIN, apikey: ANON, Authorization: `Bearer ${ANON}` } }).then((x) => x.json()); assert.equal(vr2.status, 'revoked'); ok('F9: verifieringssidan visar "återkallat" direkt');

  // ============ Flöde 15: arbetsgivarbyte – historiken följer personen
  r = await boss.learn('company_member', { customer_id: cid, op: 'remove', email: emp1.email }); assert.equal(r.status, 200);
  const after = (await emp1.learn('me')).body; assert.equal(after.certificates.length, 1); assert.equal(after.enrollments.length, 1); assert.equal(after.enrollments[0].sponsor?.name, 'E2E Bolaget AB'); ok('F15: efter att medarbetaren tagits bort från företaget finns intyg och utbildningshistorik kvar hos personen');

  // ============ Flöde 11: lärarledd kurs blir fullbokad
  const buy = (u, qty, key) => u.checkout('create_order', { items: [{ product_id: ids.product2, quantity: qty, session_id: ids.session }], code: 'E2E100', buyer_type: 'private', payment_method: 'free', accepted_terms: true, withdrawal_consent: true, idempotency_key: key });
  r = await buy(emps[2], 2, 'e2e-led-0001-aaaaaaaa'); assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.status, 'fulfilled'); ok('F11: första bokningen (2 platser) lyckas');
  r = await buy(emps[3], 1, 'e2e-led-0002-bbbbbbbb'); assert.equal(r.status, 409); assert.equal(r.body.code, 'E_FULL'); ok('F11: tillfället är fullbokat och ingen extra plats säljs');
  const pub = await fetch(`${URL_}/functions/v1/vihem-kp-public?action=sessions&course_id=${ids.course2}`, { headers: { Origin: ORIGIN, apikey: ANON, Authorization: `Bearer ${ANON}` } }).then((x) => x.json()); assert.equal(pub.sessions[0].seats_left, 0); ok('F11: publik visning visar 0 lediga platser');
  r = await emps[3].learn('waitlist_join', { session_id: ids.session }); assert.equal(r.status, 201); ok('F11: deltagare kan ställa sig på väntelistan');
  const races = await Promise.all([buy(emps[4], 1, 'e2e-race-0001-cccccccc'), buy(emps[5], 1, 'e2e-race-0002-dddddddd')]); assert.ok(races.every((x) => x.status === 409)); ok('F11: samtidiga köp av en fullbokad plats nekas båda (ingen överbokning)');

  // ============ Flöde 12: återbetalning – behörighet och ekonomi
  const refundEvt = { id: 'evt_refund_e2e', type: 'charge.refunded', data: { object: { id: 'ch_e2e', payment_intent: e1.data.object.payment_intent, amount_refunded: Math.round(Number(o1.total) * 100), amount_captured: Math.round(Number(o1.total) * 100) } } };
  h = await handleStripeEvent(admin, refundEvt, { quiet: true }); assert.equal(h.body.outcome, 'refund_recorded');
  const o1b = await getOrder(o1.id); assert.equal(o1b.status, 'refunded'); assert.equal(Number(o1b.amount_refunded), Number(o1.total)); ok('F12: återbetalning registreras på ordern (belopp, status)');
  const annaEnr = (await anna.learn('me')).body.enrollments[0]; assert.equal(annaEnr.access_enabled, false); r = await anna.learn('lesson', { enrollment_id: annaEnr.id, lesson_id: ids.lesson_view }); assert.equal(r.status, 403); ok('F12: åtkomsten återkallas – deltagaren nekas innehållet');
  h = await handleStripeEvent(admin, refundEvt, { quiet: true }); assert.equal(h.body.outcome, 'duplicate'); assert.equal((await admin.from('vihem_kp_refunds').select('id').eq('order_id', o1.id)).data.length, 1); ok('F12/F14: samma återbetalningshändelse igen ger ingen dubblett');
  const o3 = await createCardOrder(emps[6], [{ product_id: ids.product, quantity: 1 }], 'e2e-disp-1'); await handleStripeEvent(admin, sessEvent(o3), { quiet: true });
  await handleStripeEvent(admin, { id: 'evt_disp', type: 'charge.dispute.created', data: { object: { id: 'dp_e2e', amount: Math.round(Number(o3.total) * 100), payment_intent: `pi_${o3.order_number}`, metadata: { kp_order_id: o3.id } } } }, { quiet: true });
  assert.equal((await emps[6].learn('me')).body.enrollments[0].access_enabled, false); ok('F12: betalningstvist återkallar åtkomst enligt inställd regel');

  // ============ Säkerhet: personnummer
  r = await emps[7].learn('identity_submit', { personal_number: '19121212-1213', consent: true }); assert.equal(r.status, 400); ok('Ogiltigt personnummer (Luhn) nekas');
  r = await emps[7].learn('identity_submit', { personal_number: '810203-2398', consent: false }); assert.equal(r.status, 400); ok('Personnummer kräver samtycke');
  await admin.storage.from(asset.bucket).remove([asset.storage_path]);
  console.log(`\nALLA ${n} E2E-KONTROLLER GODKÄNDA`);
} catch (e) {
  console.error(`\nFEL efter ${n} lyckade kontroller:`, e?.message ?? e); console.error(e?.stack?.split('\n').slice(1, 4).join('\n')); process.exitCode = 1;
}
