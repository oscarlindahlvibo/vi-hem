import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';
const load = async (name) => {
 const source = fs.readFileSync(`supabase/functions/vihem-short-stay-receipt-email/${name}.ts`, 'utf8').replace('npm:pdf-lib@1.17.1', import.meta.resolve('pdf-lib'));
 const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
 return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
};
const { receiptSnapshot, snapshotHash, validEmail, definiteMailFailure, validateMailContent, renderMailTemplate, defaultMailTemplate } = await load('receipt');
const { receiptPdf } = await load('pdf');
const booking = { id: 'qa', guest_email: 'qa@example.invalid', guest_name: 'Åsa Öberg', total_price: 1120, paid_amount: 1120, balance_due: 0, start_date: '2026-10-12', end_date: '2026-10-14' };
const snapshot = receiptSnapshot(booking, { name: 'Östra rummet' }, { name: 'Vibogruppen AB' });
assert.equal(snapshot.net, 1000); assert.equal(snapshot.vat, 120); assert.equal(snapshot.due, 0);
assert.equal(await snapshotHash(snapshot), await snapshotHash({...snapshot}));
assert.notEqual(await snapshotHash(snapshot), await snapshotHash({...snapshot, recipient: 'other@example.invalid'}));
assert.equal(validEmail('qa@example.invalid\r\nBcc:other@example.invalid'), false);
assert.throws(() => receiptSnapshot({...booking, guest_email: ''}, {}, {}));
assert.throws(() => receiptSnapshot({...booking, receipt_lines: [{description:'Bad',amount:Infinity}]}, {}, {}));
assert.equal(definiteMailFailure(Error('GOOGLE_GMAIL_SEND_FAILED:403:denied')), true);
assert.equal(definiteMailFailure(Error('GOOGLE_GMAIL_SEND_FAILED:503:unknown')), false);
assert.equal(definiteMailFailure(Error('TimeoutError')), false);
const bytes = await receiptPdf(snapshot); assert.equal(Buffer.from(bytes).subarray(0,4).toString(), '%PDF');
assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
const long = await receiptPdf({...snapshot, lines: Array.from({length:30}, () => ({description:'ÅÄÖ lång beskrivning '.repeat(25),amount:10}))});
assert.ok((await PDFDocument.load(long)).getPageCount() > 2);
console.log('PASS receipt validation, authoritative amounts, version hashing, ambiguous transport failures and paginated Swedish PDF');

const mail=renderMailTemplate(defaultMailTemplate,snapshot);assert.ok(mail.message.includes('Åsa Öberg'));assert.ok(mail.message.includes('Östra rummet'));assert.equal(validateMailContent('Eget ämne','Eget meddelande').message,'Eget meddelande');assert.throws(()=>validateMailContent('Subject\r\nBcc:bad','body'));assert.throws(()=>validateMailContent('Subject','x'.repeat(6001)));console.log('PASS templates, Swedish merge values, edited messages and header/length validation');
