import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildTransportOrderPrompt, completeness, estimateOpenAiCostSek, looksGarbled, normalizeOrders, safeJsonParse, sha256Hex, statusForDbError,
  SYSTEM_PROMPT, transportOrderSchema, validateInterpretRequest, type InterpretedOrder, type PageInput,
} from "../_shared/ai-interpret-core.ts";

/*
 * AI-tolkning av transportdokument för andra system (t.ex. JK Projektlogistik).
 *
 * Anropas server-till-server med en API-nyckel per kund i headern X-Vihem-Ai-Key (verify_jwt = false i config.toml).
 * Nyckeln är kopplad till en kund i Vibogruppens fakturamodul. Samma OCR/AI-leverantörer och organisationsnycklar som
 * vihem-process-supplier-invoice-ocr används (Google Vision för text, OpenAI för strukturering, bildtolkning som fallback).
 *
 * Debitering: bara lyckade tolkningar, per sida. Dokumentinnehåll sparas inte; resultatet cachas högst 24 timmar så att
 * ett omförsök med samma request_id inte debiteras två gånger.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Vihem-Ai-Key, X-Client-Info, Apikey",
};

type Settings = {
  enabled: boolean;
  provider: string;
  openaiKey: string;
  googleVisionKey: string;
  aiModel: string;
  visionModel: string;
  minTextLength: number;
  enableVisionFallback: boolean;
};

type Usage = {
  model: string;
  ocrProvider: string;
  method: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costSek: number;
};

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const started = Date.now();
  // Edge-runtimens arbetare avbryts efter 60 s; avbryt själva före det så att tolkningen markeras som misslyckad (och inte debiteras).
  const deadline = started + 52000;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return json({ error: "Funktionen är inte konfigurerad." }, 503);
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const apiKey = req.headers.get("x-vihem-ai-key") ?? "";
  if (!/^vhk_[a-f0-9]{64}$/.test(apiKey)) return json({ error: "Ogiltig nyckel." }, 401);
  const keyHash = await sha256Hex(apiKey);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ogiltig begäran." }, 400);
  }

  // Pris och gränser så att anropande system kan visa kostnaden innan något skickas.
  if (body.action === "quote") {
    const { data, error } = await service.rpc("vihem_ai_client_info", { p_key_hash: keyHash });
    if (error) return json({ error: cleanDbMessage(error.message) }, statusForDbError(error.code));
    return json({
      ok: true,
      price_per_page: Number(data.price_per_page),
      vat_rate: Number(data.vat_rate),
      currency: "SEK",
      max_pages_per_request: Number(data.max_pages_per_request),
      monthly_page_limit: data.monthly_page_limit ?? null,
      month_pages_used: Number(data.month_pages_used ?? 0),
    });
  }

  const { data: info, error: infoError } = await service.rpc("vihem_ai_client_info", { p_key_hash: keyHash });
  if (infoError) return json({ error: cleanDbMessage(infoError.message) }, statusForDbError(infoError.code));

  const request = validateInterpretRequest(body, Number(info.max_pages_per_request));
  if (!request.ok) return json({ error: request.error }, request.status);

  const { data: begin, error: beginError } = await service.rpc("vihem_ai_begin", {
    p_key_hash: keyHash, p_request_id: request.requestId, p_pages: request.pages.length, p_source: request.source,
    p_user_ref: request.userRef, p_file_name: request.fileName, p_file_sha256: request.fileSha256,
  });
  if (beginError) return json({ error: cleanDbMessage(beginError.message) }, statusForDbError(beginError.code));

  const price = Number(info.price_per_page);
  const pricing = { price_per_page: price, vat_rate: Number(info.vat_rate), amount_ex_vat: Math.round(price * request.pages.length * 100) / 100, pages: request.pages.length };

  if (begin.duplicate) {
    if (begin.status === "success" && begin.result) {
      return json({ ok: true, duplicate: true, billed: false, interpretation_id: begin.id, ...begin.result, ...pricing });
    }
    if (begin.status === "processing") return json({ error: "Tolkningen pågår redan. Försök igen om en stund." }, 409);
    return json({ error: "Resultatet finns inte längre. Gör en ny tolkning." }, 410);
  }

  const usage: Usage = { model: "", ocrProvider: "", method: "", calls: 0, inputTokens: 0, outputTokens: 0, costSek: 0 };
  try {
    const settings = await loadSettings(service, String(begin.provider_organisation_id));
    if (!settings.enabled || (!settings.openaiKey && !settings.googleVisionKey)) throw new Error("AI-tolkning är inte konfigurerad (nycklar saknas).");
    if (!settings.openaiKey) throw new Error("OpenAI-nyckel saknas.");

    let ocrText = "";
    if (settings.provider === "google_vision" && settings.googleVisionKey) {
      try {
        const texts = await Promise.all(request.pages.map((page) => googleVisionOcr(page, settings.googleVisionKey, deadline)));
        ocrText = texts.map((text, index) => `--- Sida ${index + 1} ---\n${text}`).join("\n");
        usage.ocrProvider = "google_vision";
        console.log(`AI-tolkning: OCR klar efter ${Date.now() - started} ms, ${ocrText.length} tecken`);
        usage.costSek += request.pages.length * 0.016;
      } catch (error) {
        usage.ocrProvider = "google_vision_failed";
        console.warn("OCR misslyckades, går direkt på bildtolkning", error instanceof Error ? error.message : error);
      }
    }

    let orders: InterpretedOrder[] = [];
    let warnings: string[] = [];
    const hasText = ocrText.replace(/--- Sida \d+ ---/g, "").trim().length >= settings.minTextLength;
    if (hasText) {
      usage.method = "ocr_text";
      const result = await callOpenAi(settings.openaiKey, settings.aiModel, buildTransportOrderPrompt(ocrText), [], usage, deadline);
      ({ orders, warnings } = normalizeOrders(result));
    }
    if (orders.length === 0 || ((completeness(orders) < 0.45 || looksGarbled(orders)) && settings.enableVisionFallback)) {
      usage.method = hasText ? "ocr_text_plus_vision" : "vision";
      const vision = await callOpenAi(settings.openaiKey, settings.visionModel, buildTransportOrderPrompt(ocrText), request.pages, usage, deadline);
      const normalized = normalizeOrders(vision);
      if (normalized.orders.length > 0 && (!looksGarbled(normalized.orders) || looksGarbled(orders))) ({ orders, warnings } = normalized);
    }

    if (orders.length === 0) throw new Error("Kunde inte hitta någon transportorder i dokumentet.");

    const stored = { orders, warnings, model: usage.model, method: usage.method };
    await service.rpc("vihem_ai_complete", {
      p_id: begin.id, p_status: "success", p_result: stored, p_model: usage.model, p_ocr_provider: usage.ocrProvider, p_method: usage.method,
      p_calls: usage.calls, p_input_tokens: usage.inputTokens, p_output_tokens: usage.outputTokens, p_cost: usage.costSek, p_ms: Date.now() - started, p_error: "",
    });
    return json({ ok: true, duplicate: false, billed: true, interpretation_id: begin.id, ...stored, raw_text: ocrText.slice(0, 20000), ...pricing });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Okänt fel";
    console.error("AI-tolkning misslyckades", message);
    await service.rpc("vihem_ai_complete", {
      p_id: begin.id, p_status: "failed", p_result: null, p_model: usage.model, p_ocr_provider: usage.ocrProvider, p_method: usage.method,
      p_calls: usage.calls, p_input_tokens: usage.inputTokens, p_output_tokens: usage.outputTokens, p_cost: usage.costSek, p_ms: Date.now() - started, p_error: message,
    });
    // Misslyckade tolkningar debiteras inte.
    return json({ ok: false, billed: false, error: message.slice(0, 300), interpretation_id: begin.id }, 502);
  }
});

function cleanDbMessage(message: string) {
  return message.replace(/^.*?ERROR:\s*/, "").slice(0, 300);
}

