import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Tabs, Textarea } from '../../components/ui';
import { formatSek, monthKey, monthStartDate, previousMonth, statementCsv, type StatementData } from './billing-format';

type Customer = {
  id: string; name: string; org_number: string; billing_email: string; notes: string; vat_rate: number; ai_page_price: number;
  ai_max_pages_per_request: number; ai_monthly_page_limit: number | null; ai_enabled: boolean; active: boolean;
};
type PriceItem = {
  id: string; customer_id: string; kind: 'hosting' | 'addon'; name: string; unit: string; quantity: number; unit_price: number;
  recurring: boolean; valid_from: string; valid_to: string | null; active: boolean; sort_order: number;
};
type ClientKey = { id: string; name: string; key_hint: string; active: boolean; created_at: string; revoked_at: string | null; last_used_at: string | null };
type Row = {
  customer: Customer; clients: ClientKey[]; price_items: PriceItem[];
  month: { pages: number; interpretations: number; failed: number; estimated_cost_sek: number };
  statement: { id: string; status: 'locked' | 'invoiced'; invoice_reference: string | null } | null;
};

const functionUrl = `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/vihem-ai-interpret-document`;
const emptyPriceItem = { id: '', kind: 'hosting', name: '', unit: 'månad', quantity: '1', unit_price: '', recurring: true, valid_from: new Date().toISOString().slice(0, 10), valid_to: '' };

