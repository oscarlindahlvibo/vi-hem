import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Inbound-Secret",
};

type IngestBody = {
  company_id?: string;
  supplier_email?: string;
  supplier_name?: string;
  supplier_invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  subject?: string;
  message?: string;
  amount_incl_vat?: number | string;
  vat_rate?: number | string;
  file_name?: string;
  content_type?: string;
  file_base64?: string;
  document_kind?: "supplier_invoice" | "receipt";
  source?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const body = (await req.json().catch(() => ({}))) as IngestBody;
    const companyId = body.company_id || "";
    const isStaffScanner = body.source === "staff_scanner";
    if (!companyId) return json({ error: "company_id saknas." }, 400);

    const { data: company, error: companyError } = await serviceClient
      .from("vihem_companies")
      .select("*")
      .eq("id", companyId)
      .maybeSingle();

    if (companyError) throw companyError;
    if (!company) return json({ error: "Bolaget hittades inte." }, 404);

    const inboundSecret = Deno.env.get("VIHEM_SUPPLIER_INVOICE_INBOUND_SECRET") || "";
    const isInbound = Boolean(inboundSecret && req.headers.get("X-Inbound-Secret") === inboundSecret);
    const authHeader = req.headers.get("Authorization") || "";
    let actorId: string | null = null;

    if (!isInbound) {
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
      if (profile.role !== "superadmin" && profile.organisation_id !== company.organisation_id) {
        return json({ error: "Saknar behörighet för organisationen." }, 403);
      }
      if (isStaffScanner && !["admin", "staff", "superadmin"].includes(profile.role)) {
        return json({ error: "Endast personal kan scanna ekonomiska underlag." }, 403);
      }
      if (!isStaffScanner && profile.role !== "superadmin" && profile.role !== "admin") {
        const { data: permission } = await serviceClient
          .from("vihem_company_user_permissions")
          .select("role")
          .eq("company_id", companyId)
          .eq("user_id", user.id)
          .eq("active", true)
          .in("role", ["bookkeeper", "admin"])
          .maybeSingle();
        if (!permission) return json({ error: "Saknar bolagsbehörighet för leverantörsfakturor." }, 403);
      }
    }

    const supplier = await findOrCreateSupplier(serviceClient, company, body, actorId);
    const vatRate = toNumber(body.vat_rate, company.default_vat_rate || 25);
    const totalAmount = toNumber(body.amount_incl_vat, 0);
    const subtotal = totalAmount > 0 ? round(totalAmount / (1 + vatRate / 100)) : 0;
    const vat = round(totalAmount - subtotal);
    const today = new Date().toISOString().slice(0, 10);
    const invoiceDate = validDate(body.invoice_date) || today;
    const dueDate = validDate(body.due_date) || addDays(invoiceDate, supplier?.payment_terms_days || 30);
    const invoiceNumber = body.supplier_invoice_number || extractInvoiceNumber(body.subject || body.file_name || "") || "";
    const title = body.subject || body.file_name || "Inkommen leverantörsfaktura";

    const { data: supplierInvoice, error: supplierInvoiceError } = await serviceClient
      .from("vihem_supplier_invoices")
      .insert({
        organisation_id: company.organisation_id,
        company_id: company.id,
        supplier_id: supplier?.id || null,
        supplier_invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate,
        currency: company.default_currency || "SEK",
        status: "needs_review",
        approval_status: "pending",
        subtotal_amount: subtotal,
        vat_amount: vat,
        total_amount: totalAmount,
        document_kind: body.document_kind === "receipt" ? "receipt" : "supplier_invoice",
        notes: body.message || title,
        ocr_status: body.file_base64 ? "queued" : "not_started",
        ocr_data: {
          source: isInbound ? "inbound_secret" : isStaffScanner ? "staff_scanner" : "authenticated",
          document_kind: body.document_kind === "receipt" ? "receipt" : "supplier_invoice",
          subject: body.subject || "",
          supplier_email: body.supplier_email || "",
          received_at: new Date().toISOString(),
        },
        created_by: actorId,
      })
      .select("*")
      .single();

    if (supplierInvoiceError || !supplierInvoice) throw supplierInvoiceError || new Error("Kunde inte skapa leverantörsfakturan.");

    const { error: lineError } = await serviceClient
      .from("vihem_supplier_invoice_lines")
      .insert({
        organisation_id: company.organisation_id,
        company_id: company.id,
        supplier_invoice_id: supplierInvoice.id,
        line_no: 1,
        description: title,
        quantity: 1,
        unit_price: subtotal,
        vat_rate: vatRate,
        account_code: supplier?.default_account_code || "",
        line_total_excl_vat: subtotal,
        vat_amount: vat,
        line_total_incl_vat: totalAmount,
      });

    if (lineError) throw lineError;

    let documentId: string | null = null;
    if (body.file_base64) {
      documentId = await saveAttachment(serviceClient, company, supplierInvoice, body, actorId);
    }

    return json({
      ok: true,
      supplier_invoice_id: supplierInvoice.id,
      supplier_id: supplier?.id || null,
      document_id: documentId,
      ocr_status: body.file_base64 ? "queued" : "not_started",
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

async function findOrCreateSupplier(serviceClient: any, company: any, body: IngestBody, actorId: string | null) {
  const email = (body.supplier_email || "").trim().toLowerCase();
  const name = (body.supplier_name || email || "Okänd leverantör").trim();

  let query = serviceClient
    .from("vihem_finance_suppliers")
    .select("*")
    .eq("organisation_id", company.organisation_id)
    .or(`company_id.eq.${company.id},company_id.is.null`)
    .limit(1);

  query = email ? query.eq("email", email) : query.ilike("name", name);
  const { data: existing, error: existingError } = await query.maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const { data: supplier, error: supplierError } = await serviceClient
    .from("vihem_finance_suppliers")
    .insert({
      organisation_id: company.organisation_id,
      company_id: company.id,
      name,
      email,
      payment_terms_days: 30,
      active: true,
      notes: "Skapad från inkommande leverantörsfaktura.",
      created_by: actorId,
    })
    .select("*")
    .single();

  if (supplierError) throw supplierError;
  return supplier;
}

async function saveAttachment(serviceClient: any, company: any, supplierInvoice: any, body: IngestBody, actorId: string | null) {
  const originalFileName = body.file_name || `supplier-invoice-${supplierInvoice.id}.pdf`;
  const extension = originalFileName.includes(".") ? originalFileName.split(".").pop() || "pdf" : "pdf";
  const baseName = originalFileName.replace(/\.[^.]+$/, "");
  const fileName = `${safePathPart(baseName)}.${safePathPart(extension)}`;
  const storagePath = `${company.organisation_id}/supplier-invoices/${supplierInvoice.id}/${fileName}`;
  const bytes = decodeBase64(body.file_base64 || "");
  const contentType = body.content_type || contentTypeFromExtension(extension);

  const { error: uploadError } = await serviceClient.storage
    .from("vihem-documents")
    .upload(storagePath, new Blob([bytes], { type: contentType }), {
      contentType,
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data: documentRow, error: documentError } = await serviceClient
    .from("vihem_documents")
    .insert({
      organisation_id: company.organisation_id,
      title: `${body.document_kind === "receipt" ? "Kvitto" : "Leverantörsfaktura"} ${supplierInvoice.supplier_invoice_number || supplierInvoice.id.slice(0, 8)}`,
      file_url: "",
      file_name: originalFileName,
      file_size: bytes.byteLength,
      document_type: "invoice",
      company_id: company.id,
      document_category: "supplier_invoice",
      contract_status: "not_applicable",
      visibility: "admin",
      tenant_id: null,
      property_id: null,
      apartment_id: null,
      storage_bucket: "vihem-documents",
      storage_path: storagePath,
      description: body.document_kind === "receipt" ? "Inskickat kvitto för granskning" : "Inkommen bilaga till leverantörsfaktura",
      created_by: actorId,
    })
    .select("id")
    .single();

  if (documentError) throw documentError;

  const { error: updateError } = await serviceClient
    .from("vihem_supplier_invoices")
    .update({
      document_id: documentRow.id,
      ocr_status: "queued",
      ocr_data: {
        ...(supplierInvoice.ocr_data || {}),
        file_name: originalFileName,
        content_type: contentType,
        storage_path: storagePath,
        document_kind: body.document_kind === "receipt" ? "receipt" : "supplier_invoice",
        queued_at: new Date().toISOString(),
      },
    })
    .eq("id", supplierInvoice.id);

  if (updateError) throw updateError;
  return documentRow.id as string;
}

function decodeBase64(value: string) {
  const clean = value.includes(",") ? value.split(",").pop() || "" : value;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function extractInvoiceNumber(value: string) {
  const match = value.match(/(?:faktura|invoice|inv)[-_ #:]?([a-z0-9-]+)/i);
  return match?.[1] || "";
}

function validDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return value;
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
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

function contentTypeFromExtension(extension: string) {
  const ext = extension.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "application/pdf";
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
