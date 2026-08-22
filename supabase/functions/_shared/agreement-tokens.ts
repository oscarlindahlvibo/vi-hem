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
const TOKEN_BYTES = 32; // 256 bits of entropy, hex-encoded (64 chars)

export function generateSigningToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
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
