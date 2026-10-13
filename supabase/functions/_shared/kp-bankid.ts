// BankID för Kompetensportalen via samma leverantör (BankSignering) och samma organisationsinställningar som vihem-bankid.
// Leverantörsanropen är avsiktligt en separat liten kopia: vihem-bankid lämnas orörd. Inget personnummer skrivs till loggar.
const TEST = { sign: "https://banksign-test.azurewebsites.net/api/sign", collect: "https://banksign-test.azurewebsites.net/api/collectstatus" };
const PROD = { sign: "https://api.banksignering.se/api/sign", collect: "https://api.banksignering.se/api/collectstatus" };

const secret = () => Deno.env.get("VIHEM_BANKID_SECRET_KEY") || Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
async function decrypt(value: string): Promise<string> {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret()));
  const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
}
async function credentials(s: any) {
  return { apiUser: await decrypt(s.encrypted_api_user), password: await decrypt(s.encrypted_password), companyApiGuid: await decrypt(s.encrypted_company_api_guid) };
}
function endpoint(s: any, which: "sign" | "collect") {
  const env = s.environment === "test" ? "TEST" : "PRODUCTION";
  const raw = String(Deno.env.get(`BANKSIGN_${env}_${which === "sign" ? "SIGN" : "COLLECT"}_URL`) || (s.environment === "test" ? TEST : PROD)[which]).trim().replace(/\/+$/, "");
  const action = which === "sign" ? "sign" : "collectstatus";
  if (/\/api\/(sign|collectstatus)$/i.test(raw)) return raw.replace(/\/api\/(sign|collectstatus)$/i, `/api/${action}`);
  return /\/api$/i.test(raw) ? `${raw}/${action}` : `${raw}/api/${action}`;
}
const unwrap = (d: any) => d?.apiCallResponse?.Response || d?.apiCallResponse?.response || d?.ApiCallResponse?.Response || d?.ApiCallResponse?.response || d?.Response || d?.response || d;
const pick = (o: any, keys: string[]) => { for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null) return o[k]; return undefined; };

export async function bankidSettings(admin: any, org: string, need: "login" | "link" | "sign") {
  const { data } = await admin.from("vihem_bankid_settings").select("*").eq("organisation_id", org).maybeSingle();
  if (!data?.enabled || (need === "login" && !data.login_enabled) || (need === "sign" && !data.signing_enabled) || !data.encrypted_api_user || !data.encrypted_password || !data.encrypted_company_api_guid) return null;
  return data;
}

export async function bankidStart(s: any, visibleText: string, endUserIp: string, nonVisibleData = "") {
  const response = await fetch(endpoint(s, "sign"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(await credentials(s)), endUserIp, userVisibleData: visibleText, userNonVisibleData: nonVisibleData, getQr: true }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`[E_BANKID] BankID kunde inte startas (${response.status}).`);
  const r = unwrap(data);
  const orderRef = String(pick(r, ["OrderRef", "orderRef", "order_ref"]) ?? "");
  const token = String(pick(r, ["AutoStartToken", "autoStartToken", "auto_start_token", "autostarttoken"]) ?? "");
  if (!orderRef) throw new Error("[E_BANKID] BankID returnerade inget order-id.");
  return { orderRef, autoStartToken: token, autoStartUrl: token ? `https://app.bankid.com/?autostarttoken=${encodeURIComponent(token)}` : "", qrImage: String(pick(r, ["QrImage", "qrImage", "qr_image"]) ?? "") || null };
}

export async function bankidCollect(s: any, orderRef: string): Promise<{ status: "pending" | "complete" | "failed"; hintCode?: string; personalNumber?: string; name?: string; givenName?: string; surname?: string; signature?: string; ocspResponse?: string }> {
  const response = await fetch(endpoint(s, "collect"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(await credentials(s)), orderRef }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`[E_BANKID] BankID-svar kunde inte hämtas (${response.status}).`);
  const r = unwrap(data);
  const status = String(pick(r, ["Status", "status"]) ?? "pending").toLowerCase();
  const hintCode = pick(r, ["HintCode", "hintCode", "hint_code"]);
  if (status === "failed") return { status: "failed", hintCode };
  if (status !== "complete") return { status: "pending", hintCode };
  const c = pick(r, ["CompletionData", "completionData", "completion_data"]);
  const pno = String(c?.User?.PersonalNumber ?? c?.user?.personalNumber ?? "").replace(/\D/g, "");
  const name = String(c?.User?.Name ?? c?.user?.name ?? "");
  const givenName = String(c?.User?.GivenName ?? c?.user?.givenName ?? ""), surname = String(c?.User?.Surname ?? c?.user?.surname ?? "");
  return pno.length === 12 ? { status: "complete", personalNumber: pno, name, givenName, surname, signature: c?.Signature ?? c?.signature ?? "", ocspResponse: c?.OcspResponse ?? c?.ocspResponse ?? "" } : { status: "failed", hintCode: "no_personal_number" };
}

/** Nyckelad hash för uppslag/unikhet. Samma nyckelmaterial som personnummerkrypteringen. */
export async function pnoHmac(pno: string): Promise<string> {
  const material = Deno.env.get("VIHEM_KP_SECRET_KEY") || "";
  if (!material) throw new Error("[E_CONFIG] Krypteringsnyckel för personuppgifter saknas på servern.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`vihem-kp-pno-v1:${material}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(pno)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
