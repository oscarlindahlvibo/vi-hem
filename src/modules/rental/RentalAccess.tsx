import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Lock, RefreshCw, ShieldAlert } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Button, Card, Input, Modal, Select, StatusBadge, Textarea } from '../../components/ui';
import { useToast } from '../../components/toast';
import type { StatusTone } from '../../components/ui';

// Allt som rör lås, åtkomstkoder, avtalsversioner och prisprov i uthyrningsmodulen. Hemligheter (igloohome-nycklar, koder) hanteras
// uteslutande av edge-funktionen vihem-rental-admin; webbläsaren får aldrig läsa dem tillbaka.

const dt = (v?: string | null) => (v ? new Date(v).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
const money = (v: number | string, currency = 'SEK') => new Intl.NumberFormat('sv-SE', { style: 'currency', currency }).format(Number(v || 0));

export async function rentalAdmin<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('vihem-rental-admin', { body: { action, ...body } });
  if (error) {
    // Funktionen svarar med JSON-fel; supabase-js lägger svaret i error.context
    let message = error.message;
    try { const parsed = await (error as any).context?.json?.(); if (parsed?.error) message = parsed.error; } catch { /* behåll standardmeddelande */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

const CODE_STATUS: Record<string, [string, StatusTone]> = {
  scheduled: ['Schemalagd', 'info'], issuing: ['Utfärdas…', 'warning'], issued: ['Utfärdad', 'success'], sent: ['Skickad', 'success'],
  failed: ['Misslyckades (försöker igen)', 'warning'], cancelled: ['Avbruten', 'neutral'], manual: ['Kräver manuell åtgärd', 'danger'],
};
const SMS_STATUS: Record<string, [string, StatusTone]> = {
  not_sent: ['Ej skickat', 'neutral'], pending: ['Köat', 'info'], sent: ['Skickat – accepterat av operatören', 'info'],
  delivered: ['Levererat (bekräftat)', 'success'], failed: ['Misslyckades', 'danger'], unknown: ['Okänt', 'neutral'],
};

type Lock = { id: string; name: string; external_device_id: string; model: string | null; active: boolean; last_error: string | null };
type AssetLite = { id: string; name: string; product_id: string; lock_id: string | null };

/** Flik "Lås & åtkomst": integration, låsregister, koppling objekt↔lås och tidsregler. */
export function RentalAccessAdmin({ organisationId, settings, onSettingsChanged }: { organisationId: string; settings: Record<string, any>; onSettingsChanged: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<{ configured: boolean; active: boolean; mode: string | null; has_credentials: boolean; last_tested_at: string | null; last_error: string | null } | null>(null);
  const [locks, setLocks] = useState<Lock[]>([]);
  const [assets, setAssets] = useState<(AssetLite & { productName: string })[]>([]);
  const [busy, setBusy] = useState('');
  const [creds, setCreds] = useState({ client_id: '', client_secret: '', mode: 'live' });
  const [policy, setPolicy] = useState({ access_enabled: false, access_dispatch_minutes: '60', free_cancellation_minutes: '60', booking_hold_minutes: '30', access_sms_template: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setStatus(await rentalAdmin('integration_status'));
      const [l, a, p] = await Promise.all([
        supabase.from('vihem_rental_locks').select('id,name,external_device_id,model,active,last_error').eq('organisation_id', organisationId).order('name'),
        supabase.from('vihem_rental_assets').select('id,name,product_id,lock_id').eq('organisation_id', organisationId).order('name'),
        supabase.from('vihem_rental_products').select('id,name,requires_access').eq('organisation_id', organisationId),
      ]);
      setLocks((l.data as Lock[]) || []);
      const names = new Map((p.data || []).map((x: any) => [x.id, x.name]));
      setAssets(((a.data as AssetLite[]) || []).map(x => ({ ...x, productName: names.get(x.product_id) || '' })));
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunde inte läsa låsinställningar.'); }
  }, [organisationId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setPolicy({
      access_enabled: !!settings.access_enabled, access_dispatch_minutes: String(settings.access_dispatch_minutes ?? 60), free_cancellation_minutes: String(settings.free_cancellation_minutes ?? 60),
      booking_hold_minutes: String(settings.booking_hold_minutes ?? 30), access_sms_template: settings.access_sms_template ?? 'Hej {{name}}! Din kod till {{asset}} är {{pin}}. Giltig {{from}} – {{until}}. Bokning {{reference}}.',
    });
  }, [settings]);

  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Åtgärden misslyckades.'); } setBusy(''); };

  const savePolicy = () => run('policy', async () => {
    const { error: e } = await supabase.from('vihem_rental_settings').upsert({
      organisation_id: organisationId, access_enabled: policy.access_enabled,
      access_dispatch_minutes: Math.max(0, Number(policy.access_dispatch_minutes) || 0), free_cancellation_minutes: Math.max(0, Number(policy.free_cancellation_minutes) || 0),
      booking_hold_minutes: Math.min(240, Math.max(5, Number(policy.booking_hold_minutes) || 30)), access_sms_template: policy.access_sms_template, updated_at: new Date().toISOString(),
    });
    if (e) throw new Error(e.message);
    toast.show('Regler sparade', { tone: 'success' }); onSettingsChanged();
  });

  const saveIntegration = (active?: boolean) => run('save', async () => {
    await rentalAdmin('save_integration', { mode: creds.mode, client_id: creds.client_id, client_secret: creds.client_secret, ...(active === undefined ? {} : { active }) });
    setCreds({ ...creds, client_id: '', client_secret: '' });
    toast.show(active === false ? 'Integrationen är avstängd' : 'Integrationen sparad', { tone: 'success' }); await load();
  });
  const test = () => run('test', async () => { const r = await rentalAdmin('test_integration'); if (r.ok) toast.show(`Anslutningen fungerar (${r.devices.length} lås hittades)`, { tone: 'success' }); else setError(r.error); await load(); });
  const sync = () => run('sync', async () => { const r = await rentalAdmin('sync_locks'); if (r.ok) toast.show(`${r.devices.length} lås importerade`, { tone: 'success' }); else setError(r.error); await load(); });
  const linkLock = (assetId: string, lockId: string) => run('link', async () => { const { error: e } = await supabase.from('vihem_rental_assets').update({ lock_id: lockId || null }).eq('id', assetId); if (e) throw new Error(e.message); await load(); });

  const noKeys = !status?.has_credentials && status?.mode !== 'mock';
  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Card className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-5 w-5 text-blue-600" /> igloohome-integration</h2>
            <p className="text-sm text-slate-500">Koder till uthyrningsobjektens lås skapas automatiskt av servern och skickas via SMS. Nycklarna lagras krypterat och visas aldrig igen.</p></div>
          <div className="flex gap-2">{status?.active ? <StatusBadge tone="success">Aktiv</StatusBadge> : <StatusBadge tone="neutral">Av</StatusBadge>}{status?.mode === 'mock' && <StatusBadge tone="warning">Testläge – inga riktiga koder</StatusBadge>}</div>
        </div>
        {noKeys && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Inga nycklar är inlagda. Skapa en API-nyckel i igloohome Developer-portalen (Client ID + Client Secret) och klistra in dem nedan. Utan aktiv integration hanteras koder manuellt – resten av uthyrningen fungerar som vanligt.</p>}
        {status?.last_error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Senaste test misslyckades: {status.last_error}</p>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Läge" value={creds.mode} onChange={e => setCreds({ ...creds, mode: e.target.value })} options={[{ value: 'live', label: 'Skarpt (igloohome)' }, { value: 'mock', label: 'Test (påhittade koder, inget SMS)' }]} />
          <Input label="Client ID" value={creds.client_id} autoComplete="off" placeholder={status?.has_credentials ? '•••••••• (sparat)' : ''} onChange={e => setCreds({ ...creds, client_id: e.target.value })} />
          <Input label="Client Secret" type="password" autoComplete="new-password" value={creds.client_secret} placeholder={status?.has_credentials ? '•••••••• (sparat)' : ''} onChange={e => setCreds({ ...creds, client_secret: e.target.value })} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => saveIntegration()} loading={busy === 'save'}>Spara nycklar/läge</Button>
          <Button variant="secondary" onClick={test} loading={busy === 'test'} disabled={!status?.configured}>Testa anslutning</Button>
          <Button variant="secondary" onClick={sync} loading={busy === 'sync'} disabled={!status?.configured}><RefreshCw className="h-4 w-4" /> Hämta lås</Button>
          {status?.active ? <Button variant="danger" onClick={() => saveIntegration(false)}>Stäng av</Button> : <Button variant="secondary" disabled={!status?.configured} onClick={() => saveIntegration(true)}>Aktivera</Button>}
        </div>
        <p className="text-xs text-slate-500">Senast testad: {dt(status?.last_tested_at)}. Obs: igloohomes API har en 30 dagars gratis provperiod – därefter krävs betalt konto, annars svarar API:t 402 och koder hamnar i "kräver manuell åtgärd".</p>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Lock className="h-5 w-5 text-blue-600" /> Lås och objekt</h2>
        {locks.length === 0 ? <p className="text-sm text-slate-500">Inga lås importerade än. Klicka "Hämta lås" ovan efter att nycklarna är sparade.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th className="py-2">Objekt</th><th>Produkt</th><th>Lås</th></tr></thead><tbody>
            {assets.map(a => <tr key={a.id} className="border-t border-slate-100"><td className="py-2 font-medium">{a.name}</td><td className="text-slate-500">{a.productName}</td>
              <td><Select label="" value={a.lock_id || ''} onChange={e => linkLock(a.id, e.target.value)} options={[{ value: '', label: 'Inget lås (manuell hämtning)' }, ...locks.map(l => ({ value: l.id, label: `${l.name}${l.model ? ` (${l.model})` : ''}` }))]} /></td></tr>)}
          </tbody></table></div>)}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Regler för åtkomst och avbokning</h2>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.access_enabled} onChange={e => setPolicy({ ...policy, access_enabled: e.target.checked })} /> Skicka låskoder automatiskt (kräver aktiv integration och objekt kopplade till lås)</label>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Skicka kod (minuter före start)" type="number" min="0" value={policy.access_dispatch_minutes} onChange={e => setPolicy({ ...policy, access_dispatch_minutes: e.target.value })} />
          <Input label="Fri avbokning till (minuter före start)" type="number" min="0" value={policy.free_cancellation_minutes} onChange={e => setPolicy({ ...policy, free_cancellation_minutes: e.target.value })} />
          <Input label="Reservation före betalning (minuter)" type="number" min="5" max="240" value={policy.booking_hold_minutes} onChange={e => setPolicy({ ...policy, booking_hold_minutes: e.target.value })} />
        </div>
        <Textarea label="SMS-mall (platshållare: {{name}} {{asset}} {{pin}} {{from}} {{until}} {{reference}})" rows={3} value={policy.access_sms_template} onChange={e => setPolicy({ ...policy, access_sms_template: e.target.value })} />
        <p className="text-xs text-slate-500">Koden skickas aldrig tidigare än inställd tid. Bokningar som görs senare än så får koden direkt efter betalning och kunden varnas före betalning att avbokning då inte längre gäller. Koden skrivs aldrig i loggar – SMS-historiken visar den maskerad.</p>
        <div className="flex justify-end"><Button onClick={savePolicy} loading={busy === 'policy'}>Spara regler</Button></div>
      </Card>
    </div>
  );
}

/** Panel i bokningsdialogen: status för koder, händelselogg och åtgärder, samt avbokning med återbetalning. */
export function BookingAccessPanel({ bookingId, role, bookingStatus, total, onChanged }: { bookingId: string; role: string; bookingStatus: string; total: number; onChanged: () => void }) {
  const toast = useToast();
  const [codes, setCodes] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [booking, setBooking] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [reveal, setReveal] = useState<Record<string, string>>({});
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refund, setRefund] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const [c, e, b] = await Promise.all([
      supabase.from('vihem_rental_access_codes').select('id,status,scheduled_for,valid_from,valid_until,sms_status,sms_sent_at,last_error,warning,attempts,asset:vihem_rental_assets(name)').eq('booking_id', bookingId).order('created_at'),
      supabase.from('vihem_rental_access_events').select('event_type,detail,created_at').eq('booking_id', bookingId).order('created_at', { ascending: false }).limit(15),
      supabase.from('vihem_rental_bookings').select('status,payment_status,refund_status,refund_amount,short_notice,access_warning,cancellation_source,cancelled_at,hold_expires_at,total').eq('id', bookingId).maybeSingle(),
    ]);
    setCodes(c.data || []); setEvents(e.data || []); setBooking(b.data);
    setRefund(String(b.data?.total ?? total));
  }, [bookingId, total]);
  useEffect(() => { load(); }, [load]);

  const act = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(''); try { await fn(); await load(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : 'Åtgärden misslyckades.'); } setBusy(''); };
  const codeAction = (action: string, codeId: string) => act(action + codeId, async () => { const r = await rentalAdmin(action, { booking_id: bookingId, code_id: codeId }); if (action === 'reveal_pin') setReveal(prev => ({ ...prev, ...Object.fromEntries((r.codes || []).map((c: any) => [c.code_id, c.pin])) })); else toast.show(r.note || 'Klart', { tone: 'success' }); });
  const cancel = () => act('cancel', async () => {
    const r = await rentalAdmin('cancel_booking', { booking_id: bookingId, reason, refund_amount: booking?.payment_status === 'paid' ? Number(refund) || 0 : undefined });
    setCancelOpen(false);
    toast.show(r.offline_pin_warning ? 'Bokningen är avbokad – OBS: utfärdad kod kan fortfarande fungera' : r.refund_status === 'failed' ? 'Avbokad, men återbetalningen misslyckades' : 'Bokningen är avbokad', { tone: r.refund_status === 'failed' || r.offline_pin_warning ? 'error' : 'success' });
  });

  const cancelled = booking?.status === 'cancelled';
  return (
    <div className="mt-6 space-y-4 border-t border-slate-200 pt-4">
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {booking?.short_notice && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Kort varsel: kunden bekräftade före betalning att ordinarie avbokning inte gäller.</p>}
      {booking?.access_warning && <p className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800"><ShieldAlert className="h-5 w-5 shrink-0" /> {booking.access_warning}</p>}
      {booking?.refund_status && booking.refund_status !== 'none' && <p className="text-sm">Återbetalning: <StatusBadge tone={booking.refund_status === 'succeeded' ? 'success' : booking.refund_status === 'failed' ? 'danger' : 'warning'}>{({ pending: 'pågår', succeeded: `genomförd (${money(booking.refund_amount)})`, failed: 'misslyckades – hantera manuellt i Stripe', manual: 'manuell' } as Record<string, string>)[booking.refund_status]}</StatusBadge></p>}
      <h3 className="font-semibold">Åtkomstkoder</h3>
      {codes.length === 0 ? <p className="text-sm text-slate-500">Ingen kod för den här bokningen (inget lås kopplat, funktionen avstängd eller bokningen inte betald än).</p> : codes.map(c => (
        <div key={c.id} className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{c.asset?.name || 'Objekt'}</strong><div className="flex gap-2"><StatusBadge tone={(CODE_STATUS[c.status] || ['', 'neutral'])[1]}>{(CODE_STATUS[c.status] || [c.status])[0]}</StatusBadge><StatusBadge tone={(SMS_STATUS[c.sms_status] || ['', 'neutral'])[1]}>SMS: {(SMS_STATUS[c.sms_status] || [c.sms_status])[0]}</StatusBadge></div></div>
          <p className="text-slate-500">Utskick {dt(c.scheduled_for)} · giltig {dt(c.valid_from)} – {dt(c.valid_until)}{c.attempts ? ` · försök ${c.attempts}` : ''}</p>
          {c.last_error && <p className="text-red-700">Fel: {c.last_error}</p>}
          {c.warning && <p className="text-amber-800">{c.warning}</p>}
          {reveal[c.id] && <p className="rounded-lg bg-slate-900 px-3 py-2 font-mono text-lg tracking-widest text-white">{reveal[c.id]}</p>}
          {!cancelled && <div className="flex flex-wrap gap-2">
            {['scheduled', 'failed', 'manual'].includes(c.status) && <Button size="sm" variant="secondary" loading={busy === 'issue_now' + c.id} onClick={() => codeAction('issue_now', c.id)}>Utfärda nu</Button>}
            {['issued', 'sent', 'manual'].includes(c.status) && <Button size="sm" variant="secondary" loading={busy === 'resend_sms' + c.id} onClick={() => codeAction('resend_sms', c.id)}>Skicka SMS igen</Button>}
            {role === 'admin' && ['failed', 'manual', 'issued', 'sent'].includes(c.status) && <Button size="sm" variant="secondary" loading={busy === 'reissue' + c.id} onClick={() => codeAction('reissue', c.id)}>Utfärda ny kod</Button>}
            {role === 'admin' && ['issued', 'sent'].includes(c.status) && <Button size="sm" variant="ghost" loading={busy === 'reveal_pin' + c.id} onClick={() => codeAction('reveal_pin', c.id)}>Visa kod (loggas)</Button>}
          </div>}
        </div>
      ))}
      {events.length > 0 && <details className="text-sm"><summary className="cursor-pointer text-slate-600">Händelselogg ({events.length})</summary><ul className="mt-2 space-y-1 text-slate-500">{events.map((ev, i) => <li key={i}>{dt(ev.created_at)} · {ev.event_type}{ev.detail?.reason ? ` – ${ev.detail.reason}` : ''}</li>)}</ul></details>}
      {!cancelled && ['pending', 'confirmed', 'active'].includes(bookingStatus) && <div><Button variant="danger" onClick={() => setCancelOpen(true)}>Avboka bokningen…</Button></div>}
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Avboka bokning" footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setCancelOpen(false)}>Behåll</Button><Button variant="danger" loading={busy === 'cancel'} onClick={cancel}>Avboka</Button></div>}>
        <div className="space-y-4 text-sm">
          <p>Avbokningen frigör objektet och stoppar kommande kodutskick direkt (serverstyrt). {codes.some(c => ['issuing', 'issued', 'sent'].includes(c.status)) && <strong className="text-red-700">En kod har redan utfärdats. Offline-koder kan inte återkallas på distans och kan fortfarande fungera tills de löper ut – byt/blockera koden i låsets app om det behövs.</strong>}</p>
          {booking?.payment_status === 'paid' && <Input label={`Belopp att återbetala via Stripe (max ${money(booking.total - (booking.refund_amount || 0))})`} type="number" min="0" value={refund} onChange={e => setRefund(e.target.value)} />}
          <Textarea label="Orsak (visas internt)" rows={2} value={reason} onChange={e => setReason(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}

/** Flik "Avtal": versioner av hyresavtalet. Publicerade versioner kan inte ändras; bokningar behåller texten kunden godkände. */
export function RentalContractsAdmin({ organisationId }: { organisationId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [draftBody, setDraftBody] = useState('');
  const [viewing, setViewing] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    const { data } = await supabase.from('vihem_rental_contract_versions').select('id,version,title,body,status,published_at,created_at').eq('organisation_id', organisationId).order('version', { ascending: false });
    setRows(data || []); const draft = (data || []).find((r: any) => r.status === 'draft'); setDraftBody(draft?.body || '');
  }, [organisationId]);
  useEffect(() => { load(); }, [load]);
  const draft = rows.find(r => r.status === 'draft'), active = rows.find(r => r.status === 'active');
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(''); try { await fn(); await load(); } catch (e: any) { setError(String(e?.message || e).replace(/^\[E_[A-Z_]+\]\s*/, '')); } setBusy(''); };
  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Aktivt hyresavtal {active && <span className="text-slate-500">(version {active.version}, publicerad {dt(active.published_at)})</span>}</h2>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{active?.body || 'Inget aktivt avtal.'}</pre>
        <p className="text-xs text-slate-500">Kunder kan inte lägga till egen avtalstext. Varje bokning sparar exakt den version och text kunden godkände, tillsammans med signaturen.</p>
        {!draft && <Button variant="secondary" loading={busy === 'new'} onClick={() => run('new', async () => { const { error: e } = await supabase.rpc('vihem_rental_new_contract_draft'); if (e) throw e; })}>Skapa nytt utkast från aktivt avtal</Button>}
      </Card>
      {draft && (
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">Utkast – version {draft.version}</h2>
          <Textarea label="Avtalstext" rows={14} value={draftBody} onChange={e => setDraftBody(e.target.value)} />
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="danger" loading={busy === 'del'} onClick={() => run('del', async () => { const { error: e } = await supabase.from('vihem_rental_contract_versions').delete().eq('id', draft.id).eq('status', 'draft'); if (e) throw e; })}>Radera utkast</Button>
            <div className="flex gap-2">
              <Button variant="secondary" loading={busy === 'save'} onClick={() => run('save', async () => { const { error: e } = await supabase.from('vihem_rental_contract_versions').update({ body: draftBody }).eq('id', draft.id); if (e) throw e; toast.show('Utkast sparat', { tone: 'success' }); })}>Spara utkast</Button>
              <Button loading={busy === 'pub'} onClick={() => run('pub', async () => { const { error: u } = await supabase.from('vihem_rental_contract_versions').update({ body: draftBody }).eq('id', draft.id); if (u) throw u; const { error: e } = await supabase.rpc('vihem_rental_publish_contract', { p_id: draft.id }); if (e) throw e; toast.show('Avtalet är publicerat och gäller för nya bokningar', { tone: 'success' }); })}>Publicera</Button>
            </div>
          </div>
        </Card>
      )}
      <Card className="p-5"><h2 className="mb-3 font-semibold">Tidigare versioner</h2>
        <ul className="divide-y divide-slate-100 text-sm">{rows.map(r => <li key={r.id} className="flex items-center justify-between py-2"><span>Version {r.version} · {r.status === 'active' ? 'aktiv' : r.status === 'draft' ? 'utkast' : 'ersatt'} · {dt(r.published_at || r.created_at)}</span><Button size="sm" variant="ghost" onClick={() => setViewing(r)}>Visa</Button></li>)}</ul>
      </Card>
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `Version ${viewing.version}` : ''} size="lg"><pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-sm">{viewing?.body}</pre></Modal>
    </div>
  );
}

