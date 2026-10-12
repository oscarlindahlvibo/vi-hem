// igloohome-integration (AlgoPIN, offline-koder). Dokumenterat API:
//   OAuth2 client credentials: POST https://auth.igloohome.co/oauth2/token  (Basic base64(client_id:client_secret), grant_type=client_credentials)
//   Enheter:                   GET  https://api.igloohome.co/home/devices
//   Skapa kod:                 POST https://api.igloohome.co/home/devices/{deviceId}/algopin/{hourly|daily}  { accessName, startDate, endDate, variance? }  -> { pin, pinId }
// Begränsningar (igloohome): hourly 1–672 h, daily 29–367 dagar; koder längre än 24 h måste användas första gången inom 24 h efter start;
// start/slut i hela timmar. Allt som inte är verifierat mot ett fysiskt lås är markerat som antagande nedan.
// Leverantören är bakom ett gränssnitt så att den kan bytas ut mot en mock i tester och när konto/lås saknas.

export interface LockDevice { id: string; name: string; model: string; timezone?: string; raw?: unknown }
export interface PinRequest { deviceId: string; start: Date; end: Date; accessName: string; timezone: string }
export interface IssuedPin { pin: string; pinId: string; pinType: "hourly" | "daily" | "mock" }
export interface LockProvider {
  readonly name: string;
  listDevices(): Promise<LockDevice[]>;
  createPin(request: PinRequest): Promise<IssuedPin>;
}

export class LockProviderError extends Error {
  constructor(message: string, public readonly status = 0, public readonly retryable = false) { super(message); }
}

const AUTH_URL = "https://auth.igloohome.co/oauth2/token";
const API_URL = "https://api.igloohome.co/home";

/** Formaterar ett ögonblick som lokal tid i given tidszon med UTC-offset, t.ex. 2026-10-17T10:00:00+02:00. */
export function formatWithOffset(date: Date, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date).map((p) => [p.type, p.value]));
  const localAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMin = Math.round((localAsUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Väljer PIN-typ utifrån hyrestid och avrundar till hela timmar (start nedåt, slut uppåt). */
export function planPin(start: Date, end: Date): { type: "hourly" | "daily"; start: Date; end: Date } {
  const hour = 3600_000;
  const s = new Date(Math.floor(start.getTime() / hour) * hour);
  const e = new Date(Math.ceil(end.getTime() / hour) * hour);
  const hours = (e.getTime() - s.getTime()) / hour;
  if (hours < 1) throw new LockProviderError("Perioden är kortare än en timme.");
  if (hours <= 672) return { type: "hourly", start: s, end: e };
  if (hours >= 29 * 24 && hours <= 367 * 24) return { type: "daily", start: s, end: e };
  // 28–29 dygn och > 367 dygn går inte att utfärda med en enda AlgoPIN-typ.
  throw new LockProviderError(hours > 367 * 24 ? "Hyrestiden är längre än 367 dygn – koden måste utfärdas manuellt." : "Hyrestider mellan 28 och 29 dygn stöds inte av igloohomes kodtyper – utfärda koden manuellt.");
}

export class IgloohomeProvider implements LockProvider {
  readonly name = "igloohome";
  private token: { value: string; expires: number } | null = null;
  constructor(private clientId: string, private clientSecret: string, private fetcher: typeof fetch = fetch) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const response = await this.fetcher(AUTH_URL, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new LockProviderError(response.status === 401 ? "igloohome avvisade inloggningsuppgifterna." : `igloohome-inloggning misslyckades (${response.status}).`, response.status, response.status >= 500);
    this.token = { value: data.access_token, expires: Date.now() + (Number(data.expires_in) || 86400) * 1000 };
    return this.token.value;
  }

  private async call(path: string, init: RequestInit = {}) {
    const response = await this.fetcher(`${API_URL}${path}`, { ...init, headers: { Authorization: `Bearer ${await this.accessToken()}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = String(data?.message || data?.error || "").slice(0, 200);
      const known: Record<number, string> = {
        400: "igloohome nekade begäran (ogiltiga datum eller kodtyp).", 401: "igloohome-nyckeln är ogiltig eller har gått ut.",
        402: "igloohome-kontots API-provperiod har gått ut – uppgradera kontot.", 403: "API-nyckeln saknar behörighet (scope) för den här kodtypen eller låset.",
        404: "Låset hittades inte hos igloohome.", 409: "Låsets fastighet saknar tidszon hos igloohome – ställ in den i igloohome-appen.",
      };
      throw new LockProviderError(`${known[response.status] || `igloohome svarade ${response.status}.`}${detail ? ` (${detail})` : ""}`, response.status, response.status >= 500 || response.status === 429);
    }
    return data;
  }

  async listDevices(): Promise<LockDevice[]> {
    const data = await this.call("/devices");
    const list: any[] = Array.isArray(data) ? data : data.payload || data.data || data.devices || [];
    return list.map((d) => ({ id: String(d.deviceId ?? d.id), name: String(d.deviceName ?? d.name ?? d.deviceId ?? d.id), model: String(d.type ?? d.model ?? d.deviceType ?? ""), timezone: d.timezone, raw: undefined }));
  }

  async createPin(request: PinRequest): Promise<IssuedPin> {
    const plan = planPin(request.start, request.end);
    const data = await this.call(`/devices/${encodeURIComponent(request.deviceId)}/algopin/${plan.type}`, {
      method: "POST",
      body: JSON.stringify({ accessName: request.accessName.slice(0, 50), startDate: formatWithOffset(plan.start, request.timezone), endDate: formatWithOffset(plan.end, request.timezone) }),
    });
    const pin = String(data.pin ?? ""), pinId = String(data.pinId ?? "");
    if (!pin) throw new LockProviderError("igloohome returnerade ingen kod.");
    return { pin, pinId, pinType: plan.type };
  }
}

/** Mock för tester och för miljöer utan konto/lås. Ger deterministiska "koder" och räknar anrop. */
export class MockLockProvider implements LockProvider {
  readonly name = "mock";
  calls: PinRequest[] = [];
  failNext: LockProviderError | null = null;
  constructor(private devices: LockDevice[] = [{ id: "MOCK-LOCK-1", name: "Testlås", model: "mock" }]) {}
  async listDevices() { return this.devices; }
  async createPin(request: PinRequest): Promise<IssuedPin> {
    if (this.failNext) { const e = this.failNext; this.failNext = null; throw e; }
    this.calls.push(request);
    planPin(request.start, request.end);
    return { pin: String(100000 + (this.calls.length * 7919) % 899999), pinId: `mock-${this.calls.length}`, pinType: "mock" };
  }
}
