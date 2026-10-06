import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  logLevel: 'error',
  build: { write: false },
});
const outputs = Array.isArray(result) ? result : [result];
const modules = outputs.flatMap(output => output.output.flatMap(chunk =>
  chunk.type === 'chunk' ? Object.keys(chunk.modules) : []));
const normalised = modules.map(id => id.replace(/\\/g, '/'));
assert(!normalised.some(id => id.includes('/apps/vibofast/')), 'Public website included in mobile build');
for (const page of ['WebsiteAdmin', 'DriveImagesAdmin', 'InterestsAdmin']) {
  assert(normalised.includes(`${root}src/modules/vibofast/${page}.tsx`), `Missing admin page: ${page}`);
}
console.log('PASS: mobile build contains Vibo administration, Drive images and interests; no public vibofast.se modules.');
