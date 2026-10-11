import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mobileReleaseEnvironment } from './mobile-release-config.mjs';
const jwt = role => `header.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`;
const input = { VITE_SUPABASE_URL: 'https://supabase.example.com', VITE_PUBLIC_APP_URL: 'https://app.example.com', VITE_SUPABASE_ANON_KEY: jwt('anon') };
assert.equal(mobileReleaseEnvironment(input).VITE_VIHEM_BETA_RESTRICT_EXTERNAL, 'true');
assert.equal(mobileReleaseEnvironment({...input, VITE_VIHEM_BETA_RESTRICT_EXTERNAL:'false', VITE_SUPABASE_USE_SAME_ORIGIN:'true'}).VITE_SUPABASE_USE_SAME_ORIGIN, 'false');
for (const patch of [
 {VITE_SUPABASE_ANON_KEY:jwt('service_role')}, {VITE_SUPABASE_ANON_KEY:'sb_secret_test'}, {VITE_SUPABASE_ANON_KEY:''},
 {VITE_SUPABASE_URL:'http://localhost:8000'}, {VITE_PUBLIC_APP_URL:'https://127.0.0.1'}, {VITE_ENABLE_LOCAL_SUPERADMIN:'true'},
]) assert.throws(() => mobileReleaseEnvironment({...input,...patch}));
assert.equal(mobileReleaseEnvironment({...input,VITE_SUPABASE_ANON_KEY:'sb_publishable_test'}).VITE_VIHEM_BETA_RESTRICT_EXTERNAL,'true');
assert.ok(fs.readFileSync('ios/App/ci_scripts/ci_post_clone.sh','utf8').includes('npm run mobile:build'));
const project=fs.readFileSync('ios/App/App.xcodeproj/project.pbxproj','utf8');
assert.ok(project.includes('PrivacyInfo.xcprivacy in Resources'));
assert.ok(fs.readFileSync('ios/App/App/PrivacyInfo.xcprivacy','utf8').includes('C617.1'));
assert.ok(fs.readFileSync('ios/App/App/PrivacyInfo.xcprivacy','utf8').includes('CA92.1'));
console.log('PASS: mobile restrictions enforced, secrets/local endpoints rejected, CI and privacy resource wired.');
