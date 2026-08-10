import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type ExtractedLine = {
  description?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  net_amount?: number;
  vat_rate?: number;
  vat_amount?: number;
};

type ExtractedDocument = {
  document_type?: "supplier_invoice" | "receipt" | "unknown";
  supplier_name?: string;
  supplier_org_number?: string;
  supplier_vat_number?: string;
  invoice_number?: string;
  receipt_number?: string;
  invoice_date?: string;
  due_date?: string;
  receipt_time?: string;
  currency?: string;
  net_amount?: number;
  vat_amount?: number;
  gross_amount?: number;
  bankgiro?: string;
  plusgiro?: string;
  iban?: string;
  bic?: string;
  payment_reference?: string;
  ocr_reference?: string;
  customer_reference?: string;
  supplier_reference?: string;
  payment_method?: string;
  suggested_company_id?: string;
  suggested_account_code?: string;
  suggested_project_id?: string;
  suggested_work_order_id?: string;
  suggested_property_id?: string;
  suggested_vehicle_id?: string;
  suggested_cost_center?: string;
  line_items?: ExtractedLine[];
  confidence?: Record<string, number>;
};

type Usage = {
  ocr_provider: string;
  ai_model: string;
  extraction_method: string;
  ai_call_count: number;
  input_tokens: number;
  output_tokens: number;
  ocr_pages: number;
  vision_fallback_used: boolean;
  estimated_cost_sek: number;
  processing_ms: number;
  retries: number;
};

type AiExtractionResult = {
  data: ExtractedDocument;
  model: string;
  aiCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostSek: number;
  warning?: string;
};

