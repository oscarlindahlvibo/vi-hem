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
        .select("company_id")
        .eq("organisation_id", profile.organisation_id)
        .eq("user_id", user.id)
        .eq("active", true)
        .in("role", ["bookkeeper", "admin"]);

      if (permissionError) throw permissionError;
      allowedCompanyIds = (permissions || []).map((permission: any) => permission.company_id);
      if (allowedCompanyIds.length === 0) return json({ error: "Saknar bolagsbehörighet för SIE-export." }, 403);
    }

    let query = serviceClient
      .from("vihem_accounting_sync_queue")
      .select("*, company:company_id(*)")
      .in("status", statuses)
      .order("created_at", { ascending: true })
      .limit(500);

    if (profile.role !== "superadmin") query = query.eq("organisation_id", profile.organisation_id);
    if (companyId) query = query.eq("company_id", companyId);
    if (allowedCompanyIds) query = query.in("company_id", allowedCompanyIds);

    const { data: queueItems, error: queueError } = await query;
    if (queueError) throw queueError;

    const vouchers = await buildVouchers(serviceClient, queueItems || []);
    const companyName = vouchers[0]?.companyName || "VI-HEM";
    const sie = buildSie(companyName, vouchers);

    return json({
      ok: true,
      filename: `vihem-bokforing-${new Date().toISOString().slice(0, 10)}.se`,
      count: vouchers.length,
      sie,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

async function buildVouchers(serviceClient: any, queueItems: any[]) {
  const vouchers = [];
  const accountMaps = await loadAccountMaps(serviceClient, queueItems);

  for (const item of queueItems) {
    const accounts = accountMaps.get(item.company_id) || fallbackAccounts();
    if (item.entity_type === "invoice") {
      const { data: invoice } = await serviceClient
        .from("vihem_invoices")
        .select("*, customer:customer_id(*)")
        .eq("id", item.entity_id)
        .maybeSingle();

      if (!invoice) continue;
      const { data: invoiceLines, error: invoiceLineError } = await serviceClient
        .from("vihem_invoice_lines")
        .select("description, line_total_excl_vat, vat_amount, account_code")
        .eq("invoice_id", invoice.id)
        .order("line_no", { ascending: true });

      if (invoiceLineError) throw invoiceLineError;

      const date = compactDate(invoice.invoice_date || item.created_at);
      const text = `Kundfaktura ${invoice.invoice_number || invoice.id} ${invoice.customer?.name || ""}`.trim();
      const revenueRows = (invoiceLines || []).map((line: any) => directAccountRow(
        accounts,
        line.account_code,
        "sales",
        -Number(line.line_total_excl_vat || 0),
        line.description || text,
      ));

      vouchers.push({
        id: item.id,
        companyName: item.company?.legal_name || item.company?.name || "VI-HEM",
        date,
        text,
        rows: [
          accountRow(accounts, "customer_receivable", Number(invoice.total_amount || 0), text),
          ...(revenueRows.length > 0 ? revenueRows : [accountRow(accounts, "sales", -Number(invoice.subtotal_amount || 0), text)]),
          accountRow(accounts, "output_vat", -Number(invoice.vat_amount || 0), text),
        ],
      });
    } else if (item.entity_type === "payment") {
      const { data: payment } = await serviceClient
        .from("vihem_payments")
        .select("*, invoice:invoice_id(*, customer:customer_id(*))")
        .eq("id", item.entity_id)
        .maybeSingle();

      if (!payment) continue;
      const date = compactDate(payment.payment_date || item.created_at);
      const text = `Betalning ${payment.invoice?.invoice_number || payment.reference || payment.id}`.trim();
      vouchers.push({
        id: item.id,
        companyName: item.company?.legal_name || item.company?.name || "VI-HEM",
        date,
        text,
        rows: [
          accountRow(accounts, "bank", Number(payment.amount || 0), text),
          accountRow(accounts, "customer_receivable", -Number(payment.amount || 0), text),
        ],
      });
    } else if (item.entity_type === "supplier_invoice") {
      const { data: supplierInvoice } = await serviceClient
        .from("vihem_supplier_invoices")
        .select("*, supplier:supplier_id(*)")
        .eq("id", item.entity_id)
        .maybeSingle();

      if (!supplierInvoice) continue;
      const { data: supplierInvoiceLines, error: supplierLineError } = await serviceClient
        .from("vihem_supplier_invoice_lines")
        .select("description, line_total_excl_vat, vat_amount, account_code")
        .eq("supplier_invoice_id", supplierInvoice.id)
        .order("line_no", { ascending: true });

      if (supplierLineError) throw supplierLineError;

      const text = `Leverantörsfaktura ${supplierInvoice.supplier_invoice_number || supplierInvoice.id} ${supplierInvoice.supplier?.name || ""}`.trim();
      if (item.action === "payment") {
        const paidDate = typeof supplierInvoice.ocr_data?.paid_date === "string" ? supplierInvoice.ocr_data.paid_date : "";
        const date = compactDate(paidDate || supplierInvoice.updated_at || item.created_at);
        vouchers.push({
          id: item.id,
          companyName: item.company?.legal_name || item.company?.name || "VI-HEM",
          date,
          text: `Betalning ${text}`,
          rows: [
            accountRow(accounts, "supplier_payable", Number(supplierInvoice.paid_amount || supplierInvoice.total_amount || 0), text),
            accountRow(accounts, "bank", -Number(supplierInvoice.paid_amount || supplierInvoice.total_amount || 0), text),
          ],
        });
        continue;
      }

      const date = compactDate(supplierInvoice.invoice_date || item.created_at);
      const costRows = (supplierInvoiceLines || []).map((line: any) => directAccountRow(
        accounts,
        line.account_code,
        "purchase",
        Number(line.line_total_excl_vat || 0),
        line.description || text,
      ));

      vouchers.push({
        id: item.id,
        companyName: item.company?.legal_name || item.company?.name || "VI-HEM",
        date,
        text,
        rows: [
          ...(costRows.length > 0 ? costRows : [accountRow(accounts, "purchase", Number(supplierInvoice.subtotal_amount || 0), text)]),
          accountRow(accounts, "input_vat", Number(supplierInvoice.vat_amount || 0), text),
          accountRow(accounts, "supplier_payable", -Number(supplierInvoice.total_amount || 0), text),
        ],
      });
    }
  }

  return vouchers.filter(voucher => {
    const balance = voucher.rows.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
    return Math.abs(balance) < 0.01;
  });
}

function buildSie(companyName: string, vouchers: any[]) {
  const today = compactDate(new Date().toISOString());
  const accountNames = collectAccountNames(vouchers);
  const lines = [
    "#FLAGGA 0",
    "#PROGRAM \"VI-HEM\"",
    "#FORMAT PC8",
    `#GEN ${today}`,
    `#FNAMN ${sieString(companyName)}`,
    "#SIETYP 4",
    ...Array.from(accountNames.entries()).map(([account, name]) => `#KONTO ${account} ${sieString(name)}`),
  ];

  vouchers.forEach((voucher, index) => {
    lines.push(`#VER A ${index + 1} ${voucher.date} ${sieString(voucher.text)} {`);
    voucher.rows.forEach((row: any) => {
      lines.push(`#TRANS ${row.account} {} ${sieAmount(row.amount)} ${sieString(row.text)}`);
    });
    lines.push("}");
  });

  return `${lines.join("\n")}\n`;
}

async function loadAccountMaps(serviceClient: any, queueItems: any[]) {
  const companyIds = Array.from(new Set(queueItems.map(item => item.company_id).filter(Boolean)));
  const maps = new Map<string, Record<string, string>>();
  if (companyIds.length === 0) return maps;

  const { data, error } = await serviceClient
    .from("vihem_accounting_accounts")
    .select("company_id, account_code, name, default_role")
    .in("company_id", companyIds)
    .eq("active", true);

  if (error) throw error;

  for (const companyId of companyIds) {
    maps.set(companyId, fallbackAccounts());
  }

  for (const account of data || []) {
    if (!account.default_role) continue;
    const map = maps.get(account.company_id) || fallbackAccounts();
    map[account.default_role] = account.account_code;
    map[`name:${account.account_code}`] = account.name;
    maps.set(account.company_id, map);
  }

  return maps;
}

function accountRow(accounts: Record<string, string>, role: string, amount: number, text: string) {
  const fallback = fallbackAccounts();
  const account = accounts[role] || fallback[role] || "";
  return directAccountRow(accounts, account, role, amount, text);
}

function directAccountRow(accounts: Record<string, string>, accountCode: string, fallbackRole: string, amount: number, text: string) {
  const fallback = fallbackAccounts();
  const account = accountCode || accounts[fallbackRole] || fallback[fallbackRole] || "";
  return {
    account,
    accountName: accounts[`name:${account}`] || fallback[`name:${account}`] || `Konto ${account}`,
    amount,
    text,
  };
}

function fallbackAccounts() {
  return {
    customer_receivable: "1510",
    bank: "1930",
    supplier_payable: "2440",
    output_vat: "2611",
    input_vat: "2641",
    sales: "3001",
    purchase: "4000",
    "name:1510": "Kundfordringar",
    "name:1930": "Företagskonto",
    "name:2440": "Leverantörsskulder",
    "name:2611": "Utgående moms",
    "name:2641": "Ingående moms",
    "name:3001": "Försäljning",
    "name:4000": "Inköp",
  };
}

function collectAccountNames(vouchers: any[]) {
  const names = new Map<string, string>();
  const fallback = fallbackAccounts();
  for (const voucher of vouchers) {
    for (const row of voucher.rows) {
      names.set(row.account, row.accountName || fallback[`name:${row.account}`] || `Konto ${row.account}`);
    }
  }
  if (names.size === 0) {
    for (const account of ["1510", "1930", "2440", "2611", "2641", "3001", "4000"]) {
      names.set(account, fallback[`name:${account}`]);
    }
  }
  return names;
}

function compactDate(value: string) {
  return String(value || new Date().toISOString()).slice(0, 10).replace(/-/g, "");
}

function sieAmount(value: number) {
  return Number(value || 0).toFixed(2);
}

function sieString(value: string) {
  return `"${String(value || "").replace(/"/g, "'")}"`;
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
