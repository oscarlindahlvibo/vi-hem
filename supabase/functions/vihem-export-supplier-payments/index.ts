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
    const dueTo = typeof body.due_to === "string" && body.due_to ? body.due_to.slice(0, 10) : "";
    const format = body.format === "bankgirot" ? "bankgirot" : "csv";
    const markExported = body.mark_exported !== false;

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile, error: profileError } = await serviceClient
      .from("vihem_profiles")
      .select("id, role, organisation_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) return json({ error: "Kunde inte verifiera användaren." }, 403);

    let query = serviceClient
      .from("vihem_supplier_invoices")
      .select("*, company:company_id(*), supplier:supplier_id(*)")
      .eq("approval_status", "approved")
      .eq("payment_status", "scheduled")
      .eq("status", "scheduled_for_payment")
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: true });

    if (profile.role !== "superadmin") {
      query = query.eq("organisation_id", profile.organisation_id);
    }
    if (companyId) query = query.eq("company_id", companyId);
    if (dueTo) query = query.lte("due_date", dueTo);

    const { data: invoices, error: invoiceError } = await query;
    if (invoiceError) throw invoiceError;

    const rows: SupplierPaymentExportRow[] = [];
    const skipped = {
      missing_company_permission: 0,
      missing_supplier: 0,
      missing_payment_target: 0,
      zero_amount: 0,
      already_exported: 0,
    };

    const permittedCompanyIds = new Set<string>();
    for (const invoice of invoices || []) {
      if (invoice.payment_exported_at && body.include_exported !== true) {
        skipped.already_exported += 1;
        continue;
      }

      if (!permittedCompanyIds.has(invoice.company_id)) {
        const canExport = await canExportCompany(serviceClient, profile, invoice.company_id);
        if (!canExport) {
          skipped.missing_company_permission += 1;
          continue;
        }
        permittedCompanyIds.add(invoice.company_id);
      }

      if (!invoice.supplier) {
        skipped.missing_supplier += 1;
        continue;
      }

      const paymentTarget = preferredPaymentTarget(invoice.supplier);
      if (!paymentTarget.value) {
        skipped.missing_payment_target += 1;
        continue;
      }

      const balance = Math.round((Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0)) * 100) / 100;
      if (!Number.isFinite(balance) || balance <= 0) {
        skipped.zero_amount += 1;
        continue;
      }

      rows.push({
        supplier_invoice_id: invoice.id,
        company_name: invoice.company?.name || "",
        supplier_name: invoice.supplier.name || "",
        supplier_organisation_number: invoice.supplier.organisation_number || "",
        invoice_number: invoice.supplier_invoice_number || "",
        due_date: invoice.due_date,
        amount: balance,
        currency: invoice.currency || "SEK",
        payment_method: paymentTarget.method,
        payment_target: paymentTarget.value,
        reference: invoice.payment_reference || invoice.supplier.payment_reference || invoice.supplier_invoice_number || invoice.id,
        message: invoice.notes || "",
      });
    }

    const exportId = `sp-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
    if (markExported && rows.length > 0) {
      const { error: updateError } = await serviceClient
        .from("vihem_supplier_invoices")
        .update({
          payment_exported_at: new Date().toISOString(),
          payment_export_id: exportId,
        })
        .in("id", rows.map(row => row.supplier_invoice_id));
      if (updateError) throw updateError;
    }

    const content = format === "bankgirot"
      ? toBankgirotSupplierPayments(rows)
      : toCsv([
        [
          "bolag",
          "leverantor",
          "organisationsnummer",
          "fakturanummer",
          "forfallodatum",
          "belopp",
          "valuta",
          "betalmetod",
          "betalmal",
          "referens",
          "meddelande",
          "leverantorsfaktura_id",
        ],
        ...rows.map(row => [
          row.company_name,
          row.supplier_name,
          row.supplier_organisation_number,
          row.invoice_number,
          row.due_date,
          formatAmount(row.amount),
          row.currency,
          row.payment_method,
          row.payment_target,
          row.reference,
          row.message,
          row.supplier_invoice_id,
        ]),
      ]);

    return json({
      ok: true,
      filename: `vihem-leverantorsbetalningar-${new Date().toISOString().slice(0, 10)}.${format === "bankgirot" ? "txt" : "csv"}`,
      export_id: exportId,
      format,
      count: rows.length,
      skipped,
      content,
      csv: format === "csv" ? content : "",
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

type SupplierPaymentExportRow = {
  supplier_invoice_id: string;
  company_name: string;
  supplier_name: string;
  supplier_organisation_number: string;
  invoice_number: string;
  due_date: string;
  amount: number;
  currency: string;
  payment_method: string;
  payment_target: string;
  reference: string;
  message: string;
};

async function canExportCompany(serviceClient: any, profile: any, companyId: string) {
  if (profile.role === "superadmin" || profile.role === "admin") return true;

  const { data, error } = await serviceClient
    .from("vihem_company_user_permissions")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", profile.id)
    .eq("active", true)
    .in("role", ["bookkeeper", "admin"])
    .limit(1);

  if (error) throw error;
  return (data || []).length > 0;
}

function preferredPaymentTarget(supplier: any) {
  const bankgiro = digitsOnly(supplier.bankgiro || "");
  if (bankgiro) return { method: "bankgiro", value: bankgiro };

  const plusgiro = digitsOnly(supplier.plusgiro || "");
  if (plusgiro) return { method: "plusgiro", value: plusgiro };

  const iban = String(supplier.iban || "").replace(/\s/g, "").toUpperCase();
  if (iban) return { method: "iban", value: iban };

  const bankAccount = digitsOnly(supplier.bank_account || "");
  if (bankAccount) return { method: "bankkonto", value: bankAccount };

  return { method: "", value: "" };
}

function toBankgirotSupplierPayments(rows: SupplierPaymentExportRow[]) {
  const today = compactDate(new Date().toISOString().slice(0, 10));
  const totalOre = rows.reduce((sum, row) => sum + amountToOre(row.amount), 0);
  const lines = [
    fixedRecord(["01", today, safeText("VIHEM SUPPLIER PAYMENTS", 30)], 80),
    ...rows.map((row) => fixedRecord([
      "22",
      compactDate(row.due_date),
      row.payment_method === "bankgiro" ? "BG" : row.payment_method === "plusgiro" ? "PG" : "BK",
      digitsOnly(row.payment_target).padStart(16, "0").slice(-16),
      String(amountToOre(row.amount)).padStart(12, "0"),
      safeText(row.reference || row.invoice_number || row.supplier_invoice_id, 20),
      safeText(row.supplier_name, 24),
    ], 80)),
    fixedRecord(["09", String(rows.length).padStart(8, "0"), String(totalOre).padStart(16, "0"), today], 80),
  ];
  return `${lines.join("\n")}\n`;
}

function formatAmount(value: number) {
  return value.toFixed(2).replace(".", ",");
}

function compactDate(value: string) {
  return value.replaceAll("-", "").slice(0, 8);
}

function amountToOre(value: number) {
  return Math.round(Number(value || 0) * 100);
}

function digitsOnly(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function fixedRecord(parts: string[], length: number) {
  return parts.join("").slice(0, length).padEnd(length, " ");
}

function safeText(value: string, length: number) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 .:_/-]/g, "")
    .toUpperCase()
    .slice(0, length)
    .padEnd(length, " ");
}

function toCsv(rows: string[][]) {
  return rows
    .map((row) => row.map((value) => {
      const normalized = String(value ?? "").replace(/\r?\n/g, " ");
      return `"${normalized.replace(/"/g, '""')}"`;
    }).join(";"))
    .join("\n");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