type OcrRuntimeSettings = {
  enabled: boolean;
  provider: string;
  openaiKey: string;
  googleVisionKey: string;
  aiModel: string;
  visionModel: string;
  minTextLength: number;
  minConfidence: number;
  enableVisionFallback: boolean;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit || 25), 1), 50);
    const companyId = typeof body.company_id === "string" ? body.company_id : "";
    const supplierInvoiceId = typeof body.supplier_invoice_id === "string" ? body.supplier_invoice_id : "";
    const forceVision = Boolean(body.force_vision);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile, error: profileError } = await serviceClient
      .from("vihem_profiles")
      .select("id, role, organisation_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) return json({ error: "Kunde inte verifiera användaren." }, 403);
    const runtimeSettings = await loadOcrRuntimeSettings(serviceClient, profile.organisation_id);

    let allowedCompanyIds: string[] | null = null;
    if (profile.role !== "superadmin" && profile.role !== "admin") {
      const { data: permissions, error: permissionError } = await serviceClient
        .from("vihem_company_user_permissions")
        .select("company_id, role")
        .eq("organisation_id", profile.organisation_id)
        .eq("user_id", user.id)
        .eq("active", true)
        .in("role", ["bookkeeper", "approver", "admin"]);

      if (permissionError) throw permissionError;
      allowedCompanyIds = (permissions || []).map((permission: any) => permission.company_id);
      if (allowedCompanyIds.length === 0) return json({ error: "Saknar bolagsbehörighet för OCR-kön." }, 403);
    }

    let query = serviceClient
      .from("vihem_supplier_invoices")
      .select("*, document:document_id(*), company:company_id(*), supplier:supplier_id(*)")
      .not("document_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (supplierInvoiceId) query = query.eq("id", supplierInvoiceId);
    else query = query.in("ocr_status", ["queued", "uploaded", "failed"]);
    if (profile.role !== "superadmin") query = query.eq("organisation_id", profile.organisation_id);
    if (companyId) query = query.eq("company_id", companyId);
    if (allowedCompanyIds) query = query.in("company_id", allowedCompanyIds);

    const { data: invoices, error: invoiceError } = await query;
    if (invoiceError) throw invoiceError;

    const results = [];
    for (const invoice of invoices || []) {
      const result = await processInvoice(serviceClient, invoice, { forceVision, actorId: user.id, settings: runtimeSettings });
      results.push(result);
    }

    return json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

async function loadOcrRuntimeSettings(serviceClient: any, organisationId: string): Promise<OcrRuntimeSettings> {
  const encryptionSecret = getEncryptionSecret();
  const fallbackSettings = await getFallbackOcrSettings(serviceClient, organisationId);
  const { data: tableSettings, error } = await serviceClient
    .from("vihem_ocr_provider_settings")
    .select("*")
    .eq("organisation_id", organisationId)
    .maybeSingle();

  if (error) console.warn("Could not load vihem_ocr_provider_settings, using organisation fallback", error.message);
  const data = mergeOcrSettings(tableSettings, fallbackSettings);

  const openaiKey = data?.encrypted_openai_key && encryptionSecret
    ? await decryptSecret(data.encrypted_openai_key, encryptionSecret).catch(() => "")
    : "";
  const googleVisionKey = data?.encrypted_google_vision_key && encryptionSecret
    ? await decryptSecret(data.encrypted_google_vision_key, encryptionSecret).catch(() => "")
    : "";

  return {
    enabled: data?.enabled ?? true,
    provider: data?.provider || Deno.env.get("VIHEM_OCR_PROVIDER") || "google_vision",
    openaiKey: openaiKey || Deno.env.get("OPENAI_API_KEY") || Deno.env.get("VIHEM_OPENAI_API_KEY") || "",
    googleVisionKey: googleVisionKey || Deno.env.get("GOOGLE_VISION_API_KEY") || "",
    aiModel: data?.ai_model || Deno.env.get("VIHEM_OCR_AI_MODEL") || "gpt-5-nano",
    visionModel: data?.vision_model || Deno.env.get("VIHEM_OCR_VISION_MODEL") || "gpt-5-mini",
    minTextLength: Number(data?.min_text_length ?? Deno.env.get("VIHEM_OCR_MIN_TEXT_LENGTH") ?? 250),
    minConfidence: Number(data?.min_confidence ?? Deno.env.get("VIHEM_OCR_MIN_CONFIDENCE") ?? 0.72),
    enableVisionFallback: data?.enable_vision_fallback ?? ((Deno.env.get("VIHEM_OCR_ENABLE_VISION_FALLBACK") || "true") !== "false"),
  };
}

function mergeOcrSettings(primary: any, fallback: any) {
  if (!primary) return fallback || null;
  if (!fallback) return primary;
  return {
    ...fallback,
    ...primary,
    encrypted_openai_key: primary.encrypted_openai_key || fallback.encrypted_openai_key || "",
    encrypted_google_vision_key: primary.encrypted_google_vision_key || fallback.encrypted_google_vision_key || "",
  };
}

async function getFallbackOcrSettings(serviceClient: any, organisationId: string) {
  const { data, error } = await serviceClient
    .from("vihem_organisations")
    .select("settings")
    .eq("id", organisationId)
    .maybeSingle();
  if (error) return null;
  return data?.settings?.ocr_provider_settings || null;
}

function getEncryptionSecret() {
  return Deno.env.get("VIHEM_OCR_SECRET_KEY")
    || Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY")
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    || "";
}

async function processInvoice(serviceClient: any, invoice: any, options: { forceVision: boolean; actorId: string; settings: OcrRuntimeSettings }) {
  const started = Date.now();
  const usage: Usage = {
    ocr_provider: "",
    ai_model: "",
    extraction_method: "",
    ai_call_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    ocr_pages: 0,
    vision_fallback_used: false,
    estimated_cost_sek: 0,
    processing_ms: 0,
    retries: Number(invoice.processing_attempts || 0),
  };

  try {
    await updateInvoiceStatus(serviceClient, invoice.id, "extracting_text", {
      processing_started_at: new Date().toISOString(),
      processing_attempts: Number(invoice.processing_attempts || 0) + 1,
    });

    const document = invoice.document || {};
    if (!document.storage_bucket || !document.storage_path) throw new Error("Dokumentet saknar storage-koppling.");

    const { data: blob, error: downloadError } = await serviceClient.storage
      .from(document.storage_bucket)
      .download(document.storage_path);
    if (downloadError || !blob) throw downloadError || new Error("Kunde inte hämta originaldokumentet.");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const contentType = String(document.mime_type || document.content_type || invoice.ocr_data?.content_type || blob.type || "").toLowerCase();
    const fileName = String(document.file_name || invoice.ocr_data?.file_name || "");
    const isPdf = contentType.includes("pdf") || fileName.toLowerCase().endsWith(".pdf");
    const originalBase64 = bytesToBase64(bytes);

    let text = "";
    if (isPdf && !options.forceVision) {
      text = extractPdfTextCheap(bytes);
      usage.extraction_method = "pdf_text";
    }

    let ocrWarning = "";
    if (options.settings.enabled && (!text || text.length < options.settings.minTextLength) && !options.forceVision) {
      await updateInvoiceStatus(serviceClient, invoice.id, "ocr_processing");
      try {
        const ocr = await runOcrAdapter(bytes, contentType, fileName, options.settings);
        text = ocr.text || text;
        usage.ocr_provider = ocr.provider;
        usage.ocr_pages = ocr.pages;
        usage.estimated_cost_sek += ocr.estimatedCostSek;
        usage.extraction_method = usage.extraction_method === "pdf_text" ? "pdf_text_plus_ocr" : "ocr";
      } catch (error) {
        ocrWarning = error instanceof Error ? error.message : "OCR misslyckades.";
        usage.ocr_provider = `${options.settings.provider || "ocr"}_failed`;
        usage.extraction_method = usage.extraction_method === "pdf_text" ? "pdf_text_plus_ocr_failed" : "ocr_failed";
      }
    }

    if (!text || text.trim().length < 20) {
      text = buildMetadataText(invoice, document);
      usage.extraction_method = usage.extraction_method || "metadata";
    }

    await updateInvoiceStatus(serviceClient, invoice.id, "ai_processing");
    const context = await loadBusinessContext(serviceClient, invoice);
    let extracted = await structureWithAi(text, context, invoice.document_kind || "supplier_invoice", false, undefined, options.settings);
    usage.ai_model = extracted.model;
    usage.ai_call_count += extracted.aiCalls;
    usage.input_tokens += extracted.inputTokens;
    usage.output_tokens += extracted.outputTokens;
    usage.estimated_cost_sek += extracted.estimatedCostSek;

    let data = extracted.data;
    data = applyContextSuggestions(data, context);
    let validation = await validateExtraction(serviceClient, invoice, data, context);
    let confidence = normalizeConfidence(data.confidence, validation);

    const shouldUseVision = options.settings.enabled && options.settings.enableVisionFallback && !options.forceVision
      && (validation.severity === "red" || averageConfidence(confidence) < options.settings.minConfidence);

    if (shouldUseVision) {
      const vision = await structureWithAi(text, context, invoice.document_kind || "supplier_invoice", true, {
        base64: originalBase64,
        contentType: contentType || "application/octet-stream",
        fileName,
      }, options.settings);
      usage.vision_fallback_used = true;
      usage.ai_model = vision.model;
      usage.ai_call_count += vision.aiCalls;
      usage.input_tokens += vision.inputTokens;
      usage.output_tokens += vision.outputTokens;
      usage.estimated_cost_sek += vision.estimatedCostSek;
      data = applyContextSuggestions(vision.data, context);
      validation = await validateExtraction(serviceClient, invoice, data, context);
      confidence = normalizeConfidence(data.confidence, validation);
      if (vision.warning) {
        validation = {
          ...validation,
          warnings: [...(validation.warnings || []), `Vision: ${vision.warning}`],
          severity: validation.severity === "green" ? "yellow" : validation.severity,
        };
      }
    }

    const processingWarnings = [
      ocrWarning ? `OCR: ${ocrWarning}` : "",
      extracted.warning ? `AI: ${extracted.warning}` : "",
    ].filter(Boolean);
    if (processingWarnings.length) {
      validation = {
        ...validation,
        warnings: [...(validation.warnings || []), ...processingWarnings],
        severity: validation.severity === "green" ? "yellow" : validation.severity,
      };
      confidence = normalizeConfidence(data.confidence, validation);
    }

    await persistExtraction(serviceClient, invoice, data, validation, confidence, text, usage, options.actorId);
    usage.processing_ms = Date.now() - started;
    await logUsage(serviceClient, invoice, usage, validation.severity === "red" ? "needs_review" : "completed");

    return {
      id: invoice.id,
      status: validation.severity === "red" ? "needs_review" : "needs_review",
      extraction_method: usage.extraction_method,
      vision_fallback_used: usage.vision_fallback_used,
      warnings: validation.warnings,
    };
  } catch (error) {
    usage.processing_ms = Date.now() - started;
    await serviceClient
      .from("vihem_supplier_invoices")
      .update({
        ocr_status: "failed",
        processing_finished_at: new Date().toISOString(),
        ocr_data: {
          ...(invoice.ocr_data || {}),
          error: error instanceof Error ? error.message : "Okänt fel",
          failed_at: new Date().toISOString(),
        },
      })
      .eq("id", invoice.id);
    await logUsage(serviceClient, invoice, usage, "failed", error instanceof Error ? error.message : "Okänt fel");
    return { id: invoice.id, status: "failed", error: error instanceof Error ? error.message : "Okänt fel" };
  }
}

async function runOcrAdapter(bytes: Uint8Array, contentType: string, fileName: string, settings: OcrRuntimeSettings) {
  if (settings.provider === "google_vision" && settings.googleVisionKey) {
    return googleVisionOcr(bytes, contentType, fileName, settings.googleVisionKey);
  }
  return {
    provider: "none",
    text: "",
    pages: 0,
    estimatedCostSek: 0,
  };
}

async function googleVisionOcr(bytes: Uint8Array, contentType: string, fileName: string, apiKey: string) {
  const isPdf = contentType.includes("pdf") || fileName.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    return { provider: "google_vision_skipped_pdf", text: "", pages: estimatePdfPages(bytes), estimatedCostSek: 0 };
  }

  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        image: { content: bytesToBase64(bytes) },
        features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
      }],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || "Google Vision OCR misslyckades.");
  const text = json?.responses?.[0]?.fullTextAnnotation?.text || json?.responses?.[0]?.textAnnotations?.[0]?.description || "";
  return {
    provider: "google_vision",
    text,
    pages: 1,
    estimatedCostSek: 0.016,
  };
}

