import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import ts from 'typescript';
import vm from 'node:vm';
const root=fileURLToPath(new URL('../',import.meta.url));
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'vihem-supplier-'));
async function module(source,name){const file=path.join(temp,name+'.mjs');await fs.writeFile(file,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);return import(pathToFileURL(file).href);}
try {
 const parser=await module(await fs.readFile(path.join(root,'supabase/functions/vihem-supplier-product/product.ts'),'utf8'),'parser');
 const url='https://www.biltema.se/verktyg/qa-2000043408';
 for(const input of ['http://www.biltema.se/qa-2000043408','https://www.biltema.se.evil.test/qa-2000043408','https://user@www.jula.se/catalog/qa-123/','https://127.0.0.1/qa-2000043408','https://www.jula.se/search/','https://www.biltema.se:444/qa-2000043408'])assert.throws(()=>parser.productUrl(input));
 const html='window.productData = window.productData || '+JSON.stringify({variations:[{name:'Skruv ÅÄÖ',articleNumberFriendlyName:'18-319'},{name:'Variant 2',articleNumberFriendlyName:'18-320'}]})+';';
 const products=await parser.fetchProducts(url,async()=>new Response(html,{headers:{'content-type':'text/html'}}));assert.equal(products.length,2);assert.equal(products[0].sku,'18-319');assert.equal(products[0].name,'Skruv ÅÄÖ');
 for(const response of [new Response('',{status:302,headers:{Location:'http://127.0.0.1'}}),new Response('',{status:403}),new Response('not html'),new Response('x'.repeat(2000001),{headers:{'content-type':'text/html'}})])await assert.rejects(parser.fetchProducts(url,async()=>response));
 let client=await fs.readFile(path.join(root,'src/lib/supplierProducts.ts'),'utf8');client=client.replace("import { registerPlugin } from '@capacitor/core';",'const registerPlugin = <T>() => ({} as T);');
 const {validateSupplierProduct,productExtractionScript}=await module(client,'client');
 const document={querySelector(selector){return selector==='main'?{innerText:'Artnr. 18-319'}:{textContent:'Skruv ÅÄÖ'};},querySelectorAll(){return [{textContent:JSON.stringify({'@graph':[{'@type':'Product',name:'Wrong related item',sku:'wrong'},{'@type':'Product',name:'Skruv ÅÄÖ',sku:'18-319'}]})}];}};
 const result=vm.runInNewContext(productExtractionScript,{document,location:{href:url}});assert.equal(validateSupplierProduct(result).sku,'18-319');assert.equal(validateSupplierProduct(result).supplier,'Biltema');assert.throws(()=>validateSupplierProduct({name:'Bad',url:'javascript:alert(1)'}));
 const retailers = [
  ['https://www.byggmax.se/lantbruksstro-p45521','Byggmax','let productStructuredData = [{"@type":"Product","name":"Lantbruksströ","sku":"45521"}];','45521'],
  ['https://www.bauhaus.se/skruvdragare-bl186kb-qw-18v-2x1-5ah','BAUHAUS','<body itemscope itemtype="http://schema.org/Product"><h1><span>Skruvdragare ÅÄÖ &amp; bits</span></h1><meta itemprop="sku" content="1076354"><h2>Relaterade produkter</h2>','1076354'],
  ['https://www.jemfix.se/borrskruvdragare-18v-falke/3100/9073414/','jem & fix','<script type="application/ld&#x2B;json">{"@type":"Product","name":"Borrskruvdragare ÅÄÖ","sku":"9073414"}</script>','9073414'],
 ];
 for (const [link,supplier,markup,sku] of retailers) {
  const result=await parser.fetchProducts(link,async()=>new Response(markup,{headers:{'content-type':'text/html'}}));
  assert.equal(result.length,1);assert.equal(result[0].sku,sku);assert.equal(result[0].supplier,supplier);
  assert.equal(validateSupplierProduct(result[0]).supplier,supplier);
  assert.throws(()=>parser.productUrl(link.replace(new URL(link).hostname,new URL(link).hostname+'.evil.test')));
 }
 const nativeByggmax=vm.runInNewContext(productExtractionScript,{document:{querySelector(selector){return selector==='main'?{innerText:'ART.NR: 45521'}:selector.startsWith('meta')?null:{textContent:'Lantbruksströ'};},querySelectorAll(){return [];}},location:{href:retailers[0][0]}});
 assert.equal(validateSupplierProduct(nativeByggmax).sku,'45521');
 for(const suffix of ['/', '']) {
  const link='https://www.jula.se/catalog/bygg/maskeringstejp-021489'+suffix;
  assert.equal(validateSupplierProduct({name:'Maskeringstejp 50 m',sku:'021489',url:link}).supplier,'Jula');
  assert.equal(parser.productUrl(link).hostname,'www.jula.se');
 }
 assert.equal(parser.parseProducts('<h1>Category</h1>',new URL(retailers[1][0])).length,0);
 for(const link of ['https://www.byggmax.se/catalogsearch/result/','https://www.bauhaus.se/catalogsearch/result/','https://www.jemfix.se/skruvdragare/140102/'])assert.throws(()=>parser.productUrl(link));
 const searchMarkup='<a href="https://www.byggmax.se/skruv-p123"><img alt="Bild"></a><a href="https://www.byggmax.se/skruv-p123">Skruv ÅÄÖ</a><a href="https://www.byggmax.se.evil.test/skruv-p456">Bad</a><a href="https://www.byggmax.se/skruv-p123">Duplicate</a>';
 let searchRequest;
 const hits=await parser.searchProducts('skruv & bits','Byggmax',async url=>{searchRequest=url;return new Response(searchMarkup,{headers:{'content-type':'text/html'}});});
 assert.equal(searchRequest.searchParams.get('q'),'skruv & bits');assert.equal(hits.length,1);assert.equal(hits[0].name,'Skruv ÅÄÖ');assert.equal(hits[0].sku,'123');
 await assert.rejects(parser.searchProducts('skruv','https://127.0.0.1',async()=>{throw Error('must not fetch');}));
 assert.deepEqual(await parser.searchProducts('unknown','Byggmax',async()=>new Response('<h1>No results</h1>',{headers:{'content-type':'text/html'}})),[]);
 console.log('PASS supplier URL restrictions, variants, Unicode, redirects, blocked/oversized responses, product extraction, five suppliers and review data validation');
}finally{await fs.rm(temp,{recursive:true,force:true});}
