import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ICalEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}

function unfoldICal(text: string) {
  return text.replace(/\r?\n[ \t]/g, '');
}

function readValue(line: string) {
  const index = line.indexOf(':');
  return index >= 0 ? line.slice(index + 1).replace(/\\n/g, '\n').replace(/\\,/g, ',').trim() : '';
}

function parseICalDate(line: string) {
  const value = readValue(line);
  const allDay = /VALUE=DATE/.test(line) || /^\d{8}$/.test(value);
  if (/^\d{8}$/.test(value)) {
    const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    return { value: new Date(`${date}T00:00:00`).toISOString(), allDay: true };
  }

  const normalized = value.endsWith('Z')
    ? value.replace(/Z$/, '+00:00')
    : value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return { value: parsed.toISOString(), allDay };
}

function parseICal(text: string): ICalEvent[] {
  const lines = unfoldICal(text).split(/\r?\n/);
  const events: ICalEvent[] = [];
  let current: Partial<ICalEvent> | null = null;
  let allDay = false;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      allDay = false;
    }
    if (!current) continue;

    if (line.startsWith('UID')) current.uid = readValue(line);
    if (line.startsWith('SUMMARY')) current.summary = readValue(line);
    if (line.startsWith('DESCRIPTION')) current.description = readValue(line);
    if (line.startsWith('LOCATION')) current.location = readValue(line);
    if (line.startsWith('DTSTART')) {
      const parsed = parseICalDate(line);
      if (parsed) {
        current.startsAt = parsed.value;
        allDay = parsed.allDay;
      }
    }
    if (line.startsWith('DTEND')) {
      const parsed = parseICalDate(line);
      if (parsed) current.endsAt = parsed.value;
    }

    if (line === 'END:VEVENT') {
      if (current.uid && current.startsAt) {
        const fallbackEnd = new Date(current.startsAt);
        fallbackEnd.setHours(fallbackEnd.getHours() + 1);
        events.push({
          uid: current.uid,
          summary: current.summary || 'Kalenderhändelse',
          description: current.description || '',
          location: current.location || '',
          startsAt: current.startsAt,
          endsAt: current.endsAt || fallbackEnd.toISOString(),
          allDay,
        });
      }
      current = null;
    }
  }

  return events;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: auth } = await userClient.auth.getUser();
    if (!auth.user) throw new Error('Inte inloggad.');

    const { data: profile, error: profileError } = await serviceClient
      .from('vihem_profiles')
      .select('id, role, organisation_id')
      .eq('id', auth.user.id)
      .single();
    if (profileError || !profile) throw new Error('Kunde inte verifiera användaren.');
    if (profile.role !== 'admin' && profile.role !== 'superadmin') throw new Error('Saknar behörighet.');
    if (!profile.organisation_id) throw new Error('Användaren saknar organisation.');

    const body = await req.json().catch(() => ({}));
    const sourceId = body.source_id as string | undefined;

    let query = serviceClient
      .from('vihem_calendar_sources')
      .select('*')
      .eq('organisation_id', profile.organisation_id)
      .eq('active', true);
    if (sourceId) query = query.eq('id', sourceId);

    const { data: sources, error: sourceError } = await query;
    if (sourceError) throw sourceError;

    const results = [];
    for (const source of sources || []) {
      try {
        const response = await fetch(source.ical_url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const events = parseICal(await response.text());
        const rows = events.map((event) => ({
          organisation_id: source.organisation_id,
          title: event.summary,
          description: event.description,
          location: event.location,
          starts_at: event.startsAt,
          ends_at: event.endsAt,
          all_day: event.allDay,
          visibility: 'selected_users',
          participant_ids: [source.user_id],
          category: source.category,
          color: source.color,
          source_type: 'ical',
          calendar_source_id: source.id,
          external_uid: event.uid,
          created_by: source.created_by,
          updated_by: profile.id,
          updated_at: new Date().toISOString(),
        }));

        if (rows.length > 0) {
          const { error: upsertError } = await serviceClient
            .from('vihem_calendar_events')
            .upsert(rows, { onConflict: 'calendar_source_id,external_uid' });
          if (upsertError) throw upsertError;
        }

        await serviceClient
          .from('vihem_calendar_sources')
          .update({ last_synced_at: new Date().toISOString(), sync_error: null, updated_by: profile.id })
          .eq('id', source.id);
        results.push({ source_id: source.id, imported: rows.length });
      } catch (error: any) {
        await serviceClient
          .from('vihem_calendar_sources')
          .update({ sync_error: error.message || 'Kunde inte synka kalendern.', updated_by: profile.id })
          .eq('id', source.id);
        results.push({ source_id: source.id, error: error.message });
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Synk misslyckades.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