async function structureWithAi(
  text: string,
  context: any,
  documentKind: string,
  useVision: boolean,
  original?: { base64: string; contentType: string; fileName: string },
  settings?: OcrRuntimeSettings,
): Promise<AiExtractionResult> {
  const openAiKey = settings?.enabled === false ? "" : settings?.openaiKey || Deno.env.get("OPENAI_API_KEY") || Deno.env.get("VIHEM_OPENAI_API_KEY") || "";
  if (!openAiKey) {
    return {
      data: regexExtraction(text, documentKind),
      model: "local-regex",
      aiCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostSek: 0,
    };
  }

  const model = useVision ? (settings?.visionModel || "gpt-5-mini") : (settings?.aiModel || "gpt-5-nano");
  const fallbackModel = useVision ? "gpt-4o-mini" : "gpt-4o-mini";
  const messages: any[] = [
    {
      role: "system",
      content: "Du extraherar ekonomidata för VI-HEM. Svara endast med JSON som följer schemat. AI föreslår bara, godkänner aldrig.",
    },
    {
      role: "user",
      content: buildExtractionPrompt(text, context, documentKind),
    },
  ];

  if (useVision && original && !original.contentType.includes("pdf")) {
    messages[1] = {
      role: "user",
      content: [
        { type: "text", text: buildExtractionPrompt(text, context, documentKind) },
        { type: "image_url", image_url: { url: `data:${original.contentType};base64,${original.base64}` } },
      ],
    };
  }

  const firstAttempt = await callOpenAiChat(openAiKey, model, messages);
  const payload = firstAttempt.ok
    ? firstAttempt.payload
    : await callOpenAiChat(openAiKey, fallbackModel, messages).then(result => {
      if (result.ok) return { ...result.payload, __vihem_model: fallbackModel, __vihem_warning: firstAttempt.error };
      return null;
    });

  if (!payload) {
    return {
      data: regexExtraction(text, documentKind),
      model: "local-regex",
      aiCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostSek: 0,
      warning: firstAttempt.error || "OpenAI-tolkningen misslyckades. Lokal enkel tolkning användes.",
    };
  }

  const raw = payload?.choices?.[0]?.message?.content || "{}";
  const data = safeJsonParse(raw) as ExtractedDocument;
  const apiUsage = payload?.usage || {};
  const inputTokens = Number(apiUsage.prompt_tokens || apiUsage.input_tokens || 0);
  const outputTokens = Number(apiUsage.completion_tokens || apiUsage.output_tokens || 0);
  const usedModel = payload.__vihem_model || model;

  return {
    data,
    model: usedModel,
    aiCalls: 1,
    inputTokens,
    outputTokens,
    estimatedCostSek: estimateOpenAiCostSek(usedModel, inputTokens, outputTokens),
    warning: payload.__vihem_warning ? `Första modellen (${model}) misslyckades: ${payload.__vihem_warning}` : undefined,
  };
}

async function callOpenAiChat(openAiKey: string, model: string, messages: any[]) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "vihem_finance_document_extraction",
          strict: true,
          schema: extractionJsonSchema(),
        },
      },
      messages,
    }),
  });

  const payload = await res.json();
  if (!res.ok) return { ok: false, error: payload?.error?.message || `OpenAI svarade ${res.status}.`, payload: null };
  return { ok: true, error: "", payload };
}

