import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function requiredEnv(name, predicate = value => Boolean(value)) {
  const value = process.env[name]?.trim();
  if (!predicate(value)) errors.push(`${name} saknas eller är ogiltig.`);
  return value;
}

const supabaseUrl = requiredEnv('VITE_SUPABASE_URL', value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !/localhost|127\.0\.0\.1/.test(url.hostname);
  } catch {
    return false;
  }
});
requiredEnv('VITE_SUPABASE_ANON_KEY', value => Boolean(value) && !/service_role|secret/i.test(value));
requiredEnv('VITE_PUBLIC_APP_URL', value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !/localhost|127\.0\.0\.1/.test(url.hostname);
  } catch {
    return false;
  }
});

if (process.env.VITE_ENABLE_LOCAL_SUPERADMIN === 'true') {
  errors.push('VITE_ENABLE_LOCAL_SUPERADMIN måste vara false eller saknas i produktion.');
}

const files = [
  'public/manifest.webmanifest',
  'public/privacy-policy.html',
  'public/icons/icon-192.png',
  'public/icons/icon-512.png',
  'capacitor.config.ts',
  'android/app/build.gradle',
  'ios/App/App.xcodeproj/project.pbxproj',
];
for (const file of files) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`Saknad releasefil: ${file}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'));
if (manifest.name !== 'VI-HEM' || manifest.short_name !== 'VI-HEM') {
  errors.push('PWA-manifestet måste använda appnamnet VI-HEM.');
}
if (!Array.isArray(manifest.icons) || manifest.icons.length < 2) {
  errors.push('PWA-manifestet behöver både 192px- och 512px-ikon.');
}

const capacitor = fs.readFileSync(path.join(root, 'capacitor.config.ts'), 'utf8');
if (!capacitor.includes("appId: 'se.vihem.app'")) errors.push('Capacitor appId är inte se.vihem.app.');

if (!supabaseUrl?.startsWith('https://')) errors.push('Produktionsbygget får inte använda lokal Supabase.');

if (errors.length) {
  console.error('Releasekontroll misslyckades:');
  for (const error of errors) console.error(`- ${error}`);
  console.error('\nExempel: VITE_SUPABASE_URL=https://... VITE_SUPABASE_ANON_KEY=... VITE_PUBLIC_APP_URL=https://app.vi-hem.se npm run release:check');
  process.exit(1);
}

console.log('Releasekontroll godkänd. Produktionsmiljön och mobilpaketet har grundläggande rätt konfiguration.');
