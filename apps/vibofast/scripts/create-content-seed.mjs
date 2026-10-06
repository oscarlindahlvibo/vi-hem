import ts from 'typescript';
import fs from 'node:fs';
async function load(path) {
 const source=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const {company}=await load('src/data/company.ts'); const {faqCategories}=await load('src/data/faq.ts');
const content={company,faq:faqCategories,text:JSON.parse(fs.readFileSync('integration/content-catalog.json','utf8'))};
fs.writeFileSync('integration/initial-content.json',JSON.stringify(content,null,2));
fs.writeFileSync('../../docs/vibofast/initial-content.sql',`-- Set Vibo's verified organisation UUID in this SQL session first:\n-- SET vihem_vibofast.organisation_id = 'REPLACE_WITH_VERIFIED_UUID';\n-- Add only this feature's initial content; never overwrite existing content.\nINSERT INTO vihem_vibofast_private.site_content(id,organisation_id,content)\nVALUES(true,current_setting('vihem_vibofast.organisation_id')::uuid,'${JSON.stringify(content).replaceAll("'","''")}'::jsonb)\nON CONFLICT(id) DO NOTHING;\n`);