async function loadBusinessContext(serviceClient: any, invoice: any) {
  const [companies, suppliers, accounts, vatCodes, rules, projects, workOrders, properties] = await Promise.all([
    serviceClient.from("vihem_companies").select("id,name,legal_name,organisation_number,vat_number,address_line1,city").eq("organisation_id", invoice.organisation_id).eq("active", true),
    serviceClient.from("vihem_finance_suppliers").select("*").eq("organisation_id", invoice.organisation_id).eq("active", true).limit(250),
    serviceClient.from("vihem_accounting_accounts").select("*").eq("organisation_id", invoice.organisation_id).eq("active", true).limit(300),
    serviceClient.from("vihem_vat_codes").select("*").eq("organisation_id", invoice.organisation_id).eq("active", true).limit(100),
    serviceClient.from("vihem_supplier_accounting_rules").select("*").eq("organisation_id", invoice.organisation_id).eq("active", true).limit(200),
    serviceClient.from("vihem_customer_projects").select("id,title,name,company_id,status").eq("organisation_id", invoice.organisation_id).in("status", ["planned", "active", "in_progress", "approved_by_customer", "completed"]).limit(100),
    serviceClient.from("vihem_work_orders").select("id,title,company_id,property_id,status").eq("organisation_id", invoice.organisation_id).not("status", "in", "(completed,archived,cancelled)").limit(150),
    serviceClient.from("vihem_properties").select("id,name,address,company_id").eq("organisation_id", invoice.organisation_id).limit(150),
  ]);
  for (const result of [companies, suppliers, accounts, vatCodes, rules, projects, workOrders, properties]) {
    if (result.error) throw result.error;
  }
  return {
    companies: companies.data || [],
    suppliers: suppliers.data || [],
    accounts: accounts.data || [],
    vatCodes: vatCodes.data || [],
    rules: rules.data || [],
    projects: projects.data || [],
    workOrders: workOrders.data || [],
    properties: properties.data || [],
  };
}

function applyContextSuggestions(data: ExtractedDocument, context: any): ExtractedDocument {
  const supplier = findBestSupplier(data, context.suppliers);
  const company = findBestCompany(data, context.companies);
  const rule = findBestRule(data, supplier, company, context.rules);

  return {
    ...data,
    supplier_name: data.supplier_name || supplier?.name || "",
    supplier_org_number: data.supplier_org_number || supplier?.organisation_number || "",
    suggested_company_id: data.suggested_company_id || company?.id || "",
    suggested_account_code: data.suggested_account_code || rule?.account_code || supplier?.default_account_code || "",
    suggested_project_id: data.suggested_project_id || rule?.project_id || "",
    suggested_work_order_id: data.suggested_work_order_id || rule?.work_order_id || "",
    suggested_property_id: data.suggested_property_id || rule?.property_id || "",
    suggested_cost_center: data.suggested_cost_center || rule?.cost_center || "",
  };
}

async function validateExtraction(serviceClient: any, invoice: any, data: ExtractedDocument, context: any) {
  const warnings: string[] = [];
  const errors: string[] = [];
  const net = money(data.net_amount);
  const vat = money(data.vat_amount);
  const gross = money(data.gross_amount);
  const lineNet = money((data.line_items || []).reduce((sum, line) => sum + money(line.net_amount ?? ((line.quantity || 1) * (line.unit_price || 0))), 0));
  const lineVat = money((data.line_items || []).reduce((sum, line) => sum + money(line.vat_amount ?? 0), 0));

  if (gross > 0 && Math.abs(net + vat - gross) > 1) errors.push("Netto + moms stämmer inte med totalbelopp.");
  if (lineNet > 0 && net > 0 && Math.abs(lineNet - net) > 2) warnings.push("Fakturaradernas netto avviker från totalsumman.");
  if (lineVat > 0 && vat > 0 && Math.abs(lineVat - vat) > 2) warnings.push("Fakturaradernas moms avviker från angiven moms.");
  if (!validDate(data.invoice_date)) warnings.push("Fakturadatum/kvittodatum saknas eller är ogiltigt.");
  if (data.due_date && !validDate(data.due_date)) warnings.push("Förfallodatum är ogiltigt.");
  if (data.due_date && data.invoice_date && validDate(data.invoice_date) && validDate(data.due_date) && data.due_date < data.invoice_date) errors.push("Förfallodatum ligger före fakturadatum.");
  if (data.supplier_org_number && !looksLikeOrgNumber(data.supplier_org_number)) warnings.push("Organisationsnummer behöver kontrolleras.");
  if (data.iban && !looksLikeIban(data.iban)) warnings.push("IBAN behöver kontrolleras.");
  if (data.bankgiro && !looksLikeBgPg(data.bankgiro)) warnings.push("Bankgiro behöver kontrolleras.");
  if (data.plusgiro && !looksLikeBgPg(data.plusgiro)) warnings.push("Plusgiro behöver kontrolleras.");

  const supplier = findBestSupplier(data, context.suppliers);
  const companyId = data.suggested_company_id || invoice.company_id;
  let duplicate: any = null;
  if (companyId && (supplier?.id || invoice.supplier_id) && (data.invoice_number || data.receipt_number)) {
    const { data: duplicateRows } = await serviceClient
      .from("vihem_supplier_invoices")
      .select("id,supplier_invoice_number,invoice_date,total_amount")
      .eq("company_id", companyId)
      .eq("supplier_id", supplier?.id || invoice.supplier_id)
      .eq("supplier_invoice_number", data.invoice_number || data.receipt_number)
      .neq("id", invoice.id)
      .limit(1);
    duplicate = duplicateRows?.[0] || null;
  }
  if (duplicate) errors.push("Möjlig dubblett: samma bolag, leverantör och faktura-/kvittonummer finns redan.");

  return {
    severity: errors.length ? "red" : warnings.length ? "yellow" : "green",
    warnings,
    errors,
    duplicate_supplier_invoice_id: duplicate?.id || null,
  };
}

