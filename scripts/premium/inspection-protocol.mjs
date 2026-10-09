import fs from 'node:fs'; import assert from 'node:assert/strict'; import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';
const source = fs.readFileSync(new URL('../../src/lib/inspections/protocol.ts',import.meta.url),'utf8');
const js = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const temporary = new URL('../../work/inspection-protocol-test.mjs',import.meta.url); fs.mkdirSync(new URL('../../work/',import.meta.url),{recursive:true}); fs.writeFileSync(temporary,js);
try {
 const {inspectionProtocol}=await import(temporary.href); const image=new Uint8Array(fs.readFileSync(new URL('./fixtures/profile.jpg',import.meta.url)));
 const input={id:'qa-inspection',version:'qa-version',organisation:'VI-HEM · QA',address:'Ekängsvägen 1 – Åmål',apartment:'1001',type:'Utflyttningsbesiktning',date:'2026-10-10',inspector:'Besiktningsperson Åsa Öberg',tenant:'Syntetisk hyresgäst',tenantPresent:true,condition:'Bra',notes:'Lång text med Å Ä Ö. '.repeat(130),action:'Skadad kökslucka behöver repareras.',rooms:Array.from({length:9},(_,i)=>({name:i===0?'Kök':`Rum ${i}`,condition:'Dålig',notes:'Skada på lucka. '.repeat(35),reviewed:true,photos:['fixture','fixture']})),photos:['fixture']};
 const bytes=await inspectionProtocol(input,async()=>image); const pdf=await PDFDocument.load(bytes); assert.ok(pdf.getPageCount()>10); assert.equal(pdf.getPages().length,pdf.getPageCount());
 if(process.env.PREMIUM_PDF_OUTPUT) fs.writeFileSync(process.env.PREMIUM_PDF_OUTPUT,bytes);
 await assert.rejects(()=>inspectionProtocol({...input,notes:'Ej stödd symbol 🧪'},async()=>image),/tecken/);
 await assert.rejects(()=>inspectionProtocol(input,async()=>new Uint8Array([1,2])),/bild/);
 console.log(`PASS: ${pdf.getPageCount()} pages, Swedish text, long comments/rooms/images, invalid image and unsupported glyph fail without finalization. Rendering QA separate.`);
} finally {fs.unlinkSync(temporary);}
