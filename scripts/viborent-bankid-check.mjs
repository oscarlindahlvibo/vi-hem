// Provider mock only. No real BankID order or signature is requested.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
const dir=mkdtempSync(path.join(tmpdir(),'rental-bankid-'));
const entry=path.join(dir,'entry.ts'), out=path.join(dir,'bundle.mjs');
writeFileSync(entry,`export * from ${JSON.stringify(path.resolve('supabase/functions/_shared/rental-bankid.ts'))}; export * from ${JSON.stringify(path.resolve('supabase/functions/_shared/kp-bankid.ts'))};`);
await build({entryPoints:[entry],outfile:out,bundle:true,format:'esm',platform:'node',logLevel:'error'});
globalThis.crypto ||= webcrypto;
globalThis.Deno={env:{get:k=>({VIHEM_BANKID_SECRET_KEY:'synthetic-bankid-test-key',VIHEM_RENTAL_SECRET_KEY:'synthetic-rental-test-key'})[k]}};
const m=await import(pathToFileURL(out).href);
assert.equal(m.hasSigningEvidence({status:'pending'}),false);
assert.equal(m.hasSigningEvidence({status:'complete',name:'QA',personalNumber:'190001010000',signature:'sig'}),false);
assert.equal(m.hasSigningEvidence({status:'complete',name:'QA',personalNumber:'190001010000',signature:'sig',ocspResponse:'ocsp'}),true);
const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('synthetic-bankid-test-key'));
const key=await crypto.subtle.importKey('raw',hash,'AES-GCM',false,['encrypt']);
async function encrypt(v){const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(v)));return Buffer.concat([iv,cipher]).toString('base64');}
const settings={enabled:true,signing_enabled:true,login_enabled:false,environment:'test',encrypted_api_user:await encrypt('qa-user'),encrypted_password:await encrypt('qa-password'),encrypted_company_api_guid:await encrypt('qa-company')};
const fakeSettings=s=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:s})})})})});
assert.equal(await m.bankidSettings(fakeSettings(settings),'qa-org','login'),null);
assert.ok(await m.bankidSettings(fakeSettings(settings),'qa-org','sign'));
assert.equal(await m.bankidSettings(fakeSettings({...settings,signing_enabled:false}),'qa-org','sign'),null);
let payload;
globalThis.fetch=async(url,init)=>{payload=JSON.parse(init.body); assert.match(url,/banksign-test/);return Response.json({apiCallResponse:{Response:{OrderRef:'qa-ref',AutoStartToken:'qa-autostart',QrImage:'https://banksign-test.azurewebsites.net/qr/qa-ref'}}});};
const started=await m.bankidStart(settings,'Exact QA contract and price','127.0.0.1','Exact QA booking snapshot');
assert.equal(started.orderRef,'qa-ref');assert.equal(payload.userVisibleData,'Exact QA contract and price');assert.equal(payload.userNonVisibleData,'Exact QA booking snapshot');
await m.bankidStart(settings,'Existing KP flow','127.0.0.1');assert.equal(payload.userNonVisibleData,'');
globalThis.fetch=async()=>Response.json({apiCallResponse:{Response:{Status:'complete',CompletionData:{user:{personalNumber:'190001010000',name:'QA Signer'},signature:'qa-signature',ocspResponse:'qa-ocsp'}}}});
assert.ok(m.hasSigningEvidence(await m.bankidCollect(settings,'qa-ref')));
globalThis.fetch=async()=>Response.json({apiCallResponse:{Response:{Status:'complete',CompletionData:{user:{personalNumber:'190001010000',name:'QA Signer'}}}}});
assert.equal(m.hasSigningEvidence(await m.bankidCollect(settings,'qa-ref')),false);
// Authorization precedes provider access; caller cannot substitute a completion/name from its body.
const noBooking=await m.rentalBankid({},new Request('http://localhost'),'qa-org','bankid-collect',{accepted_terms:true},null);
assert.equal(noBooking.status,404);
console.log('PASS rental BankID provider mock, signature evidence, configuration gates and existing KP compatibility');