async function persistExtraction(
  serviceClient: any,
  invoice: any,
  data: ExtractedDocument,
  validation: any,
  confidence: Record<string, number>,
  extractedText: string,
  usage: Usage,
  actorId: string,
) {
  const supplier = await findOrCreateSupplierFromExtraction(serviceClient, invoice, data, actorId);
  const nextCompanyId = data.suggested_company_id && data.suggested_company_id === invoice.company_id
    ? data.suggested_company_id
    : invoice.company_id;
  const documentKind = data.document_type === "receipt" ? "receipt" : invoice.document_kind || "supplier_invoice";
  const invoiceNumber = data.invoice_number || data.receipt_number || invoice.supplier_invoice_number || "";
  const invoiceDate = validDate(data.invoice_date) || invoice.invoice_date;
  const dueDate = documentKind === "receipt"
    ? invoiceDate
    : validDate(data.due_date) || invoice.due_date;
  const vatRate = firstVatRate(data);
  const gross = money(data.gross_amount || invoice.total_amount || 0);
  const net = money(data.net_amount || (gross > 0 ? gross / (1 + vatRate / 100) : invoice.subtotal_amount || 0));
  const vat = money(data.vat_amount || (gross - net));

  await serviceClient
    .from("vihem_supplier_invoices")
    .update({
      company_id: nextCompanyId,
      supplier_id: supplier?.id || invoice.supplier_id || null,
      supplier_invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      due_date: dueDate,
      currency: data.currency || invoice.currency || "SEK",
      status: "needs_review",
      approval_status: "pending",
      subtotal_amount: net,
      vat_amount: vat,
      total_amount: gross || net + vat,
      payment_reference: data.payment_reference || data.ocr_reference || invoice.payment_reference || "",
      document_kind: documentKind,
      extracted_text: extractedText.slice(0, 200000),
      ocr_provider: usage.ocr_provider || usage.extraction_method,
      ai_model: usage.ai_model,
      ai_call_count: Number(invoice.ai_call_count || 0) + usage.ai_call_count,
      input_tokens: Number(invoice.input_tokens || 0) + usage.input_tokens,
      output_tokens: Number(invoice.output_tokens || 0) + usage.output_tokens,
      ocr_pages: Number(invoice.ocr_pages || 0) + usage.ocr_pages,
      estimated_cost_sek: Number(invoice.estimated_cost_sek || 0) + usage.estimated_cost_sek,
      processing_finished_at: new Date().toISOString(),
      validation_results: validation,
      confidence,
      duplicate_supplier_invoice_id: validation.duplicate_supplier_invoice_id,
      project_id: data.suggested_project_id || invoice.project_id || null,
      work_order_id: data.suggested_work_order_id || invoice.work_order_id || null,
      property_id: data.suggested_property_id || invoice.property_id || null,
      cost_center: data.suggested_cost_center || invoice.cost_center || "",
      ocr_status: "needs_review",
      ocr_data: {
        ...(invoice.ocr_data || {}),
        extracted: data,
        validation,
        confidence,
        extraction_method: usage.extraction_method,
        ocr_provider: usage.ocr_provider,
        ai_model: usage.ai_model,
        processed_by_function: "vihem-process-supplier-invoice-ocr",
        processed_at: new Date().toISOString(),
        review_required: true,
      },
    })
    .eq("id", invoice.id);

  await replaceSuggestedLines(serviceClient, invoice, data, nextCompanyId, supplier);
  await maybeUpsertRuleUsage(serviceClient, invoice, data, supplier, nextCompanyId, actorId);
}

async function replaceSuggestedLines(serviceClient: any, invoice: any, data: ExtractedDocument, companyId: string, supplier: any) {
  const lines = (data.line_items || []).length > 0
    ? data.line_items || []
    : [{
      description: data.supplier_name || supplier?.name || (data.document_type === "receipt" ? "Kvitto" : "Leverantörsfaktura"),
      quantity: 1,
      unit: "st",
      unit_price: money(data.net_amount || data.gross_amount || 0),
      net_amount: money(data.net_amount || data.gross_amount || 0),
      vat_rate: firstVatRate(data),
      vat_amount: money(data.vat_amount || 0),
    }];

  await serviceClient.from("vihem_supplier_invoice_lines").delete().eq("supplier_invoice_id", invoice.id);
  const rows = lines.slice(0, 80).map((line, index) => {
    const quantity = Number(line.quantity || 1);
    const unitPrice = money(line.unit_price ?? (quantity ? money(line.net_amount || 0) / quantity : 0));
    const net = money(line.net_amount ?? quantity * unitPrice);
    const vatRate = Number(line.vat_rate ?? firstVatRate(data));
    const vat = money(line.vat_amount ?? net * (vatRate / 100));
    return {
      organisation_id: invoice.organisation_id,
      company_id: companyId,
      supplier_invoice_id: invoice.id,
      line_no: index + 1,
      description: String(line.description || "Rad").slice(0, 500),
      quantity,
      unit: String(line.unit || "st").slice(0, 20),
      unit_price: unitPrice,
      vat_rate: vatRate,
      account_code: data.suggested_account_code || supplier?.default_account_code || "",
      project_id: data.suggested_project_id || null,
      work_order_id: data.suggested_work_order_id || null,
      line_total_excl_vat: net,
      vat_amount: vat,
      line_total_incl_vat: money(net + vat),
      metadata: {
        ocr_suggested: true,
        source_document_kind: data.document_type || invoice.document_kind,
      },
    };
  });
  if (rows.length) {
    const { error } = await serviceClient.from("vihem_supplier_invoice_lines").insert(rows);
    if (error) throw error;
  }
}

