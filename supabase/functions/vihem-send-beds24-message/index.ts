import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, isAuthContext, json, errorJson, corsHeaders } from '../_shared/vihem-auth.ts';
import { sendGuestMessage, acceptsChannelMessages } from '../_shared/beds24-send-message.ts';
import { normalizeGuestMessage } from '../_shared/beds24-messages.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return errorJson('METHOD_NOT_ALLOWED', 'Endast POST stöds.', 405);
  const auth = await authenticate(req);
  if (!isAuthContext(auth)) return auth;
  const org = auth.callerProfile.organisation_id;
  if (!org || !['admin', 'superadmin', 'staff'].includes(auth.callerProfile.role)) return errorJson('FORBIDDEN', 'Saknar behörighet.', 403);
  const db = auth.adminClient;
  const { data: enabled, error: enabledError } = await auth.userClient.rpc('is_short_stay_enabled', { org_id: org });
  if (enabledError || !enabled) return errorJson('FORBIDDEN', 'Korttidsuthyrning är inte aktiverat.', 403);
  try {
    const body = await req.json();
    const bookingId = String(body.bookingId || '');
    if (!/^\d+$/.test(bookingId) || !Number.isSafeInteger(Number(bookingId))) return errorJson('INVALID_BOOKING', 'Ogiltig bokning.', 400);
    const contextOnly = body.action === 'context';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!contextOnly && (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId || '') || !message || message.length > 5000)) return errorJson('INVALID_MESSAGE', 'Skriv ett meddelande på högst 5 000 tecken.', 400);
    if (!contextOnly) {
      const { data: previous, error } = await db.from('vihem_short_stay_message_sends').select('*').eq('id', body.requestId).maybeSingle();
      if (error) throw error;
      if (previous) {
        if (previous.organisation_id !== org || previous.sender_id !== auth.callerId || previous.beds24_booking_id !== bookingId || previous.message !== message) return errorJson('CONFLICT', 'Utskicksreferensen används redan.', 409);
        return json({ status: previous.status });
      }
    }
    const { data: connection, error: connectionError } = await db.from('vihem_beds24_connections').select('*').eq('organisation_id', org).eq('enabled', true).maybeSingle();
    if (connectionError || !connection?.refresh_token) return errorJson('NOT_CONNECTED', 'Beds24 är inte anslutet.', 400);
    let token = connection.access_token;
    if (!token || Date.parse(connection.access_token_expires_at || '') <= Date.now() + 300000 || !connection.access_token_expires_at) {
      const res = await fetch('https://api.beds24.com/v2/authentication/token', { headers: { refreshToken: connection.refresh_token }, signal: AbortSignal.timeout(10000) });
      const result = await res.json();
      if (!res.ok || !result.token) throw new Error('token');
      token = result.token;
      const { error } = await db.from('vihem_beds24_connections').update({ access_token: token, access_token_expires_at: new Date(Date.now() + Math.max(Number(result.expiresIn || 86400) - 300, 60) * 1000).toISOString() }).eq('id', connection.id);
      if (error) throw error;
    }
    const res = await fetch(`https://api.beds24.com/v2/bookings?id=${bookingId}`, { headers: { token, accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return errorJson('BOOKING_UNAVAILABLE', 'Kunde inte kontrollera bokningen i Beds24.', 502);
    const result = await res.json();
    const booking = result.data?.find((row: any) => String(row.id) === bookingId);
    if (!booking) return errorJson('NOT_FOUND', 'Bokningen kunde inte hittas.', 404);
    const { data: units, error: unitError } = await db.from('vihem_short_stay_units').select('id,beds24_room_id,beds24_property_id').eq('organisation_id', org).eq('beds24_enabled', true).eq('beds24_room_id', String(booking.roomId));
    const unit = units?.find((row: any) => row.beds24_property_id && String(row.beds24_property_id) === String(booking.propertyId));
    if (unitError || !unit) return errorJson('FORBIDDEN', 'Bokningen hör inte till organisationens anslutna rum.', 403);
    const canSend = acceptsChannelMessages(booking);
    if (contextOnly) return json({ canSend, channel: booking.channel, reason: canSend ? null : 'Den här bokningskanalen stöder inte meddelanden från VI-HEM. Använd Beds24 för bokningen.' });
    if (!canSend) return errorJson('UNSUPPORTED_CHANNEL', 'Bokningskanalen stöder inte den här skickafunktionen.', 400);
    const { error: claimError } = await db.from('vihem_short_stay_message_sends').insert({ id: body.requestId, organisation_id: org, unit_id: unit.id, beds24_booking_id: bookingId, sender_id: auth.callerId, message });
    if (claimError?.code === '23505') return json({ status: 'pending' });
    if (claimError) throw claimError;
    const status = await sendGuestMessage(token, bookingId, message);
    const { error: saveError } = await db.from('vihem_short_stay_message_sends').update({ status, updated_at: new Date().toISOString() }).eq('id', body.requestId).eq('organisation_id', org);
    if (saveError) return json({ status: 'pending' });
    // Sending succeeded independently of the read mirror. Never repeat the POST if this refresh fails.
    if (status === 'sent') {
      try {
        const mirror = await fetch(`https://api.beds24.com/v2/bookings/messages?bookingId=${bookingId}`, { headers: { token }, signal: AbortSignal.timeout(10000) });
        const messages = mirror.ok ? await mirror.json() : {};
        const mapped = (messages.data || []).filter((row: any) => String(row.bookingId) === bookingId).map((row: any) => normalizeGuestMessage(row, unit, org)).filter(Boolean);
        if (mapped.length) await db.from('vihem_short_stay_messages').upsert(mapped, { onConflict: 'organisation_id,beds24_message_id' });
      } catch { /* Scheduled synchronization will refresh the conversation. */ }
    }
    return json({ status });
  } catch { return errorJson('SEND_FAILED', 'Kunde inte kontrollera utskicket. Försök igen med samma meddelande för att kontrollera status.', 500); }
});
