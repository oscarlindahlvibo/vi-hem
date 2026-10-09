import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root=process.cwd();
const output=process.argv[2] || 'docs/premium/current';
fs.mkdirSync(output,{recursive:true});
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const files=walk('src').filter(f=>f.endsWith('.tsx'));
const app=ts.createSourceFile('src/App.tsx',fs.readFileSync('src/App.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const routes=[];
function traverse(node,fn){fn(node);ts.forEachChild(node,n=>traverse(n,fn));}
traverse(app,n=>{if(ts.isCaseClause(n)&&ts.isStringLiteral(n.expression)){const body=n.statements.map(s=>s.getText(app)).join(' ');routes.push({route:n.expression.text,guards:[...body.matchAll(/if\s*\((.*?)\)\s*return/g)].map(m=>m[1]),views:[...body.matchAll(/<([A-Z]\w+)/g)].map(m=>m[1])});}});
const inventory=files.map(file=>{
 const source=fs.readFileSync(file,'utf8'), ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const components=[],controls=[],dialogs=[],headings=[],imports=[];
 traverse(ast,n=>{
  if(ts.isFunctionDeclaration(n)&&n.name)components.push(n.name.text);
  if(ts.isImportDeclaration(n))imports.push(n.moduleSpecifier.text);
  if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){
   const tag=n.tagName.getText(ast),attrs=Object.fromEntries(n.attributes.properties.filter(ts.isJsxAttribute).map(a=>[a.name.getText(ast),a.initializer?.getText(ast)||'true']));
   const line=ast.getLineAndCharacterOfPosition(n.getStart(ast)).line+1;
   if(['button','a','input','select','textarea','Button','Input','Select','Textarea','form','table','Tabs','SegmentedControl'].includes(tag))controls.push({tag,line,...attrs});
   if(/Modal|Sheet|Dialog|Camera|Signature/.test(tag))dialogs.push({tag,line,title:attrs.title||attrs['aria-label']||'dynamic'});
   if(['PageHeader','h1','h2','h3'].includes(tag))headings.push({tag,line,title:attrs.title||'inline'});
  }
 });
 const view= /pages\/|Page.tsx|Dashboard.tsx|Admin.tsx|Admin\.tsx|modules\/(rent|vibofast|ekangen)/.test(file);
 const flags=[];
 const nativeFields=controls.filter(c=>['input','select','textarea'].includes(c.tag)&&c.type!=='"hidden"');
 if(nativeFields.length)flags.push(`${nativeFields.length} native fields: inspect labels, sizing, validation`);
 const bare=controls.filter(c=>c.tag==='button');if(bare.length)flags.push(`${bare.length} native buttons: review purpose/states/touch size`);
 if(controls.some(c=>c.tag==='table'))flags.push('Table: review mobile presentation, density, pagination');
 if(/text-\[([0-9]|10|11)px\]/.test(source))flags.push('Sub-12px text: inspect legibility');
 if(/window.confirm|\bconfirm\(/.test(source))flags.push('Native confirmation: review shared dialog replacement');
 if(/fixed inset-0/.test(source)&&!/\bModal\b/.test(source))flags.push('Custom overlay: inspect focus/scroll/layer ownership');
 if(/onClick/.test(source)&&!imports.some(i=>/\/ui$/.test(i)))flags.push('No shared UI import: inspect component consistency');
 return {file,view,lines:source.split('\n').length,components,routes:routes.filter(r=>r.views.some(v=>components.includes(v))),headings,dialogs,controls,flags,review:{code:'inventoried',visual:'not reviewed',functional:'not verified',mobile:'not verified',ipad:'not verified',desktop:'not verified',dimensions:['Visual quality','Usability','Hierarchy','Consistency','Mobile','Accessibility','Click count','Next action','Functional quality','Premium feel'].map(name=>({name,status:'Requires manual review; inventory is not verification'}))}};
});
const report={generated:new Date().toISOString(),scope:'VI-HEM src; public websites in apps/ are separate products',counts:{tsx:files.length,views:inventory.filter(i=>i.view).length,routes:routes.length,dialogs:inventory.reduce((n,i)=>n+i.dialogs.length,0),interactive:inventory.reduce((n,i)=>n+i.controls.length,0)},roles:['superadmin','admin','staff','tenant','screen'],routes,files:inventory};
fs.writeFileSync(path.join(output,'inventory.json'),JSON.stringify(report,null,2)+'\n');
let md=`# VI-HEM 3.0 – källkodsinventering\n\nInventeringen omfattar ${report.counts.tsx} TSX-filer, ${report.counts.views} vy-/modulfiler, ${report.counts.routes} route-val, ${report.counts.dialogs} dialog-/sheet-/kamera-/signaturreferenser och ${report.counts.interactive} interaktiva element/formulär/tabeller. Varje element har fil och rad i inventory.json. Dynamiska underflöden och runtime-behörigheter kräver separat prov.\n\n**Detta är en kodinventering, inte en visuell eller funktionell verifiering.** Alla vyer börjar med ej verifierad status för varje bedömningsdimension. Ingen sida markeras klar genom gemensam CSS.\n\n| Vy/modul | Rader | Dialogreferenser | Kodindikatorer att granska |\n|---|---:|---:|---|\n`;
for(const i of inventory.filter(i=>i.view))md+=`| ${i.file} | ${i.lines} | ${i.dialogs.length} | ${i.flags.join('; ')||'Gemensam UI finns; faktisk kvalitet måste granskas'} |\n`;
md+='\n## Routes och befintliga frontendgrindar\n\nBackend/RLS är den verkliga behörighetskontrollen. Tabellen dokumenterar befintliga frontendval och ger inga nya behörigheter.\n\n| Route | Komponenter | Lokala grindar |\n|---|---|---|\n';for(const r of routes)md+=`| ${r.route} | ${r.views.join(', ')} | ${r.guards.join('; ')||'Kontrollera även omgivande router/rollgrind'} |\n`;
fs.writeFileSync(path.join(output,'inventory.md'),md);
console.log(report.counts);
