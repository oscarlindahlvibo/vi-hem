import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createAccountedService } from "../_shared/accounted.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Cron-Secret",
};

type Profile = {
  id: string;
  role: string;
  organisation_id: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const cronSecret = Deno.env.get("VIHEM_CRON_SECRET") || "";
    const cronAuthorized = !!cronSecret && req.headers.get("X-Cron-Secret") === cronSecret;
    if (!authHeader && !cronAuthorized) return json({ error: "Unauthorized" }, 401);

    const serviceClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const companyId = typeof body.company_id === "string" ? body.company_id : "";
    const organisationId = typeof body.organisation_id === "string" && body.organisation_id ? body.organisation_id : "";
    const limit = Math.min(Math.max(Number(body.limit || 50), 1), 200);

    let profile: Profile | null = null;
    let allowedCompanyIds: string[] | null = null;

    if (!cronAuthorized) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) return json({ error: "Unauthorized" }, 401);

      const { data: profileData, error: profileError } = await serviceClient
        .from("vihem_profiles")
        .select("id, role, organisation_id")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError || !profileData) return json({ error: "Kunde inte verifiera användaren." }, 403);
      profile = profileData as Profile;
      allowedCompanyIds = await getAllowedCompanyIds(serviceClient, profile);
      if (allowedCompanyIds && allowedCompanyIds.length === 0) {
        return json({ error: "Saknar bolagsbehörighet för bokföringssynk." }, 403);
      }
    }

    let query = serviceClient
      .from("vihem_accounting_sync_queue")
      .select("*, integration:integration_id(*)")
      .in("status", ["queued", "processing"])
      .order("created_at", { ascending: true })
      .limit(limit);

    if (profile && profile.role !== "superadmin") query = query.eq("organisation_id", profile.organisation_id);
    if (!profile && organisationId) query = query.eq("organisation_id", organisationId);
    if (companyId) query = query.eq("company_id", companyId);
    if (allowedCompanyIds) query = query.in("company_id", allowedCompanyIds);

    const { data: queueItems, error: queueError } = await query;
    if (queueError) throw queueError;

    const results = [];
    for (const item of queueItems || []) {
      results.push(await processQueueItem(serviceClient, item));
    }

    return json({
      ok: true,
      processed: results.length,
      synced: results.filter(item => item.status === "synced").length,
      failed: results.filter(item => item.status === "failed").length,
      results,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

async function getAllowedCompanyIds(serviceClient: any, profile: Profile) {
  if (profile.role === "superadmin" || profile.role === "admin") return null;

  const { data, error } = await serviceClient
    .from("vihem_company_user_permissions")
    .select("company_id")
    .eq("organisation_id", profile.organisation_id)
    .eq("user_id", profile.id)
    .eq("active", true)
    .in("role", ["bookkeeper", "admin"]);

  if (error) throw error;
  return (data || []).map((permission: { company_id: string }) => permission.company_id);
}

async function processQueueItem(serviceClient: any, item: any) {
  await updateQueueStatus(serviceClient, item, "processing", "", "");

  const provider = item.integration?.provider || item.payload?.provider || "manual";
  if (["manual", "sie", "none"].includes(provider)) {
    const externalId = buildExternalId(provider, item);
    await updateQueueStatus(serviceClient, item, "synced", externalId, "");
    return {
      id: item.id,
      status: "synced",
      provider,
      external_id: externalId,
    };
  }

  try {
    if (!item.integration?.id) {
      throw new Error(`Saknar aktiv bokföringskoppling för ${provider}.`);
    }

    const secret = await loadIntegrationSecret(serviceClient, item.integration.id);
    if (!secret) {
      throw new Error(`Saknar token för ${provider}. Lägg in token på bokföringskopplingen eller exportera via CSV/SIE.`);
    }

    const result = provider === "fortnox"
      ? await syncFortnoxItem(serviceClient, item, secret)
      : provider === "accounted"
        ? await syncAccountedItem(serviceClient, item, secret)
        : await syncGenericHttpItem(serviceClient, item, secret);

    await updateQueueStatus(serviceClient, item, "synced", result.external_id, "");
    return {
      id: item.id,
      status: "synced",
      provider,
      external_id: result.external_id,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : `Kunde inte synka mot ${provider}.`;
    await updateQueueStatus(serviceClient, item, "failed", "", errorMessage);
    return {
      id: item.id,
      status: "failed",
      provider,
      error: errorMessage,
    };
  }
}

async function syncAccountedItem(serviceClient: any, item: any, secret: string) {
  const entity = await loadAccountingEntity(serviceClient, item);
  if (!entity) throw new Error(`Kunde inte läsa ${item.entity_type} för Accounted-synk.`);
  return createAccountedService(item.integration, secret).sync(item, entity);
}

async function updateQueueStatus(
  serviceClient: any,
  item: any,
  status: "processing" | "synced" | "failed",
  externalId: string,
  errorMessage: string,
) {
  const updatePayload: Record<string, unknown> = {
    status,
    error_message: status === "failed" ? errorMessage : "",
    last_attempt_at: ["processing", "failed", "synced"].includes(status) ? new Date().toISOString() : item.last_attempt_at,
    synced_at: status === "synced" ? new Date().toISOString() : item.synced_at,
    updated_at: new Date().toISOString(),
  };

  if (status === "processing") updatePayload.attempts = Number(item.attempts || 0) + 1;
  if (externalId) updatePayload.external_id = externalId;

  const { error } = await serviceClient
    .from("vihem_accounting_sync_queue")
    .update(updatePayload)
    .eq("id", item.id);

  if (error) throw error;

  const accountingStatus = status === "synced" ? "synced" : status === "failed" ? "failed" : "pending";

  if (item.entity_type === "invoice") {
    const { error: invoiceError } = await serviceClient
      .from("vihem_invoices")
      .update({
        accounting_status: accountingStatus,
        ...(externalId ? { external_accounting_id: externalId } : {}),
      })
      .eq("id", item.entity_id);

    if (invoiceError) throw invoiceError;
  }

  if (item.entity_type === "supplier_invoice") {
    const { error: supplierInvoiceError } = await serviceClient
      .from("vihem_supplier_invoices")
      .update({
        accounting_status: accountingStatus,
        ...(externalId ? { external_accounting_id: externalId } : {}),
      })
      .eq("id", item.entity_id);

    if (supplierInvoiceError) throw supplierInvoiceError;
  }

  if (externalId && item.entity_type === "customer") {
    const { error: customerError } = await serviceClient
      .from("vihem_finance_customers")
      .update({ external_accounting_id: externalId })
      .eq("id", item.entity_id);

    if (customerError) throw customerError;
  }

  if (externalId && item.entity_type === "supplier") {
    const { error: supplierError } = await serviceClient
      .from("vihem_finance_suppliers")
      .update({ external_accounting_id: externalId })
      .eq("id", item.entity_id);

    if (supplierError) throw supplierError;
  }

  if (externalId && item.entity_type === "payment") {
    const { error: paymentError } = await serviceClient
      .from("vihem_payments")
      .update({ external_payment_id: externalId })
      .eq("id", item.entity_id);

    if (paymentError) throw paymentError;
  }
}

async function loadIntegrationSecret(serviceClient: any, integrationId: string) {
  const encryptionSecret = Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || "";
  if (!encryptionSecret) return "";

  const { data, error } = await serviceClient
    .from("vihem_accounting_integration_secrets")
    .select("encrypted_secret")
    .eq("integration_id", integrationId)
    .eq("secret_name", "primary_token")
    .maybeSingle();

  if (error) throw error;
  if (!data?.encrypted_secret) return "";

  return decryptSecret(String(data.encrypted_secret), encryptionSecret);
}

async function decryptSecret(encryptedSecret: string, encryptionSecret: string) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest("SHA-256", encoder.encode(encryptionSecret));
  const key = await crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["decrypt"]);
  const bytes = Uint8Array.from(atob(encryptedSecret), (char) => char.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plainBuffer);
}

function parseSecret(secret: string) {
  const trimmed = secret.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : { token: trimmed };
  } catch {
    return { token: trimmed };
  }
}

