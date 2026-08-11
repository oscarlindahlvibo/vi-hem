import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/* eslint-disable no-control-regex -- preserve PDF whitespace during sanitisation. */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Cron-Secret",
};

type InvoiceLine = {
  description: string;
  quantity: number | string;
  unit: string;
  unit_price: number | string;
  vat_rate: number | string;
  line_total_incl_vat: number | string;
};

type PdfCommand = string;

const pageWidth = 595;
const pageHeight = 842;
const margin = 44;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const invoiceId = typeof body.invoice_id === "string" ? body.invoice_id : "";
    if (!invoiceId) return json({ error: "invoice_id saknas." }, 400);

    const authHeader = req.headers.get("Authorization") || "";
    const cronSecret = Deno.env.get("VIHEM_CRON_SECRET") || "";
    const isCron = Boolean(cronSecret && req.headers.get("X-Cron-Secret") === cronSecret);

    let actorId: string | null = null;
    let actorProfile: any = null;
    if (!isCron) {
      if (!authHeader) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) return json({ error: "Unauthorized" }, 401);
      actorId = user.id;

      const { data: profile, error: profileError } = await serviceClient
        .from("vihem_profiles")
        .select("id, role, organisation_id")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError || !profile) return json({ error: "Kunde inte verifiera användaren." }, 403);
      actorProfile = profile;
    }

    const { data: invoice, error: invoiceError } = await serviceClient
      .from("vihem_invoices")
      .select("*, company:company_id(*), customer:customer_id(*)")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoiceError) throw invoiceError;
    if (!invoice) return json({ error: "Fakturan hittades inte." }, 404);
    if (!invoice.invoice_number) return json({ error: "Fakturan behöver vara godkänd och ha fakturanummer först." }, 400);

    if (!isCron) {
      const allowed = await canRenderInvoice(serviceClient, actorProfile, invoice);
      if (!allowed) return json({ error: "Saknar behörighet för fakturans bolag." }, 403);
    }

    const { data: lines, error: lineError } = await serviceClient
      .from("vihem_invoice_lines")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("line_no", { ascending: true });

    if (lineError) throw lineError;

    const invoiceTitle = `Faktura ${invoice.invoice_number || invoice.id.slice(0, 8)}`;
    const fileName = `${safePathPart(invoiceTitle)}.pdf`;
    const organisationId = invoice.organisation_id || invoice.company?.organisation_id;
    if (!organisationId) return json({ error: "Organisation saknas på fakturan." }, 400);

    const storagePath = `${organisationId}/invoices/${invoice.id}/${fileName}`;
    const pdfBytes = buildInvoicePdfBytes(invoice, (lines || []) as InvoiceLine[]);
    const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });

    const { error: uploadError } = await serviceClient.storage
      .from("vihem-documents")
      .upload(storagePath, pdfBlob, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: documentRow, error: documentError } = await serviceClient
      .from("vihem_documents")
      .insert({
        organisation_id: organisationId,
        title: invoiceTitle,
        file_url: "",
        file_name: fileName,
        file_size: pdfBytes.byteLength,
        document_type: "invoice",
        company_id: invoice.company_id,
        document_category: "invoice",
        contract_status: "not_applicable",
        visibility: "admin",
        tenant_id: null,
        property_id: null,
        apartment_id: null,
        storage_bucket: "vihem-documents",
        storage_path: storagePath,
        description: `Faktura till ${invoice.customer?.name || "kund"}`,
        created_by: actorId,
      })
      .select("id")
      .single();

    if (documentError) throw documentError;

    const { error: updateError } = await serviceClient
      .from("vihem_invoices")
      .update({ document_id: documentRow.id })
      .eq("id", invoice.id);

    if (updateError) throw updateError;

    const { data: signedData } = await serviceClient.storage
      .from("vihem-documents")
      .createSignedUrl(storagePath, 60 * 10, { download: fileName });

    return json({
      ok: true,
      document_id: documentRow.id,
      storage_path: storagePath,
      signed_url: signedData?.signedUrl || null,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

async function canRenderInvoice(serviceClient: any, profile: any, invoice: any) {
  if (!profile) return false;
  if (profile.role === "superadmin") return true;
  if (profile.role === "admin" && profile.organisation_id === invoice.organisation_id) return true;

  const { data: permission } = await serviceClient
    .from("vihem_company_user_permissions")
    .select("role, is_active")
    .eq("company_id", invoice.company_id)
    .eq("user_id", profile.id)
    .eq("is_active", true)
    .maybeSingle();

  return ["seller", "bookkeeper", "approver", "admin"].includes(permission?.role);
}

function formatCurrency(amount: number | string, currency = "SEK") {
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function pdfText(value: string) {
  return String(value || "")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, "\"")
    .replace(/[’]/g, "'")
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "");
}

function escapePdfString(value: string) {
  return pdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function text(value: string, x: number, y: number, size = 10, font: "regular" | "bold" = "regular"): PdfCommand {
  const fontName = font === "bold" ? "F2" : "F1";
  return `BT /${fontName} ${size} Tf ${x} ${y} Td (${escapePdfString(value)}) Tj ET`;
}

function line(x1: number, y1: number, x2: number, y2: number): PdfCommand {
  return `${x1} ${y1} m ${x2} ${y2} l S`;
}

function fillRect(x: number, y: number, width: number, height: number, gray = 0.95): PdfCommand {
  return `${gray} g ${x} ${y} ${width} ${height} re f 0 g`;
}

function wrap(value: string, maxLength: number) {
  const words = pdfText(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function object(id: number, body: string) {
  return `${id} 0 obj\n${body}\nendobj\n`;
}

function makePdfBytes(objects: string[]) {
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((entry) => {
    offsets.push(pdf.length);
    pdf += entry;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

function buildInvoicePdfBytes(invoice: any, lines: InvoiceLine[]) {
  const company = invoice.company;
  const customer = invoice.customer;
  const commands: PdfCommand[] = [];
  let y = pageHeight - margin;

  commands.push(text(company?.legal_name || company?.name || "Bolag saknas", margin, y, 18, "bold"));
  commands.push(text("FAKTURA", pageWidth - 165, y, 24, "bold"));
  y -= 24;

  commands.push(text(company?.organisation_number ? `Org.nr ${company.organisation_number}` : "", margin, y, 9));
  commands.push(text(`Faktura ${invoice.invoice_number || "Utkast"}`, pageWidth - 165, y, 10, "bold"));
  y -= 15;
  commands.push(text(company?.email ? `E-post ${company.email}` : "", margin, y, 9));
  commands.push(text(`Fakturadatum ${invoice.invoice_date}`, pageWidth - 165, y, 9));
  y -= 15;
  commands.push(text(company?.phone ? `Telefon ${company.phone}` : "", margin, y, 9));
  commands.push(text(`Förfallodatum ${invoice.due_date}`, pageWidth - 165, y, 9));

  y -= 44;
  commands.push(fillRect(margin, y - 58, pageWidth - margin * 2, 74, 0.96));
  commands.push(text("Faktureras till", margin + 14, y, 10, "bold"));
  y -= 16;
  commands.push(text(customer?.name || "Kund saknas", margin + 14, y, 12, "bold"));
  y -= 14;
  commands.push(text(customer?.organisation_number ? `Kundnr/org.nr ${customer.organisation_number}` : "", margin + 14, y, 9));
  y -= 13;
  commands.push(text(customer?.invoice_email || customer?.email ? `E-post ${customer?.invoice_email || customer?.email}` : "", margin + 14, y, 9));

  y -= 42;
  commands.push(fillRect(margin, y - 7, pageWidth - margin * 2, 22, 0.92));
  commands.push(text("Beskrivning", margin + 8, y, 9, "bold"));
  commands.push(text("Antal", 330, y, 9, "bold"));
  commands.push(text("Pris", 386, y, 9, "bold"));
  commands.push(text("Moms", 448, y, 9, "bold"));
  commands.push(text("Summa", 502, y, 9, "bold"));
  y -= 22;

  lines.forEach((invoiceLine, index) => {
    const descriptionLines = wrap(invoiceLine.description, 42).slice(0, 3);
    const rowHeight = Math.max(24, descriptionLines.length * 12 + 10);
    if (index % 2 === 1) commands.push(fillRect(margin, y - rowHeight + 8, pageWidth - margin * 2, rowHeight, 0.985));

    descriptionLines.forEach((description, descriptionIndex) => {
      commands.push(text(description, margin + 8, y - descriptionIndex * 12, 9));
    });
    commands.push(text(`${Number(invoiceLine.quantity)} ${invoiceLine.unit}`, 330, y, 9));
    commands.push(text(formatCurrency(invoiceLine.unit_price, invoice.currency), 386, y, 9));
    commands.push(text(`${Number(invoiceLine.vat_rate)}%`, 448, y, 9));
    commands.push(text(formatCurrency(invoiceLine.line_total_incl_vat, invoice.currency), 502, y, 9));
    y -= rowHeight;
    commands.push(line(margin, y + 10, pageWidth - margin, y + 10));
  });

  y = Math.min(y - 22, 245);
  const totalsX = 360;
  commands.push(text("Summa exkl. moms", totalsX, y, 10));
  commands.push(text(formatCurrency(invoice.subtotal_amount, invoice.currency), 485, y, 10, "bold"));
  y -= 17;
  commands.push(text("Moms", totalsX, y, 10));
  commands.push(text(formatCurrency(invoice.vat_amount, invoice.currency), 485, y, 10, "bold"));
  y -= 22;
  commands.push(line(totalsX, y + 12, pageWidth - margin, y + 12));
  commands.push(text("Att betala", totalsX, y, 13, "bold"));
  commands.push(text(formatCurrency(invoice.total_amount, invoice.currency), 470, y, 13, "bold"));

  const footerY = 58;
  commands.push(line(margin, footerY + 28, pageWidth - margin, footerY + 28));
  commands.push(text(company?.bankgiro ? `Bankgiro ${company.bankgiro}` : "", margin, footerY + 12, 8));
  commands.push(text(company?.plusgiro ? `Plusgiro ${company.plusgiro}` : "", margin + 150, footerY + 12, 8));
  commands.push(text(company?.iban ? `IBAN ${company.iban}` : "", margin + 300, footerY + 12, 8));
  commands.push(text(invoice.notes ? `Anteckning: ${invoice.notes}` : "", margin, footerY - 4, 8));

  const stream = commands.filter(Boolean).join("\n");
  const objects = [
    object(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`),
    object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    object(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
    object(6, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
  ];

  return makePdfBytes(objects);
}

function safePathPart(value: string) {
  return value
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "fil";
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