async function findOrCreateSupplierFromExtraction(serviceClient: any, invoice: any, data: ExtractedDocument, actorId: string) {
  const name = clean(data.supplier_name);
  const orgNumber = normalizeDigits(data.supplier_org_number);
  if (!name && !orgNumber && !invoice.supplier_id) return null;

  let query = serviceClient
    .from("vihem_finance_suppliers")
    .select("*")
    .eq("organisation_id", invoice.organisation_id)
    .or(`company_id.eq.${invoice.company_id},company_id.is.null`)
    .limit(1);
  query = orgNumber ? query.eq("organisation_number", orgNumber) : query.ilike("name", name);
  const { data: existing } = await query.maybeSingle();
  if (existing) return existing;

  if (invoice.supplier_id) {
    const { data: supplier } = await serviceClient.from("vihem_finance_suppliers").select("*").eq("id", invoice.supplier_id).maybeSingle();
    if (supplier) return supplier;
  }
  if (!name) return null;

  const { data: supplier, error } = await serviceClient
    .from("vihem_finance_suppliers")
    .insert({
      organisation_id: invoice.organisation_id,
      company_id: invoice.company_id,
      name,
      organisation_number: orgNumber,
      vat_number: clean(data.supplier_vat_number),
      bankgiro: clean(data.bankgiro),
      plusgiro: clean(data.plusgiro),
      iban: clean(data.iban),
      bic: clean(data.bic),
      payment_reference: clean(data.payment_reference || data.ocr_reference),
      payment_terms_days: 30,
      active: true,
      notes: "Skapad från OCR-tolkning.",
      created_by: actorId,
    })
    .select("*")
    .single();
  if (error) throw error;
  return supplier;
}

async function maybeUpsertRuleUsage(serviceClient: any, invoice: any, data: ExtractedDocument, supplier: any, companyId: string, actorId: string) {
  if (!supplier?.id || !data.suggested_account_code) return;
  const { data: existing } = await serviceClient
    .from("vihem_supplier_accounting_rules")
    .select("*")
    .eq("organisation_id", invoice.organisation_id)
    .eq("company_id", companyId)
    .eq("supplier_id", supplier.id)
    .eq("account_code", data.suggested_account_code)
    .maybeSingle();

  if (existing) {
    await serviceClient
      .from("vihem_supplier_accounting_rules")
      .update({ usage_count: Number(existing.usage_count || 0) + 1, last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return;
  }

  await serviceClient.from("vihem_supplier_accounting_rules").insert({
    organisation_id: invoice.organisation_id,
    company_id: companyId,
    supplier_id: supplier.id,
    supplier_name_pattern: supplier.name,
    document_kind: invoice.document_kind || "supplier_invoice",
    account_code: data.suggested_account_code,
    project_id: data.suggested_project_id || null,
    work_order_id: data.suggested_work_order_id || null,
    property_id: data.suggested_property_id || null,
    cost_center: data.suggested_cost_center || "",
    usage_count: 1,
    last_used_at: new Date().toISOString(),
    created_by: actorId,
  });
}

async function logUsage(serviceClient: any, invoice: any, usage: Usage, status: string, errorMessage = "") {
  usage.processing_ms = usage.processing_ms || 0;
  await serviceClient.from("vihem_ocr_usage_logs").insert({
    organisation_id: invoice.organisation_id,
    company_id: invoice.company_id,
    supplier_invoice_id: invoice.id,
    document_id: invoice.document_id,
    document_kind: invoice.document_kind || "supplier_invoice",
    ocr_provider: usage.ocr_provider,
    ai_model: usage.ai_model,
    extraction_method: usage.extraction_method,
    ai_call_count: usage.ai_call_count,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    ocr_pages: usage.ocr_pages,
    vision_fallback_used: usage.vision_fallback_used,
    estimated_cost_sek: usage.estimated_cost_sek,
    processing_ms: usage.processing_ms,
    retries: usage.retries,
    status,
    error_message: errorMessage,
  });
}

async function updateInvoiceStatus(serviceClient: any, id: string, ocrStatus: string, extra: Record<string, unknown> = {}) {
  await serviceClient.from("vihem_supplier_invoices").update({ ocr_status: ocrStatus, ...extra }).eq("id", id);
}

function buildExtractionPrompt(text: string, context: any, documentKind: string) {
  const slimContext = {
    document_kind: documentKind,
    companies: context.companies.map((c: any) => ({ id: c.id, name: c.name, legal_name: c.legal_name, organisation_number: c.organisation_number, vat_number: c.vat_number, address: [c.address_line1, c.city].filter(Boolean).join(", ") })).slice(0, 25),
    suppliers: context.suppliers.map((s: any) => ({ id: s.id, name: s.name, organisation_number: s.organisation_number, vat_number: s.vat_number, default_account_code: s.default_account_code })).slice(0, 80),
    accounts: context.accounts.map((a: any) => ({ account_code: a.account_code, name: a.name, account_type: a.account_type })).slice(0, 120),
    vat_codes: context.vatCodes.map((v: any) => ({ code: v.code, rate: v.rate, purchase_account_code: v.purchase_account_code })).slice(0, 40),
    projects: context.projects.map((p: any) => ({ id: p.id, title: p.title || p.name, company_id: p.company_id, status: p.status })).slice(0, 40),
    work_orders: context.workOrders.map((w: any) => ({ id: w.id, title: w.title, company_id: w.company_id, property_id: w.property_id, status: w.status })).slice(0, 60),
    properties: context.properties.map((p: any) => ({ id: p.id, name: p.name, address: p.address, company_id: p.company_id })).slice(0, 60),
  };
  return [
    "Extrahera ekonomidata från dokumenttexten. Alla belopp ska vara nummer i dokumentets valuta.",
    "Identifiera mottagande VI-HEM-bolag bara om det är tydligt. Vid osäkerhet lämna suggested_company_id tom.",
    "Föreslå konto/projekt/arbetsorder/fastighet endast om dokumenttext och kontext stödjer det.",
    "Returnera confidence 0-1 för viktiga fält: supplier, invoice_number, invoice_date, due_date, gross_amount, vat_amount, payment_reference, bankgiro, company.",
    `Kontext JSON: ${JSON.stringify(slimContext)}`,
    `Dokumenttext:\n${text.slice(0, 50000)}`,
  ].join("\n\n");
}

function extractionJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      document_type: { type: "string", enum: ["supplier_invoice", "receipt", "unknown"] },
      supplier_name: { type: "string" },
      supplier_org_number: { type: "string" },
      supplier_vat_number: { type: "string" },
      invoice_number: { type: "string" },
      receipt_number: { type: "string" },
      invoice_date: { type: "string" },
      due_date: { type: "string" },
      receipt_time: { type: "string" },
      currency: { type: "string" },
      net_amount: { type: "number" },
      vat_amount: { type: "number" },
      gross_amount: { type: "number" },
      bankgiro: { type: "string" },
      plusgiro: { type: "string" },
      iban: { type: "string" },
      bic: { type: "string" },
      payment_reference: { type: "string" },
      ocr_reference: { type: "string" },
      customer_reference: { type: "string" },
      supplier_reference: { type: "string" },
      payment_method: { type: "string" },
      suggested_company_id: { type: "string" },
      suggested_account_code: { type: "string" },
      suggested_project_id: { type: "string" },
      suggested_work_order_id: { type: "string" },
      suggested_property_id: { type: "string" },
      suggested_vehicle_id: { type: "string" },
      suggested_cost_center: { type: "string" },
      line_items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            description: { type: "string" },
            quantity: { type: "number" },
            unit: { type: "string" },
            unit_price: { type: "number" },
            net_amount: { type: "number" },
            vat_rate: { type: "number" },
            vat_amount: { type: "number" },
          },
          required: ["description", "quantity", "unit", "unit_price", "net_amount", "vat_rate", "vat_amount"],
        },
      },
      confidence: {
        type: "object",
        additionalProperties: false,
        properties: {
          supplier: { type: "number" },
          invoice_number: { type: "number" },
          invoice_date: { type: "number" },
          due_date: { type: "number" },
          gross_amount: { type: "number" },
          vat_amount: { type: "number" },
          payment_reference: { type: "number" },
          bankgiro: { type: "number" },
          company: { type: "number" },
        },
        required: ["supplier", "invoice_number", "invoice_date", "due_date", "gross_amount", "vat_amount", "payment_reference", "bankgiro", "company"],
      },
    },
    required: [
      "document_type", "supplier_name", "supplier_org_number", "supplier_vat_number",
      "invoice_number", "receipt_number", "invoice_date", "due_date", "receipt_time",
      "currency", "net_amount", "vat_amount", "gross_amount", "bankgiro", "plusgiro",
      "iban", "bic", "payment_reference", "ocr_reference", "customer_reference",
      "supplier_reference", "payment_method", "suggested_company_id", "suggested_account_code",
      "suggested_project_id", "suggested_work_order_id", "suggested_property_id",
      "suggested_vehicle_id", "suggested_cost_center", "line_items", "confidence",
    ],
  };
}

