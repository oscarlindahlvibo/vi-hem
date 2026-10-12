// Cellsynt-utskick utan inloggad användare (för schemalagda jobb). Använder samma inställningar och kryptering som vihem-send-sms.
// Meddelandet i loggtabellen sparas MASKERAT (t.ex. koden som ••••) – den riktiga texten lämnar aldrig denna funktion.
const enc = new TextEncoder();
const secretKey = () => Deno.env.get("VIHEM_CELLSYNT_SECRET_KEY") || Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
async function decrypt(value: string) {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(secretKey()));
  const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
}
export function normalisePhone(value: unknown) {
  const raw = String(value ?? "").trim().replace(/[\s()-]/g, "");
  if (raw.startsWith("+")) return `00${raw.slice(1)}`;
  if (raw.startsWith("00")) return raw;
  if (raw.startsWith("0")) return `0046${raw.slice(1)}`;
  return raw;
}

export interface SmsResult { ok: boolean; messageId?: string; externalId?: string; error?: string }

export async function sendSms(admin: any, organisationId: string, recipientRaw: string, message: string, maskedMessage: string, related: { type: string; id: string }): Promise<SmsResult> {
  const recipient = normalisePhone(recipientRaw);
  if (!/^00\d{8,15}$/.test(recipient)) return { ok: false, error: "Ogiltigt telefonnummer." };
  const { data: settings } = await admin.from("vihem_sms_settings").select("enabled,sender,encrypted_username,encrypted_password,encrypted_api_url").eq("organisation_id", organisationId).maybeSingle();
  if (settings && !settings.enabled) return { ok: false, error: "SMS är inte aktiverat för organisationen." };
  const sender = String(settings?.sender || Deno.env.get("CELLSYNT_SENDER") || "").slice(0, 11);
  let username: string | undefined, password: string | undefined, endpoint: string;
  try {
    username = settings?.encrypted_username ? await decrypt(settings.encrypted_username) : Deno.env.get("CELLSYNT_USERNAME");
    password = settings?.encrypted_password ? await decrypt(settings.encrypted_password) : Deno.env.get("CELLSYNT_PASSWORD");
    endpoint = settings?.encrypted_api_url ? await decrypt(settings.encrypted_api_url) : (Deno.env.get("CELLSYNT_API_URL") || "https://se-1.cellsynt.net/sms.php");
  } catch { return { ok: false, error: "Cellsynt-inställningarna kunde inte läsas." }; }
  if (!username || !password || !sender) return { ok: false, error: "Cellsynt är inte konfigurerat." };

  const { data: log, error: logError } = await admin.from("vihem_sms_messages").insert({ organisation_id: organisationId, provider: "cellsynt", recipient, message: maskedMessage, status: "sending", related_type: related.type, related_id: related.id }).select("id").single();
  if (logError) return { ok: false, error: "SMS-loggen kunde inte skrivas." };
  try {
    const params = new URLSearchParams({ username, password, destination: recipient, type: "text", charset: "UTF-8", text: message, originatortype: "alpha", originator: sender });
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/plain" }, body: params });
    const result = (await response.text()).trim();
    if (!response.ok || !/^OK:\s*/i.test(result)) throw new Error(`Cellsynt (${response.status}): ${result.slice(0, 120)}`);
    const externalId = result.replace(/^OK:\s*/i, "").slice(0, 200);
    await admin.from("vihem_sms_messages").update({ status: "sent", external_id: externalId, sent_at: new Date().toISOString() }).eq("id", log.id);
    return { ok: true, messageId: log.id, externalId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "SMS-utskicket misslyckades.";
    await admin.from("vihem_sms_messages").update({ status: "failed", error: reason.slice(0, 300) }).eq("id", log.id);
    return { ok: false, messageId: log.id, error: reason.slice(0, 300) };
  }
}
