// Fredagsmöte-ombygget: skärmparkoppling utan fullständig inloggning.
//
// Två åtgärder i samma funktion:
//  - action:'create' (kräver inloggad användare med meeting.screen.manage) --
//    mötesledarens kontrollvy anropar detta för att skapa en ny
//    parkopplingskod för en given meeting_id/segment_key/display_role.
//  - action:'redeem' (INGEN inloggning krävs -- det är hela poängen, en
//    redan betrodd fysisk skärm ska kunna ansluta utan att vara en
//    fullständig VI-HEM-användare) -- löser in en kod mot en aktiv
//    sessions-token. Engångsinlösen, begränsat antal försök, kort
//    giltighetstid, och endast HASH av både kod och token lagras i
//    databasen -- se vihem_meeting_screen_sessions.
//
// QR-koden kodar bara samma 6-siffriga kod (eller en kort inlösningslänk),
// aldrig en långlivad token -- token utfärdas först vid lyckad inlösen.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomDigits(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => String(b % 10)).join('');
}

function randomToken(bytesLength = 32) {
  const bytes = new Uint8Array(bytesLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const MAX_REDEEM_ATTEMPTS = 5;
const PAIRING_TTL_MINUTES = 10;
const SESSION_TTL_HOURS = 4;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return jsonResponse({ error: 'Supabase server secrets saknas.' }, 500);
  }
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json();
    const action = String(body.action || '');

    if (action === 'create') {
      const authHeader = req.headers.get('Authorization') || '';
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: authData, error: authError } = await userClient.auth.getUser();
      if (authError || !authData.user) return jsonResponse({ error: 'Unauthorized' }, 401);

      const { data: profile } = await adminClient
        .from('vihem_profiles')
        .select('id, organisation_id, role')
        .eq('id', authData.user.id)
        .single();
      if (!profile) return jsonResponse({ error: 'Profil saknas.' }, 403);

      if (!['admin', 'superadmin'].includes(String(profile.role))) {
        const { data: hasPermission } = await adminClient.rpc('vihem_has_permission', {
          p_user_id: profile.id,
          p_permission_key: 'meeting.screen.manage',
        });
        if (!hasPermission) return jsonResponse({ error: 'Unauthorized' }, 403);
      }

      const { meeting_id, segment_key, display_role, label } = body;
      if (!meeting_id || !segment_key || !display_role) return jsonResponse({ error: 'meeting_id, segment_key och display_role krävs.' }, 400);
      if (!['owner', 'finance', 'staff'].includes(segment_key)) return jsonResponse({ error: 'Ogiltig segment_key.' }, 400);
      if (!['meeting_main', 'staff_week_plan'].includes(display_role)) return jsonResponse({ error: 'Ogiltig display_role.' }, 400);

      const { data: meeting } = await adminClient
        .from('vihem_meetings')
        .select('id, organisation_id')
        .eq('id', meeting_id)
        .eq('organisation_id', profile.organisation_id)
        .single();
      if (!meeting) return jsonResponse({ error: 'Mötet hittades inte.' }, 404);

      const code = randomDigits(6);
      const codeHash = await sha256Hex(code);
      const pairingExpiresAt = new Date(Date.now() + PAIRING_TTL_MINUTES * 60 * 1000).toISOString();

      const { data: session, error: insertError } = await adminClient
        .from('vihem_meeting_screen_sessions')
        .insert({
          organisation_id: profile.organisation_id,
          meeting_id,
          segment_key,
          display_role,
          label: label || '',
          pairing_code_hash: codeHash,
          status: 'pending',
          pairing_expires_at: pairingExpiresAt,
          created_by: profile.id,
        })
        .select('id')
        .single();
      if (insertError || !session) return jsonResponse({ error: 'Kunde inte skapa parkopplingskod.' }, 500);

      await adminClient.from('vihem_audit_events').insert({
        organisation_id: profile.organisation_id,
        actor_id: profile.id,
        event_type: 'screen_pairing_code_created',
        entity_type: 'meeting_screen_session',
        entity_id: session.id,
        summary: `Parkopplingskod skapad för ${segment_key}/${display_role}`,
        metadata: { meeting_id },
      });

      // Code returned in plaintext ONLY here, to the authenticated leader
      // who is about to display it/its QR code -- never stored in
      // plaintext, never returned again after this response.
      return jsonResponse({ session_id: session.id, code, expires_at: pairingExpiresAt });
    }

    if (action === 'redeem') {
      const { code } = body;
      if (!code || typeof code !== 'string') return jsonResponse({ error: 'Kod krävs.' }, 400);
      const codeHash = await sha256Hex(code);

      const { data: session } = await adminClient
        .from('vihem_meeting_screen_sessions')
        .select('*')
        .eq('pairing_code_hash', codeHash)
        .eq('status', 'pending')
        .maybeSingle();

      if (!session) return jsonResponse({ error: 'Ogiltig eller redan använd kod.' }, 400);

      if (session.pairing_code_redeemed_at) {
        return jsonResponse({ error: 'Koden är redan använd.' }, 400);
      }
      if (new Date(session.pairing_expires_at).getTime() < Date.now()) {
        return jsonResponse({ error: 'Koden har gått ut.' }, 400);
      }
      if (session.redeem_attempts >= MAX_REDEEM_ATTEMPTS) {
        return jsonResponse({ error: 'För många försök. Be mötesledaren skapa en ny kod.' }, 429);
      }

      const token = randomToken(32);
      const tokenHash = await sha256Hex(token);
      const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

      const { error: updateError } = await adminClient
        .from('vihem_meeting_screen_sessions')
        .update({
          status: 'active',
          pairing_code_redeemed_at: new Date().toISOString(),
          session_token_hash: tokenHash,
          session_expires_at: sessionExpiresAt,
          last_seen_at: new Date().toISOString(),
          redeem_attempts: session.redeem_attempts + 1,
        })
        .eq('id', session.id)
        .eq('status', 'pending'); // re-check status in the WHERE to close a redeem race
      if (updateError) return jsonResponse({ error: 'Kunde inte lösa in koden.' }, 500);

      await adminClient.from('vihem_audit_events').insert({
        organisation_id: session.organisation_id,
        actor_id: null,
        event_type: 'screen_pairing_redeemed',
        entity_type: 'meeting_screen_session',
        entity_id: session.id,
        summary: `Skärm ansluten (${session.segment_key}/${session.display_role})`,
        metadata: { meeting_id: session.meeting_id },
      });

      return jsonResponse({
        session_token: token,
        meeting_id: session.meeting_id,
        segment_key: session.segment_key,
        display_role: session.display_role,
        expires_at: sessionExpiresAt,
      });
    }

    return jsonResponse({ error: 'Okänd action.' }, 400);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Okänt fel.' }, 500);
  }
});
