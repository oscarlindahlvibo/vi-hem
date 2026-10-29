// Kontroll av src/platform/files.ts mot fake-adapter: val av väg per plattform, filnamnstvätt, popup-spärr och blob-livslängd.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

mkdirSync('node_modules/.cache', { recursive: true });
const dir = mkdtempSync(path.join(path.resolve('node_modules/.cache'), 'platform-check-'));
const out = path.join(dir, 'bundle.mjs');
const stub = { name: 'stub-capacitor', setup(b) { b.onResolve({ filter: /^@capacitor\// }, (a) => ({ path: a.path, namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const Capacitor={isNativePlatform:()=>false};export const Filesystem={};export const Directory={Cache:"CACHE"};export const Share={};', loader: 'js' })); } };
await build({ entryPoints: ['src/platform/files.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', plugins: [stub] });
const m = await import(pathToFileURL(out).href);
let n = 0; const ok = (name) => console.log(`ok ${++n} - ${name}`);

function fake({ native = false, popupBlocked = false } = {}) {
  const log = { shared: [], downloads: [], opened: 0, closed: 0, hrefs: [], urls: [], revoked: [], timers: [] };
  const env = {
    isNative: () => native,
    share: async (_b, name) => { log.shared.push(name); },
    openWindow: () => { if (popupBlocked) return null; log.opened++; return { opener: 1, location: { set href(v) { log.hrefs.push(v); } }, close: () => { log.closed++; } }; },
    openUrl: (u) => { log.urls.push(u); },
    download: (url, name) => { log.downloads.push([url, name]); },
    createUrl: () => 'blob:x', revokeUrl: (u) => log.revoked.push(u), later: (fn, ms) => log.timers.push([fn, ms]),
  };
  return { files: m.createFiles(env), log };
}
const pdf = new Blob(['x'], { type: 'application/pdf' });
const xlsx = new Blob(['x'], { type: 'application/octet-stream' });

assert.equal(m.safeFilename('a/b\\c:d*e?.pdf'), 'a-b-c-d-e-.pdf'); assert.equal(m.safeFilename(''), 'fil'); assert.equal(m.safeFilename('...'), 'fil'); assert.equal(m.safeFilename('x'.repeat(300)).length, 120); ok('filnamn tvättas');

{ const { files, log } = fake({ native: true }); await files.deliverFile(pdf, 'a/b.pdf', { mode: 'open' }); await files.deliverFile(pdf, 'c.pdf');
  assert.deepEqual(log.shared, ['a-b.pdf', 'c.pdf']); assert.equal(log.opened, 0); assert.equal(log.downloads.length, 0); ok('appen: open och save går båda via delningsbladet'); }

{ const { files, log } = fake(); const d = files.beginFileDelivery('open'); assert.equal(log.opened, 1); await d.deliver(pdf, 'f.pdf');
  assert.deepEqual(log.hrefs, ['blob:x']); assert.equal(log.downloads.length, 0); ok('webben: open pre-öppnar fliken innan filen hämtats och visar PDF där'); }

{ const { files, log } = fake(); const d = files.beginFileDelivery('open'); await d.deliver(xlsx, 'f.xlsx');
  assert.equal(log.closed, 1); assert.equal(log.downloads.length, 1); ok('webben: filtyp som inte kan visas stänger fliken och laddas ner'); }

{ const { files, log } = fake({ popupBlocked: true }); await files.deliverFile(pdf, 'f.pdf', { mode: 'open' });
  assert.equal(log.downloads.length, 1); ok('webben: blockerad popup faller tillbaka på nedladdning'); }

{ const { files, log } = fake(); await files.deliverFile(pdf, 'f.pdf', { mode: 'save' });
  assert.equal(log.opened, 0); assert.equal(log.downloads[0][1], 'f.pdf'); ok('webben: save öppnar ingen flik'); }

{ const { files, log } = fake(); await files.deliverFile(pdf, 'f.pdf');
  assert.equal(log.timers.length, 1); assert.equal(log.timers[0][1], 120_000); assert.equal(log.revoked.length, 0); log.timers[0][0](); assert.deepEqual(log.revoked, ['blob:x']); ok('blob-länken frigörs efter 120 s'); }

{ const { files, log } = fake(); const d = files.beginFileDelivery('open'); d.cancel(); d.cancel(); await d.deliver(pdf, 'f.pdf');
  assert.equal(log.closed, 1); assert.equal(log.downloads.length + log.hrefs.length, 0); ok('cancel stänger fliken en gång och stoppar senare leverans'); }

{ const { files, log } = fake(); const d = files.beginFileDelivery('open'); d.openUrl('https://x/y.pdf');
  assert.deepEqual(log.hrefs, ['https://x/y.pdf']); assert.equal(log.urls.length, 0); d.cancel(); assert.equal(log.closed, 0); ok('openUrl navigerar den förbeställda fliken och cancel stänger den inte efteråt'); }
{ const { files, log } = fake({ popupBlocked: true }); files.beginFileDelivery('open').openUrl('https://x/y.pdf');
  assert.deepEqual(log.urls, ['https://x/y.pdf']); ok('openUrl utan förbeställd flik öppnar via adaptern'); }

rmSync(dir, { recursive: true, force: true });
console.log(`\nALLA ${n} PLATTFORMSKONTROLLER GODKÄNDA`);
