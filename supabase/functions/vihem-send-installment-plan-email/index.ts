import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type SmtpConfig = { host: string; port: number; secure: boolean; startTls: boolean; username: string; password: string; fromEmail: string; fromName: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  try {
    const body = await req.json().catch(() => ({}));
    const organisationId = typeof body.organisation_id === "string" ? body.organisation_id : "";
    const planId = typeof body.plan_id === "string" ? body.plan_id : "";
    const scheduleId = typeof body.schedule_id === "string" ? body.schedule_id : "";
    if (!organisationId || !planId) return json({ error: "Organisation och plan saknas." }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: profile } = await serviceClient.from("vihem_profiles").select("role, organisation_id").eq("id", user.id).maybeSingle();
    if (!profile || !["admin", "superadmin"].includes(profile.role)) return json({ error: "Saknar behörighet." }, 403);
    if (profile.role !== "superadmin" && profile.organisation_id !== organisationId) return json({ error: "Fel organisation." }, 403);

    const { data: plan, error: planError } = await serviceClient.from("vihem_installment_plans").select("*").eq("id", planId).eq("organisation_id", organisationId).single();
    if (planError || !plan) return json({ error: "Avbetalningsplanen hittades inte." }, 404);
    if (!plan.customer_id) return json({ error: "Planen saknar kopplad kund." }, 400);
    const { data: customer } = await serviceClient.from("vihem_finance_customers").select("name,email,invoice_email").eq("id", plan.customer_id).eq("organisation_id", organisationId).maybeSingle();
    const recipient = customer?.invoice_email || customer?.email || "";
    if (!recipient) return json({ error: "Kunden saknar e-postadress." }, 400);
    const { data: company } = await serviceClient.from("vihem_companies").select("name").eq("id", plan.company_id).eq("organisation_id", organisationId).maybeSingle();
    let scheduleQuery = serviceClient.from("vihem_installment_schedule").select("id,installment_no,due_date,amount").eq("plan_id", plan.id).order("installment_no");
    if (scheduleId) scheduleQuery = scheduleQuery.eq("id", scheduleId);
    const { data: schedule, error: scheduleError } = await scheduleQuery;
    if (scheduleError) throw scheduleError;
    if (scheduleId && (!schedule || schedule.length === 0)) return json({ error: "Delbetalningen hittades inte." }, 404);

    const lines = (schedule || []).map((row) => `${row.installment_no}. ${formatDate(row.due_date)} - ${money(row.amount)}`).join("\n");
    const text = [
      `Hej ${customer?.name || ""},`,
      "",
      scheduleId ? `Här kommer fakturan för delbetalning ${schedule?.[0]?.installment_no} i avbetalningsplan ${plan.plan_number}.` : `Här kommer din avbetalningsplan ${plan.plan_number}.`,
      company?.name ? `Avsändare: ${company.name}` : "",
      `Totalt belopp: ${money(plan.total_amount)}`,
      `Antal delbetalningar: ${plan.installment_count}`,
      "",
      "Betalningstillfällen:",
      lines || "Inga betalningstillfällen registrerade.",
      plan.terms ? `\nVillkor:\n${plan.terms}` : "",
      "",
      "Vänliga hälsningar,",
      "VI-HEM",
    ].filter(Boolean).join("\n");

    const smtp = readSmtpConfig();
    await smtpSend(smtp, smtp.fromEmail, recipient, buildMessage(smtp, recipient, customer?.name || "", `Avbetalningsplan ${plan.plan_number}`, text));
    let statusUpdate = serviceClient.from("vihem_installment_schedule").update({ email_status: "sent", email_sent_at: new Date().toISOString(), email_error: null }).eq("plan_id", plan.id);
    if (scheduleId) statusUpdate = statusUpdate.eq("id", scheduleId);
    const { error: statusError } = await statusUpdate;
    if (statusError) throw statusError;
    await serviceClient.from("vihem_installment_audit_log").insert({ organisation_id: organisationId, plan_id: plan.id, action: "email_sent", metadata: { recipient, schedule_id: scheduleId || null }, created_by: user.id });
    return json({ ok: true, sent_to: recipient, plan_number: plan.plan_number, schedule_id: scheduleId || null });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Kunde inte skicka e-post." }, 400);
  }
});