async function syncFortnoxItem(serviceClient: any, item: any, secret: string) {
  if (item.action === "delete" || item.action === "void") {
    throw new Error("Radering och makulering mot Fortnox kräver ett separat godkänt flöde.");
  }

  const entity = await loadAccountingEntity(serviceClient, item);
  if (!entity) throw new Error(`Kunde inte läsa ${item.entity_type} för bokföringssynk.`);

  if (item.entity_type === "customer") return syncFortnoxCustomer(serviceClient, item, entity, secret);
  if (item.entity_type === "invoice") return syncFortnoxInvoice(serviceClient, item, entity, secret);
  if (item.entity_type === "payment") return syncFortnoxPayment(serviceClient, item, entity, secret);
  if (item.entity_type === "supplier") return syncFortnoxSupplier(serviceClient, item, entity, secret);
  if (item.entity_type === "supplier_invoice") return syncFortnoxSupplierInvoice(serviceClient, item, entity, secret);

  throw new Error(`Fortnox-adaptern saknar stöd för ${item.entity_type}.`);
}

async function syncFortnoxCustomer(serviceClient: any, item: any, customer: any, secret: string) {
  const existingId = customer.external_accounting_id || item.external_id || "";
  const result = await fortnoxFetch(item, secret, existingId ? `/customers/${encodeURIComponent(existingId)}` : "/customers", {
    method: existingId ? "PUT" : "POST",
    body: {
      Customer: {
        CustomerNumber: existingId || undefined,
        Name: customer.name,
        Email: customer.invoice_email || customer.email || "",
        Phone1: customer.phone || "",
        Address1: customer.address_line1 || "",
        Address2: customer.address_line2 || "",
        ZipCode: customer.postal_code || "",
        City: customer.city || "",
        CountryCode: customer.country_code || "SE",
        OrganisationNumber: customer.organisation_number || "",
        YourReference: customer.notes || "",
      },
    },
  });
  const externalId = String(result.Customer?.CustomerNumber || existingId || "");
  if (!externalId) throw new Error("Fortnox returnerade inget kundnummer.");
  await serviceClient.from("vihem_finance_customers").update({ external_accounting_id: externalId }).eq("id", customer.id);
  return { external_id: externalId };
}

