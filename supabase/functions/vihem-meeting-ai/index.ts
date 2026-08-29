// Möten & Uppföljning: AI-analys av ett mötesprotokoll. Läser dagordning,
// protokoll, beslut, uppgifter och relevanta öppna objekt (arbetsordrar,
// felanmälningar, kundprojekt, inköpslista) och föreslår -- föreslår, utför
// aldrig automatiskt -- nya uppgifter, ändringar av befintliga uppgifter,
// tillägg till inköpslistan och nya arbetsordrar. Återanvänder samma
// AI-nyckel/inställningar som leverantörsfaktura-OCR:n och Fleet Managers
// fordonsuppslag (vihem_ocr_provider_settings), så ingen ny nyckelhantering
// behövs -- och samma krypteringsnyckel-env-var (VIHEM_OCR_SECRET_KEY) som
// de faktiskt använder, till skillnad från en tidigare version av den här
// filen som av misstag letade efter en annan variabel och därför aldrig
// kunde dekryptera en riktigt sparad nyckel.
//
// Importerna/klientmönstret matchar övriga edge-funktioner i kodbasen
// (jsr:@supabase/functions-js + npm:@supabase/supabase-js + Deno.serve).
// En tidigare version av filen importerade supabase-js via ett fjärr-CDN
// (esm.sh, en gammal pinnad version) och `auth.getUser()` fick då aldrig
// tag i den inloggade användaren lokalt -- alla anrop gav "Unauthorized"
// trots giltig session. Verifierat genom att byta ut exakt detta mot det
// mönster som redan fungerar i t.ex. vihem-fleet-lookup-vehicle.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type JsonMap = Record<string, unknown>;

function jsonResponse(body: JsonMap, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function estimateOpenAiCostSek(inputTokens = 0, outputTokens = 0) {
  const usd = (inputTokens / 1_000_000) * 0.05 + (outputTokens / 1_000_000) * 0.40;
  return Number((usd * 10.6).toFixed(5));
}

function compactRows(rows: unknown[] | null | undefined, limit = 20) {
  return Array.isArray(rows) ? rows.slice(0, limit) : [];
}

// Samma prioritetsordning/nyckel som övriga edge-funktioner som dekrypterar
// en org-sparad hemlighet (vihem-process-supplier-invoice-ocr,
// vihem-fleet-lookup-vehicle m.fl.) -- måste matcha exakt vilken nyckel
// vihem-manage-ocr-settings faktiskt krypterade med, annars misslyckas
// dekrypteringen tyst och funktionen tror att ingen nyckel finns alls.
function getEncryptionSecret() {
  return Deno.env.get('VIHEM_OCR_SECRET_KEY')
    || Deno.env.get('VIHEM_ACCOUNTING_SECRET_KEY')
    || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    || '';
}

async function decryptSecret(encryptedValue: string, encryptionSecret: string) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const bytes = Uint8Array.from(atob(encryptedValue), c => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  const keyMaterial = await crypto.subtle.digest('SHA-256', encoder.encode(encryptionSecret));
  const key = await crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['decrypt']);
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return decoder.decode(plainBuffer);
}

async function safeSelect(client: ReturnType<typeof createClient>, table: string, build: (query: any) => any) {
  try {
    const { data, error } = await build(client.from(table).select('*'));
    if (error) return [];
    return data || [];
  } catch (_error) {
    return [];
  }
}

const PRIORITY_ENUM = ['low', 'normal', 'high', 'urgent'];
const ACTION_STATUS_ENUM = ['open', 'in_progress', 'done', 'cancelled'];

function meetingAnalysisSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      warnings: { type: 'array', items: { type: 'string' } },
      tasks_to_create: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: PRIORITY_ENUM },
            due_date: { type: ['string', 'null'] },
            reason: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['title', 'description', 'priority', 'due_date', 'reason', 'confidence'],
        },
      },
      tasks_to_update: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action_item_id: { type: ['string', 'null'] },
            action_item_title_hint: { type: 'string' },
            new_status: { type: ['string', 'null'], enum: [...ACTION_STATUS_ENUM, null] },
            new_priority: { type: ['string', 'null'], enum: [...PRIORITY_ENUM, null] },
            reason: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['action_item_id', 'action_item_title_hint', 'new_status', 'new_priority', 'reason', 'confidence'],
        },
      },
      purchase_items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            item_name: { type: 'string' },
            quantity: { type: ['string', 'null'] },
            store_name: { type: ['string', 'null'] },
            notes: { type: ['string', 'null'] },
            reason: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['item_name', 'quantity', 'store_name', 'notes', 'reason', 'confidence'],
        },
      },
      work_orders_to_create: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: PRIORITY_ENUM },
            reason: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['title', 'description', 'priority', 'reason', 'confidence'],
        },
      },
      review_flags: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            detail: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['title', 'detail', 'reason'],
        },
      },
    },
    required: ['summary', 'warnings', 'tasks_to_create', 'tasks_to_update', 'purchase_items', 'work_orders_to_create', 'review_flags'],
  };
}

