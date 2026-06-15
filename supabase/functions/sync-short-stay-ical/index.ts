import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ICalEvent {
  uid: string;
  summary: string;
  description: string;
  startDate: string;
  endDate: string;
}

function unfoldICal(text: string) {
  return text.replace(/\r?\n[ \t]/g, '');
}

function parseDate(value: string) {
  const clean = value.trim();
  if (/^\d{8}$/.test(clean)) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  }
  const parsed = new Date(clean.replace(/Z$/, '+00:00'));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function readValue(line: string) {
  const index = line.indexOf(':');
  return index >= 0 ? line.slice(index + 1).replace(/\\n/g, '\n').trim() : '';
}

function parseICal(text: string): ICalEvent[] {
  const lines = unfoldICal(text).split(/\r?\n/);
  const events: ICalEvent[] = [];
  let current: Partial<ICalEvent> | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') current = {};
    if (!current) continue;

    if (line.startsWith('UID')) current.uid = readValue(line);
    if (line.startsWith('SUMMARY')) current.summary = readValue(line);
    if (line.startsWith('DESCRIPTION')) current.description = readValue(line);
    if (line.startsWith('DTSTART')) {
      const date = parseDate(readValue(line));
      if (date) current.startDate = date;
    }
    if (line.startsWith('DTEND')) {
      const date = parseDate(readValue(line));
      if (date) current.endDate = date;
    }

    if (line === 'END:VEVENT') {
      if (current.uid && current.startDate && current.endDate) {
        events.push({
          uid: current.uid,
          summary: current.summary || 'Bokning',
          description: current.description || '',
          startDate: current.startDate,
          endDate: current.endDate,
        });
      }
      current = null;
    }
  }

  return events;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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
      .from('profiles')
      .select('id, role, organisation_id')
      .eq('id', auth.user.id)
      .single();
    if (profileError || !profile) throw new Error('Kunde inte verifiera användaren.');
    if (!['staff', 'admin'].includes(profile.role)) throw new Error('Saknar behörighet.');
    if (!profile.organisation_id) throw new Error('Användaren saknar organisation.');

    const body = await req.json().catch(() => ({}));
    const unitId = body.unit_id as string | undefined;

    let query = serviceClient
      .from('short_stay_units')
      .select('*')
      .eq('organisation_id', profile.organisation_id)
      .eq('is_active', true);
    if (unitId) query = query.eq('id', unitId);

    const { data: units, error: unitError } = await query;
    if (unitError) throw unitError;

    const results = [];

    for (const unit of units || []) {
      for (const channelNumber of [1, 2, 3]) {
        const url = unit[`ical_url_${channelNumber}`];
        const channelName = unit[`channel_name_${channelNumber}`] || `Kanal ${channelNumber}`;
        const errorField = `sync_error_${channelNumber}`;

        if (!url) continue;

        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const events = parseICal(await response.text());
          const rows = events.map((event) => ({
            organisation_id: unit.organisation_id,
            unit_id: unit.id,
            external_uid: `${channelNumber}:${event.uid}`,
            channel_number: channelNumber,
            channel_name: channelName,
            title: event.summary,
            description: event.description,
            start_date: event.startDate,
            end_date: event.endDate,
            is_manual: false,
            booking_type: event.summary.toLowerCase().includes('block') ? 'block' : 'booking',
            cleaning_status: 'dirty',
            updated_at: new Date().toISOString(),
          }));

          if (rows.length > 0) {
            const { error: upsertError } = await serviceClient
              .from('short_stay_bookings')
              .upsert(rows, { onConflict: 'unit_id,external_uid' });
            if (upsertError) throw upsertError;
          }

          await serviceClient
            .from('short_stay_units')
            .update({
              last_synced_at: new Date().toISOString(),
              [errorField]: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', unit.id);

          results.push({ unit_id: unit.id, channel_number: channelNumber, imported: rows.length });
        } catch (error: any) {
          await serviceClient
            .from('short_stay_units')
            .update({
              [errorField]: error.message || 'Kunde inte synka kalendern.',
              updated_at: new Date().toISOString(),
            })
            .eq('id', unit.id);
          results.push({ unit_id: unit.id, channel_number: channelNumber, error: error.message });
        }
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