function regexExtraction(text: string, documentKind: string): ExtractedDocument {
  const normalized = text.replace(/\s+/g, " ");
  const date = normalized.match(/\b(20\d{2})[-/.](\d{2})[-/.](\d{2})\b/);
  const invoiceNo = normalized.match(/(?:faktura(?:nummer|nr)?|invoice(?: no)?|kvitto(?:nummer|nr)?|receipt)[\s:#-]*([A-ZÅÄÖa-zåäö0-9-]{3,})/i);
  const bg = normalized.match(/\b(?:BG|Bankgiro)[:\s]*([0-9]{3,4}[-\s]?[0-9]{4})\b/i);
  const pg = normalized.match(/\b(?:PG|Plusgiro)[:\s]*([0-9]{2,8}[-\s]?[0-9]{1,4})\b/i);
  const iban = normalized.match(/\b(SE[0-9A-Z]{22}|[A-Z]{2}[0-9A-Z]{13,32})\b/i);
  const totals = [...normalized.matchAll(/(?:total|att betala|summa)[^\d]{0,20}([0-9][0-9\s.]*[,\.][0-9]{2})/gi)].map(m => parseAmount(m[1]));
  const moms = [...normalized.matchAll(/(?:moms|vat)[^\d]{0,20}([0-9][0-9\s.]*[,\.][0-9]{2})/gi)].map(m => parseAmount(m[1]));
  const gross = totals.filter(n => n > 0).sort((a, b) => b - a)[0] || 0;
  const vat = moms.filter(n => n > 0 && (!gross || n < gross)).sort((a, b) => b - a)[0] || 0;
  return {
    document_type: documentKind === "receipt" ? "receipt" : "supplier_invoice",
    supplier_name: "",
    supplier_org_number: "",
    supplier_vat_number: "",
    invoice_number: documentKind === "receipt" ? "" : invoiceNo?.[1] || "",
    receipt_number: documentKind === "receipt" ? invoiceNo?.[1] || "" : "",
    invoice_date: date ? `${date[1]}-${date[2]}-${date[3]}` : "",
    due_date: "",
    receipt_time: "",
    currency: "SEK",
    net_amount: money(gross - vat),
    vat_amount: vat,
    gross_amount: gross,
    bankgiro: bg?.[1] || "",
    plusgiro: pg?.[1] || "",
    iban: iban?.[1] || "",
    bic: "",
    payment_reference: "",
    ocr_reference: "",
    customer_reference: "",
    supplier_reference: "",
    payment_method: "",
    suggested_company_id: "",
    suggested_account_code: "",
    suggested_project_id: "",
    suggested_work_order_id: "",
    suggested_property_id: "",
    suggested_vehicle_id: "",
    suggested_cost_center: "",
    line_items: [],
    confidence: { gross_amount: gross ? 0.55 : 0.2, vat_amount: vat ? 0.45 : 0.2, invoice_date: date ? 0.55 : 0.2, invoice_number: invoiceNo ? 0.45 : 0.2 },
  };
}

function extractPdfTextCheap(bytes: Uint8Array) {
  const decoded = new TextDecoder("latin1").decode(bytes);
  const chunks: string[] = [];
  for (const match of decoded.matchAll(/\(([^()]{2,500})\)\s*Tj/g)) chunks.push(match[1]);
  for (const match of decoded.matchAll(/\[([^\]]{5,2000})\]\s*TJ/g)) chunks.push(match[1].replace(/\(([^()]*)\)/g, "$1"));
  const readable = decoded
    .replace(/[^\x09\x0A\x0D\x20-\x7EÅÄÖåäö]/g, " ")
    .replace(/\s+/g, " ")
    .match(/[A-Za-zÅÄÖåäö0-9][A-Za-zÅÄÖåäö0-9 .,:;_@/#%+()=-]{20,}/g);
  if (readable) chunks.push(...readable.slice(0, 200));
  return chunks.join("\n").replace(/\\([()\\])/g, "$1").replace(/\s+/g, " ").trim();
}

function buildMetadataText(invoice: any, document: any) {
  return [
    `Filnamn: ${document.file_name || invoice.ocr_data?.file_name || ""}`,
    `Titel: ${document.title || ""}`,
    `Anteckning: ${invoice.notes || ""}`,
    `Befintligt fakturanummer: ${invoice.supplier_invoice_number || ""}`,
  ].join("\n");
}

function findBestCompany(data: ExtractedDocument, companies: any[]) {
  const haystack = [data.customer_reference, data.supplier_reference].join(" ").toLowerCase();
  const org = normalizeDigits(data.customer_reference);
  return companies.find((company: any) => (
    company.organisation_number && org.includes(normalizeDigits(company.organisation_number))
  )) || companies.find((company: any) => (
    haystack && [company.name, company.legal_name].some((name: string) => name && haystack.includes(name.toLowerCase()))
  )) || null;
}

function findBestSupplier(data: ExtractedDocument, suppliers: any[]) {
  const supplierName = clean(data.supplier_name).toLowerCase();
  const org = normalizeDigits(data.supplier_org_number);
  return suppliers.find((supplier: any) => org && normalizeDigits(supplier.organisation_number) === org)
    || suppliers.find((supplier: any) => supplierName && (supplier.name || "").toLowerCase() === supplierName)
    || suppliers.find((supplier: any) => supplierName && supplierName.includes((supplier.name || "").toLowerCase()))
    || null;
}

function findBestRule(data: ExtractedDocument, supplier: any, company: any, rules: any[]) {
  return rules.find((rule: any) => (
    (!company?.id || rule.company_id === company.id)
    && (!supplier?.id || rule.supplier_id === supplier.id)
    && (rule.document_kind === "both" || rule.document_kind === (data.document_type || "supplier_invoice"))
  )) || null;
}

function normalizeConfidence(confidence: Record<string, unknown> | undefined, validation: any) {
  const base: Record<string, number> = {};
  for (const [key, value] of Object.entries(confidence || {})) base[key] = clamp(Number(value), 0, 1);
  if (validation.errors.length) base.validation = 0.2;
  else if (validation.warnings.length) base.validation = 0.65;
  else base.validation = 0.95;
  return base;
}

function averageConfidence(confidence: Record<string, number>) {
  const values = Object.values(confidence).filter(value => Number.isFinite(value));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function firstVatRate(data: ExtractedDocument) {
  const lineRate = data.line_items?.find(line => Number.isFinite(Number(line.vat_rate)))?.vat_rate;
  if (Number.isFinite(Number(lineRate))) return Number(lineRate);
  const net = money(data.net_amount);
  const vat = money(data.vat_amount);
  if (net > 0 && vat >= 0) return Math.round((vat / net) * 10000) / 100;
  return 25;
}

function estimatePdfPages(bytes: Uint8Array) {
  const text = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, 500000)));
  const count = (text.match(/\/Type\s*\/Page\b/g) || []).length;
  return Math.max(count, 1);
}

function estimateOpenAiCostSek(model: string, inputTokens: number, outputTokens: number) {
  const lower = model.toLowerCase();
  const usdPerMillionInput = lower.includes("nano") ? 0.05 : lower.includes("mini") ? 0.25 : 1.25;
  const usdPerMillionOutput = lower.includes("nano") ? 0.4 : lower.includes("mini") ? 2.0 : 10.0;
  const usd = (inputTokens / 1_000_000) * usdPerMillionInput + (outputTokens / 1_000_000) * usdPerMillionOutput;
  return Math.round(usd * 10.6 * 10000) / 10000;
}

function validDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : value;
}

function looksLikeOrgNumber(value: string) {
  const digits = normalizeDigits(value);
  return digits.length === 10 || digits.length === 12;
}

function looksLikeIban(value: string) {
  return /^[A-Z]{2}[0-9A-Z]{13,32}$/i.test(value.replace(/\s+/g, ""));
}

function looksLikeBgPg(value: string) {
  return /^[0-9]{2,8}[-\s]?[0-9]{1,4}$/.test(value.trim());
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function normalizeDigits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function money(value: unknown) {
  const number = typeof value === "number" ? value : parseAmount(String(value || "0"));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function parseAmount(value: string) {
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function decryptSecret(encryptedValue: string, encryptionSecret: string) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const bytes = Uint8Array.from(atob(encryptedValue), c => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  const keyMaterial = await crypto.subtle.digest("SHA-256", encoder.encode(encryptionSecret));
  const key = await crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["decrypt"]);
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return decoder.decode(plainBuffer);
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
