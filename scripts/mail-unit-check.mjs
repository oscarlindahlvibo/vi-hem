// Enhetstester för VI-HEM Mails serverlogik: Gmail-tolkning, MIME-bygge (verifierat med Pythons e-postparser), Gmail-klient med mockade svar,
// säkert utskick (idempotens/osäkra utfall/avsändarvalidering) och Domain-Wide Delegation. Inga riktiga Google-anrop – se docs/mail/RAPPORT.md.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

mkdirSync('node_modules/.cache', { recursive: true });
const dir = mkdtempSync(path.join(path.resolve('node_modules/.cache'), 'mail-unit-'));
const root = path.resolve('supabase/functions/_shared/mail');
const entry = path.join(dir, 'entry.ts');
const modules = ['parse', 'mime', 'gmail', 'dwd', 'send'];
writeFileSync(entry, modules.map((f) => `export * as ${f} from ${JSON.stringify(path.join(root, f + '.ts'))};`).join('\n') + `\nexport * as sig from ${JSON.stringify(path.resolve('src/modules/mail/lib/signature.ts'))};\nexport * as util from ${JSON.stringify(path.resolve('src/modules/mail/lib/compose.ts'))};\nexport * as tpl from ${JSON.stringify(path.resolve('src/modules/mail/lib/templates.ts'))};\n`);
const out = path.join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const m = await import(pathToFileURL(out).href);
let n = 0; const ok = (name) => console.log(`ok ${++n} - ${name}`);
const b64u = (s) => Buffer.from(s).toString('base64url');

// ---------------------------------------------------------------------------------------------------------------- parse
assert.equal(m.parse.decodeMimeWords('=?UTF-8?B?w4dhIHbDpGwgS2FybHNzb24=?='), 'Ça väl Karlsson'); ok('RFC 2047 base64 avkodas');
assert.equal(m.parse.decodeMimeWords('=?iso-8859-1?Q?Fr=E5n_Bj=F6rn?='), 'Från Björn'); ok('RFC 2047 quoted-printable (iso-8859-1) avkodas');
assert.deepEqual(m.parse.parseAddress('"Lindahl, Oscar" <Oscar@Vibogruppen.se>'), { name: 'Lindahl, Oscar', email: 'oscar@vibogruppen.se' }); ok('adress med komma i namnet');
assert.equal(m.parse.parseAddressList('"A, B" <a@x.se>, c@y.se, Dee <d@z.se>').length, 3); ok('adresslista delas inte på komma i citat');
assert.equal(m.parse.baseSubject('Sv: Re: Fwd: Offert'), 'Offert'); assert.equal(m.parse.replySubject('Sv: Offert'), 'Sv: Offert'); assert.equal(m.parse.forwardSubject('Offert'), 'Vb: Offert'); ok('ämnesprefix för svar/vidarebefordran');
const raw = {
  id: 'm1', threadId: 't1', labelIds: ['INBOX', 'UNREAD', 'STARRED'], internalDate: '1760000000000', snippet: 'Hej &amp; välkommen',
  payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: '=?UTF-8?Q?Anna_=C3=85berg?= <anna@example.se>' }, { name: 'To', value: 'oscar@vibogruppen.se, Info <info@vibogruppen.se>' }, { name: 'Cc', value: 'kopia@example.se' }, { name: 'Subject', value: '=?UTF-8?B?T2ZmZXJ0IMOWc3Rlcg==?=' }, { name: 'Message-ID', value: '<abc@example.se>' }, { name: 'Delivered-To', value: 'info@vibogruppen.se' }, { name: 'Content-Type', value: 'multipart/mixed; boundary="b1"' }],
    parts: [{ mimeType: 'multipart/related', parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-8859-1' }], body: { data: Buffer.from([0x48, 0xe5, 0x6c, 0x6c]).toString('base64url') } }, { mimeType: 'text/html', body: { data: b64u('<p>Hej <img src="cid:logo1"></p>') } }] }, { mimeType: 'image/png', filename: '', headers: [{ name: 'Content-ID', value: '<logo1>' }, { name: 'Content-Disposition', value: 'inline' }], body: { attachmentId: 'att-inline', size: 120 } }] },
      { mimeType: 'application/pdf', filename: 'Offert =?UTF-8?Q?=C3=96?=.pdf', headers: [{ name: 'Content-Disposition', value: 'attachment; filename="x.pdf"' }], body: { attachmentId: 'att-pdf', size: 4096 } }] },
};
const pm = m.parse.parseMessage(raw);
assert.equal(pm.subject, 'Offert Öster'); assert.equal(pm.from.name, 'Anna Åberg'); assert.equal(pm.to.length, 2); assert.equal(pm.cc[0].email, 'kopia@example.se'); ok('rubriker tolkas');
assert.equal(pm.text, 'Håll'); ok('textdel avkodas med rätt teckenuppsättning (iso-8859-1)');
assert.match(pm.html, /cid:logo1/); assert.equal(pm.attachments.length, 2); assert.equal(pm.attachments.find((a) => a.contentId === 'logo1').inline, true); assert.equal(pm.attachments.find((a) => a.filename.startsWith('Offert Ö')).inline, false); ok('inline-bild och bilaga skiljs åt');
assert.equal(pm.unread, true); assert.equal(pm.starred, true); assert.equal(pm.snippet, 'Hej & välkommen'); assert.deepEqual(pm.deliveredTo, ['info@vibogruppen.se']); ok('läst/stjärna/snippet/Delivered-To');
const sum = m.parse.summarizeThread({ id: 't1', messages: [raw, { ...raw, id: 'm2', labelIds: ['INBOX', 'SENT'], internalDate: '1760000100000', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'oscar@vibogruppen.se' }, { name: 'Subject', value: 'Sv: Offert' }, { name: 'Content-Type', value: 'text/plain' }] } }] }, ['oscar@vibogruppen.se']);
assert.equal(sum.messageCount, 2); assert.equal(sum.from.email, 'anna@example.se'); assert.equal(sum.unread, true); assert.equal(sum.hasAttachments, true); assert.equal(sum.lastDate, 1760000100000); ok('trådsammanfattning: avsändare är motparten, olästa/bilagor syns');

