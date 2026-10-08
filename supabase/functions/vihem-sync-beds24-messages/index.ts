import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { authenticate, isAuthContext, json, errorJson, corsHeaders } from '../_shared/vihem-auth.ts';
import { fetchRoomMessages, normalizeGuestMessage } from '../_shared/beds24-messages.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return errorJson('METHOD_NOT_ALLOWED', 'Endast POST stöds.', 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let organisationId: string | null = null;
  if (req.headers.get('Authorization')) {
    const auth = await authenticate(req);
    if (!isAuthContext(auth)) return auth;
    if (!['admin', 'superadmin', 'staff'].includes(auth.callerProfile.role)) return errorJson('FORBIDDEN', 'Saknar behörighet.', 403);
    organisationId = auth.callerProfile.organisation_id;
    if (!organisationId) return errorJson('FORBIDDEN', 'Saknar organisation.', 403);
    const { data: enabled, error: enabledError } = await auth.userClient.rpc('is_short_stay_enabled', { org_id: organisationId });
    if (enabledError || !enabled) return errorJson('FORBIDDEN', 'Korttidsuthyrning är inte aktiverat.', 403);
  } else {
    const { data } = await db.from('vihem_system_settings').select('value').eq('key', 'beds24_scheduled_sync').maybeSingle();
    const supplied = req.headers.get('x-vihem-sync-secret');
    if (!supplied || !data?.value?.secret || supplied !== data.value.secret) return errorJson('UNAUTHORIZED', 'Saknar behörighet.', 401);
  }
  try {
    let query = db.from('vihem_beds24_connections').select('*').eq('enabled', true).neq('refresh_token', '');
    if (organisationId) query = query.eq('organisation_id', organisationId);
    const { data: connections, error } = await query;
    if (error) throw error;
    if (organisationId && !connections?.length) return errorJson('NOT_CONNECTED', 'Beds24 är inte anslutet.', 400);
    const results = [];
    for (const connection of connections || []) {
      let imported = 0;
      try {
        const { data: enabled, error: enabledError } = await db.rpc('is_short_stay_enabled', { org_id: connection.organisation_id });
        if (enabledError) throw enabledError;
        if (!enabled) continue;
        const token = await accessToken(db, connection);
        const { data: units, error: unitsError } = await db.from('vihem_short_stay_units')
          .select('id, beds24_room_id, beds24_property_id').eq('organisation_id', connection.organisation_id).eq('beds24_enabled', true);
        if (unitsError) throw unitsError;
        for (const unit of units || []) {
          if (!/^\d+$/.test(unit.beds24_room_id || '')) continue;
          await fetchRoomMessages(token, unit, async messages => {
            const mapped = messages.map(message => normalizeGuestMessage(message, unit, connection.organisation_id)).filter(Boolean);
            const rows = [...new Map(mapped.map(row => [row!.beds24_message_id, row])).values()];
            for (let i = 0; i < rows.length; i += 50) {
              const { error: saveError } = await db.from('vihem_short_stay_messages').upsert(rows.slice(i, i + 50), { onConflict: 'organisation_id,beds24_message_id' });
              if (saveError) throw saveError;
            }
            imported += rows.length;
          });
        }
        await writeLog(db, connection, 'success', `Gästmeddelanden synkade (${imported} meddelanden).`, imported);
        results.push({ ok: true, imported });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Kunde inte synka gästmeddelanden.';
        await writeLog(db, connection, 'error', message, imported);
        results.push({ ok: false, imported, error: message });
      }
    }
    const ok = results.every(result => result.ok);
    return json({ ok, results, imported: results.reduce((sum, result) => sum + result.imported, 0), error: results.find(result => !result.ok)?.error }, ok ? 200 : 502);
  } catch {
    return errorJson('SYNC_FAILED', 'Kunde inte synka gästmeddelanden.', 500);
  }
});

async function accessToken(db: any, connection: any) {
  if (connection.access_token && Date.parse(connection.access_token_expires_at || '') > Date.now() + 300000) return connection.access_token;
  const response = await fetch('https://api.beds24.com/v2/authentication/token', { headers: { accept: 'application/json', refreshToken: connection.refresh_token }, signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok || !data.token) throw new Error('Kunde inte förnya Beds24-anslutningen.');
  const { error } = await db.from('vihem_beds24_connections').update({ access_token: data.token, access_token_expires_at: new Date(Date.now() + Math.max(Number(data.expiresIn || 86400) - 300, 60) * 1000).toISOString() }).eq('id', connection.id);
  if (error) throw error;
  return data.token;
}

async function writeLog(db: any, connection: any, status: string, message: string, count: number) {
  const { error } = await db.from('vihem_beds24_sync_logs').insert({ organisation_id: connection.organisation_id, connection_id: connection.id, event_type: 'message_sync', status, message, imported_count: count });
  if (error) throw error;
}
