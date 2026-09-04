// Sends mail via the Gmail API using the same Google Workspace service
// account + Domain-Wide Delegation already set up for vihem-gmail/index.ts
// (which only reads mail). This is a fresh copy of the credential/JWT-token
// plumbing rather than an extraction of vihem-gmail's version -- same
// reasoning as smtp-mailer.ts: that function serves real mailbox reads
// today, so it isn't touched to avoid risking that path while adding this
// one. If this proves itself, folding the two together is a natural
// follow-up.
//
// Requires the service account's Domain-Wide Delegation Client ID (Google
// Admin Console > Security > API controls > Domain-wide delegation) to have
// the https://www.googleapis.com/auth/gmail.send scope authorized, in
// addition to whatever scopes vihem-gmail already needs -- without it every
// call here fails with GOOGLE_TOKEN_FAILED:unauthorized_client.
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export interface GmailSendParams {
  fromEmail: string;
  fromName?: string;
  toEmail: string;
  toName?: string;
  subject: string;
  text: string;
  attachment?: { fileName: string; contentType: string; bytes: Uint8Array };
}

// response.json() has been observed to hang indefinitely (never resolves
// OR rejects) on non-2xx bodies in this edge runtime -- reading the body as
// text first (with a hard timeout) and parsing that manually sidesteps
// whatever is wrong with its streaming/json() path specifically.
async function readBodySafely(response: Response): Promise<{ raw: string; json: any }> {
  const raw = await Promise.race([
    response.text(),
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error("BODY_READ_TIMEOUT")), 10000)),
  ]).catch(() => "");
  let json: any = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { /* not JSON */ }
  return { raw, json };
}

export async function sendGmailMessage(db: any, organisationId: string, params: GmailSendParams): Promise<void> {
  const accessToken = await googleToken(db, organisationId, params.fromEmail, GMAIL_SEND_SCOPE);
  const raw = base64url(buildRfc822Message(params));
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(params.fromEmail)}/messages/send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) {
    const { json: payload } = await readBodySafely(response);
    throw new Error(`GOOGLE_GMAIL_SEND_FAILED:${response.status}:${payload.error?.status || ""}:${payload.error?.message || ""}`);
  }
}

function buildRfc822Message(params: GmailSendParams): string {
  const headers = [
    `From: ${formatAddress(params.fromName || "", params.fromEmail)}`,
    `To: ${formatAddress(params.toName || "", params.toEmail)}`,
    `Subject: ${encodeHeader(params.subject)}`,
    "MIME-Version: 1.0",
  ];

  if (!params.attachment) {
    return [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(bytesToBase64(new TextEncoder().encode(params.text))),
      "",
    ].join("\r\n");
  }

  const boundary = `vihem-mixed-${crypto.randomUUID()}`;
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(bytesToBase64(new TextEncoder().encode(params.text))),
    "",
    `--${boundary}`,
    `Content-Type: ${params.attachment.contentType}; name="${params.attachment.fileName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${params.attachment.fileName}"`,
    "",
    wrapBase64(bytesToBase64(params.attachment.bytes)),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function googleCredentials(db: any, organisationId: string) {
  const { data } = await db
    .from("vihem_google_workspace_settings")
    .select("encrypted_service_account_json")
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (data?.encrypted_service_account_json) {
    try {
      return JSON.parse(await decryptSecret(data.encrypted_service_account_json, encryptionSecret()));
    } catch {
      throw new Error("GOOGLE_CREDENTIALS_UNREADABLE");
    }
  }
  const rawEnv = Deno.env.get("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON") || Deno.env.get("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON_BASE64");
  if (rawEnv) {
    try {
      return JSON.parse(rawEnv.startsWith("{") ? rawEnv : atob(rawEnv));
    } catch {
      throw new Error("GOOGLE_CREDENTIALS_INVALID_JSON");
    }
  }
  throw new Error("GOOGLE_CREDENTIALS_MISSING");
}

async function googleToken(db: any, organisationId: string, subject: string, scope: string): Promise<string> {
  const credentials = await googleCredentials(db, organisationId);
  if (!credentials?.client_email || !credentials?.private_key) throw new Error("GOOGLE_CREDENTIALS_MISSING");
  const now = Math.floor(Date.now() / 1000);
  const encodePart = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encodePart({ alg: "RS256", typ: "JWT" })}.${encodePart({
    iss: credentials.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    sub: subject,
    iat: now,
    exp: now + 3600,
  })}`;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("pkcs8", pem(credentials.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    throw new Error("GOOGLE_PRIVATE_KEY_INVALID");
  }
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${b64url(new Uint8Array(signature))}`,
    signal: AbortSignal.timeout(15000),
  });
  const { json: payload } = await readBodySafely(response);
  if (!response.ok) {
    throw new Error(`GOOGLE_TOKEN_FAILED:${payload.error || "unknown"}:${payload.error_description || ""}`);
  }
  if (!payload.access_token) throw new Error("GOOGLE_TOKEN_FAILED:missing_token:");
  return payload.access_token as string;
}