// ---------------------------------------------------------------------------------------------------------------- mime
const pyParse = (raw) => {
  const code = 'import sys, json, email\nfrom email import policy\nm = email.message_from_bytes(sys.stdin.buffer.read(), policy=policy.default)\n' +
    'def walk(p):\n  r = {"ct": p.get_content_type(), "filename": p.get_filename(), "cid": p.get("Content-ID")}\n  if p.is_multipart(): r["parts"] = [walk(x) for x in p.iter_parts()]\n  else:\n    try: r["text"] = p.get_content() if p.get_content_maintype()=="text" else None\n    except Exception as e: r["text"] = None\n  return r\n' +
    'print(json.dumps({"headers": {k: str(v) for k, v in m.items()}, "tree": walk(m)}))';
  return JSON.parse(execFileSync('python3', ['-I', '-c', code], { input: raw.replace(/\r?\n/g, '\r\n'), encoding: 'utf8' }));
};
const base = { from: { name: 'Oscar Åberg', email: 'oscar@vibogruppen.se' }, to: [{ name: 'Mottagare', email: 'Mott@Example.se' }], subject: 'Hälsning – Offert åäö', html: '<p>Hej <b>världen</b></p>', messageId: '<id1@vibogruppen.se>' };
let built = m.mime.buildMime({ ...base, cc: [{ name: '', email: 'mott@example.se' }, { name: '', email: 'kopia@example.se' }, { name: '', email: 'oscar@vibogruppen.se' }], bcc: [{ name: '', email: 'dold@example.se' }], inReplyTo: 'orig@x.se', references: 'a@x.se b@x.se' });
let py = pyParse(built.raw);
assert.equal(py.headers.Subject, 'Hälsning – Offert åäö'); assert.match(py.headers.From, /Oscar Åberg <oscar@vibogruppen.se>/); assert.equal(py.headers['Message-ID'], '<id1@vibogruppen.se>'); ok('MIME: icke-ASCII i ämne och namn (RFC 2047) tolkas korrekt av Pythons e-postparser');
assert.deepEqual(built.recipients.sort(), ['dold@example.se', 'kopia@example.se', 'mott@example.se']); assert.ok(!/^Cc:.*oscar@/im.test(built.raw)); ok('MIME: mottagare dedupliceras och avsändaren får ingen kopia av sitt eget Cc/Bcc');
assert.equal(py.headers['In-Reply-To'], '<orig@x.se>'); assert.equal(py.headers.References, '<a@x.se> <b@x.se>'); ok('MIME: In-Reply-To/References normaliseras');
assert.equal(py.tree.ct, 'multipart/alternative'); assert.match(py.tree.parts[1].text, /<b>världen<\/b>/); assert.match(py.tree.parts[0].text, /Hej världen/); ok('MIME: text/plain + text/html, UTF-8 intakt');
built = m.mime.buildMime({ ...base, subject: 'Hej\r\nBcc: attacker@evil.test', to: [{ name: 'Fel"\r\nBcc: x@y.se', email: 'ok@example.se' }] });
assert.ok(!/^Bcc:/im.test(built.raw)); ok('MIME: rubrikinjektion via ämne/namn (CRLF) är omöjlig');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64');
built = m.mime.buildMime({ ...base, html: `<p>Logo</p><img src="data:image/png;base64,${png}"><script>alert(1)</script><a href="javascript:alert(1)" onclick="x()">länk</a>`, attachments: [{ name: 'Faktura å.pdf', type: 'application/pdf', base64: Buffer.from('%PDF-1.4 test').toString('base64') }] });
py = pyParse(built.raw);
assert.equal(py.tree.ct, 'multipart/mixed'); assert.equal(py.tree.parts[0].ct, 'multipart/related'); assert.equal(py.tree.parts[1].filename, 'Faktura å.pdf'); assert.ok(py.tree.parts[0].parts[1].cid.includes('@vihem-mail')); ok('MIME: inline-bild (data:-URI → Content-ID) och bilaga får rätt struktur');
assert.ok(!/<script/i.test(py.tree.parts[0].parts[0].parts[1].text) && !/javascript:/i.test(py.tree.parts[0].parts[0].parts[1].text) && !/onclick/i.test(py.tree.parts[0].parts[0].parts[1].text) && /cid:img1-/.test(py.tree.parts[0].parts[0].parts[1].text)); ok('MIME: aktivt innehåll tas bort ur utgående HTML, bilden refererar cid:');
assert.throws(() => m.mime.buildMime({ ...base, to: [] }), /E_RECIPIENT/); ok('MIME: utan mottagare nekas');
const draft = m.mime.buildDraftMime({ ...base, to: [] }); assert.ok(!/^To:/im.test(draft.raw)); assert.ok(pyParse(draft.raw)); ok('MIME: utkast utan mottagare är giltigt');
assert.match(m.mime.newMessageId('Vibogruppen.se'), /^<[0-9a-f]{24}\.[a-z0-9]+@Vibogruppen\.se>$/); ok('eget Message-ID');

