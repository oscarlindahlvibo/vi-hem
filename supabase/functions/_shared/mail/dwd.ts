// Google Domain-Wide Delegation för VI-HEM Mail: samma service account/nyckel som övriga Workspace-integrationer (krypterad i
// vihem_google_workspace_settings), men med scope per åtgärd: läsvägar använder gmail.readonly (redan godkänd), skrivande åtgärder gmail.modify
// (måste godkännas i Admin Console – annars returneras SCOPE_NOT_AUTHORIZED, ingen tyst reservväg). Token cachas i minnet (< 1 h).
import { classifyGmailError, GmailApiError, type GmailRequest } from './gmail.ts';

export const SCOPE_READ = 'https://www.googleapis.com/auth/gmail.readonly';
export const SCOPE_WRITE = 'https://www.googleapis.com/auth/gmail.modify';

const b64url = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const pem = (s: string) => Uint8Array.from(atob(s.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '')), (c) => c.charCodeAt(0));

export interface ServiceAccount { client_email: string; private_key: string }
const cache = new Map<string, { token: string; exp: number }>();

export async function getDwdToken(creds: ServiceAccount, subject: string, scope: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const key = `${creds.client_email}|${subject}|${scope}`;
  const hit = cache.get(key); if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const now = Math.floor(Date.now() / 1000); const enc = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: creds.client_email, scope, aud: 'https://oauth2.googleapis.com/token', sub: subject, iat: now, exp: now + 3600 })}`;
  let cryptoKey: CryptoKey;
  try { cryptoKey = await crypto.subtle.importKey('pkcs8', pem(creds.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']); } catch { throw new GmailApiError(500, 'key', 'Google-nyckeln kunde inte läsas.'); }
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned));
  const response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${b64url(new Uint8Array(signature))}` });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const code = String(payload.error || 'unknown');
    if (code === 'unauthorized_client') throw new GmailApiError(403, 'scope', `SCOPE_NOT_AUTHORIZED:${scope}`);
    throw new GmailApiError(response.status || 500, code, `GOOGLE_TOKEN_FAILED:${code}`);
  }
  cache.set(key, { token: payload.access_token, exp: Date.now() + Math.min(Number(payload.expires_in ?? 3600), 3000) * 1000 });
  return payload.access_token as string;
}

/** Skapar en GmailRequest för en brevlåda. `write: true` i anropet väljer gmail.modify, annars gmail.readonly. */
export function gmailRequestFor(creds: ServiceAccount, mailbox: string, fetchImpl: typeof fetch = fetch): GmailRequest {
  return async (method, path, body, opts) => {
    const scope = opts?.write ? SCOPE_WRITE : SCOPE_READ;
    let lastError: GmailApiError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await getDwdToken(creds, mailbox, scope, fetchImpl);
      const response = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      if (response.status === 204) return null;
      const payload: any = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      const c = classifyGmailError(response.status, payload);
      const retryAfter = Number(response.headers.get('retry-after') ?? 0) || undefined;
      lastError = new GmailApiError(response.status, c.code, c.message, retryAfter);
      if (c.code === 'AUTH_EXPIRED') { cache.clear(); continue; }
      // Skrivande anrop (POST/PUT/PATCH/DELETE) återförsöks aldrig vid 5xx/timeout – utfallet är då osäkert (ett utskick kan redan ha gått iväg). Bara rate limit (avvisas före behandling) och utgången token återförsöks.
      const safeToRetry = method === 'GET' || c.code === 'RATE_LIMITED';
      if (c.retryable && safeToRetry && attempt < 2) { await new Promise((r) => setTimeout(r, Math.min((retryAfter ?? 0) * 1000 || 400 * 2 ** attempt, 3000))); continue; }
      throw lastError;
    }
    throw lastError ?? new GmailApiError(500, 'unknown', 'Okänt Google-fel.');
  };
}
export const _clearTokenCache = () => cache.clear();
