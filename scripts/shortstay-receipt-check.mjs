import assert from 'node:assert/strict';import fs from 'node:fs/promises';import ts from 'typescript';import {PDFDocument} from 'pdf-lib';import {pathToFileURL} from 'node:url';
const moduleUrl=new URL('../.shortstay-receipt-check.mjs',import.meta.url);
try {
 const source=await fs.readFile(new URL('../src/lib/shortStayReceipt.ts',import.meta.url),'utf8');await fs.writeFile(moduleUrl,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 const {defaultShortStayCompany,makeShortStayReceiptPdf}=await import(pathToFileURL(moduleUrl.pathname).href);
 assert.equal(defaultShortStayCompany([{id:'other',name:'Annat',legal_name:''},{id:'vibo',name:'Vibogruppen AB',legal_name:''}]).id,'vibo');assert.equal(defaultShortStayCompany([{id:'vibo',name:'VIBOGRUPPEN',legal_name:''}]).id,'vibo');assert.equal(defaultShortStayCompany([{id:'other',name:'Vibogruppen Fastigheter AB',legal_name:''}]),undefined);assert.equal(defaultShortStayCompany([]),undefined);
 const input={title:'Kvitto ÅÄÖ',issuer:'Vibogruppen AB',bookingId:'qa',details:['Åsa Öberg'],rows:Array.from({length:80},(_,i)=>({label:`Rad ${i}: `+'Lång beskrivning ÅÄÖ '.repeat(20),amount:i===79?'-100,00 kr':'1 120,00 kr'}))};
 const blob=await makeShortStayReceiptPdf(input);assert.equal(blob.type,'application/pdf');const pdf=await PDFDocument.load(await blob.arrayBuffer());assert.ok(pdf.getPageCount()>2);assert.equal(pdf.getPages()[0].getWidth(),595);console.log('PASS preferred company, no arbitrary fallback, Swedish PDF, negative row, long text and pagination');
}finally{await fs.unlink(moduleUrl).catch(()=>{});}