async function loadSettings(service: ReturnType<typeof createClient>, organisationId: string): Promise<Settings> {
  const secret = Deno.env.get("VIHEM_OCR_SECRET_KEY") || Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const { data } = await service.from("vihem_ocr_provider_settings").select("*").eq("organisation_id", organisationId).maybeSingle();
  const openaiKey = data?.encrypted_openai_key && secret ? await decryptSecret(data.encrypted_openai_key, secret).catch(() => "") : "";
  const googleVisionKey = data?.encrypted_google_vision_key && secret ? await decryptSecret(data.encrypted_google_vision_key, secret).catch(() => "") : "";
  return {
    enabled: data?.enabled ?? true,
    provider: data?.provider || Deno.env.get("VIHEM_OCR_PROVIDER") || "google_vision",
    openaiKey: openaiKey || Deno.env.get("OPENAI_API_KEY") || Deno.env.get("VIHEM_OPENAI_API_KEY") || "",
    googleVisionKey: googleVisionKey || Deno.env.get("GOOGLE_VISION_API_KEY") || "",
    aiModel: data?.ai_model || "gpt-5-nano",
    visionModel: data?.vision_model || "gpt-5-mini",
    minTextLength: Number(data?.min_text_length ?? 250),
    enableVisionFallback: data?.enable_vision_fallback ?? true,
  };
}

