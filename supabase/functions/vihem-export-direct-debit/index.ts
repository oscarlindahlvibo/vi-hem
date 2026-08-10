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
    const runId = typeof body.run_id === "string" ? body.run_id : "";
    const format = body.format === "bankgirot" ? "bankgirot" : "csv";
    if (!runId) return json({ error: "Hyreskörning saknas." }, 400);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile, error: profileError } = await serviceClient
      .from("vihem_profiles")
      .select("id, role, organisation_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) return json({ error: "Kunde inte verifiera användaren." }, 403);

    const { data: run, error: runError } = await serviceClient
      .from("vihem_rent_billing_runs")
      .select("*, company:company_id(*)")
      .eq("id", runId)
      .maybeSingle();

    if (runError) throw runError;
    if (!run) return json({ error: "Hyreskörningen finns inte." }, 404);
    if (profile.role !== "superadmin" && run.organisation_id !== profile.organisation_id) {
      return json({ error: "Saknar behörighet till hyreskörningen." }, 403);
    }

    const canExport = await canExportCompany(serviceClient, profile, run.company_id);
    if (!canExport) return json({ error: "Saknar bolagsbehörighet för autogiroexport." }, 403);

    const { data: items, error: itemError } = await serviceClient
      .from("vihem_rent_billing_items")
      .select("*, tenant:tenant_id(id,name,email), property:property_id(id,name,address), apartment:apartment_id(id,apartment_number), invoice:invoice_id(*)")
      .eq("run_id", run.id)
      .neq("status", "skipped")
      .order("created_at", { ascending: true });

    if (itemError) throw itemError;

    const tenancyIds = [...new Set((items || []).map((item: any) => item.tenancy_id).filter(Boolean))];
    const { data: mandates, error: mandateError } = tenancyIds.length > 0
      ? await serviceClient
        .from("vihem_direct_debit_mandates")
        .select("*")
        .in("tenancy_id", tenancyIds)
        .eq("status", "active")
      : { data: [], error: null };

    if (mandateError) throw mandateError;

    const mandateByTenancy = new Map((mandates || []).map((mandate: any) => [mandate.tenancy_id, mandate]));
    const skipped = {
      missing_mandate: 0,
      missing_invoice: 0,
      not_collectable: 0,
      zero_amount: 0,
    };
    const rows: DirectDebitExportRow[] = [];

    for (const item of items || []) {
      const mandate = mandateByTenancy.get(item.tenancy_id);
      if (!mandate) {
        skipped.missing_mandate += 1;
        continue;
      }

      if (!item.invoice_id || !item.invoice) {
        skipped.missing_invoice += 1;
        continue;
      }

      if (["paid", "credited", "cancelled"].includes(item.invoice.status)) {
        skipped.not_collectable += 1;
        continue;
      }

      const balance = Number(item.invoice.balance_due ?? item.invoice.total_amount ?? item.total_amount ?? 0);
      if (!Number.isFinite(balance) || balance <= 0) {
        skipped.zero_amount += 1;
        continue;
      }

      rows.push({
        company_name: run.company?.name || "",
        rent_period: run.rent_period,
        due_date: item.due_date,
        mandate_reference: mandate.mandate_reference || item.invoice.invoice_number || item.id,
        bankgiro_number: mandate.bankgiro_number || run.company?.bankgiro || "",
        payer_number: mandate.payer_number || "",
        account_holder: mandate.account_holder || item.tenant?.name || "",
        invoice_number: item.invoice.invoice_number || "",
        tenant_name: item.tenant?.name || "",
        apartment_number: item.apartment?.apartment_number || "",
        property_name: item.property?.name || item.property?.address || "",
        amount: balance,
        currency: item.invoice.currency || "SEK",
        rent_item_id: item.id,
        invoice_id: item.invoice_id,
      });
    }

    const content = format === "bankgirot"
      ? toBankgirotAutogiro(rows, run)
      : toCsv([
        [
          "bolag",
          "hyresperiod",
          "forfallodatum",
          "mandatreferens",
          "bankgiro",
          "betalarnummer",
          "kontohavare",
          "fakturanummer",
          "hyresgast",
          "lagenhet",
          "fastighet",
          "belopp",
          "valuta",
          "hyresrad_id",
          "faktura_id",
        ],
        ...rows.map(row => [
          row.company_name,
          row.rent_period,
          row.due_date,
          row.mandate_reference,
          row.bankgiro_number,
          row.payer_number,
          row.account_holder,
          row.invoice_number,
          row.tenant_name,
          row.apartment_number,
          row.property_name,
          formatAmount(row.amount),
          row.currency,
          row.rent_item_id,
          row.invoice_id,
        ]),
      ]);

    return json({
      ok: true,
      filename: `vihem-autogiro-${run.rent_period.slice(0, 7)}-${new Date().toISOString().slice(0, 10)}.${format === "bankgirot" ? "txt" : "csv"}`,
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

type DirectDebitExportRow = {
  company_name: string;
  rent_period: string;
  due_date: string;
  mandate_reference: string;
  bankgiro_number: string;
  payer_number: string;
  account_holder: string;
  invoice_number: string;
  tenant_name: string;
  apartment_number: string;
  property_name: string;
  amount: number;
  currency: string;
  rent_item_id: string;
  invoice_id: string;
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

function formatAmount(value: number) {
  return value.toFixed(2).replace(".", ",");
}

function toBankgirotAutogiro(rows: DirectDebitExportRow[], run: any) {
  const today = compactDate(new Date().toISOString().slice(0, 10));
  const payeeBankgiro = digitsOnly(run.company?.bankgiro || rows[0]?.bankgiro_number || "").padStart(10, "0").slice(-10);
  const totalOre = rows.reduce((sum, row) => sum + amountToOre(row.amount), 0);
  const lines = [
    fixedRecord(["01", today, payeeBankgiro, safeText(run.company?.name || "VI-HEM", 30), safeText(`HYRA ${run.rent_period}`, 25)], 80),
    ...rows.map((row) => fixedRecord([
      "82",
      compactDate(row.due_date),
      payeeBankgiro,
      digitsOnly(row.payer_number).padStart(16, "0").slice(-16),
      String(amountToOre(row.amount)).padStart(12, "0"),
      safeText(row.mandate_reference || row.invoice_number || row.rent_item_id, 16),
      safeText(row.tenant_name, 20),
    ], 80)),
    fixedRecord(["09", String(rows.length).padStart(8, "0"), String(totalOre).padStart(16, "0"), today], 80),
  ];
  return `${lines.join("\n")}\n`;
}

function fixedRecord(parts: string[], length: number) {
  return parts.join("").slice(0, length).padEnd(length, " ");
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
