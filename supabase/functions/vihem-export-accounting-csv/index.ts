import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const companyId = typeof body.company_id === "string" ? body.company_id : "";
    const statuses = Array.isArray(body.statuses) && body.statuses.length > 0
      ? body.statuses.filter((status: unknown) => typeof status === "string")
      : ["queued", "processing"];

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile, error: profileError } = await serviceClient
      .from("vihem_profiles")
      .select("id, role, organisation_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) return json({ error: "Kunde inte verifiera användaren." }, 403);

    let allowedCompanyIds: string[] | null = null;
    if (profile.role !== "superadmin" && profile.role !== "admin") {
      const { data: permissions, error: permissionError } = await serviceClient
        .from("vihem_company_user_permissions")
        .select("company_id, role")
        .eq("organisation_id", profile.organisation_id)
        .eq("user_id", user.id)
        .eq("active", true)
        .in("role", ["bookkeeper", "admin"]);

      if (permissionError) throw permissionError;
      allowedCompanyIds = (permissions || []).map((permission: any) => permission.company_id);
      if (allowedCompanyIds.length === 0) return json({ error: "Saknar bolagsbehörighet för export." }, 403);
    }

    let query = serviceClient
      .from("vihem_accounting_sync_queue")
      .select("*, company:company_id(*), integration:integration_id(*)")
      .in("status", statuses)
      .order("created_at", { ascending: true })
      .limit(500);

    if (profile.role !== "superadmin") query = query.eq("organisation_id", profile.organisation_id);
    if (companyId) query = query.eq("company_id", companyId);
    if (allowedCompanyIds) query = query.in("company_id", allowedCompanyIds);

    const { data: queueItems, error: queueError } = await query;
    if (queueError) throw queueError;

    const rows = await buildExportRows(serviceClient, queueItems || []);
    const csv = toCsv([
      [
        "ko_id",
        "status",
        "typ",
        "atgard",
        "bolag",
        "provider",
        "datum",
        "nummer",
        "motpart",
        "belopp_exkl_moms",
        "moms",
        "belopp_inkl_moms",
        "valuta",
        "extern_id",
      ],
      ...rows,
    ]);

    return json({
      ok: true,
      filename: `vihem-bokforing-${new Date().toISOString().slice(0, 10)}.csv`,
      count: rows.length,
      csv,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

async function buildExportRows(serviceClient: any, queueItems: any[]) {
  const rows: string[][] = [];

  for (const item of queueItems) {
    if (item.entity_type === "invoice") {
      const { data: invoice } = await serviceClient
        .from("vihem_invoices")
        .select("*, customer:customer_id(*)")
        .eq("id", item.entity_id)
        .maybeSingle();

      if (!invoice) continue;
      rows.push([
        item.id,
        item.status,
        "kundfaktura",
        item.action,
        item.company?.name || "",
        item.integration?.provider || "manual",
        invoice.invoice_date || "",
        invoice.invoice_number || invoice.id,
        invoice.customer?.name || "",
        decimal(invoice.subtotal_amount),
        decimal(invoice.vat_amount),
        decimal(invoice.total_amount),
        invoice.currency || "SEK",
        item.external_id || invoice.external_accounting_id || "",
      ]);
    } else if (item.entity_type === "payment") {
      const { data: payment } = await serviceClient
        .from("vihem_payments")
        .select("*, invoice:invoice_id(*, customer:customer_id(*))")
        .eq("id", item.entity_id)
        .maybeSingle();

      if (!payment) continue;
      rows.push([
        item.id,
        item.status,
        "betalning",
        item.action,
        item.company?.name || "",
        item.integration?.provider || "manual",
        payment.payment_date || "",
        payment.invoice?.invoice_number || payment.id,
        payment.invoice?.customer?.name || payment.reference || "",
        "",
        "",
        decimal(payment.amount),
        payment.currency || "SEK",
        item.external_id || payment.external_payment_id || "",
      ]);
    } else if (item.entity_type === "supplier_invoice") {
      const { data: supplierInvoice } = await serviceClient
        .from("vihem_supplier_invoices")
        .select("*, supplier:supplier_id(*)")
        .eq("id", item.entity_id)
        .maybeSingle();

      if (!supplierInvoice) continue;
      rows.push([
        item.id,
        item.status,
        "leverantorsfaktura",
        item.action,
        item.company?.name || "",
        item.integration?.provider || "manual",
        supplierInvoice.invoice_date || "",
        supplierInvoice.supplier_invoice_number || supplierInvoice.id,
        supplierInvoice.supplier?.name || "",
        decimal(supplierInvoice.subtotal_amount),
        decimal(supplierInvoice.vat_amount),
        decimal(supplierInvoice.total_amount),
        supplierInvoice.currency || "SEK",
        item.external_id || supplierInvoice.external_accounting_id || "",
      ]);
    } else {
      rows.push([
        item.id,
        item.status,
        item.entity_type,
        item.action,
        item.company?.name || "",
        item.integration?.provider || "manual",
        item.created_at?.slice(0, 10) || "",
        item.entity_id,
        "",
        "",
        "",
        "",
        "SEK",
        item.external_id || "",
      ]);
    }
  }

  return rows;
}

function decimal(value: unknown) {
  return Number(value || 0).toFixed(2).replace(".", ",");
}

function toCsv(rows: string[][]) {
  return rows.map(row => row.map(csvCell).join(";")).join("\n");
}

function csvCell(value: string) {
  const text = String(value ?? "");
  if (/[;"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
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
