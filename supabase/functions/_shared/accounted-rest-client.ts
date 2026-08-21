// Server-side REST client for Accounted's /api/v1 surface.
//
// This is the ONLY place in VI-HEM that should build a Bearer request against
// Accounted's v1 API. It never runs in the frontend: the Accounted API key is
// a server secret decrypted just-in-time by the caller and passed in here.
//
// Contract notes (from Accounted's own v1 wrapper, lib/api/v1/with-api-v1.ts):
//   - Auth: `Authorization: Bearer gnubok_sk_...`
//   - Idempotency-Key header required on invoice/customer/webhook POSTs.
//     Accounted replays the cached response for a repeated key+body, so a
//     retried request after a network failure is always safe to resend
//     with the SAME key.
//   - Dry-run: either `?dry_run=true` or `X-Dry-Run: true`. A dry-run
//     response is never cached under the idempotency key, so it can be
//     safely retried before the real (non-dry-run) call.
//   - Error envelope: { error: { code, message, message_en, details,
//     recovery_hint, docs_url, request_id } }. Always surface `code` (and
//     `recovery_hint` when present) to the caller instead of the raw HTTP
//     status — Accounted's codes are stable and documented, the status
//     alone is not enough to act on.

export interface AccountedErrorShape {
  code: string;
  message: string;
  message_en?: string;
  details?: unknown;
  recovery_hint?: string;
  docs_url?: string;
  request_id?: string;
  http_status: number;
}

export class AccountedApiError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly recoveryHint?: string;
  readonly httpStatus: number;
  readonly requestId?: string;

  constructor(shape: AccountedErrorShape) {
    super(shape.message_en || shape.message || `Accounted API error (${shape.code})`);
    this.name = "AccountedApiError";
    this.code = shape.code;
    this.details = shape.details;
    this.recoveryHint = shape.recovery_hint;
    this.httpStatus = shape.http_status;
    this.requestId = shape.request_id;
  }
}

export interface AccountedClientConfig {
  baseUrl: string;
  apiKey: string;
  /** Request timeout in ms. Accounted writes can involve PDF rendering; keep this generous. */
  timeoutMs?: number;
}

export interface AccountedRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  dryRun?: boolean;
  query?: Record<string, string | undefined>;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export function createAccountedClient(config: AccountedClientConfig) {
  const baseUrl = config.baseUrl.trim().replace(/\/$/, "");
  const apiKey = config.apiKey.trim();
  if (!baseUrl) throw new Error("Accounted base-URL saknas.");
  if (!apiKey) throw new Error("Accounted API-nyckel saknas.");
  if (!apiKey.startsWith("gnubok_sk_")) {
    throw new Error("Accounted API-nyckeln har fel format (ska börja med gnubok_sk_).");
  }

  async function request<T = unknown>(path: string, options: AccountedRequestOptions = {}): Promise<T> {
    const url = new URL(`${baseUrl}${path}`);
    if (options.dryRun) url.searchParams.set("dry_run", "true");
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: options.method || "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new AccountedApiError({
        code: aborted ? "ACCOUNTED_TIMEOUT" : "ACCOUNTED_NETWORK_ERROR",
        message: aborted
          ? "Accounted svarade inte inom tidsgränsen."
          : `Kunde inte nå Accounted: ${err instanceof Error ? err.message : String(err)}`,
        http_status: 0,
      });
    }
    clearTimeout(timeout);

    const text = await response.text();
    let payload: any = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const requestId = response.headers.get("X-Request-Id") || undefined;
      if (payload && payload.error && typeof payload.error === "object") {
        throw new AccountedApiError({
          code: String(payload.error.code || "ACCOUNTED_ERROR"),
          message: String(payload.error.message || "Okänt fel från Accounted."),
          message_en: payload.error.message_en,
          details: payload.error.details,
          recovery_hint: payload.error.recovery_hint,
          docs_url: payload.error.docs_url,
          request_id: payload.error.request_id || requestId,
          http_status: response.status,
        });
      }
      throw new AccountedApiError({
        code: `HTTP_${response.status}`,
        message: text.slice(0, 500) || `Accounted svarade ${response.status}.`,
        request_id: requestId,
        http_status: response.status,
      });
    }

    if (payload === null) {
      throw new AccountedApiError({
        code: "ACCOUNTED_INVALID_RESPONSE",
        message: "Accounted svarade med ogiltig JSON.",
        http_status: response.status,
      });
    }

    // v1 success envelope is either { data: ... } or, for dry-run previews,
    // { data: { dry_run: true, preview: ... } }. Callers that need the raw
    // envelope (e.g. to check dry_run) can pass through payload.data as-is;
    // most callers just want `data`.
    return (payload.data ?? payload) as T;
  }

  return {
    get: <T = unknown>(path: string, query?: Record<string, string | undefined>) =>
      request<T>(path, { method: "GET", query }),
    post: <T = unknown>(path: string, body: unknown, opts: { idempotencyKey: string; dryRun?: boolean }) =>
      request<T>(path, { method: "POST", body, idempotencyKey: opts.idempotencyKey, dryRun: opts.dryRun }),
    patch: <T = unknown>(path: string, body: unknown, opts: { idempotencyKey?: string }) =>
      request<T>(path, { method: "PATCH", body, idempotencyKey: opts.idempotencyKey }),
    async healthCheck(companyId: string): Promise<{ ok: boolean; error?: AccountedErrorShape }> {
      try {
        await request(`/api/v1/companies/${encodeURIComponent(companyId)}`, { method: "GET" });
        return { ok: true };
      } catch (err) {
        if (err instanceof AccountedApiError) {
          return {
            ok: false,
            error: {
              code: err.code,
              message: err.message,
              recovery_hint: err.recoveryHint,
              details: err.details,
              http_status: err.httpStatus,
              request_id: err.requestId,
            },
          };
        }
        throw err;
      }
    },
  };
}

/**
 * Deterministic Idempotency-Key derived from a stable local identity
 * (e.g. `${sourceType}:${sourceId}`), so a retried edge-function invocation
 * after a network failure or Supabase timeout re-sends the SAME key and
 * Accounted replays its cached response instead of creating a duplicate.
 * Callers that need a fresh attempt (e.g. explicit "create again") must
 * append a distinguishing suffix themselves (e.g. a revision counter).
 */
export async function deriveIdempotencyKey(parts: string[]): Promise<string> {
  const input = parts.join(":");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `vihem-${hex.slice(0, 40)}`;
}
