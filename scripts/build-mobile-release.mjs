import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadEnv } from 'vite';
import { mobileReleaseEnvironment } from './mobile-release-config.mjs';
const env = mobileReleaseEnvironment({
  ...loadEnv('production', process.cwd(), ''), ...process.env,
  VITE_PUBLIC_APP_URL: process.env.VITE_PUBLIC_APP_URL || loadEnv('production', process.cwd(), '').VITE_PUBLIC_APP_URL || 'https://app.vi-hem.se',
});
const git = (...args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) throw Error('Git-proveniens kunde inte kontrolleras.');
  return r.stdout.trim();
};
const revision = git('rev-parse', 'HEAD');
const workingTreePending = Boolean(git('status', '--porcelain'));
for (const args of [['run', 'release:check'], ['run', 'build']]) {
  const r = spawnSync('npm', args, { stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status || 1);
}
fs.writeFileSync('dist/beta-version.json', JSON.stringify({revision, restricted: true, workingTreePending, builtAt: new Date().toISOString(), target: 'native'}) + '\n');
console.log('Mobilbygge klart: begränsad beta, konfigurerad HTTPS-backend, inga privata API-nycklar.');