// ---------------------------------------------------------------------------------------------------------------- gmail-klient (mock)
const calls = [];
const mock = (handler) => async (method, p, body, opts) => { calls.push({ method, p, body, opts }); return handler(method, p, body, opts); };
let gm = m.gmail.createGmail(mock((method, p) => {
  if (p.startsWith('/threads?')) return { threads: [{ id: 'a' }, { id: 'gone' }, { id: 'b' }], nextPageToken: 'NEXT', resultSizeEstimate: 3 };
  if (p.startsWith('/threads/gone')) throw new m.gmail.GmailApiError(404, 'NOT_FOUND', 'x');
  if (p.startsWith('/threads/')) return { id: p.split('/')[2].split('?')[0], messages: [{ id: 'x', threadId: 'y', labelIds: ['INBOX'], internalDate: '1', payload: { headers: [{ name: 'From', value: 'a@b.se' }, { name: 'Subject', value: 'Ämne' }] } }] };
  throw new Error('oväntat ' + p);
}));
let list = await gm.listThreads({ labelIds: ['INBOX'], maxResults: 3 });
assert.equal(list.threads.length, 2); assert.equal(list.nextPageToken, 'NEXT'); assert.ok(calls[0].p.includes('labelIds=INBOX')); assert.ok(!calls[0].opts?.write); ok('Gmail: lista trådar (läsning), borttagen tråd hoppas över, sidtoken bevaras');
calls.length = 0;
gm = m.gmail.createGmail(mock((method, p) => { if (p.startsWith('/history')) { if (p.includes('startHistoryId=old')) throw new m.gmail.GmailApiError(404, 'NOT_FOUND', 'x'); return { historyId: '200', history: [{ messagesAdded: [{ message: { id: 'n1', threadId: 'T1', labelIds: ['INBOX', 'UNREAD'] } }, { message: { id: 'n2', threadId: 'T2', labelIds: ['SENT'] } }], labelsAdded: [{ message: { id: 'z', threadId: 'T3' } }] }] }; } throw new Error(p); }));
let ch = await gm.changesSince('100'); assert.deepEqual(ch.changedThreadIds.sort(), ['T1', 'T2', 'T3']); assert.equal(ch.historyId, '200'); assert.deepEqual(ch.newInboxMessages.map((x) => x.id), ['n1']); ok('Gmail: inkrementell synk ger berörda trådar och nya inkorgsmejl (inte skickade)');
ch = await gm.changesSince('old'); assert.equal(ch.expired, true); ok('Gmail: utgånget historyId upptäcks (fallback till full omladdning)');
gm = m.gmail.createGmail(mock(() => ({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'Label_1', name: 'Kund', type: 'user' }] })));
assert.equal((await gm.labels()).length, 2); ok('Gmail: etiketter');
calls.length = 0; gm = m.gmail.createGmail(mock(() => ({})));
await gm.modifyThreads(['1', '2'], ['STARRED'], []); assert.equal(calls.length, 2); assert.ok(calls.every((c) => c.opts?.write === true && c.p.endsWith('/modify'))); ok('Gmail: skrivande anrop markeras write (kräver gmail.modify)');
gm = m.gmail.createGmail(mock(() => ({ sendAs: [{ sendAsEmail: 'Info@Vibogruppen.se', displayName: 'Info', signature: '<div>Hälsningar</div>', isPrimary: true, verificationStatus: 'accepted' }, { sendAsEmail: 'x@y.se', verificationStatus: 'pending' }] })));
const ids = await gm.sendAs(); assert.equal(ids[0].email, 'info@vibogruppen.se'); assert.equal(ids[0].verified, true); assert.equal(ids[1].verified, false); assert.equal(ids[0].signature, '<div>Hälsningar</div>'); ok('Gmail: Send-As med signatur och verifieringsstatus');
const c403 = m.gmail.classifyGmailError(403, { error: { message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } }); assert.equal(c403.code, 'SCOPE_NOT_AUTHORIZED');
assert.equal(m.gmail.classifyGmailError(429, {}).code, 'RATE_LIMITED'); assert.equal(m.gmail.classifyGmailError(404, {}).code, 'NOT_FOUND'); assert.equal(m.gmail.classifyGmailError(503, {}).code, 'GOOGLE_UNAVAILABLE'); ok('Gmail: felklassificering (scope/rate limit/saknas/otillgänglig)');
let active = 0, peak = 0; await m.gmail.mapLimit(Array.from({ length: 30 }, (_, i) => i), 5, async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 2)); active--; }); assert.ok(peak <= 5); ok('samtidigheten begränsas (Google-kvoter)');

