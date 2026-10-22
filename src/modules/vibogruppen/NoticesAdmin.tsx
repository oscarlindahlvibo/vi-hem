import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import {
  isoToLocalInput, kindLabels, localInputToIso, noticeStatus, severityLabels, surfaceLabels, validateNoticeForm,
  type NoticeKind, type NoticeSeverity, type NoticeStatus, type NoticeSurface,
} from './notice-format';

type Notice = {
  id: string; title: string; body: string; severity: NoticeSeverity; kind: NoticeKind; show_from: string; show_until: string;
  event_starts_at: string | null; event_ends_at: string | null; all_customers: boolean; customer_ids: string[]; customer_names: string[]; surfaces: NoticeSurface[]; active: boolean;
};
type CustomerOption = { id: string; name: string };
type Form = {
  id: string; title: string; body: string; severity: NoticeSeverity; kind: NoticeKind; show_from: string; show_until: string;
  event_starts_at: string; event_ends_at: string; customerMode: 'all' | 'some' | 'none'; customer_ids: string[]; surfaces: string[]; active: boolean;
};

const statusBadge: Record<NoticeStatus, { label: string; className: string }> = {
  live: { label: 'Visas nu', className: 'bg-emerald-100 text-emerald-700' },
  planned: { label: 'Planerad', className: 'bg-blue-100 text-blue-700' },
  ended: { label: 'Avslutad', className: 'bg-slate-100 text-slate-600' },
  off: { label: 'Avstängd', className: 'bg-slate-100 text-slate-600' },
};
const severityBadge: Record<NoticeSeverity, string> = { info: 'bg-sky-100 text-sky-700', warning: 'bg-amber-100 text-amber-800', critical: 'bg-red-100 text-red-700' };

function emptyForm(): Form {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 3 * 24 * 3600 * 1000);
  return {
    id: '', title: '', body: '', severity: 'warning', kind: 'maintenance', show_from: isoToLocalInput(start.toISOString()), show_until: isoToLocalInput(end.toISOString()),
    event_starts_at: '', event_ends_at: '', customerMode: 'all', customer_ids: [], surfaces: [], active: true,
  };
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '');

