import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type Obligation = Record<string, unknown> & { official_reference: string; obligation_type: 'vat' | 'agi'; period: string; due_at: string };
interface Provider { sync(companyId: string, now: Date): Promise<{ obligations: Obligation[]; events: Record<string, unknown>[] }> }

class MockProvider implements Provider {
  async sync(companyId: string, now: Date) {
    const year = now.getUTCFullYear(); const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const due = new Date(Date.UTC(year, now.getUTCMonth() + 1, 12, 8)).toISOString();
    const base = { company_id: companyId, source: 'skatteverket', currency: 'SEK', official_status: 'open', task_status: 'open', source_updated_at: now.toISOString(), last_seen_at: now.toISOString(), due_at: due };
    return {
      obligations: [
        { ...base, obligation_type: 'vat', period: `${year}-${month}`, title: 'Momsdeklaration', description: 'Testunderlag från Skatteverket-adaptern.', amount: 0, verification_status: 'verified', official_reference: `MOCK-VAT-${year}-${month}`, raw_data: { provider: 'mock' } },
        { ...base, obligation_type: 'agi', period: `${year}-${month}`, title: 'Arbetsgivardeklaration', description: 'Kontrollera löneunderlag innan rapportering.', amount: null, verification_status: 'warning', official_reference: `MOCK-AGI-${year}-${month}`, raw_data: { provider: 'mock' } },
      ],
      events: [{ company_id: companyId, source: 'skatteverket', event_type: 'sync', title: 'Skatteverkets uppgifter synkades', description: 'Mockad synk utan officiella myndighetsanrop.', event_at: now.toISOString(), official_reference: `MOCK-SYNC-${year}-${month}`, raw_data: { provider: 'mock' } }],
    };
  }
}

class OAuthProvider implements Provider { async sync() { throw new Error('Officiell Skatteverket-synk kräver konfigurerad OAuth.'); } }

function randomUrlSafe(bytes = 32) { const data = new Uint8Array(bytes); crypto.getRandomValues(data); return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); }
async function sha256(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join(''); }

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = request.headers.get('Authorization'); if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!; const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } }); const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: auth, error: authError } = await userClient.auth.getUser(); if (authError || !auth.user) return json({ error: 'Unauthorized' }, 401);
    const { data: profile } = await admin.from('vihem_profiles').select('id,organisation_id,role').eq('id', auth.user.id).maybeSingle();
    if (!profile || !['admin', 'superadmin'].includes(profile.role)) return json({ error: 'Forbidden' }, 403);
    const body = await request.json(); const companyId = body.company_id as string; if (!companyId) return json({ error: 'company_id krävs' }, 400);
    const { data: enabled } = await admin.from('vihem_organisation_modules').select('enabled').eq('organisation_id', profile.organisation_id).eq('module_key', 'skatteverket').maybeSingle(); if (!enabled?.enabled) return json({ error: 'Modulen är inte aktiverad.' }, 403);
    const { data: company } = await admin.from('vihem_companies').select('id').eq('id', companyId).eq('organisation_id', profile.organisation_id).eq('active', true).maybeSingle(); if (!company) return json({ error: 'Bolaget tillhör inte organisationen.' }, 403);
    if (body.operation === 'oauth-start') {
      const clientId = Deno.env.get('SKATTEVERKET_CLIENT_ID'); const authUrl = Deno.env.get('SKATTEVERKET_AUTH_URL'); const redirectUri = body.redirect_uri || Deno.env.get('SKATTEVERKET_REDIRECT_URI'); if (!clientId || !authUrl || !redirectUri) return json({ error: 'OAuth är inte serverkonfigurerad ännu.' }, 503);
      const state = randomUrlSafe(); const verifier = randomUrlSafe(48); const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)); const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      const { error } = await admin.from('vihem_skatteverket_oauth_states').insert({ organisation_id: profile.organisation_id, company_id: companyId, state_hash: await sha256(state), code_verifier: verifier, redirect_uri: redirectUri, expires_at: new Date(Date.now() + 600000).toISOString() }); if (error) throw error;
      const target = new URL(authUrl); target.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: 'read', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString(); return json({ authorization_url: target.toString() });
    }
    if (body.operation !== 'mock-sync') return json({ error: 'Okänd operation' }, 400);
    const { data: integration } = await admin.from('vihem_skatteverket_integrations').select('mode').eq('company_id', companyId).maybeSingle(); const provider: Provider = integration?.mode === 'oauth' ? new OAuthProvider() : new MockProvider(); const now = new Date();
    const { data: run, error: runError } = await admin.from('vihem_tax_sync_runs').insert({ organisation_id: profile.organisation_id, company_id: companyId, mode: integration?.mode || 'mock', status: 'running', created_by: auth.user.id }).select('id').single(); if (runError) throw runError;
    try {
      const result = await provider.sync(companyId, now); const { error: obligationError } = await admin.from('vihem_tax_obligations').upsert(result.obligations.map(item => ({ ...item, organisation_id: profile.organisation_id })), { onConflict: 'company_id,source,obligation_type,period' }); if (obligationError) throw obligationError;
      const { error: eventError } = await admin.from('vihem_tax_events').upsert(result.events.map(item => ({ ...item, organisation_id: profile.organisation_id })), { onConflict: 'company_id,source,official_reference', ignoreDuplicates: true }); if (eventError) throw eventError;
      const { data: saved } = await admin.from('vihem_tax_obligations').select('id,title,description,due_at,official_reference').eq('company_id', companyId).in('official_reference', result.obligations.map(item => item.official_reference));
      for (const item of saved || []) { const { data: existing } = await admin.from('vihem_planning_items').select('id').eq('organisation_id', profile.organisation_id).eq('entity_type', 'tax_obligation').eq('entity_id', item.id).maybeSingle(); if (!existing) await admin.from('vihem_planning_items').insert({ organisation_id: profile.organisation_id, title: item.title, description: item.description, start_at: item.due_at, end_at: item.due_at, item_type: 'custom', entity_type: 'tax_obligation', entity_id: item.id, priority: 'normal', status: 'planned', created_by: auth.user.id, metadata: { company_id: companyId, official_reference: item.official_reference } }); }
      await admin.from('vihem_tax_sync_runs').update({ status: 'completed', obligations_seen: result.obligations.length, events_seen: result.events.length, finished_at: now.toISOString() }).eq('id', run.id); await admin.from('vihem_skatteverket_integrations').upsert({ organisation_id: profile.organisation_id, company_id: companyId, mode: integration?.mode || 'mock', last_sync_at: now.toISOString(), last_error: '' }, { onConflict: 'organisation_id,company_id' }); return json({ ok: true, obligations: result.obligations.length, events: result.events.length });
    } catch (error) { await admin.from('vihem_tax_sync_runs').update({ status: 'failed', error_message: error instanceof Error ? error.message : String(error), finished_at: now.toISOString() }).eq('id', run.id); throw error; }
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Serverfel' }, 500); }
});