async function decryptSecret(value: string, secret: string): Promise<string> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]);
  return decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher));
}

function encryptionSecret() {
  return (
    Deno.env.get("VIHEM_GOOGLE_WORKSPACE_SECRET_KEY") ||
    Deno.env.get("VIHEM_OCR_SECRET_KEY") ||
    Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    ""
  );
}

function pem(value: string) {
  const binary = atob(value.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ""));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function formatAddress(name: string, email: string) {
  return name ? `${encodeHeader(name)} <${email}>` : `<${email}>`;
}

function encodeHeader(value: string) {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(value))}?=`;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  return btoa(binary);
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join("\r\n") || "";
}

// Gmail API's `raw` field needs URL-safe (base64url) encoding with no
// padding, unlike the MIME body's own base64 content-transfer-encoding
// (regular base64, wrapped at 76 chars) used inside the message itself.
function base64url(message: string) {
  return btoa(unescape(encodeURIComponent(message))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function googleMailerErrorCode(error: unknown) {
  const s = String(error);
  if (s.includes("GOOGLE_CREDENTIALS_MISSING")) return "CREDENTIALS_MISSING";
  if (s.includes("GOOGLE_CREDENTIALS_UNREADABLE")) return "CREDENTIALS_UNREADABLE";
  if (s.includes("GOOGLE_CREDENTIALS_INVALID_JSON")) return "CREDENTIALS_INVALID_JSON";
  if (s.includes("GOOGLE_PRIVATE_KEY_INVALID")) return "PRIVATE_KEY_INVALID";
  if (s.includes("unauthorized_client")) return "UNAUTHORIZED_CLIENT";
  if (s.includes("invalid_grant")) return "INVALID_GRANT";
  if (s.includes("GOOGLE_TOKEN_FAILED")) return "GOOGLE_TOKEN_FAILED";
  if (s.includes("GOOGLE_GMAIL_SEND_FAILED")) return "GOOGLE_GMAIL_SEND_FAILED";
  return "GOOGLE_API_ERROR";
}

export function googleMailerFriendlyMessage(code: string) {
  const messages: Record<string, string> = {
    CREDENTIALS_MISSING: "Google service account saknas. Lägg in JSON-nyckeln under E-post & underlag i Inställningar.",
    CREDENTIALS_UNREADABLE: "Den sparade Google-nyckeln kunde inte dekrypteras. Spara om JSON-nyckeln och testa igen.",
    CREDENTIALS_INVALID_JSON: "Google-nyckeln är inte giltig JSON.",
    PRIVATE_KEY_INVALID: "Google private_key kunde inte läsas.",
    UNAUTHORIZED_CLIENT: "Google avvisade servicekontot för att skicka e-post. Kontrollera att gmail.send-scopet är tillagt för Domain-Wide Delegation i Google Admin Console.",
    INVALID_GRANT: "Google avvisade delegeringen. Kontrollera Domain-Wide Delegation och att avsändaradressen finns i er Workspace.",
    GOOGLE_TOKEN_FAILED: "Google kunde inte utfärda en åtkomsttoken för att skicka e-post.",
    GOOGLE_GMAIL_SEND_FAILED: "Gmail API kunde inte skicka meddelandet.",
  };
  return messages[code] || "E-postutskicket via Google misslyckades.";
}
