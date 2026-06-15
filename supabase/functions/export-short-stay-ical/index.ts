import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'text/calendar; charset=utf-8',
};

function escapeICal(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function compactDate(date: string) {
  return date.replace(/-/g, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || '';

    if (!token) throw new Error('Saknar kalender-token.');

    const { data: unit, error: unitError } = await supabase
      .from('short_stay_units')
      .select('id, name, ical_token')
      .eq('ical_token', token)
      .eq('is_active', true)
      .single();
    if (unitError || !unit) throw new Error('Kalendern hittades inte.');

    const { data: bookings, error: bookingError } = await supabase
      .from('short_stay_bookings')
      .select('*')
      .eq('unit_id', unit.id)
      .gte('end_date', new Date().toISOString().slice(0, 10))
      .order('start_date');
    if (bookingError) throw bookingError;

    const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const body = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//VI-HEM//Korttidsuthyrning//SV',
      `X-WR-CALNAME:${escapeICal(unit.name || 'VI-HEM')}`,
      ...(bookings || []).map((booking: any) => [
        'BEGIN:VEVENT',
        `UID:vihem-${booking.id}@vi-hem.se`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${compactDate(booking.start_date)}`,
        `DTEND;VALUE=DATE:${compactDate(booking.end_date)}`,
        `SUMMARY:${escapeICal(booking.booking_type === 'block' ? 'Spärrad' : 'Bokad')}`,
        `DESCRIPTION:${escapeICal(booking.guest_name || booking.notes || booking.title || '')}`,
        'END:VEVENT',
      ].join('\r\n')),
      'END:VCALENDAR',
    ].join('\r\n');

    return new Response(body, { headers: corsHeaders });
  } catch (error: any) {
    return new Response(`Fel: ${error.message || 'Kunde inte exportera kalender.'}`, {
      status: 404,
      headers: corsHeaders,
    });
  }
});
