// Shared by local mobile builds and Xcode Cloud. Never log API credentials.
export function mobileReleaseEnvironment(input) {
  const env = { ...input };
  for (const name of ['VITE_SUPABASE_URL', 'VITE_PUBLIC_APP_URL']) {
    let url;
    try { url = new URL(env[name]); } catch { throw Error(`${name} måste vara en HTTPS-adress.`); }
    if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
      throw Error(`${name} måste använda extern HTTPS.`);
    }
  }
  const key = env.VITE_SUPABASE_ANON_KEY || '';
  if (key.startsWith('sb_secret_')) throw Error('En hemlig Supabase-nyckel får inte byggas in i appen.');
  if (!key.startsWith('sb_publishable_')) {
    let payload;
    try { payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')); } catch { throw Error('Ogiltig publik Supabase-nyckel.'); }
    if (payload.role !== 'anon') throw Error('Mobilbygget kräver en anon/publishable-nyckel.');
  }
  if (env.VITE_ENABLE_LOCAL_SUPERADMIN === 'true') throw Error('Lokalt superadminläge får inte finnas i mobilreleasen.');
  // This release uses the same restrictions as the installed beta. Removing
  // these requires a separately verified external integration release.
  env.VITE_VIHEM_BETA_RESTRICT_EXTERNAL = 'true';
  env.VITE_SUPABASE_USE_SAME_ORIGIN = 'false';
  return env;
}
