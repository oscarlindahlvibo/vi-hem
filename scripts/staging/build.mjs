import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
const path = process.env.VIHEM_QA_CREDENTIALS;
if (!path) throw new Error('VIHEM_QA_CREDENTIALS required');
const c = JSON.parse(fs.readFileSync(path));
const client = createClient('http://127.0.0.1:18880', c.service, { auth: { persistSession: false } });
const result = await client.from('vihem_organisations').select('name').eq('id', c.org).single();
if (result.error || result.data?.name !== 'VI-HEM Chat QA') throw new Error('Isolated QA guard failed');
const build = spawnSync('npm', ['run', 'build', '--', '--outDir', 'dist-staging'], {
  stdio: 'inherit', env: { ...process.env, VITE_VIHEM_BETA_RESTRICT_EXTERNAL: 'true', VITE_SUPABASE_USE_SAME_ORIGIN: 'true', VITE_SUPABASE_URL: 'http://127.0.0.1:18881', VITE_SUPABASE_ANON_KEY: c.anon },
});
if (build.status) process.exit(build.status);
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
fs.writeFileSync('dist-staging/staging-version.json', JSON.stringify({ revision, environment: 'isolated QA', builtAt: new Date().toISOString() }));