async function syncFortnoxSupplier(serviceClient: any, item: any, supplier: any, secret: string) {
  const existingId = supplier.external_accounting_id || item.external_id || "";
  const result = await fortnoxFetch(item, secret, existingId ? `/suppliers/${encodeURIComponent(existingId)}` : "/suppliers", {
    method: existingId ? "PUT" : "POST",
    body: {
      Supplier: {
        SupplierNumber: existingId || undefined,
        Name: supplier.name,
        Email: supplier.email || "",
        Phone1: supplier.phone || "",
        Address1: supplier.address_line1 || "",
        Address2: supplier.address_line2 || "",
        ZipCode: supplier.postal_code || "",
        City: supplier.city || "",
        CountryCode: supplier.country_code || "SE",
        OrganisationNumber: supplier.organisation_number || "",
      },
    },
  });
  const externalId = String(result.Supplier?.SupplierNumber || existingId || "");
  if (!externalId) throw new Error("Fortnox returnerade inget leverantörsnummer.");
  await serviceClient.from("vihem_finance_suppliers").update({ external_accounting_id: externalId }).eq("id", supplier.id);
  return { external_id: externalId };
}

async function syncFortnoxInvoice(serviceClient: any, item: any, invoice: any, secret: string) {
  const customer = invoice.customer;
  if (!customer) throw new Error("Fakturan saknar kund.");
  const customerNumber = customer.external_accounting_id
    || (await syncFortnoxCustomer(serviceClient, item, customer, secret)).external_id;

  const result = await fortnoxFetch(item, secret, "/invoices", {
    method: "POST",
    body: {
      Invoice: {
        CustomerNumber: customerNumber,
        InvoiceDate: invoice.invoice_date,
        DueDate: invoice.due_date,
        Currency: invoice.currency || "SEK",
        ExternalInvoiceReference1: invoice.invoice_number || invoice.id,
        Remarks: invoice.notes || "",
        InvoiceRows: (invoice.lines || []).map((line: any) => ({
          Description: line.description || "Rad",
          DeliveredQuantity: Number(line.quantity || 1),
          Unit: line.unit || "st",
          Price: Number(line.unit_price || 0),
          VAT: Number(line.vat_rate || 0),
          AccountNumber: line.account_code || undefined,
        })),
      },
    },
  });
  const externalId = String(result.Invoice?.DocumentNumber || result.Invoice?.InvoiceNumber || result.Invoice?.Url || "");
  if (!externalId) throw new Error("Fortnox returnerade inget fakturanummer.");
  await serviceClient.from("vihem_invoices").update({ external_accounting_id: externalId }).eq("id", invoice.id);
  return { external_id: externalId };
}

async function syncFortnoxPayment(serviceClient: any, item: any, payment: any, secret: string) {
  if (!payment.invoice?.external_accounting_id) {
    throw new Error("Betalningen kan inte bokföras innan fakturan har ett externt fakturanummer.");
  }

  const config = item.integration?.config || {};
  const result = await fortnoxFetch(item, secret, "/invoicepayments", {
    method: "POST",
    body: {
      InvoicePayment: {
        InvoiceNumber: payment.invoice.external_accounting_id,
        Amount: Number(payment.amount || 0),
        PaymentDate: payment.payment_date,
        ModeOfPayment: typeof config.mode_of_payment === "string" ? config.mode_of_payment : "BG",
        WriteOffs: [],
      },
    },
  });
  const externalId = String(result.InvoicePayment?.Number || result.InvoicePayment?.Url || `fortnox-payment-${payment.id}`);
  await serviceClient.from("vihem_payments").update({ external_payment_id: externalId }).eq("id", payment.id);
  return { external_id: externalId };
}