export function NoticesAdmin({ client }: { client: SupabaseClient }) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lock = useRef(false);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await client.rpc('vihem_vibogruppen_notices_list');
    if (rpcError) throw rpcError;
    setNotices(data as Notice[]);
    const overview = await client.rpc('vihem_vibogruppen_billing_overview', { p_month: new Date().toISOString().slice(0, 8) + '01' });
    if (!overview.error) setCustomers((overview.data as { customers: { customer: CustomerOption }[] }).customers.map((row) => ({ id: row.customer.id, name: row.customer.name })));
  }, [client]);

  useEffect(() => {
    let active = true;
    load().catch(() => { if (active) setError('Kunde inte läsa meddelandena. Kontrollera behörighet och att backend är installerad.'); });
    return () => { active = false; };
  }, [load]);

  async function run(action: () => Promise<void>, success: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await load();
      setMessage(success);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Åtgärden misslyckades.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function rpc(name: string, args: Record<string, unknown>) {
    const { error: rpcError } = await client.rpc(name, args);
    if (rpcError) throw new Error(rpcError.message.replace(/^.*?ERROR:\s*/, ''));
  }

  function edit(notice: Notice) {
    setForm({
      id: notice.id, title: notice.title, body: notice.body, severity: notice.severity, kind: notice.kind,
      show_from: isoToLocalInput(notice.show_from), show_until: isoToLocalInput(notice.show_until),
      event_starts_at: isoToLocalInput(notice.event_starts_at), event_ends_at: isoToLocalInput(notice.event_ends_at),
      customerMode: notice.all_customers ? 'all' : notice.customer_ids.length > 0 ? 'some' : 'none', customer_ids: notice.customer_ids, surfaces: notice.surfaces ?? [], active: notice.active,
    });
  }

  async function save() {
    if (!form) return;
    const allCustomers = form.customerMode === 'all';
    const customerIds = form.customerMode === 'some' ? form.customer_ids : [];
    const problem = validateNoticeForm({ ...form, all_customers: allCustomers, customer_ids: customerIds });
    if (problem) { setError(problem); return; }
    const payload = {
      ...(form.id ? { id: form.id } : {}), title: form.title.trim(), body: form.body, severity: form.severity, kind: form.kind,
      show_from: localInputToIso(form.show_from), show_until: localInputToIso(form.show_until),
      event_starts_at: localInputToIso(form.event_starts_at) ?? '', event_ends_at: localInputToIso(form.event_ends_at) ?? '',
      all_customers: allCustomers, customer_ids: customerIds, surfaces: form.surfaces, active: form.active,
    };
    await run(async () => { await rpc('vihem_vibogruppen_notice_save', { p: payload }); setForm(null); }, 'Meddelandet är sparat.');
  }

  if (!notices) return <div className="space-y-5"><PageHeader title="Driftmeddelanden" subtitle="Banners i anslutna system" />{error ? <p role="alert" className="text-sm text-vihem-danger">{error}</p> : <p className="text-sm text-vihem-muted">Laddar…</p>}</div>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Driftmeddelanden"
        subtitle="Planerade uppdateringar och serverunderhåll som visas som banner i anslutna system (t.ex. JK) under den tid du anger"
        action={<Button onClick={() => { setError(''); setForm(emptyForm()); }}>Nytt meddelande</Button>}
      />
      {error && !form && <p role="alert" className="text-sm text-vihem-danger">{error}</p>}
      {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
      {notices.length === 0 ? (
        <EmptyState title="Inga meddelanden" description="Skapa ett meddelande för att varna användarna om en kommande uppdatering eller ett serverunderhåll." />
      ) : (
        <div className="space-y-3">
          {notices.map((notice) => {
            const status = statusBadge[noticeStatus(notice)];
            return (
              <Card key={notice.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{notice.title}</h2>
                    <Badge className={severityBadge[notice.severity]}>{severityLabels[notice.severity]}</Badge>
                    <Badge className="bg-slate-100 text-slate-700">{kindLabels[notice.kind]}</Badge>
                    <Badge className={status.className}>{status.label}</Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" disabled={busy} onClick={() => edit(notice)}>Ändra</Button>
                    <Button variant="secondary" disabled={busy} onClick={() => { if (window.confirm(`Ta bort "${notice.title}"?`)) void run(() => rpc('vihem_vibogruppen_notice_delete', { p_id: notice.id }), 'Meddelandet är borttaget.'); }}>Ta bort</Button>
                  </div>
                </div>
                {notice.body && <p className="whitespace-pre-line text-sm">{notice.body}</p>}
                <p className="text-xs text-vihem-muted">
                  Visas {fmt(notice.show_from)} – {fmt(notice.show_until)}
                  {notice.event_starts_at && ` · Underhåll ${fmt(notice.event_starts_at)}${notice.event_ends_at ? ` – ${fmt(notice.event_ends_at)}` : ''}`}
                  {' · '}Gäller {[notice.all_customers ? 'alla kundsystem' : notice.customer_names.join(', '), ...(notice.surfaces ?? []).map((s) => surfaceLabels[s] ?? s)].filter(Boolean).join(', ')}
                </p>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={Boolean(form)} title={form?.id ? 'Ändra meddelande' : 'Nytt meddelande'} onClose={() => setForm(null)} size="lg">
        {form && (
          <div className="space-y-3">
            <Input label="Rubrik" value={form.title} maxLength={160} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Textarea label="Meddelande (valfritt)" rows={3} maxLength={2000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Typ" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as NoticeKind })} options={(Object.keys(kindLabels) as NoticeKind[]).map((value) => ({ value, label: kindLabels[value] }))} />
              <Select label="Allvarlighet" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as NoticeSeverity })} options={(Object.keys(severityLabels) as NoticeSeverity[]).map((value) => ({ value, label: severityLabels[value] }))} />
              <Input label="Visa från" type="datetime-local" value={form.show_from} onChange={(e) => setForm({ ...form, show_from: e.target.value })} />
              <Input label="Visa till" type="datetime-local" value={form.show_until} onChange={(e) => setForm({ ...form, show_until: e.target.value })} />
              <Input label="Underhåll startar (valfritt)" type="datetime-local" value={form.event_starts_at} onChange={(e) => setForm({ ...form, event_starts_at: e.target.value })} />
              <Input label="Underhåll slutar (valfritt)" type="datetime-local" value={form.event_ends_at} onChange={(e) => setForm({ ...form, event_ends_at: e.target.value })} />
            </div>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Egna appar och sajter</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {(Object.keys(surfaceLabels) as NoticeSurface[]).map((surface) => (
                  <label key={surface} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.surfaces.includes(surface)} onChange={(e) => setForm({ ...form, surfaces: e.target.checked ? [...form.surfaces, surface] : form.surfaces.filter((s) => s !== surface) })} />
                    {surfaceLabels[surface]}
                  </label>
                ))}
              </div>
            </fieldset>
            <Select label="Anslutna kundsystem (t.ex. JK)" value={form.customerMode} onChange={(e) => setForm({ ...form, customerMode: e.target.value as Form['customerMode'] })} options={[{ value: 'all', label: 'Alla kundsystem' }, { value: 'some', label: 'Utvalda kunder' }, { value: 'none', label: 'Inga kundsystem' }]} />
            {form.customerMode === 'some' && (
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">Kunder</legend>
                {customers.map((customer) => (
                  <label key={customer.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.customer_ids.includes(customer.id)} onChange={(e) => setForm({ ...form, customer_ids: e.target.checked ? [...form.customer_ids, customer.id] : form.customer_ids.filter((id) => id !== customer.id) })} />
                    {customer.name}
                  </label>
                ))}
              </fieldset>
            )}
            <Select label="Status" value={form.active ? 'on' : 'off'} onChange={(e) => setForm({ ...form, active: e.target.value === 'on' })} options={[{ value: 'on', label: 'Aktiv (visas under angiven tid)' }, { value: 'off', label: 'Avstängd (visas inte)' }]} />
            <p className="text-xs text-vihem-muted">Tiderna anges i din lokala tid. Meddelandet visas som banner i kundsystemet från starttiden och försvinner av sig självt vid sluttiden.</p>
            {error && <p role="alert" className="text-sm text-vihem-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setForm(null)}>Avbryt</Button>
              <Button disabled={busy} onClick={() => void save()}>Spara</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
