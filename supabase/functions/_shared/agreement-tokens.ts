// Secure signing-link tokens for Avtal V2.
//
// The raw token is generated here, returned to the caller EXACTLY ONCE (to
// be sent via email/SMS or shown to the admin), and never persisted -- only
// its sha256 hash is written to vihem_agreement_signature_requests.
// verifyToken() re-hashes an incoming token the same way for lookup.
// Deliberately hash-at-rest rather than the plaintext-token convention used
// by vihem_laundry_guest_links elsewhere in this codebase -- see the
// migration header (20260822120000) for why a legal signature link is held
// to a stricter bar.
const TOKEN_BYTES = 32; // 256 bits of entropy, base64url-encoded (43 chars, vs. 64 for hex)

/**
 * base64url (RFC 4648 §5) rather than hex: same 256 bits of entropy, ~1/3
 * shorter string -- meaningfully shortens the SMS signing link, and
 * base64url is URL-safe by construction (+/= replaced, no extra encoding
 * needed in the query string). Verification is encoding-agnostic (just
 * hashes whatever string it receives), so this doesn't touch already-issued
 * tokens' validity.
 */
export function generateSigningToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashSigningToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildSigningUrl(baseAppUrl: string, token: string): string {
  const url = new URL("/sign", baseAppUrl.replace(/\/$/, "") + "/");
  url.searchParams.set("token", token);
  return url.toString();
}
