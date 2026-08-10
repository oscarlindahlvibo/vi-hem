import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type SettingsBody = {
  action?: "get" | "save" | "delete_secret" | "test";
  provider?: "google_vision" | "none";
  enabled?: boolean;
  openai_key?: string;
  google_vision_key?: string;
  delete_secret_name?: "openai" | "google_vision";
  ai_model?: string;
  vision_model?: string;
  min_text_length?: number | string;
  min_confidence?: number | string;
  enable_vision_fallback?: boolean;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const encryptionSecret = getEncryptionSecret(serviceKey);
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const body = (await req.json().catch(() => ({}))) as SettingsBody;
    const action = body.action || "get";

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile, error: profileError } = await serviceClient
      .from("vihem_profiles")
      .select("id, role, organisation_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile?.organisation_id) return json({ error: "Kunde inte verifiera användaren." }, 403);
    if (!["superadmin", "admin"].includes(profile.role)) {
      return json({ error: "Endast admin kan hantera AI/OCR-kopplingar." }, 403);
    }

    const existing = await getSettings(serviceClient, profile.organisation_id);
    if (action === "get") return json({ ok: true, settings: publicSettings(existing) });

    if (action === "delete_secret") {
      const update: Record<string, unknown> = { updated_by: user.id };
      if (body.delete_secret_name === "openai") {
        update.encrypted_openai_key = "";
        update.openai_key_hint = "";
        update.openai_key_rotated_at = null;
      } else if (body.delete_secret_name === "google_vision") {
        update.encrypted_google_vision_key = "";
        update.google_vision_key_hint = "";
        update.google_vision_key_rotated_at = null;
      } else {
        return json({ error: "Välj vilken nyckel som ska tas bort." }, 400);
      }
      const settings = await upsertSettings(serviceClient, profile.organisation_id, user.id, update);
      return json({ ok: true, settings: publicSettings(settings) });
    }

    if (action === "save") {
      const update: Record<string, unknown> = {
        provider: body.provider || existing?.provider || "google_vision",
        enabled: body.enabled ?? existing?.enabled ?? true,
        ai_model: clean(body.ai_model) || existing?.ai_model || "gpt-5-nano",
        vision_model: clean(body.vision_model) || existing?.vision_model || "gpt-5-mini",
        min_text_length: clampInt(body.min_text_length, 0, 10000, existing?.min_text_length ?? 250),
        min_confidence: clampNumber(body.min_confidence, 0, 1, Number(existing?.min_confidence ?? 0.72)),
        enable_vision_fallback: body.enable_vision_fallback ?? existing?.enable_vision_fallback ?? true,
        updated_by: user.id,
      };

      if (clean(body.openai_key)) {
        update.encrypted_openai_key = await encryptSecret(clean(body.openai_key), encryptionSecret);
        update.openai_key_hint = buildSecretHint(clean(body.openai_key));
        update.openai_key_rotated_at = new Date().toISOString();
      }
      if (clean(body.google_vision_key)) {
        update.encrypted_google_vision_key = await encryptSecret(clean(body.google_vision_key), encryptionSecret);
        update.google_vision_key_hint = buildSecretHint(clean(body.google_vision_key));
        update.google_vision_key_rotated_at = new Date().toISOString();
      }

      const settings = await upsertSettings(serviceClient, profile.organisation_id, user.id, update);
      return json({ ok: true, settings: publicSettings(settings) });
    }

    if (action === "test") {
      const settings = existing || await upsertSettings(serviceClient, profile.organisation_id, user.id, {});
      const openaiKey = settings.encrypted_openai_key
        ? await decryptSecret(settings.encrypted_openai_key, encryptionSecret)
        : Deno.env.get("OPENAI_API_KEY") || Deno.env.get("VIHEM_OPENAI_API_KEY") || "";
      const googleKey = settings.encrypted_google_vision_key
        ? await decryptSecret(settings.encrypted_google_vision_key, encryptionSecret)
        : Deno.env.get("GOOGLE_VISION_API_KEY") || "";

      const openai = await testOpenAi(openaiKey, settings.ai_model || "gpt-5-nano");
      const google = testGoogleVisionConfig(googleKey);
      const ok = openai.ok && (settings.provider !== "google_vision" || google.ok);
      const nextSettings = await upsertSettings(serviceClient, profile.organisation_id, user.id, {
        config: {
          ...(settings.config || {}),
          last_tested_at: new Date().toISOString(),
          last_test_result: ok ? "ok" : "warning",
          last_test_openai: openai,
          last_test_google_vision: google,
        },
        updated_by: user.id,
      });
      return json({ ok, settings: publicSettings(nextSettings), openai, google_vision: google }, ok ? 200 : 400);
    }

    return json({ error: "Okänd åtgärd." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

async function getSettings(serviceClient: any, organisationId: string) {
  const fallback = await getFallbackSettings(serviceClient, organisationId).catch(() => null);
  const { data, error } = await serviceClient
    .from("vihem_ocr_provider_settings")
    .select("*")
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (error) return fallback;
  return mergeSettings(data, fallback);
}

async function upsertSettings(serviceClient: any, organisationId: string, userId: string, patch: Record<string, unknown>) {
  const baseSettings = {
    organisation_id: organisationId,
    provider: "google_vision",
    enabled: true,
    ai_model: "gpt-5-nano",
    vision_model: "gpt-5-mini",
    min_text_length: 250,
    min_confidence: 0.72,
    enable_vision_fallback: true,
    created_by: userId,
    updated_by: userId,
    ...patch,
  };

  const { data, error } = await serviceClient
    .from("vihem_ocr_provider_settings")
    .upsert(baseSettings, { onConflict: "organisation_id" })
    .select("*")
    .single();
  if (error) return await upsertFallbackSettings(serviceClient, organisationId, baseSettings);
  await upsertFallbackSettings(serviceClient, organisationId, data).catch(error => {
    console.warn("Could not mirror OCR settings to organisation settings", error.message);
  });
  return data;
}

function mergeSettings(primary: any, fallback: any) {
  if (!primary) return fallback || null;
  if (!fallback) return primary;
  return {
    ...fallback,
    ...primary,
    encrypted_openai_key: primary.encrypted_openai_key || fallback.encrypted_openai_key || "",
    openai_key_hint: primary.openai_key_hint || fallback.openai_key_hint || "",
    openai_key_rotated_at: primary.openai_key_rotated_at || fallback.openai_key_rotated_at || null,
    encrypted_google_vision_key: primary.encrypted_google_vision_key || fallback.encrypted_google_vision_key || "",
    google_vision_key_hint: primary.google_vision_key_hint || fallback.google_vision_key_hint || "",
    google_vision_key_rotated_at: primary.google_vision_key_rotated_at || fallback.google_vision_key_rotated_at || null,
    config: {
      ...(fallback.config || {}),
      ...(primary.config || {}),
    },
  };
}

async function getFallbackSettings(serviceClient: any, organisationId: string) {
  const { data, error } = await serviceClient
    .from("vihem_organisations")
    .select("settings")
    .eq("id", organisationId)
    .maybeSingle();
  if (error) throw error;
  const settings = data?.settings || {};
  return settings.ocr_provider_settings || null;
}

async function upsertFallbackSettings(serviceClient: any, organisationId: string, nextSettings: Record<string, unknown>) {
  const { data, error } = await serviceClient
    .from("vihem_organisations")
    .select("settings")
    .eq("id", organisationId)
    .maybeSingle();
  if (error) throw error;

  const organisationSettings = data?.settings || {};
  const existing = organisationSettings.ocr_provider_settings || {};
  const fallbackSettings = {
    ...existing,
    ...nextSettings,
    organisation_id: organisationId,
    updated_at: new Date().toISOString(),
  };

  const { error: updateError } = await serviceClient
    .from("vihem_organisations")
    .update({
      settings: {
        ...organisationSettings,
        ocr_provider_settings: fallbackSettings,
      },
    })
    .eq("id", organisationId);
  if (updateError) throw updateError;
  return fallbackSettings;
}

function publicSettings(settings: any) {
  const config = settings?.config || {};
  return {
    provider: settings?.provider || "google_vision",
    enabled: settings?.enabled ?? true,
    has_openai_key: Boolean(settings?.encrypted_openai_key) || Boolean(Deno.env.get("OPENAI_API_KEY") || Deno.env.get("VIHEM_OPENAI_API_KEY")),
    openai_key_hint: settings?.openai_key_hint || (Deno.env.get("OPENAI_API_KEY") || Deno.env.get("VIHEM_OPENAI_API_KEY") ? "server-env" : ""),
    openai_key_rotated_at: settings?.openai_key_rotated_at || null,
    has_google_vision_key: Boolean(settings?.encrypted_google_vision_key) || Boolean(Deno.env.get("GOOGLE_VISION_API_KEY")),
    google_vision_key_hint: settings?.google_vision_key_hint || (Deno.env.get("GOOGLE_VISION_API_KEY") ? "server-env" : ""),
    google_vision_key_rotated_at: settings?.google_vision_key_rotated_at || null,
    ai_model: settings?.ai_model || "gpt-5-nano",
    vision_model: settings?.vision_model || "gpt-5-mini",
    min_text_length: settings?.min_text_length ?? 250,
    min_confidence: Number(settings?.min_confidence ?? 0.72),
    enable_vision_fallback: settings?.enable_vision_fallback ?? true,
    last_tested_at: config.last_tested_at || null,
    last_test_result: config.last_test_result || "",
    last_test_openai: config.last_test_openai || null,
    last_test_google_vision: config.last_test_google_vision || null,
  };
}

async function testOpenAi(apiKey: string, model: string) {
  if (!apiKey) return { ok: false, message: "OpenAI-nyckel saknas." };
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    return { ok: false, message: payload?.error?.message || `OpenAI svarade ${res.status}.` };
  }
  return { ok: true, message: `OpenAI-nyckel fungerar. Modell vald: ${model}.` };
}

function testGoogleVisionConfig(apiKey: string) {
  if (!apiKey) return { ok: false, message: "Google Vision-nyckel saknas." };
  if (apiKey.length < 20) return { ok: false, message: "Google Vision-nyckeln ser för kort ut." };
  return { ok: true, message: "Google Vision-nyckel finns sparad. Full OCR-verifiering sker vid första dokumenttolkning." };
}

async function encryptSecret(secretValue: string, encryptionSecret: string) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest("SHA-256", encoder.encode(encryptionSecret));
  const key = await crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(secretValue));
  const combined = new Uint8Array(iv.byteLength + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
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

function buildSecretHint(secretValue: string) {
  const trimmed = secretValue.trim();
  if (trimmed.length <= 8) return `${"*".repeat(Math.max(trimmed.length, 4))}`;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getEncryptionSecret(serviceKey: string) {
  return Deno.env.get("VIHEM_OCR_SECRET_KEY")
    || Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY")
    || serviceKey;
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
