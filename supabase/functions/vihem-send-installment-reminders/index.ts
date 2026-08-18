import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Cron-Secret",
};

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  startTls: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
};

type Reminder = {
  id: string;
  sent_to: string;
  reminder_type: string;
  plan?: { plan_number: string; terms: string; company?: { name: string }; customer?: { name: string } };
  schedule?: { id: string; installment_no: number; due_date: string; amount: number; paid_amount: number };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const cronSecret = Deno.env.get("VIHEM_CRON_SECRET") || "";
    const isCron = Boolean(cronSecret && req.headers.get("X-Cron-Secret") === cronSecret);
    if (!isCron) return json({ error: "Unauthorized" }, 401);

    const smtp = readSmtpConfig();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const organisationId = typeof body.organisation_id === "string" ? body.organisation_id : "";
    const limit = Math.min(Math.max(Number(body.limit || 20), 1), 50);

    let query = client
      .from("vihem_installment_reminder_log")
      .select("*, plan:plan_id(plan_number, terms, company:company_id(name), customer:customer_id(name)), schedule:schedule_id(id, installment_no, due_date, amount, paid_amount)")
      .eq("status", "queued")
      .order("sent_at", { ascending: true })
      .limit(limit);
    if (organisationId) query = query.eq("organisation_id", organisationId);

    const { data, error } = await query;
    if (error) throw error;
    const results: Array<Record<string, unknown>> = [];

    for (const reminder of (data || []) as Reminder[]) {
      try {
        await smtpSend(smtp, smtp.fromEmail, reminder.sent_to, buildMessage(smtp, reminder));
        const sentAt = new Date().toISOString();
        await client.from("vihem_installment_reminder_log").update({ status: "sent", sent_at: sentAt, error: null }).eq("id", reminder.id);
        if (reminder.schedule?.id) {
          await client.from("vihem_installment_schedule").update({ email_status: "sent", email_sent_at: sentAt, email_error: null }).eq("id", reminder.schedule.id);
        }
        results.push({ id: reminder.id, status: "sent" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Kunde inte skicka avbetalningspåminnelse.";
        await client.from("vihem_installment_reminder_log").update({ status: "failed", error: message }).eq("id", reminder.id);
        if (reminder.schedule?.id) {
          await client.from("vihem_installment_schedule").update({ email_status: "failed", email_error: message }).eq("id", reminder.schedule.id);
        }
        results.push({ id: reminder.id, status: "failed", error: message });
      }
    }

    return json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

function readSmtpConfig(): SmtpConfig {
  const host = Deno.env.get("SMTP_HOST") || "";
  const fromEmail = Deno.env.get("SMTP_FROM_EMAIL") || Deno.env.get("SMTP_USERNAME") || "";
  if (!host) throw new Error("SMTP_HOST saknas i edge function-miljön.");
  if (!fromEmail) throw new Error("SMTP_FROM_EMAIL saknas i edge function-miljön.");
  return {
    host,
    port: Number(Deno.env.get("SMTP_PORT") || "25"),
    secure: (Deno.env.get("SMTP_SECURE") || "").toLowerCase() === "true",
    startTls: (Deno.env.get("SMTP_STARTTLS") || "").toLowerCase() === "true",
    username: Deno.env.get("SMTP_USERNAME") || "",
    password: Deno.env.get("SMTP_PASSWORD") || "",
    fromEmail,
    fromName: Deno.env.get("SMTP_FROM_NAME") || "VI-HEM",
  };
}

function buildMessage(smtp: SmtpConfig, reminder: Reminder) {
  const plan = reminder.plan;
  const schedule = reminder.schedule;
  const subject = reminder.reminder_type === "overdue"
    ? `Förfallen betalning – ${plan?.plan_number || "avbetalningsplan"}`
    : `Påminnelse om betalning – ${plan?.plan_number || "avbetalningsplan"}`;
  const text = [
    `Hej ${plan?.customer?.name || ""}!`,
    "",
    subject,
    `Plan: ${plan?.plan_number || "-"}`,
    `Delbetalning: ${schedule?.installment_no || "-"}`,
    `Förfallodatum: ${schedule?.due_date || "-"}`,
    `Belopp: ${Number(schedule?.amount || 0).toFixed(2)} kr`,
    "",
    "Detta är en administrativ betalningspåminnelse och inte en ny faktura.",
    "Kontakta oss om betalningen redan är gjord eller om du har frågor.",
  ].join("\n");
  const boundary = `vihem-installment-${crypto.randomUUID()}`;
  return [
    `From: ${formatAddress(smtp.fromName, smtp.fromEmail)}`,
    `To: <${reminder.sent_to}>`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(bytesToBase64(new TextEncoder().encode(text))),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function smtpSend(config: SmtpConfig, fromEmail: string, toEmail: string, message: string) {
  let connection: Deno.Conn | Deno.TlsConn = config.secure
    ? await Deno.connectTls({ hostname: config.host, port: config.port })
    : await Deno.connect({ hostname: config.host, port: config.port });
  let reader = connection.readable.getReader();
  let writer = connection.writable.getWriter();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffered = "";
  const readResponse = async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("SMTP-anslutningen stängdes.");
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (/^\d{3} /.test(last)) { const response = lines.join("\n"); buffered = ""; return response; }
    }
  };
  const expect = async (codes: number[]) => { const response = await readResponse(); const code = Number(response.slice(0, 3)); if (!codes.includes(code)) throw new Error(`SMTP svarade ${code}: ${response}`); };
  const command = async (line: string, codes: number[]) => { await writer.write(encoder.encode(`${line}\r\n`)); await expect(codes); };
  try {
    await expect([220]);
    await command(`EHLO ${config.host}`, [250]);
    if (config.startTls && !config.secure) {
      await command("STARTTLS", [220]);
      writer.releaseLock(); reader.releaseLock();
      connection = await (Deno as any).startTls(connection, { hostname: config.host });
      reader = connection.readable.getReader(); writer = connection.writable.getWriter();
      await command(`EHLO ${config.host}`, [250]);
    }
    if (config.username && config.password) await command(`AUTH PLAIN ${bytesToBase64(new TextEncoder().encode(`\0${config.username}\0${config.password}`))}`, [235]);
    await command(`MAIL FROM:<${fromEmail}>`, [250]);
    await command(`RCPT TO:<${toEmail}>`, [250, 251]);
    await command("DATA", [354]);
    await writer.write(encoder.encode(`${message.replace(/\r?\n\./g, "\r\n..")}\r\n.\r\n`));
    await expect([250]);
    await command("QUIT", [221]);
  } finally {
    try { writer.releaseLock(); reader.releaseLock(); connection.close(); } catch { /* already closed */ }
  }
}

function formatAddress(name: string, email: string) { return name ? `${encodeHeader(name)} <${email}>` : `<${email}>`; }
function encodeHeader(value: string) { return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(value))}?=`; }
function bytesToBase64(bytes: Uint8Array) { let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.slice(i, i + 0x8000)); return btoa(binary); }
function wrapBase64(value: string) { return value.match(/.{1,76}/g)?.join("\r\n") || ""; }
function json(body: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