function buildPrompt(context: JsonMap) {
  return `Du är VI-HEM:s mötesassistent. Analysera mötesprotokollet och kontexten nedan och fyll i JSON-schemat.

Regler:
- Du föreslår bara. Inga åtgärder utförs automatiskt -- en administratör granskar och klickar själv för att skapa/ändra något.
- tasks_to_create: nya uppgifter (mötesuppgifter/att-göra) som protokollet antyder behövs men som inte redan finns i action_items.
- tasks_to_update: ENDAST om en befintlig uppgift i action_items tydligt är klar, ska ändra prioritet, enligt protokollet. Sätt action_item_id till det exakta id-värdet från action_items-listan -- hitta aldrig på ett id. Om du inte är säker på vilken uppgift som avses, sätt action_item_id till null och beskriv den i action_item_title_hint istället.
- purchase_items: saker som behöver köpas in enligt protokollet, som inte redan finns i open_purchase_items.
- work_orders_to_create: konkreta fel/åtgärder på fastigheter/lägenheter som bör bli en arbetsorder, som inte redan finns i active_work_orders.
- review_flags: allt annat som behöver mänsklig uppmärksamhet men inte passar ovan -- t.ex. befintliga arbetsordrar/kundprojekt som verkar behöva ändras, öppna frågor, motsägelser i protokollet. Beskriv tydligt vad som behöver kollas och varför, en administratör tar hand om det manuellt.
- confidence: 0-1, hur säker du är på att förslaget är korrekt grundat i protokollet.
- Hitta inte på information. Om protokollet inte ger stöd för en kategori, lämna listan tom.
- Svara på svenska.

Kontext (JSON):
${JSON.stringify(context)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return jsonResponse({ error: 'Supabase server secrets saknas.' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const { data: profile, error: profileError } = await adminClient
      .from('vihem_profiles')
      .select('id, organisation_id, role, name')
      .eq('id', authData.user.id)
      .single();
    if (profileError || !profile) return jsonResponse({ error: 'Profil saknas.' }, 403);
    if (!['admin', 'superadmin'].includes(String(profile.role))) return jsonResponse({ error: 'Unauthorized' }, 403);

    const { meeting_id } = await req.json();
    if (!meeting_id) return jsonResponse({ error: 'meeting_id saknas.' }, 400);

    const { data: meeting, error: meetingError } = await adminClient
      .from('vihem_meetings')
      .select('*')
      .eq('id', meeting_id)
      .eq('organisation_id', profile.organisation_id)
      .single();
    if (meetingError || !meeting) return jsonResponse({ error: 'Mötet hittades inte.' }, 404);

    const [agendaItems, protocolRows, decisions, actionItems, workOrders, maintenanceRequests, customerProjects, purchaseItems] = await Promise.all([
      safeSelect(adminClient, 'vihem_meeting_agenda_items', q => q.eq('meeting_id', meeting_id).order('sort_order')),
      safeSelect(adminClient, 'vihem_meeting_protocol_rows', q => q.eq('meeting_id', meeting_id).order('created_at')),
      safeSelect(adminClient, 'vihem_meeting_decisions', q => q.eq('meeting_id', meeting_id).order('created_at')),
      safeSelect(adminClient, 'vihem_meeting_action_items', q => q.eq('meeting_id', meeting_id).order('created_at')),
      safeSelect(adminClient, 'vihem_work_orders', q => q.eq('organisation_id', profile.organisation_id).not('status', 'in', '(completed,cancelled)').limit(50)),
      safeSelect(adminClient, 'vihem_maintenance_requests', q => q.eq('organisation_id', profile.organisation_id).not('status', 'in', '(completed,cancelled)').limit(50)),
      safeSelect(adminClient, 'vihem_customer_projects', q => q.eq('organisation_id', profile.organisation_id).not('status', 'in', '(completed,archived,cancelled)').limit(50)),
      safeSelect(adminClient, 'vihem_purchase_items', q => q.eq('organisation_id', profile.organisation_id).not('status', 'in', '(purchased,cancelled)').limit(50)),
    ]);

    // Samma inställningskälla som fakturaskanningen (vihem-process-supplier-invoice-ocr):
    // vihem-manage-ocr-settings sparar normalt bara till vihem_organisations.settings
    // (jsonb-fallback) -- den dedikerade tabellraden är valfri/senare. Läs båda och
    // låt tabellraden vinna om den finns, annars fallback-jsonb:n.
    const [{ data: tableSettings }, { data: orgRow }] = await Promise.all([
      adminClient
        .from('vihem_ocr_provider_settings')
        .select('enabled, encrypted_openai_key, ai_model')
        .eq('organisation_id', profile.organisation_id)
        .maybeSingle(),
      adminClient
        .from('vihem_organisations')
        .select('settings')
        .eq('id', profile.organisation_id)
        .maybeSingle(),
    ]);
    const fallbackSettings = (orgRow?.settings as JsonMap | null)?.ocr_provider_settings as JsonMap | undefined;
    const settings = tableSettings || fallbackSettings
      ? { ...(fallbackSettings || {}), ...(tableSettings || {}) } as { enabled?: boolean; encrypted_openai_key?: string; ai_model?: string }
      : null;

    const encryptionSecret = getEncryptionSecret();
    const decryptedOpenAiKey = settings?.encrypted_openai_key && encryptionSecret
      ? await decryptSecret(settings.encrypted_openai_key, encryptionSecret).catch(() => '')
      : '';
    const openAiKey = decryptedOpenAiKey || Deno.env.get('OPENAI_API_KEY') || Deno.env.get('VIHEM_OPENAI_API_KEY');
    if (!openAiKey) return jsonResponse({ error: 'OpenAI API-nyckel saknas. Lägg till en under Administration -> Inställningar -> AI & OCR.' }, 400);
    if (settings && settings.enabled === false) {
      return jsonResponse({ error: 'Extern AI/OCR är avstängd för organisationen.' }, 400);
    }

    const model = settings?.ai_model || Deno.env.get('VIHEM_DEFAULT_AI_MODEL') || 'gpt-5-nano';
    const context = {
      meeting,
      agenda_items: compactRows(agendaItems, 40),
      protocol_rows: compactRows(protocolRows, 80),
      decisions: compactRows(decisions, 40),
      action_items: compactRows(actionItems, 50),
      active_work_orders: compactRows(workOrders, 50),
      active_maintenance_requests: compactRows(maintenanceRequests, 50),
      active_customer_projects: compactRows(customerProjects, 50),
      open_purchase_items: compactRows(purchaseItems, 50),
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Returnera endast valid JSON enligt schemat. Du utför aldrig åtgärder, du föreslår bara. Hitta aldrig på id:n -- använd bara id:n som förekommer i kontexten.' },
          { role: 'user', content: buildPrompt(context) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'vihem_meeting_analysis', strict: true, schema: meetingAnalysisSchema() },
        },
      }),
    });

    const raw = await response.json();
    if (!response.ok) {
      return jsonResponse({ error: raw?.error?.message || 'AI-tolkning misslyckades.' }, 502);
    }

    let analysis: JsonMap = {};
    try {
      analysis = JSON.parse(raw?.choices?.[0]?.message?.content || '{}');
    } catch (_error) {
      return jsonResponse({ error: 'AI returnerade ogiltig JSON.' }, 502);
    }

    const usage = raw?.usage || {};
    const estimatedCost = estimateOpenAiCostSek(usage.prompt_tokens || 0, usage.completion_tokens || 0);
    analysis.model = model;
    analysis.estimated_cost_sek = estimatedCost;

    const { data: suggestion, error: suggestionError } = await adminClient
      .from('vihem_ai_suggestions')
      .insert({
        organisation_id: profile.organisation_id,
        created_by: authData.user.id,
        source_type: 'meeting',
        source_id: meeting_id,
        suggestion_type: 'meeting_protocol_review',
        target_type: 'meeting',
        target_id: meeting_id,
        payload: analysis,
        status: 'pending',
      })
      .select('id')
      .single();
    if (suggestionError) return jsonResponse({ error: suggestionError.message }, 500);

    // Samma användningslogg-tabell som fakturaskanningen -- fanns redan,
    // en tidigare version av den här filen skrev till en tabell/kolumner
    // som aldrig funnits (vihem_ai_ocr_usage_logs) så loggningen föll
    // alltid bort tyst.
    await adminClient.from('vihem_ocr_usage_logs').insert({
      organisation_id: profile.organisation_id,
      document_kind: 'meeting_protocol',
      ocr_provider: 'openai',
      ai_model: model,
      ai_call_count: 1,
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      estimated_cost_sek: estimatedCost,
      status: 'completed',
    }).then(() => undefined);

    return jsonResponse({ analysis: { ...analysis, suggestion_id: suggestion?.id } });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Okänt fel.' }, 500);
  }
});