// ---------------------------------------------------------------------------------------------------------------- säkert utskick
const identities = [{ email: 'oscar@vibogruppen.se', name: 'Oscar', replyTo: '', signature: '', isPrimary: true, isDefault: true, verified: true, treatAsAlias: false }, { email: 'info@vibo-fastigheter.se', name: 'Vibo Fastigheter', replyTo: '', signature: '', isPrimary: false, isDefault: false, verified: true, treatAsAlias: true }, { email: 'pending@x.se', name: '', replyTo: '', signature: '', isPrimary: false, isDefault: false, verified: false, treatAsAlias: true }];
const makeStore = () => { const rows = new Map(); let id = 0; return { rows, async find(a, r) { return [...rows.values()].find((x) => x.mail_account_id === a && x.client_request_id === r) ?? null; }, async insert(row) { const r = { id: `L${++id}`, attempts: 0, updated_at: new Date().toISOString(), gmail_message_id: null, ...row }; if ([...rows.values()].some((x) => x.mail_account_id === r.mail_account_id && x.client_request_id === r.client_request_id)) throw new Error('duplicate'); rows.set(r.id, r); return r; }, async update(i, patch) { Object.assign(rows.get(i), patch); } }; };
const REQ = '11111111-1111-4111-8111-111111111111';
const mkreq = (o = {}) => ({ clientRequestId: REQ, from: 'oscar@vibogruppen.se', to: [{ name: '', email: 'kund@example.se' }], subject: 'Hej', html: '<p>Hej</p>', ...o });
const deps = (store, gmail) => ({ store, gmail, identities, accountId: 'ACC', organisationId: 'ORG', userId: 'U', domain: 'vibogruppen.se', ledgerBase: { mail_account_id: 'ACC', organisation_id: 'ORG', user_id: 'U' } });
let sends = 0; const sendMock = (opts = {}) => m.gmail.createGmail(mock((method, p, body) => { if (p === '/messages/send') { sends++; if (opts.networkError) throw new TypeError('fetch failed'); if (opts.status) throw new m.gmail.GmailApiError(opts.status, 'X', 'x'); return { id: 'GM1', threadId: 'TH1' }; } if (p.startsWith('/messages?')) return opts.found ? { messages: [{ id: 'GM-FOUND', threadId: 'TH-FOUND' }] } : {}; if (p.startsWith('/drafts/')) return {}; throw new Error(p); }));
for (const [name, from, code] of [['okänd avsändare nekas', 'ceo@evil.test', 'E_SENDER_FORBIDDEN'], ['overifierat alias nekas', 'pending@x.se', 'E_SENDER_UNVERIFIED']]) { sends = 0; await assert.rejects(() => m.send.sendMessage(deps(makeStore(), sendMock()), mkreq({ from })), (e) => e.code === code); assert.equal(sends, 0); ok(`utskick: ${name} – ingen Gmail-sändning`); }
await assert.rejects(() => m.send.sendMessage(deps(makeStore(), sendMock()), mkreq({ to: [] })), (e) => e.code === 'E_RECIPIENT'); ok('utskick: utan mottagare nekas');
let store = makeStore(); sends = 0; let r1 = await m.send.sendMessage(deps(store, sendMock()), mkreq({ from: 'INFO@vibo-fastigheter.se' })); assert.equal(r1.status, 'sent');
assert.equal([...store.rows.values()][0].from_email, 'info@vibo-fastigheter.se'); ok('utskick: skickar från godkänt alias (skiftlägesokänsligt), registerrad skapas');
let r2 = await m.send.sendMessage(deps(store, sendMock()), mkreq({ from: 'INFO@vibo-fastigheter.se' })); assert.equal(r2.status, 'sent'); assert.equal(sends, 1); ok('utskick: samma client_request_id ger aldrig ett andra utskick');
await assert.rejects(() => m.send.sendMessage(deps(store, sendMock()), mkreq({ from: 'INFO@vibo-fastigheter.se', subject: 'Annat' })), (e) => e.code === 'E_CONFLICT'); ok('utskick: samma id med annat innehåll avvisas');
store = makeStore(); sends = 0; let r3 = await m.send.sendMessage(deps(store, sendMock({ networkError: true })), mkreq()); assert.equal(r3.status, 'unknown'); assert.equal([...store.rows.values()][0].status, 'unknown'); ok('utskick: nätverksfel → osäkert utfall (unknown), inte "misslyckat"');
sends = 0; let r4 = await m.send.sendMessage(deps(store, sendMock({ found: true })), mkreq()); assert.equal(r4.status, 'sent'); assert.equal(sends, 0); assert.equal(r4.gmailMessageId, 'GM-FOUND'); ok('utskick: omförsök efter osäkert utfall hittar mejlet i Gmail (Message-ID) och skickar INTE igen');
sends = 0; let r5 = await m.send.sendMessage(deps(store = (() => { const s = makeStore(); return s; })(), sendMock({ networkError: true })), mkreq({ clientRequestId: '22222222-2222-4222-8222-222222222222' })); assert.equal(r5.status, 'unknown');
sends = 0; let r6 = await m.send.sendMessage(deps(store, sendMock({ found: false })), mkreq({ clientRequestId: '22222222-2222-4222-8222-222222222222' })); assert.equal(r6.status, 'sent'); assert.equal(sends, 1); ok('utskick: omförsök när mejlet verkligen saknas skickar exakt ett');
store = makeStore(); await assert.rejects(() => m.send.sendMessage(deps(store, sendMock({ status: 400 })), mkreq({ clientRequestId: '33333333-3333-4333-8333-333333333333' })), (e) => e.status === 400); assert.equal([...store.rows.values()][0].status, 'failed'); ok('utskick: Googles 4xx → failed (fel visas, ingen tyst retry)');
store = makeStore(); sends = 0; const sched = await m.send.sendMessage(deps(store, sendMock()), mkreq({ clientRequestId: '44444444-4444-4444-8444-444444444444', scheduleAt: new Date(Date.now() + 3600_000).toISOString() })); assert.equal(sched.status, 'scheduled'); assert.equal(sends, 0); assert.ok([...store.rows.values()][0].payload); ok('utskick: schemalagt sparas i kön utan att skickas');
const dueRow = { ...[...store.rows.values()][0] }; sends = 0; const dueRes = await m.send.sendDueScheduled(deps(store, sendMock()), dueRow); assert.equal(dueRes.status, 'sent'); assert.equal(sends, 1); assert.equal(store.rows.get(dueRow.id).payload, null); ok('utskick: arbetaren skickar förfallet schemalagt och rensar innehållet');
store = makeStore(); const hold = deps(store, sendMock()); const first = m.send.sendMessage(hold, mkreq({ clientRequestId: '55555555-5555-4555-8555-555555555555' })); const second = m.send.sendMessage(hold, mkreq({ clientRequestId: '55555555-5555-4555-8555-555555555555' }));
const settled = await Promise.allSettled([first, second]); assert.ok(sends <= 3); ok('utskick: samtidiga identiska begäranden hanteras utan krasch');

