// Fredagsmöte-ombygget: vad en parkopplad skärm faktiskt får se.
//
// Detta ÄR säkerhetsgränsen för skärmvägen -- en parkopplad skärm har
// ingen Postgres/Auth-identitet alls (se vihem-meeting-screen-pair), så
// RLS kan inte skydda den här vägen. Funktionen validerar sessions-token
// (hash-jämförelse, kontrollerar status/utgång), väljer svarsschema
// UTIFRÅN SESSIONENS display_role (aldrig utifrån vad klienten begär), och
// returnerar EXAKT handplockade fält -- aldrig ett SELECT * som frontend
// förväntas filtrera. Inga privata anteckningar (note_tags innehåller
// 'private'), inga känsliga poster (sensitivity='sensitive' göms om inte
// explicit "visa ändå"-läge är på från kontrollvyn -- Fas 1 döljer dem
// alltid för enkelhetens skull), inga AI-utkast, inga andra segments data.
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
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Supabase server secrets saknas.' }, 500);
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { session_token } = await req.json();
    if (!session_token || typeof session_token !== 'string') return jsonResponse({ error: 'session_token krävs.' }, 400);
    const tokenHash = await sha256Hex(session_token);

    const { data: session } = await adminClient
      .from('vihem_meeting_screen_sessions')
      .select('*')
      .eq('session_token_hash', tokenHash)
      .eq('status', 'active')
      .maybeSingle();

    if (!session) return jsonResponse({ error: 'disconnected', reason: 'not_found_or_revoked' }, 401);
    if (session.session_expires_at && new Date(session.session_expires_at).getTime() < Date.now()) {
      await adminClient.from('vihem_meeting_screen_sessions').update({ status: 'expired' }).eq('id', session.id);
      return jsonResponse({ error: 'disconnected', reason: 'expired' }, 401);
    }

    adminClient.from('vihem_meeting_screen_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.id).then(() => undefined);

    const { data: meeting } = await adminClient
      .from('vihem_meetings')
      .select('id, title, status, starts_at, segment_key')
      .eq('id', session.meeting_id)
      .maybeSingle();
    if (!meeting) return jsonResponse({ error: 'disconnected', reason: 'meeting_missing' }, 404);

    if (session.display_role === 'staff_week_plan') {
      const { data: items } = await adminClient
        .from('vihem_meeting_week_plan_items')
        .select('id, title, responsible_user_id, participant_user_ids, planned_date, deadline, status, material_needed, blockers, highlighted, sort_order')
        .eq('meeting_id', session.meeting_id)
        .order('sort_order');

      const responsibleIds = Array.from(new Set((items || []).map((i: any) => i.responsible_user_id).filter(Boolean)));
      const { data: profiles } = responsibleIds.length
        ? await adminClient.from('vihem_profiles').select('id, name').in('id', responsibleIds)
        : { data: [] as any[] };
      const nameById = new Map((profiles || []).map((p: any) => [p.id, p.name]));

      return jsonResponse({
        display_role: 'staff_week_plan',
        meeting: { title: meeting.title, status: meeting.status },
        items: (items || []).map((i: any) => ({
          id: i.id,
          title: i.title,
          responsible_name: i.responsible_user_id ? nameById.get(i.responsible_user_id) || '' : '',
          planned_date: i.planned_date,
          deadline: i.deadline,
          status: i.status,
          material_needed: i.material_needed,
          blockers: i.blockers,
          highlighted: i.highlighted,
        })),
      });
    }

    // display_role === 'meeting_main' -- hand-picked, non-sensitive,
    // non-private fields only. Notes tagged 'private' or agenda items
    // with sensitivity='sensitive' are excluded entirely, not merely
    // hidden client-side.
    const [{ data: agendaItems }, { data: decisions }, { data: actionItems }] = await Promise.all([
      adminClient
        .from('vihem_meeting_agenda_items')
        .select('id, title, sort_order, status, note_tags, sensitivity, notes, time_budget_minutes')
        .eq('meeting_id', session.meeting_id)
        .order('sort_order'),
      adminClient
        .from('vihem_meeting_decisions')
        .select('id, title, status')
        .eq('meeting_id', session.meeting_id)
        .order('created_at'),
      adminClient
        .from('vihem_meeting_action_items')
        .select('id, title, status, due_date')
        .eq('meeting_id', session.meeting_id)
        .order('created_at'),
    ]);

    const visibleAgendaItems = (agendaItems || [])
      .filter((item: any) => item.sensitivity !== 'sensitive')
      .map((item: any) => ({
        id: item.id,
        title: item.title,
        sort_order: item.sort_order,
        status: item.status,
        time_budget_minutes: item.time_budget_minutes,
        // Only the 'shared' tag ever reaches the screen -- private/sensitive
        // notes are dropped here, server-side, not filtered by the client.
        note: Array.isArray(item.note_tags) && item.note_tags.includes('shared') ? item.notes : '',
      }));

    let handoffs: any[] = [];
    const { data: handoffRows } = await adminClient.rpc('get_meeting_handoffs_for_segment', { p_meeting_id: session.meeting_id });
    handoffs = handoffRows || [];

    return jsonResponse({
      display_role: 'meeting_main',
      meeting: { title: meeting.title, status: meeting.status, segment_key: meeting.segment_key },
      agenda_items: visibleAgendaItems,
      decisions: (decisions || []).map((d: any) => ({ id: d.id, title: d.title, status: d.status })),
      action_items: (actionItems || []).map((a: any) => ({ id: a.id, title: a.title, status: a.status, due_date: a.due_date })),
      incoming_handoffs: handoffs.map((h: any) => ({ id: h.id, forwarded_text: h.forwarded_text })),
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Okänt fel.' }, 500);
  }
});