async function syncFortnoxSupplierInvoice(serviceClient: any, item: any, invoice: any, secret: string) {
  const supplier = invoice.supplier;
  if (!supplier) throw new Error("Leverantörsfakturan saknar leverantör.");
  const supplierNumber = supplier.external_accounting_id
    || (await syncFortnoxSupplier(serviceClient, item, supplier, secret)).external_id;

  const result = await fortnoxFetch(item, secret, "/supplierinvoices", {
    method: "POST",
    body: {
      SupplierInvoice: {
        SupplierNumber: supplierNumber,
        GivenNumber: invoice.supplier_invoice_number || invoice.id,
        InvoiceDate: invoice.invoice_date,
        DueDate: invoice.due_date,
        Total: Number(invoice.total_amount || 0),
        Currency: invoice.currency || "SEK",
        Comments: invoice.notes || "",
        SupplierInvoiceRows: (invoice.lines || []).map((line: any) => ({
          Account: line.account_code || undefined,
          Debit: Number(line.line_total_excl_vat || 0),
          Credit: 0,
          TransactionInformation: line.description || "",
        })),
      },
    },
  });
  const externalId = String(result.SupplierInvoice?.GivenNumber || result.SupplierInvoice?.Number || result.SupplierInvoice?.Url || "");
  if (!externalId) throw new Error("Fortnox returnerade inget leverantörsfaktura-id.");
  await serviceClient.from("vihem_supplier_invoices").update({ external_accounting_id: externalId }).eq("id", invoice.id);
  return { external_id: externalId };
}

async function fortnoxFetch(item: any, secret: string, path: string, options: { method: string; body: Record<string, unknown> }) {
  const credentials = parseSecret(secret) as Record<string, string>;
  const config = item.integration?.config || {};
  const baseUrl = typeof config.base_url === "string" ? config.base_url.replace(/\/$/, "") : "https://api.fortnox.se/3";
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (credentials.bearer_token) {
    headers.Authorization = `Bearer ${credentials.bearer_token}`;
  } else {
    headers["Access-Token"] = credentials.access_token || credentials.token || secret;
    if (credentials.client_secret || config.client_secret) {
      headers["Client-Secret"] = credentials.client_secret || config.client_secret;
    }
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers,
    body: JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Fortnox svarade ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function syncGenericHttpItem(serviceClient: any, item: any, secret: string) {
  if (item.action === "delete" || item.action === "void") {
    throw new Error("Radering och makulering kräver en separat endpoint i bokföringsadaptern.");
  }

  const entity = await loadAccountingEntity(serviceClient, item);
  if (!entity) throw new Error(`Kunde inte läsa ${item.entity_type} för bokföringssynk.`);

  const config = item.integration?.config || {};
  const endpoints = (config.endpoints && typeof config.endpoints === "object" ? config.endpoints : {}) as Record<string, any>;
  const endpoint = endpoints?.[item.entity_type]?.[item.action]
    || endpoints?.[item.entity_type]
    || config.endpoint_url;

  if (typeof endpoint !== "string" || !endpoint) {
    throw new Error(`Saknar adapter-endpoint för ${item.integration?.provider || "bokföringssystem"} (${item.entity_type}).`);
  }

  const credentials = parseSecret(secret) as Record<string, string>;
  const authHeader = typeof config.auth_header === "string" ? config.auth_header : "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (credentials.bearer_token || credentials.access_token) headers.Authorization = `Bearer ${credentials.bearer_token || credentials.access_token}`;
  if (credentials.api_key || credentials.token) headers[authHeader || "X-API-Key"] = credentials.api_key || credentials.token;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      provider: item.integration?.provider || "external",
      action: item.action,
      entity_type: item.entity_type,
      queue_item: item,
      entity,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${item.integration?.provider || "Adapter"} svarade ${response.status}: ${text.slice(0, 500)}`);
  }
  const result = text ? JSON.parse(text) : {};
  return { external_id: String(result.external_id || result.id || result.reference || buildExternalId(item.integration?.provider || "external", item)) };
}

async function loadAccountingEntity(serviceClient: any, item: any) {
  const queries: Record<string, { table: string; select: string }> = {
    customer: { table: "vihem_finance_customers", select: "*" },
    supplier: { table: "vihem_finance_suppliers", select: "*" },
    invoice: { table: "vihem_invoices", select: "*, customer:customer_id(*), lines:vihem_invoice_lines(*)" },
    payment: { table: "vihem_payments", select: "*, invoice:invoice_id(*)" },
    supplier_invoice: { table: "vihem_supplier_invoices", select: "*, supplier:supplier_id(*), lines:vihem_supplier_invoice_lines(*)" },
  };
  const queryConfig = queries[item.entity_type];
  if (!queryConfig) return null;

  const { data, error } = await serviceClient
    .from(queryConfig.table)
    .select(queryConfig.select)
    .eq("id", item.entity_id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function buildExternalId(provider: string, item: any) {
  const prefix = provider === "sie" ? "sie" : "manual";
  return `${prefix}-${new Date().toISOString().slice(0, 10)}-${String(item.id).slice(0, 8)}`;
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
