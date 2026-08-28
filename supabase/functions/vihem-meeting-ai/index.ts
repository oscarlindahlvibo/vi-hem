import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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

function getEncryptionSecret() {
  return Deno.env.get('VIHEM_SECRET_ENCRYPTION_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
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

function buildPrompt(context: JsonMap) {
  return `Du är VI-HEM:s mötesassistent. Analysera mötet och returnera endast strikt JSON enligt schema.

Regler:
- Skapa bara förslag. Inga åtgärder får utföras automatiskt.
- Föreslå arbetsordrar, ändringar av arbetsordrar, kundprojekt, inköpslista, uppföljningar och frågor när protokollet stödjer det.
- Var konkret och använd befintliga objekt från kontexten när det går.
- Markera låg säkerhet när information saknas.
- Svara på svenska.

Kontext:
${JSON.stringify(context)}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Supabase server secrets saknas.' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || serviceRoleKey, {
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
      safeSelect(adminClient, 'vihem_purchase_items', q => q.eq('organisation_id', profile.organisation_id).not('status', 'in', '(done,archived)').limit(50)),
    ]);

    const { data: settings } = await adminClient
      .from('vihem_ocr_provider_settings')
      .select('enabled, encrypted_openai_key, ai_model')
      .eq('organisation_id', profile.organisation_id)
      .maybeSingle();

    const encryptionSecret = getEncryptionSecret();
    const decryptedOpenAiKey = settings?.encrypted_openai_key && encryptionSecret
      ? await decryptSecret(settings.encrypted_openai_key, encryptionSecret).catch(() => '')
      : '';
    const openAiKey = decryptedOpenAiKey || Deno.env.get('OPENAI_API_KEY') || Deno.env.get('VIHEM_OPENAI_API_KEY');
    if (!openAiKey) return jsonResponse({ error: 'OpenAI API-nyckel saknas i Inställningar.' }, 400);
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
          { role: 'system', content: 'Returnera endast valid JSON. Du utför aldrig åtgärder, du föreslår bara.' },
          { role: 'user', content: buildPrompt(context) },
        ],
        response_format: { type: 'json_object' },
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

    await adminClient.from('vihem_ai_ocr_usage_logs').insert({
      organisation_id: profile.organisation_id,
      document_type: 'meeting',
      provider: 'openai',
      ai_model: model,
      ai_calls: 1,
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      estimated_cost_sek: estimatedCost,
      status: 'completed',
      metadata: { meeting_id, suggestion_id: suggestion?.id },
    }).then(() => undefined);

    return jsonResponse({ analysis: { ...analysis, suggestion_id: suggestion?.id } });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Okänt fel.' }, 500);
  }
});
