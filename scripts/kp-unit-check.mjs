// Enhetstester för Kompetensportalens serverlogik i TypeScript (personnummer, kryptering, Stripe-signatur, certifikat-PDF, URL-omskrivning).
// Kör utan nätverk och utan riktiga nycklar. Databaslogik testas i supabase/tests/kompetensportalen.test.sql och scripts/kp/run-e2e.sh.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

mkdirSync('node_modules/.cache', { recursive: true });
const dir = mkdtempSync(path.join(path.resolve('node_modules/.cache'), 'kp-unit-'));
const root = path.resolve('supabase/functions/_shared');
const entry = path.join(dir, 'entry.ts');
writeFileSync(entry, ['kp-common', 'kp-certificate-pdf', 'kp-lesson', 'kp-id06-logo', 'kp-brand-logo', 'kp-receipt-pdf'].map((f) => `export * from ${JSON.stringify(path.join(root, f + '.ts'))};`).join('\n') + `export * as stripe from ${JSON.stringify(path.join(root, 'kp-stripe.ts'))};`);
const out = path.join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', external: ['npm:*', 'jsr:*'], plugins: [{ name: 'npm-specifiers', setup(b) { b.onResolve({ filter: /^npm:/ }, (a) => ({ path: a.path.replace(/^npm:/, '').replace(/@[\d.^~]+$/, ''), external: true })); b.onResolve({ filter: /^jsr:/ }, () => ({ path: 'node:module', external: true })); } }] });
const env = { VIHEM_KP_SECRET_KEY: 'unit-test-secret', STRIPE_KP_WEBHOOK_SECRET: 'whsec_unit', KP_PUBLIC_API_URL: 'https://api.example.test/' };
globalThis.Deno = { env: { get: (k) => env[k] } };
const m = await import(pathToFileURL(out).href);
let n = 0; const ok = (name) => console.log(`ok ${++n} - ${name}`);

// Personnummer: Luhn, 10/12 siffror, samordningsnummer, ogiltiga datum
assert.equal(m.normalisePersonalNumber('811218-9876'), '198112189876'); ok('giltigt 10-siffrigt personnummer normaliseras till 12 siffror');
assert.equal(m.normalisePersonalNumber('19811218-9876'), '198112189876'); ok('giltigt 12-siffrigt personnummer');
assert.equal(m.normalisePersonalNumber('811218-9877'), null); ok('fel kontrollsiffra avvisas');
assert.equal(m.normalisePersonalNumber('123'), null); ok('för kort avvisas');
assert.equal(m.normalisePersonalNumber('abc'), null); ok('icke-siffror avvisas');
assert.equal(m.normalisePersonalNumber('19811318-9876'), null); ok('månad 13 avvisas');

// Kryptering: rundtur, kontextbindning (AAD), unik IV, manipulation upptäcks, saknad nyckel stoppar
const c1 = await m.encryptPii('198112189876', 'participant:1'); const c2 = await m.encryptPii('198112189876', 'participant:1');
assert.notEqual(c1, c2); ok('samma klartext ger olika chiffertext (slumpad IV)');
assert.equal(await m.decryptPii(c1, 'participant:1'), '198112189876'); ok('dekryptering ger tillbaka klartexten');
assert.ok(!c1.includes('1981')); ok('chiffertexten innehåller inte klartexten');
await assert.rejects(() => m.decryptPii(c1, 'participant:2')); ok('chiffertext kan inte flyttas till annan post (kontextbindning)');
const raw = Buffer.from(c1, 'base64'); raw[raw.length - 1] ^= 1;
await assert.rejects(() => m.decryptPii(raw.toString('base64'), 'participant:1')); ok('manipulerad chiffertext avvisas');
const saved = env.VIHEM_KP_SECRET_KEY; delete env.VIHEM_KP_SECRET_KEY;
await assert.rejects(() => m.encryptPii('x', 'c'), /E_CONFIG/); ok('utan serverns nyckel sparas inget'); env.VIHEM_KP_SECRET_KEY = saved;