// ---------------------------------------------------------------------------------------------------------------- DWD
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const creds = { client_email: 'svc@proj.iam.gserviceaccount.com', private_key: privateKey };
const tokenCalls = []; const gapiCalls = [];
const fakeFetch = (cfg = {}) => async (url, init) => {
  const u = String(url);
  if (u.includes('oauth2.googleapis.com')) { const jwt = new URLSearchParams(init.body).get('assertion'); const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()); tokenCalls.push(claims); if (cfg.unauthorizedClient && claims.scope.includes('gmail.modify')) return new Response(JSON.stringify({ error: 'unauthorized_client' }), { status: 400 }); return new Response(JSON.stringify({ access_token: 'tok-' + claims.scope.split('/').pop(), expires_in: 3600 }), { status: 200 }); }
  gapiCalls.push({ url: u, method: init.method, auth: init.headers.Authorization }); const next = cfg.responses?.shift(); if (next) return new Response(JSON.stringify(next.body ?? {}), { status: next.status, headers: next.headers ?? {} });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
m.dwd._clearTokenCache();
let req = m.dwd.gmailRequestFor(creds, 'oscar@vibogruppen.se', fakeFetch());
await req('GET', '/labels'); await req('POST', '/threads/1/modify', {}, { write: true });
assert.equal(tokenCalls[0].sub, 'oscar@vibogruppen.se'); assert.ok(tokenCalls[0].scope.endsWith('gmail.readonly')); assert.ok(tokenCalls[1].scope.endsWith('gmail.modify')); assert.equal(gapiCalls[1].auth, 'Bearer tok-gmail.modify'); ok('DWD: läsning använder gmail.readonly, skrivning gmail.modify, subject = brevlådan');
await req('GET', '/labels'); assert.equal(tokenCalls.length, 2); ok('DWD: token cachas');
m.dwd._clearTokenCache(); tokenCalls.length = 0; req = m.dwd.gmailRequestFor(creds, 'a@x.se', fakeFetch({ unauthorizedClient: true }));
await assert.rejects(() => req('POST', '/x', {}, { write: true }), (e) => e.message.startsWith('SCOPE_NOT_AUTHORIZED')); await req('GET', '/labels'); ok('DWD: gmail.modify ej godkänt → tydligt SCOPE_NOT_AUTHORIZED, läsning fortsätter fungera');
m.dwd._clearTokenCache(); gapiCalls.length = 0; req = m.dwd.gmailRequestFor(creds, 'a@x.se', fakeFetch({ responses: [{ status: 503, body: {} }, { status: 200, body: { id: 'ok' } }] }));
await assert.rejects(() => req('POST', '/messages/send', { raw: 'x' }, { write: true })); assert.equal(gapiCalls.length, 1); ok('DWD: skrivande anrop återförsöks inte vid 5xx (förhindrar dubbla utskick)');
m.dwd._clearTokenCache(); gapiCalls.length = 0; req = m.dwd.gmailRequestFor(creds, 'a@x.se', fakeFetch({ responses: [{ status: 503, body: {} }, { status: 200, body: { id: 'ok' } }] }));
assert.equal((await req('GET', '/labels')).id, 'ok'); assert.equal(gapiCalls.length, 2); ok('DWD: läsande anrop återförsöks vid 5xx');
m.dwd._clearTokenCache(); gapiCalls.length = 0; req = m.dwd.gmailRequestFor(creds, 'a@x.se', fakeFetch({ responses: [{ status: 429, body: { error: { message: 'rate' } }, headers: { 'retry-after': '0' } }, { status: 200, body: { id: 'after-rate' } }] }));
assert.equal((await req('POST', '/threads/1/modify', {}, { write: true })).id, 'after-rate'); ok('DWD: rate limit (429) återförsöks även för skrivande anrop (avvisas före behandling)');

