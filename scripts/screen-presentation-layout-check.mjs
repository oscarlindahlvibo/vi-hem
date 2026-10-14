import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/lib/screenPresentationLayout.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { presentationLayout, screenUsesStackedLayout } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
for (const [width, height] of [[1920,1080],[1280,720],[960,540],[768,432]]) {
  for (let mask=0;mask<16;mask++) {
    const settings={showNews:!!(mask&1),showClockedIn:!!(mask&2),showMeetings:!!(mask&4),showWorkOrders:!!(mask&8)};
    const layout=presentationLayout(settings,width,height);
    assert.equal(layout.narrow,false);
    assert.equal(screenUsesStackedLayout(width,height),false);
    const count=[settings.showNews,settings.showClockedIn,settings.showMeetings].filter(Boolean).length;
    assert.equal((layout.panelRows.match(/minmax/g)||[]).length,Math.max(1,count));
    assert.equal((layout.columns.match(/minmax/g)||[]).length,settings.showWorkOrders&&count ? 2 : 1);
  }
}
for (const [width,height] of [[390,844],[768,1024]]) assert.equal(presentationLayout({},width,height).narrow,true);
const page=fs.readFileSync(new URL('../src/pages/ScreenDisplayPage.tsx',import.meta.url),'utf8');
const version=JSON.parse(fs.readFileSync(new URL('../public/version.json',import.meta.url),'utf8')).version;
assert.ok(page.includes(`SCREEN_APP_VERSION = '${version}'`));
const shortStay=page.slice(page.indexOf('function ShortStayScreen('),page.indexOf('function WorkOrderScreen('));
assert.ok(shortStay.includes('screenUsesStackedLayout(screenWidth, screenHeight)'));
assert.ok(shortStay.includes('repeat(3, minmax(0, 1fr))'));
assert.ok(shortStay.includes('fixedHeight={!narrow}'));
console.log('PASS: 64 TV panel combinations, portrait stacking and reload version');