/** Prisprov för personal: visar exakt vad kunden skulle få betala (samma motor som onlinebokningen). */
export function PricePreview({ productId }: { productId: string }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [qty, setQty] = useState('1');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const run = async () => {
    setError(''); setResult(null);
    if (!start || !end) return setError('Välj start och slut.');
    const { data, error: e } = await supabase.rpc('vihem_rental_quote', { target_product_id: productId, target_start_at: new Date(start).toISOString(), target_end_at: new Date(end).toISOString(), target_quantity: Math.max(1, Number(qty) || 1) });
    if (e) setError(e.message.replace(/^\[E_[A-Z_]+\]\s*/, '')); else setResult(data);
  };
  const label: Record<string, string> = { hourly: 'timme', daily: 'dygn', weekly: 'vecka', weekend: 'helgpaket', fixed_period: 'paket', custom: 'paket' };
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold">Prisprov</h3>
      <div className="grid gap-3 sm:grid-cols-3"><Input label="Start" type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /><Input label="Slut" type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /><Input label="Antal" type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} /></div>
      <Button size="sm" variant="secondary" onClick={run}>Räkna ut</Button>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {result && <div className="text-sm"><ul className="text-slate-500">{(result.rules || []).map((r: any, i: number) => <li key={i}>{r.count} × {label[r.rule_type] || r.rule_type} à {money(r.unit_price)} = {money(r.line_total * (result.quantity || 1))}</li>)}</ul><p className="mt-1 font-semibold">Totalt {money(result.total)} inkl. moms ({money(result.subtotal)} + {money(result.vat_amount)})</p></div>}
    </div>
  );
}
