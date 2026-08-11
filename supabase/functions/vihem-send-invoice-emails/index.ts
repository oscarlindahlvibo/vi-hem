import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Cron-Secret",
};

type QueuedEmail = {
  id: string;
  organisation_id: string;
  company_id: string;
  invoice_id: string;
  document_id: string | null;
  recipient_email: string;
  recipient_name: string;
  subject: string;
  message: string;
  invoice?: any;
  document?: any;
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const smtp = readSmtpConfig();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const authHeader = req.headers.get("Authorization") || "";
    const cronSecret = Deno.env.get("VIHEM_CRON_SECRET") || "";
    const isCron = Boolean(cronSecret && req.headers.get("X-Cron-Secret") === cronSecret);

    let organisationId = typeof body.organisation_id === "string" ? body.organisation_id : "";
    const targetEmailId = typeof body.email_id === "string" ? body.email_id : "";

    if (!isCron) {
      if (!authHeader) return json({ error: "Unauthorized" }, 401);

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) return json({ error: "Unauthorized" }, 401);

      const { data: profile, error: profileError } = await serviceClient
        .from("vihem_profiles")
        .select("id, role, organisation_id")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError || !profile) return json({ error: "Kunde inte verifiera användaren." }, 403);
      if (!["admin", "superadmin"].includes(profile.role)) return json({ error: "Saknar behörighet." }, 403);
      if (profile.role !== "superadmin") organisationId = profile.organisation_id || "";
      if (!organisationId) return json({ error: "Organisation saknas." }, 400);
    }

    let query = serviceClient
      .from("vihem_invoice_email_outbox")
      .select("*, invoice:invoice_id(*, customer:customer_id(*), company:company_id(*)), document:document_id(*)")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(Math.min(Math.max(Number(body.limit || 20), 1), 50));

    if (organisationId) query = query.eq("organisation_id", organisationId);
    if (targetEmailId) query = query.eq("id", targetEmailId);

    const { data: queuedEmails, error: queueError } = await query;
    if (queueError) throw queueError;

    const results = [];
    for (const queued of (queuedEmails || []) as QueuedEmail[]) {
      try {
        await sendQueuedInvoiceEmail(serviceClient, smtp, queued);
        await serviceClient
          .from("vihem_invoice_email_outbox")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            error_message: "",
          })
          .eq("id", queued.id);

        await serviceClient
          .from("vihem_invoices")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
          })
          .eq("id", queued.invoice_id)
          .in("status", ["approved", "sent", "overdue"]);

        results.push({ id: queued.id, status: "sent" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Kunde inte skicka fakturamejl.";
        await serviceClient
          .from("vihem_invoice_email_outbox")
          .update({
            status: "failed",
            error_message: message,
          })
          .eq("id", queued.id);
        results.push({ id: queued.id, status: "failed", error: message });
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

async function sendQueuedInvoiceEmail(serviceClient: any, smtp: SmtpConfig, queued: QueuedEmail) {
  if (!queued.recipient_email) throw new Error("Mottagarens e-post saknas.");
  if (!queued.document?.storage_bucket || !queued.document?.storage_path) {
    throw new Error("Fakturans PDF-dokument saknar lagringsplats.");
  }

  const { data: fileBlob, error: downloadError } = await serviceClient.storage
    .from(queued.document.storage_bucket)
    .download(queued.document.storage_path);

  if (downloadError || !fileBlob) {
    throw new Error(downloadError?.message || "Kunde inte hämta fakturans PDF.");
  }

  const attachmentBytes = new Uint8Array(await fileBlob.arrayBuffer());
  const invoiceNumber = queued.invoice?.invoice_number || queued.invoice_id.slice(0, 8);
  const fileName = `faktura-${safeFilePart(invoiceNumber)}.pdf`;
  const message = buildMimeMessage({
    fromEmail: smtp.fromEmail,
    fromName: smtp.fromName,
    toEmail: queued.recipient_email,
    toName: queued.recipient_name,
    subject: queued.subject || `Faktura ${invoiceNumber}`,
    text: queued.message || "Hej! Här kommer fakturan som PDF.",
    attachmentFileName: fileName,
    attachmentBytes,
  });

  await smtpSend(smtp, smtp.fromEmail, queued.recipient_email, message);
}

function buildMimeMessage(input: {
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName: string;
  subject: string;
  text: string;
  attachmentFileName: string;
  attachmentBytes: Uint8Array;
}) {
  const mixedBoundary = `vihem-mixed-${crypto.randomUUID()}`;
  const attachmentBase64 = wrapBase64(bytesToBase64(input.attachmentBytes));

  return [
    `From: ${formatAddress(input.fromName, input.fromEmail)}`,
    `To: ${formatAddress(input.toName, input.toEmail)}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(bytesToBase64(new TextEncoder().encode(input.text))),
    "",
    `--${mixedBoundary}`,
    `Content-Type: application/pdf; name="${input.attachmentFileName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${input.attachmentFileName}"`,
    "",
    attachmentBase64,
    "",
    `--${mixedBoundary}--`,
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
      if (/^\d{3} /.test(last)) {
        const response = lines.join("\n");
        buffered = "";
        return response;
      }
    }
  };

  const expect = async (codes: number[]) => {
    const response = await readResponse();
    const code = Number(response.slice(0, 3));
    if (!codes.includes(code)) throw new Error(`SMTP svarade ${code}: ${response}`);
    return response;
  };

  const command = async (line: string, codes: number[]) => {
    await writer.write(encoder.encode(`${line}\r\n`));
    return expect(codes);
  };

  try {
    await expect([220]);
    await command(`EHLO ${config.host}`, [250]);

    if (config.startTls && !config.secure) {
      await command("STARTTLS", [220]);
      writer.releaseLock();
      reader.releaseLock();
      connection = await (Deno as any).startTls(connection, { hostname: config.host });
      reader = connection.readable.getReader();
      writer = connection.writable.getWriter();
      await command(`EHLO ${config.host}`, [250]);
    }

    if (config.username && config.password) {
      await command(`AUTH PLAIN ${bytesToBase64(new TextEncoder().encode(`\0${config.username}\0${config.password}`))}`, [235]);
    }

    await command(`MAIL FROM:<${fromEmail}>`, [250]);
    await command(`RCPT TO:<${toEmail}>`, [250, 251]);
    await command("DATA", [354]);
    await writer.write(encoder.encode(`${dotStuff(message)}\r\n.\r\n`));
    await expect([250]);
    await command("QUIT", [221]);
  } finally {
    try {
      writer.releaseLock();
      reader.releaseLock();
      connection.close();
    } catch {
      // The connection may already be closed by the server.
    }
  }
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
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join("\r\n") || "";
}

function dotStuff(message: string) {
  return message.replace(/\r?\n\./g, "\r\n..");
}

function safeFilePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/[ö]/g, "o")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "faktura";
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