// Stripe-signatur
const body = '{"id":"evt_1","type":"checkout.session.completed"}'; const t = Math.floor(Date.now() / 1000);
const sig = (ts, b, s = 'whsec_unit') => `t=${ts},v1=${createHmac('sha256', s).update(`${ts}.${b}`).digest('hex')}`;
assert.equal(await m.stripe.verifySignature(body, sig(t, body)), true); ok('korrekt Stripe-signatur godkänns');
assert.equal(await m.stripe.verifySignature(body + ' ', sig(t, body)), false); ok('ändrad body avvisas');
assert.equal(await m.stripe.verifySignature(body, sig(t, body, 'annan')), false); ok('fel hemlighet avvisas');
assert.equal(await m.stripe.verifySignature(body, sig(t - 4000, body)), false); ok('gammal tidsstämpel (replay) avvisas');
assert.equal(await m.stripe.verifySignature(body, null), false); ok('saknad header avvisas');
assert.equal(await m.stripe.verifySignature(body, `t=${t},v1=${'0'.repeat(64)},v1=${createHmac('sha256', 'whsec_unit').update(`${t}.${body}`).digest('hex')}`), true); ok('flera v1-signaturer (nyckelrotation) stöds');

// Signerade lagrings-URL:er får publik origin
assert.equal(m.publicize('http://kong:8000/storage/v1/object/sign/x?token=abc'), 'https://api.example.test/storage/v1/object/sign/x?token=abc'); ok('intern kong-URL skrivs om till publik');
assert.equal(m.publicize(null), null); ok('publicize(null) ger null');

// Certifikat-PDF
const pdf = await m.renderCertificatePdf({ title: 'Utbildningsintyg', bodyText: 'har genomfört och godkänts i', footerText: 'WPE Sweden AB', accent: '#2e5b7a', signerName: 'Anna Åberg', signerTitle: 'Utbildningsansvarig', holderName: 'Åsa Öman', courseTitle: 'Arbete på väg', courseCode: 'APV', certificateNumber: 'KP-2026-000001', verificationUrl: 'https://kompetensportalen.se/verifiera?kod=ABC', issuerName: 'WPE Sweden AB', completedOn: '2026-10-12', validUntil: '2029-10-12', issuedAt: '2026-10-12', resultText: '92 %', kind: 'training_certificate', footerLogos: [m.KP_LOGO_JPEG, m.ID06_LOGO_JPEG] });
const file = path.join(dir, 'cert.pdf'); writeFileSync(file, pdf); if (process.env.KP_KEEP_PDF) writeFileSync(process.env.KP_KEEP_PDF, pdf);
assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), '%PDF-'); ok('PDF har giltig header');
try { const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' }); assert.match(info, /Pages:\s+1/); assert.match(info, /Page size:\s+842 x 595 pts \(A4\)/); ok('pdfinfo: en sida A4 liggande'); } catch (e) { if (e.code === 'ENOENT') console.log('skip - pdfinfo saknas'); else throw e; }

// Kvitto-PDF (A4 stående)
const rpdf = m.renderReceiptPdf({ kind: 'receipt', receiptNumber: 'KV-2026-000001', issuedAt: '13 oktober 2026', orderNumber: 'KP-26-000042', currency: 'SEK', seller: { name: 'WPE Sweden AB', org_number: '559000-0000', vat_number: 'SE559000000001', address: 'Ekängsvägen 2, 577 71 Virserum', email: 'kontakt@kompetensportalen.se', phone: '010-214 61 51' }, buyerName: 'Åsa Öman', buyerEmail: 'asa@example.se', billingAddress: 'Storgatan 1, 111 22 Stockholm', lines: [{ description: 'APV 1.1–1.3 Arbete på väg (grundkompetens)', quantity: 1, unit_price: 990, net_total: 990, vat_rate: 25, vat_amount: 247.5, line_total: 1237.5 }], netTotal: 990, vatTotal: 247.5, total: 1237.5, paymentMethod: 'stripe', paymentReference: 'pi_3Abc', logoJpeg: m.KP_LOGO_JPEG });
const rfile = path.join(dir, 'receipt.pdf'); writeFileSync(rfile, rpdf); if (process.env.KP_KEEP_RECEIPT) writeFileSync(process.env.KP_KEEP_RECEIPT, rpdf);
assert.equal(Buffer.from(rpdf.slice(0, 5)).toString(), '%PDF-'); ok('kvitto-PDF har giltig header');
try { const info = execFileSync('pdfinfo', [rfile], { encoding: 'utf8' }); assert.match(info, /Pages:\s+1/); assert.match(info, /595 x 842 pts \(A4\)/); ok('pdfinfo: kvitto är en sida A4 stående'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
console.log(`\nALLA ${n} ENHETSKONTROLLER GODKÄNDA`);
rmSync(dir, { recursive: true, force: true });
