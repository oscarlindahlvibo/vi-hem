// Minimal SMTP client with attachment support, for sending mail from an Edge
// Function without an external dependency.
//
// This is an adapted copy of the working implementation in
// vihem-send-invoice-emails/index.ts (hand-rolled: connect, EHLO, optional
// STARTTLS, AUTH PLAIN, MAIL FROM/RCPT TO/DATA), generalized to accept any
// attachment content type instead of assuming application/pdf. Deliberately
// a COPY, not an extraction that also refactors the original function to
// use it: vihem-send-invoice-emails sends real production invoice emails
// today, and touching it isn't worth the risk for what is otherwise a
// same-day duplication. If this module proves itself, migrating the
// original to use it is a natural (separate) follow-up.
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  startTls: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

export function readSmtpConfigFromEnv(): SmtpConfig {
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
    fromName: Deno.env.get("SMTP_FROM_NAME") || "VI-HEM",
    fromEmail,
  };
}

export interface MailAttachment {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

export async function sendMailWithAttachment(
  config: SmtpConfig,
  params: {
    toEmail: string;
    toName?: string;
    subject: string;
    text: string;
    attachment: MailAttachment;
  },
): Promise<void> {
  return sendMail(config, params);
}

/**
 * Plain-text send with an OPTIONAL attachment -- added for Avtal V2's
 * signing-link notification emails, which have no attachment to carry.
 * sendMailWithAttachment (above) is kept as a thin wrapper so existing
 * callers (vihem-accounted-scanner-forward) are unaffected.
 */
export async function sendMail(
  config: SmtpConfig,
  params: {
    toEmail: string;
    toName?: string;
    subject: string;
    text: string;
    attachment?: MailAttachment;
  },
): Promise<void> {
  const message = buildMimeMessage({
    fromEmail: config.fromEmail,
    fromName: config.fromName,
    toEmail: params.toEmail,
    toName: params.toName || "",
    subject: params.subject,
    text: params.text,
    attachment: params.attachment,
  });
  await smtpSend(config, config.fromEmail, params.toEmail, message);
}

function buildMimeMessage(input: {
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName: string;
  subject: string;
  text: string;
  attachment?: MailAttachment;
}) {
  const headers = [
    `From: ${formatAddress(input.fromName, input.fromEmail)}`,
    `To: ${formatAddress(input.toName, input.toEmail)}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
  ];

  if (!input.attachment) {
    return [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(bytesToBase64(new TextEncoder().encode(input.text))),
      "",
    ].join("\r\n");
  }

  const mixedBoundary = `vihem-mixed-${crypto.randomUUID()}`;
  const attachmentBase64 = wrapBase64(bytesToBase64(input.attachment.bytes));

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(bytesToBase64(new TextEncoder().encode(input.text))),
    "",
    `--${mixedBoundary}`,
    `Content-Type: ${input.attachment.contentType}; name="${input.attachment.fileName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${input.attachment.fileName}"`,
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