async function decryptSecret(encryptedValue: string, encryptionSecret: string) {
  const bytes = Uint8Array.from(atob(encryptedValue), (c) => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptionSecret));
  const key = await crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher));
}

async function googleVisionOcr(page: PageInput, apiKey: string, deadline: number): Promise<string> {
  const res = await fetchWithTimeout(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ image: { content: page.base64 }, features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }] }] }),
  }, 30000, deadline);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Google Vision OCR misslyckades.");
  return data?.responses?.[0]?.fullTextAnnotation?.text || data?.responses?.[0]?.textAnnotations?.[0]?.description || "";
}

async function callOpenAi(apiKey: string, model: string, prompt: string, images: PageInput[], usage: Usage, deadline: number): Promise<unknown> {
  const userContent = images.length
    ? [{ type: "text", text: prompt }, ...images.map((page) => ({ type: "image_url", image_url: { url: `data:${page.content_type};base64,${page.base64}` } }))]
    : prompt;
  const messages = [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userContent }];
  let lastError = "";
  for (const candidate of [model, "gpt-4o-mini"]) {
    const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: candidate,
        response_format: { type: "json_schema", json_schema: { name: "transport_orders", strict: true, schema: transportOrderSchema() } },
        // Utan detta resonerar gpt-5-modellerna i nära en minut, vilket slår i edge-runtimens tidsgräns.
        ...(candidate.startsWith("gpt-5") ? { reasoning_effort: "minimal" } : {}),
        messages,
      }),
    }, 55000, deadline);
    const payload = await res.json().catch(() => ({}));
    console.log(`AI-tolkning: ${candidate} svarade ${res.status} efter ${Date.now() - (deadline - 52000)} ms (${images.length} bilder)`);
    if (!res.ok) {
      lastError = payload?.error?.message || `OpenAI svarade ${res.status}.`;
      continue;
    }
    const inputTokens = Number(payload?.usage?.prompt_tokens ?? 0);
    const outputTokens = Number(payload?.usage?.completion_tokens ?? 0);
    usage.model = candidate;
    usage.calls += 1;
    usage.inputTokens += inputTokens;
    usage.outputTokens += outputTokens;
    usage.costSek += estimateOpenAiCostSek(candidate, inputTokens, outputTokens);
    return safeJsonParse(String(payload?.choices?.[0]?.message?.content ?? "{}"));
  }
  throw new Error(lastError || "OpenAI-tolkningen misslyckades.");
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number, deadline: number) {
  const budget = Math.min(ms, deadline - Date.now());
  if (budget < 3000) throw new Error("Tolkningen tog för lång tid. Försök igen, gärna med färre sidor.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Tolkningen tog för lång tid. Försök igen, gärna med färre sidor.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