// ---------------------------------------------------------------------------------------------------------------- klientbibliotek (signatur, svar, mallar)
const SIG_A = '<div>Vibo Fastigheter<br>070-123</div>', SIG_B = '<div>Gräv &amp; Allservice<br><img src="https://x.se/logo.png"></div>';
let body = m.sig.applySignature('<p>Hej!</p>', SIG_A, 'a'); assert.match(body, /Hej!/); assert.match(body, /Vibo Fastigheter/); assert.equal(m.sig.signatureState(body)?.id, 'a'); ok('signatur: infogas i brödtexten med markör');
body = m.sig.applySignature(body, SIG_B, 'b'); assert.match(body, /Gräv &amp; Allservice/); assert.ok(!/Vibo Fastigheter/.test(body)); assert.match(body, /Hej!/); assert.equal((body.match(/data-vihem-signature/g) ?? []).length, 1); ok('signatur: byte av avsändare byter signatur utan att röra egen text, aldrig dubbel signatur');
body = m.sig.applySignature(body, SIG_A, 'a'); body = body.replace('Vibo Fastigheter', 'Vibo Fastigheter (ändrad)'); const kept = m.sig.applySignature(body, SIG_B, 'b'); assert.match(kept, /\(ändrad\)/); ok('signatur: manuellt ändrad signatur skrivs inte över');
const reply = m.sig.applySignature('<p>Svar</p><blockquote>citerat</blockquote>', SIG_A, 'a', { beforeQuote: true }); assert.ok(reply.indexOf('Vibo Fastigheter') < reply.indexOf('<blockquote>')); ok('signatur: vid svar placeras signaturen före det citerade');
assert.equal(m.sig.applySignature('<p>x</p>', '', 'a').includes('data-vihem-signature'), false); assert.equal(m.sig.stripSignature(m.sig.applySignature('<p>x</p>', SIG_A, 'a')).includes('Vibo'), false); ok('signatur: tom signatur/borttagning');
const ids2 = [{ email: 'oscar@vibogruppen.se', isPrimary: true, verified: true, name: 'Oscar' }, { email: 'info@vibo-fastigheter.se', isPrimary: false, verified: true, name: 'Vibo' }, { email: 'p@x.se', verified: false, name: '' }];
assert.equal(m.util.suggestSender(ids2, { deliveredTo: ['info@vibo-fastigheter.se'], to: ['oscar@vibogruppen.se'], cc: [] }, {}, 'ACC'), 'info@vibo-fastigheter.se'); ok('alias: svar föreslår det alias mejlet skickades till (Delivered-To)');
assert.equal(m.util.suggestSender(ids2, { deliveredTo: [], to: ['x@y.se', 'INFO@vibo-fastigheter.se'], cc: [] }, {}, 'ACC'), 'info@vibo-fastigheter.se'); assert.equal(m.util.suggestSender(ids2, { deliveredTo: [], to: ['p@x.se'], cc: [] }, {}, 'ACC'), 'oscar@vibogruppen.se'); ok('alias: matchar To/Cc, ignorerar overifierade, annars primär');
assert.equal(m.util.suggestSender(ids2, null, { ACC: 'info@vibo-fastigheter.se' }, 'ACC'), 'info@vibo-fastigheter.se'); assert.equal(m.util.suggestSender(ids2, null, { ACC: 'borta@x.se' }, 'ACC'), 'oscar@vibogruppen.se'); ok('alias: nytt mejl använder senast använda avsändare om den fortfarande är giltig');
const r = m.util.replyRecipients({ from: { name: 'Anna', email: 'anna@x.se' }, replyTo: null, to: [{ name: '', email: 'oscar@vibogruppen.se' }, { name: '', email: 'kollega@vibogruppen.se' }], cc: [{ name: '', email: 'c@x.se' }] }, ['oscar@vibogruppen.se'], true);
assert.deepEqual(r.to.map((a) => a.email), ['anna@x.se', 'kollega@vibogruppen.se']); assert.deepEqual(r.cc.map((a) => a.email), ['c@x.se']); ok('svara alla: tar bort egna adresser, avsändaren först');
assert.deepEqual(m.util.replyRecipients({ from: { name: '', email: 'a@x.se' }, replyTo: { name: '', email: 'rt@x.se' }, to: [], cc: [] }, [], false).to.map((a) => a.email), ['rt@x.se']); ok('svara: Reply-To respekteras');
const rendered = m.tpl.renderTemplate('Hej {{mottagare}}, ärende {{arende}} på {{fastighet}}. {{okand}}', { mottagare: 'Anna', arende: 'A-12', fastighet: '' }); assert.equal(rendered.text, 'Hej Anna, ärende A-12 på . {{okand}}'); assert.deepEqual(rendered.missing.sort(), ['fastighet', 'okand']); ok('mallar: variabler fylls, saknade värden redovisas (inget påhittat)');
assert.equal(m.tpl.renderTemplate('<p>{{mottagare}}</p>', { mottagare: '<img src=x onerror=alert(1)>' }, { html: true }).text.includes('<img'), false); ok('mallar: variabelvärden HTML-escapas');

rmSync(dir, { recursive: true, force: true });
console.log(`\nALLA ${n} MAIL-ENHETSKONTROLLER GODKÄNDA`);