export function BillingAdmin({ client }: { client: SupabaseClient }) {
  const [month, setMonth] = useState(monthKey(new Date()));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState('statement');
  const [statement, setStatement] = useState<StatementData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [customerModal, setCustomerModal] = useState<Partial<Customer> | null>(null);
  const [itemModal, setItemModal] = useState<typeof emptyPriceItem | null>(null);
  const [invoiceRef, setInvoiceRef] = useState('');
  const lock = useRef(false);

  const selected = useMemo(() => rows?.find((row) => row.customer.id === selectedId) ?? null, [rows, selectedId]);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await client.rpc('vihem_vibogruppen_billing_overview', { p_month: monthStartDate(month) });
    if (rpcError) throw rpcError;
    setRows((data as { customers: Row[] }).customers);
  }, [client, month]);

  const loadStatement = useCallback(async (customerId: string) => {
    const { data, error: rpcError } = await client.rpc('vihem_vibogruppen_billing_statement', { p_customer: customerId, p_month: monthStartDate(month) });
    if (rpcError) throw rpcError;
    setStatement(data as StatementData);
  }, [client, month]);

  useEffect(() => {
    let active = true;
    load().catch(() => { if (active) setError('Kunde inte läsa faktureringen. Kontrollera behörighet och att backend är installerad.'); });
    return () => { active = false; };
  }, [load]);

  useEffect(() => {
    setStatement(null);
    if (selectedId) loadStatement(selectedId).catch(() => setError('Kunde inte läsa underlaget.'));
  }, [selectedId, loadStatement, rows]);

  async function run(action: () => Promise<void>, success?: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await load();
      if (success) setNotice(success);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Åtgärden misslyckades.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error: rpcError } = await client.rpc(name, args);
    if (rpcError) throw new Error(rpcError.message.replace(/^.*?ERROR:\s*/, ''));
    return data;
  }

  function downloadCsv() {
    if (!statement || !selected) return;
    const blob = new Blob(['﻿' + statementCsv(selected.customer.name, statement)], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `fakturaunderlag-${selected.customer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${month}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const monthIsOver = month < monthKey(new Date());

  if (!rows) return <div className="space-y-5"><PageHeader title="Fakturering och AI-tolkningar" subtitle="Underlag per kund och månad" />{error ? <p role="alert" className="text-sm text-vihem-danger">{error}</p> : <p className="text-sm text-vihem-muted">Laddar…</p>}</div>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fakturering och AI-tolkningar"
        subtitle="AI-tolkade sidor, hosting och tilläggstjänster per kund och månad"
        action={<Button onClick={() => setCustomerModal({ vat_rate: 25, ai_page_price: 5, ai_max_pages_per_request: 10, ai_enabled: true, active: true })}>Ny kund</Button>}
      />
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Månad" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <Button variant="secondary" onClick={() => setMonth(previousMonth(month))}>Föregående månad</Button>
      </div>
      {error && <p role="alert" className="text-sm text-vihem-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}

      {rows.length === 0 ? (
        <EmptyState title="Inga kunder ännu" description="Lägg till en kund, sätt prislista och skapa en API-nyckel för kundens system." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <Card key={row.customer.id} className={`p-4 ${selectedId === row.customer.id ? 'ring-2 ring-blue-500' : ''}`} onClick={() => { setSelectedId(row.customer.id); setTab('statement'); }}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{row.customer.name}</h2>
                {row.statement ? <Badge className={row.statement.status === 'invoiced' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>{row.statement.status === 'invoiced' ? 'Fakturerad' : 'Låst'}</Badge> : !row.customer.active && <Badge className="bg-slate-100 text-slate-600">Inaktiv</Badge>}
              </div>
              <p className="mt-2 text-sm text-vihem-muted">{row.month.interpretations} tolkning(ar), {row.month.pages} sidor · {formatSek(row.month.pages * row.customer.ai_page_price)} exkl. moms</p>
              {row.month.failed > 0 && <p className="text-xs text-vihem-muted">{row.month.failed} misslyckade (debiteras inte)</p>}
              <p className="text-xs text-vihem-muted">Uppskattad AI-kostnad {formatSek(row.month.estimated_cost_sek)}</p>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <section className="space-y-4 border-t border-[color:var(--vihem-line)] pt-5" aria-label={`Underlag för ${selected.customer.name}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{selected.customer.name}</h2>
            <Button variant="secondary" onClick={() => setCustomerModal(selected.customer)}>Redigera kund och priser</Button>
          </div>
          <Tabs tabs={[{ key: 'statement', label: 'Månadsunderlag' }, { key: 'prices', label: 'Hosting och tillägg' }, { key: 'keys', label: 'API-nycklar' }]} active={tab} onChange={setTab} />

          {tab === 'statement' && (
            !statement ? <p className="text-sm text-vihem-muted">Laddar underlag…</p> : (
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-left text-xs text-vihem-muted"><th className="py-2">Post</th><th className="text-right">Antal</th><th className="text-right">À-pris</th><th className="text-right">Belopp</th></tr></thead>
                    <tbody>
                      {statement.lines.map((line, index) => (
                        <tr key={index} className="border-b"><td className="py-2">{line.description}</td><td className="text-right">{line.quantity} {line.unit}</td><td className="text-right">{formatSek(line.unit_price)}</td><td className="text-right">{formatSek(line.amount)}</td></tr>
                      ))}
                      {statement.lines.length === 0 && <tr><td colSpan={4} className="py-3 text-vihem-muted">Inga poster för månaden.</td></tr>}
                    </tbody>
                    <tfoot>
                      <tr><td colSpan={3} className="pt-3 text-right">Summa exkl. moms</td><td className="pt-3 text-right font-semibold">{formatSek(statement.total_ex_vat)}</td></tr>
                      <tr><td colSpan={3} className="text-right">Moms {statement.vat_rate} %</td><td className="text-right">{formatSek(statement.vat_amount)}</td></tr>
                      <tr><td colSpan={3} className="text-right font-semibold">Att fakturera</td><td className="text-right font-semibold">{formatSek(statement.total_inc_vat)}</td></tr>
                    </tfoot>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {!statement.statement && <Button loading={busy} disabled={!monthIsOver} onClick={() => run(async () => { await rpc('vihem_vibogruppen_billing_lock', { p_customer: selected.customer.id, p_month: monthStartDate(month) }); }, 'Månaden är låst. Tolkningarna räknas inte i något annat underlag.')}>Lås månaden</Button>}
                  {!statement.statement && !monthIsOver && <span className="text-sm text-vihem-muted">Månaden kan låsas efter månadsskiftet.</span>}
                  {statement.statement?.status === 'locked' && (
                    <>
                      <Input label="Fakturanummer / referens" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
                      <Button loading={busy} disabled={!invoiceRef.trim()} onClick={() => run(async () => { await rpc('vihem_vibogruppen_billing_mark_invoiced', { p_statement: statement.statement!.id, p_reference: invoiceRef }); setInvoiceRef(''); }, 'Markerad som fakturerad.')}>Markera som fakturerad</Button>
                      <Button variant="secondary" loading={busy} onClick={() => run(async () => { await rpc('vihem_vibogruppen_billing_unlock', { p_statement: statement.statement!.id }); }, 'Underlaget är öppnat igen.')}>Öppna igen</Button>
                    </>
                  )}
                  {statement.statement?.status === 'invoiced' && <Badge className="bg-emerald-100 text-emerald-700">Fakturerad {statement.statement.invoice_reference}</Badge>}
                  <Button variant="outline" onClick={downloadCsv}>Ladda ner CSV</Button>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Debiterade tolkningar ({statement.interpretations.length})</h3>
                  <div className="overflow-x-auto"><table className="w-full text-sm">
                    <thead><tr className="border-b text-left text-xs text-vihem-muted"><th className="py-2">Tid</th><th>Användare</th><th>Fil</th><th className="text-right">Sidor</th><th className="text-right">Belopp</th></tr></thead>
                    <tbody>{statement.interpretations.map((item) => (
                      <tr key={item.id} className="border-b"><td className="py-1.5">{new Date(item.created_at).toLocaleString('sv-SE')}</td><td>{item.user_ref || '–'}</td><td className="max-w-56 truncate">{item.file_name || '–'}</td><td className="text-right">{item.pages}</td><td className="text-right">{formatSek(item.amount)}</td></tr>
                    ))}</tbody>
                  </table></div>
                </div>
              </div>
            )
          )}

          {tab === 'prices' && (
            <div className="space-y-3">
              <p className="text-sm text-vihem-muted">AI-tolkning: {formatSek(selected.customer.ai_page_price)} per sida exkl. moms ({selected.customer.vat_rate} % moms). Priset ändras under "Redigera kund och priser" och gäller nya tolkningar. Gjorda tolkningar behåller sitt pris.</p>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-vihem-muted"><th className="py-2">Post</th><th>Typ</th><th className="text-right">Antal</th><th className="text-right">À-pris</th><th>Period</th><th /></tr></thead>
                <tbody>
                  {selected.price_items.map((item) => (
                    <tr key={item.id} className="border-b">
                      <td className="py-2">{item.name}{!item.active && <span className="ml-2 text-xs text-vihem-muted">(inaktiv)</span>}</td>
                      <td>{item.kind === 'hosting' ? 'Hosting' : 'Tillägg'} · {item.recurring ? 'varje månad' : 'engång'}</td>
                      <td className="text-right">{item.quantity} {item.unit}</td><td className="text-right">{formatSek(item.unit_price)}</td>
                      <td>{item.valid_from}{item.valid_to ? ` – ${item.valid_to}` : ''}</td>
                      <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setItemModal({ ...item, quantity: String(item.quantity), unit_price: String(item.unit_price), valid_to: item.valid_to ?? '' })}>Ändra</Button></td>
                    </tr>
                  ))}
                  {selected.price_items.length === 0 && <tr><td colSpan={6} className="py-3 text-vihem-muted">Inga poster. Lägg till månadspris för hosting och eventuella tilläggstjänster.</td></tr>}
                </tbody>
              </table></div>
              <Button onClick={() => setItemModal({ ...emptyPriceItem })}>Lägg till post</Button>
            </div>
          )}

          {tab === 'keys' && (
            <div className="space-y-3">
              <p className="text-sm text-vihem-muted">Kundens system anropar <code className="break-all">{functionUrl}</code> med nyckeln i headern <code>X-Vihem-Ai-Key</code>. Nyckeln visas bara när den skapas.</p>
              {selected.clients.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm">
                  <div><strong>{c.name}</strong> <span className="font-mono text-xs">{c.key_hint}</span> {!c.active && <Badge className="bg-slate-100 text-slate-600">Återkallad</Badge>}<p className="text-xs text-vihem-muted">Skapad {new Date(c.created_at).toLocaleDateString('sv-SE')}{c.last_used_at ? ` · senast använd ${new Date(c.last_used_at).toLocaleString('sv-SE')}` : ' · aldrig använd'}</p></div>
                  {c.active && <Button size="sm" variant="danger" onClick={() => { if (window.confirm(`Återkalla nyckeln ${c.key_hint}? Kundens system slutar fungera tills en ny nyckel lagts in.`)) void run(async () => { await rpc('vihem_vibogruppen_billing_revoke_client', { p_id: c.id }); }, 'Nyckeln är återkallad.'); }}>Återkalla</Button>}
                </div>
              ))}
              <Button loading={busy} onClick={() => run(async () => { setNewKey(await rpc('vihem_vibogruppen_billing_create_client', { p_customer: selected.customer.id, p_name: `${selected.customer.name} ${new Date().toLocaleDateString('sv-SE')}` }) as string); })}>Skapa ny nyckel</Button>
            </div>
          )}
        </section>
      )}

      <Modal open={Boolean(newKey)} title="Ny API-nyckel" onClose={() => setNewKey(null)}>
        <div className="space-y-3">
          <p className="text-sm">Kopiera nyckeln nu. Den visas inte igen. Lägg in den som serverhemlighet i kundens system (t.ex. <code>VIHEM_AI_CLIENT_KEY</code>).</p>
          <code className="block break-all rounded-lg bg-slate-900 p-3 text-sm text-white">{newKey}</code>
          <div className="flex gap-2"><Button onClick={() => newKey && navigator.clipboard?.writeText(newKey)}>Kopiera</Button><Button variant="secondary" onClick={() => setNewKey(null)}>Klar</Button></div>
        </div>
      </Modal>

      <Modal open={Boolean(customerModal)} title={customerModal?.id ? 'Redigera kund' : 'Ny kund'} onClose={() => setCustomerModal(null)} size="lg">
        {customerModal && (
          <div className="space-y-3">
            <Input label="Namn" value={customerModal.name ?? ''} onChange={(e) => setCustomerModal({ ...customerModal, name: e.target.value })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Organisationsnummer" value={customerModal.org_number ?? ''} onChange={(e) => setCustomerModal({ ...customerModal, org_number: e.target.value })} />
              <Input label="Fakturamejl" type="email" value={customerModal.billing_email ?? ''} onChange={(e) => setCustomerModal({ ...customerModal, billing_email: e.target.value })} />
              <Input label="Pris per tolkad sida (kr exkl. moms)" type="number" step="0.01" min="0" value={customerModal.ai_page_price ?? 5} onChange={(e) => setCustomerModal({ ...customerModal, ai_page_price: Number(e.target.value) })} />
              <Input label="Moms (%)" type="number" step="0.01" min="0" value={customerModal.vat_rate ?? 25} onChange={(e) => setCustomerModal({ ...customerModal, vat_rate: Number(e.target.value) })} />
              <Input label="Högst sidor per dokument" type="number" min="1" max="30" value={customerModal.ai_max_pages_per_request ?? 10} onChange={(e) => setCustomerModal({ ...customerModal, ai_max_pages_per_request: Number(e.target.value) })} />
              <Input label="Månadsgräns sidor (tomt = ingen)" type="number" min="0" value={customerModal.ai_monthly_page_limit ?? ''} onChange={(e) => setCustomerModal({ ...customerModal, ai_monthly_page_limit: e.target.value === '' ? null : Number(e.target.value) })} />
            </div>
            <Textarea label="Anteckningar" rows={2} value={customerModal.notes ?? ''} onChange={(e) => setCustomerModal({ ...customerModal, notes: e.target.value })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="AI-tolkning" value={customerModal.ai_enabled === false ? 'off' : 'on'} onChange={(e) => setCustomerModal({ ...customerModal, ai_enabled: e.target.value === 'on' })} options={[{ value: 'on', label: 'Påslagen' }, { value: 'off', label: 'Avstängd' }]} />
              <Select label="Kund" value={customerModal.active === false ? 'off' : 'on'} onChange={(e) => setCustomerModal({ ...customerModal, active: e.target.value === 'on' })} options={[{ value: 'on', label: 'Aktiv' }, { value: 'off', label: 'Inaktiv' }]} />
            </div>
            <div className="flex gap-2">
              <Button loading={busy} disabled={!customerModal.name?.trim()} onClick={() => run(async () => { const id = await rpc('vihem_vibogruppen_billing_save_customer', { p: customerModal }); setCustomerModal(null); setSelectedId(id as string); }, 'Kunden är sparad.')}>Spara</Button>
              <Button variant="secondary" onClick={() => setCustomerModal(null)}>Avbryt</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(itemModal)} title={itemModal?.id ? 'Ändra post' : 'Ny post'} onClose={() => setItemModal(null)} size="lg">
        {itemModal && selected && (
          <div className="space-y-3">
            <Input label="Benämning" value={itemModal.name} onChange={(e) => setItemModal({ ...itemModal, name: e.target.value })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Typ" value={itemModal.kind} onChange={(e) => setItemModal({ ...itemModal, kind: e.target.value })} options={[{ value: 'hosting', label: 'Hosting' }, { value: 'addon', label: 'Tilläggstjänst' }]} />
              <Select label="Faktureras" value={itemModal.recurring ? 'rec' : 'once'} onChange={(e) => setItemModal({ ...itemModal, recurring: e.target.value === 'rec' })} options={[{ value: 'rec', label: 'Varje månad' }, { value: 'once', label: 'En gång (i startmånaden)' }]} />
              <Input label="Antal" type="number" step="0.01" min="0.01" value={itemModal.quantity} onChange={(e) => setItemModal({ ...itemModal, quantity: e.target.value })} />
              <Input label="Enhet" value={itemModal.unit} onChange={(e) => setItemModal({ ...itemModal, unit: e.target.value })} />
              <Input label="À-pris (kr exkl. moms)" type="number" step="0.01" min="0" value={itemModal.unit_price} onChange={(e) => setItemModal({ ...itemModal, unit_price: e.target.value })} />
              <Input label="Gäller från" type="date" value={itemModal.valid_from} onChange={(e) => setItemModal({ ...itemModal, valid_from: e.target.value })} />
              <Input label="Gäller till (valfritt)" type="date" value={itemModal.valid_to} onChange={(e) => setItemModal({ ...itemModal, valid_to: e.target.value })} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button loading={busy} disabled={!itemModal.name.trim() || itemModal.unit_price === ''} onClick={() => run(async () => { await rpc('vihem_vibogruppen_billing_save_price_item', { p: { ...itemModal, id: itemModal.id || null, customer_id: selected.customer.id, quantity: Number(itemModal.quantity), unit_price: Number(itemModal.unit_price), valid_to: itemModal.valid_to || null } }); setItemModal(null); }, 'Posten är sparad.')}>Spara</Button>
              {itemModal.id && <Button variant="danger" onClick={() => { if (window.confirm('Ta bort posten? Redan låsta underlag påverkas inte.')) void run(async () => { await rpc('vihem_vibogruppen_billing_delete_price_item', { p_id: itemModal.id }); setItemModal(null); }, 'Posten är borttagen.'); }}>Ta bort</Button>}
              <Button variant="secondary" onClick={() => setItemModal(null)}>Avbryt</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
