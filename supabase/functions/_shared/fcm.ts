export interface FcmConfig {
  project_id: string;
  client_email: string;
  private_key: string;
}
export function parseFcmConfig(value: string | undefined): FcmConfig | null {
  try {
    const result = JSON.parse(value || "null");
    return result?.project_id && result?.client_email && result?.private_key
      ? result
      : null;
  } catch {
    return null;
  }
}
let cached: { email: string; token: string; expires: number } | null = null;
const base64url = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
export async function sendFcmPush(
  token: string,
  payload: { title: string; body: string; data: Record<string, string> },
  config: FcmConfig,
  fetcher = fetch,
) {
  try {
    let access =
      cached?.email === config.client_email &&
      cached.expires > Date.now() + 60000
        ? cached.token
        : null;
    if (!access) {
      const now = Math.floor(Date.now() / 1000),
        encoder = new TextEncoder();
      const header = base64url(
        encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
      );
      const claims = base64url(
        encoder.encode(
          JSON.stringify({
            iss: config.client_email,
            scope: "https://www.googleapis.com/auth/firebase.messaging",
            aud: "https://oauth2.googleapis.com/token",
            iat: now,
            exp: now + 3600,
          }),
        ),
      );
      const pem = config.private_key.replace(/-----[^-]+-----|\s/g, "");
      const binary = Uint8Array.from(atob(pem), (v) => v.charCodeAt(0));
      const key = await crypto.subtle.importKey(
        "pkcs8",
        binary,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signature = base64url(
        new Uint8Array(
          await crypto.subtle.sign(
            "RSASSA-PKCS1-v1_5",
            key,
            encoder.encode(header + "." + claims),
          ),
        ),
      );
      const response = await fetcher("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: header + "." + claims + "." + signature,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const result = await response.json();
      if (!response.ok || !result.access_token)
        return {
          ok: false,
          status: response.status,
          reason: "FCM_AUTH_FAILED",
          tokenInvalid: false,
        };
      access = result.access_token;
      cached = {
        email: config.client_email,
        token: access!,
        expires: Date.now() + Number(result.expires_in || 3600) * 1000,
      };
    }
    const response = await fetcher(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.project_id)}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body },
            data: payload.data,
            android: {
              priority: "HIGH",
              notification: { tag: payload.data.notification_id },
            },
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const data = await response.json();
    const unregistered = data.error?.details?.some(
      (value: { errorCode?: string }) => value.errorCode === "UNREGISTERED",
    );
    return {
      ok: response.ok,
      status: response.status,
      reason: response.ok
        ? undefined
        : unregistered
          ? "UNREGISTERED"
          : "FCM_SEND_FAILED",
      tokenInvalid: !!unregistered,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      reason: "FCM_CONNECTION_FAILED",
      tokenInvalid: false,
    };
  }
}
