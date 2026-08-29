// Apple Push Notification service (APNs) sender -- ES256-signed provider
// token (RFC 8032 JWS via Web Crypto, no external library needed since
// crypto.subtle's ECDSA/SHA-256 signature output is already the raw r||s
// format JWS ES256 expects, unlike Node's default DER encoding) plus a
// plain HTTP/2 POST to Apple's device endpoint. See vihem-send-push for
// the caller -- this module only knows how to talk to APNs, not about
// vihem_notifications or vihem_push_tokens.

export interface ApnsConfig {
  authKey: string; // .p8 file content, PEM (with or without header/footer)
  keyId: string;
  teamId: string;
  topic: string; // app bundle id, e.g. se.vihem.app
  environment: "development" | "production";
}

export interface ApnsPushPayload {
  title: string;
  body: string;
  badge?: number;
  sound?: string;
  data?: Record<string, unknown>;
}

export interface ApnsSendResult {
  ok: boolean;
  status: number;
  reason?: string;
  /** True when the device token is permanently invalid and should be deactivated. */
  tokenInvalid: boolean;
}

const TOKEN_INVALID_REASONS = new Set([
  "BadDeviceToken",
  "Unregistered",
  "DeviceTokenNotForTopic",
  "TopicDisallowed",
]);

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlFromString(value: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(value));
}

function pkcs8KeyBytesFromPem(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let cachedToken: { jwt: string; keyId: string; expiresAt: number } | null = null;

// APNs provider tokens are valid up to 1h; Apple asks clients not to
// generate a new one on every request, so cache per (warm) function
// instance and only regenerate a few minutes before expiry.
async function providerToken(config: ApnsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.keyId === config.keyId && cachedToken.expiresAt - now > 300) {
    return cachedToken.jwt;
  }

  const header = base64UrlFromString(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64UrlFromString(JSON.stringify({ iss: config.teamId, iat: now }));
  const unsigned = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8KeyBytesFromPem(config.authKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned),
  );

  const jwt = `${unsigned}.${base64UrlFromBytes(new Uint8Array(signature))}`;
  cachedToken = { jwt, keyId: config.keyId, expiresAt: now + 3600 };
  return jwt;
}

export async function sendApnsPush(deviceToken: string, payload: ApnsPushPayload, config: ApnsConfig): Promise<ApnsSendResult> {
  const host = config.environment === "production" ? "api.push.apple.com" : "api.sandbox.push.apple.com";
  const jwt = await providerToken(config);

  const body: Record<string, unknown> = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: payload.sound || "default",
      ...(payload.badge !== undefined ? { badge: payload.badge } : {}),
    },
    ...(payload.data || {}),
  };

  const response = await fetch(`https://${host}/3/device/${deviceToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": config.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.status === 200) return { ok: true, status: 200, tokenInvalid: false };

  const reason = await response.json().catch(() => ({}))
    .then((data: { reason?: string }) => data.reason)
    .catch(() => undefined);
  return { ok: false, status: response.status, reason, tokenInvalid: !!reason && TOKEN_INVALID_REASONS.has(reason) };
}
