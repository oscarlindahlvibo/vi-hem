// AES-GCM encrypt/decrypt for Accounted V2 integration secrets (company API
// keys, webhook signing secrets). Mirrors the scheme already used by
// vihem-save-accounting-secret / vihem-process-accounting-sync (SHA-256 of the
// server secret as key material, random 12-byte IV, base64(iv + ciphertext)),
// but reads a dedicated env var so V2 secrets can be rotated independently of
// the legacy generic bookkeeping-sync integration.
const ENCRYPTION_ENV_VAR = "VIHEM_ACCOUNTED_SECRET_KEY";

export function getAccountedEncryptionSecret(): string {
  const value = Deno.env.get(ENCRYPTION_ENV_VAR) || "";
  if (!value) {
    throw new Error(
      `${ENCRYPTION_ENV_VAR} saknas i edge-miljön. Sätt en dedikerad hemlighet innan Accounted-nycklar kan sparas.`,
    );
  }
  return value;
}

async function importKey(encryptionSecret: string, usage: "encrypt" | "decrypt") {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest("SHA-256", encoder.encode(encryptionSecret));
  return crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, [usage]);
}

export async function encryptAccountedSecret(plainText: string): Promise<string> {
  const encryptionSecret = getAccountedEncryptionSecret();
  const encoder = new TextEncoder();
  const key = await importKey(encryptionSecret, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plainText));
  const combined = new Uint8Array(iv.length + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptAccountedSecret(encrypted: string): Promise<string> {
  const encryptionSecret = getAccountedEncryptionSecret();
  const key = await importKey(encryptionSecret, "decrypt");
  const bytes = Uint8Array.from(atob(encrypted), (char) => char.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plainBuffer);
}

/** Last 4 chars only, for display in admin UI without ever exposing the full key. */
export function hintFor(secretValue: string): string {
  const trimmed = secretValue.trim();
  if (trimmed.length <= 4) return "****";
  return `****${trimmed.slice(-4)}`;
}
