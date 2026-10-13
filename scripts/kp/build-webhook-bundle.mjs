// Bundlar webhook-hanteraren (och dess beroenden) för Node så att E2E kan köra exakt samma kod som edge-funktionen.
import { build } from 'esbuild';
await build({ entryPoints: ['supabase/functions/_shared/kp-webhook.ts'], bundle: true, format: 'esm', platform: 'node', outfile: process.argv[2], logLevel: 'error',
  plugins: [{ name: 'npm-specifiers', setup(b) { b.onResolve({ filter: /^npm:/ }, (a) => ({ path: a.path.replace(/^npm:/, '').replace(/@[\d.^~]+$/, ''), external: true })); } }] });