function readSmtpConfig(): SmtpConfig {
  const host = Deno.env.get("SMTP_HOST") || "";
  const fromEmail = Deno.env.get("SMTP_FROM_EMAIL") || Deno.env.get("SMTP_USERNAME") || "";
  if (!host || !fromEmail) throw new Error("SMTP-konfiguration saknas i edge function-miljön.");
  return { host, fromEmail, port: Number(Deno.env.get("SMTP_PORT") || "25"), secure: Deno.env.get("SMTP_SECURE") === "true", startTls: Deno.env.get("SMTP_STARTTLS") === "true", username: Deno.env.get("SMTP_USERNAME") || "", password: Deno.env.get("SMTP_PASSWORD") || "", fromName: Deno.env.get("SMTP_FROM_NAME") || "VI-HEM" };
}

function buildMessage(smtp: SmtpConfig, to: string, toName: string, subject: string, text: string) {
  return [`From: ${address(smtp.fromName, smtp.fromEmail)}`, `To: ${address(toName, to)}`, `Subject: ${header(subject)}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", wrap(btoa(String.fromCharCode(...new TextEncoder().encode(text)))), ""].join("\r\n");
}

async function smtpSend(config: SmtpConfig, from: string, to: string, message: string) {
  let connection: Deno.Conn | Deno.TlsConn = config.secure ? await Deno.connectTls({ hostname: config.host, port: config.port }) : await Deno.connect({ hostname: config.host, port: config.port });
  let reader = connection.readable.getReader(); let writer = connection.writable.getWriter(); const decoder = new TextDecoder(); const encoder = new TextEncoder(); let buffered = "";
  const read = async () => { while (true) { const { value, done } = await reader.read(); if (done) throw new Error("SMTP-anslutningen stängdes."); buffered += decoder.decode(value, { stream: true }); const lines = buffered.split(/\r?\n/).filter(Boolean); const last = lines.at(-1) || ""; if (/^\d{3} /.test(last)) { buffered = ""; return lines.join("\n"); } } };
  const expect = async (codes: number[]) => { const response = await read(); const code = Number(response.slice(0, 3)); if (!codes.includes(code)) throw new Error(`SMTP svarade ${code}: ${response}`); };
  const command = async (line: string, codes: number[]) => { await writer.write(encoder.encode(`${line}\r\n`)); await expect(codes); };
  try {
    await expect([220]); await command(`EHLO ${config.host}`, [250]);
    if (config.startTls && !config.secure) { await command("STARTTLS", [220]); writer.releaseLock(); reader.releaseLock(); connection = await (Deno as any).startTls(connection, { hostname: config.host }); reader = connection.readable.getReader(); writer = connection.writable.getWriter(); await command(`EHLO ${config.host}`, [250]); }
    if (config.username && config.password) await command(`AUTH PLAIN ${base64(`\0${config.username}\0${config.password}`)}`, [235]);
    await command(`MAIL FROM:<${from}>`, [250]); await command(`RCPT TO:<${to}>`, [250, 251]); await command("DATA", [354]); await writer.write(encoder.encode(`${message.replace(/\r?\n\./g, "\r\n..\r\n")}\r\n.\r\n`)); await expect([250]); await command("QUIT", [221]);
  } finally { try { writer.releaseLock(); reader.releaseLock(); connection.close(); } catch { /* already closed */ } }
}

function address(name: string, email: string) { return name ? `${header(name)} <${email}>` : `<${email}>`; }
function header(value: string) { return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${base64(new TextEncoder().encode(value))}?=`; }
function base64(bytes: Uint8Array | string) { const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes; let binary = ""; for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.slice(i, i + 0x8000)); return btoa(binary); }
function wrap(value: string) { return value.match(/.{1,76}/g)?.join("\r\n") || ""; }
function money(value: number) { return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" }).format(Number(value || 0)); }
function formatDate(value: string) { return new Intl.DateTimeFormat("sv-SE").format(new Date(`${value}T12:00:00`)); }
function json(body: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
