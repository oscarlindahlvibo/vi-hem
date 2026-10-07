import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Building2, Users, SlidersHorizontal, CalendarClock, RefreshCw, Plus, FileText, ArrowLeft } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatDate, saveOrShareFile } from '../../lib/utils';
import { createOrGetRentBillingRun, createRentBillingInvoices, updateBillingAdjustmentStatus } from '../finance-v2/api';
import { loadRentCompanies, loadRentOverview, saveRentChange, cancelRentChange, getRentInvoicePdf, loadInvoiceCustomers } from './api';
import { rentMoney as formatCurrency } from './money';
import { buildRentCustomers } from './customers';
import type { FinanceCompany } from '../../types';
import type { RentOverview, RentTab, RentChange } from './types';

const TABS = [{ key: 'customers', page: 'rent-customers', label: 'Kunder & fakturor', icon: Users }, { key: 'adjustments', page: 'rent-adjustments', label: 'Avdrag & tillägg', icon: SlidersHorizontal }, { key: 'billing', page: 'rent-billing', label: 'Nästa hyreskörning', icon: CalendarClock }] as const;
const statusText: Record<string, string> = { draft: 'Utkast', active: 'Aktiv', applied: 'Använd', completed: 'Avslutad', paused: 'Pausad', cancelled: 'Avslutad', invoiced: 'Fakturerad', unprepared: 'Ej förberedd', skipped: 'Överhoppad', paid: 'Betald', sent: 'Skickad', overdue: 'Förfallen', partially_paid: 'Delvis betald', credited: 'Krediterad', approved: 'Godkänd', unpaid: 'Obetald', terminated: 'Uppsagd', ended: 'Avslutad' };
const invoiceMoney = (amount: number, currency: string) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency }).format(amount);
const errorText = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Kunde inte utföra åtgärden.';
function nextRentMonth(now = new Date()) { return `${new Date(now.getFullYear(), now.getMonth() + 1, 1).getFullYear()}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 1).getMonth() + 1).padStart(2, '0')}`; }
const Stat = ({ label, value }: { label: string; value: string | number }) => <Card className="p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 break-words text-xl font-bold text-slate-950">{value}</p></Card>;

export function RentModulePage({ initialTab = 'billing', onNavigate }: { initialTab?: RentTab; onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<FinanceCompany[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [month, setMonth] = useState(nextRentMonth);
  const [tab, setTab] = useState<RentTab>(initialTab);
  const [data, setData] = useState<RentOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [customerKey, setCustomerKey] = useState('');
  const [invoiceCustomerIds, setInvoiceCustomerIds] = useState<Record<string, string>>({});
  const [invoiceWarning, setInvoiceWarning] = useState('');
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [openInvoiceId, setOpenInvoiceId] = useState('');
  const [changeModal, setChangeModal] = useState(false);
  const [endChange, setEndChange] = useState<{ change: RentChange; origin: 'rent' | 'billing' } | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [companyChecked, setCompanyChecked] = useState(false);
  const [combine, setCombine] = useState(false);
  const [tenancyId, setTenancyId] = useState('');
  const [kind, setKind] = useState<'one_time' | 'recurring'>('one_time');
  const [direction, setDirection] = useState('deduction');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [startMonth, setStartMonth] = useState(month);
  const [endMonth, setEndMonth] = useState('');
  const request = useRef(0);
  const permissionRequest = useRef(0);
  const [canWrite, setCanWrite] = useState(false);
  useEffect(() => { setTab(initialTab); setSearch(''); }, [initialTab]);
  useEffect(() => {
    let cancelled = false;
    if (!user?.organisation_id) return;
    loadRentCompanies(user.organisation_id).then(rows => {
      if (cancelled) return;
      setCompanies(rows);
      // Prefer the organisation's own company; do not default to a different
      // subsidiary alphabetically when opening the rent module.
      setCompanyId(rows.find(c => c.name === 'Vibogruppen AB')?.id || rows[0]?.id || '');
      if (!rows.length) setLoading(false);
    }).catch(err => { if (!cancelled) { setError(errorText(err)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [user?.organisation_id]);
  useEffect(() => {
    const n = ++permissionRequest.current;
    setCanWrite(false);
    if (!companyId) return;
    supabase.rpc('vihem_user_has_company_access', { target_company_id: companyId, required_role: 'seller' }).then(({ data: access, error: accessError }) => {
      if (n === permissionRequest.current) setCanWrite(!accessError && access === true);
    });
  }, [companyId]);
  const load = useCallback(async () => {
    if (!companyId || !/^\d{4}-\d{2}$/.test(month)) return;
    const n = ++request.current;
    setLoading(true); setError('');
    try {
      const overview = await loadRentOverview(companyId, `${month}-01`);
      if (n !== request.current) return;
      setData(overview); setInvoiceCustomerIds({}); setInvoiceWarning('');
    } catch (err) { if (n === request.current) { setData(null); setError(errorText(err)); } }
    finally { if (n === request.current) setLoading(false); }
  }, [companyId, month]);
  // The counter invalidates async requests, rather than referring to a DOM node.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setData(null); setCustomerKey(''); setCompanyChecked(false); setMessage(''); setCreateModal(false); setChangeModal(false); setEndChange(null); void load(); return () => { request.current++; }; }, [load]);
  const current = data?.companyId === companyId && data.period === `${month}-01` ? data : null;
  const customers = useMemo(() => current ? buildRentCustomers(current, invoiceCustomerIds) : [], [current, invoiceCustomerIds]);
  const selectedCustomer = customers.find(c => c.key === customerKey);
  const pending = current?.preview.filter(r => ['draft', 'unprepared'].includes(r.state)) || [];
  const issues = pending.filter(r => r.warnings.length);
  const total = pending.reduce((sum, r) => sum + r.total, 0);
  const run = current?.runs[0];
  const dueDate = /^\d{4}-\d{2}$/.test(month) ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 0).toLocaleDateString('sv-SE') : '';
  const tenancyLabel = (id: string) => { const t = current?.tenancies.find(t => t.id === id); return t ? `${t.tenant?.name || 'Hyresgäst'} · ${t.property?.name || ''} ${t.apartment?.apartment_number || ''}` : 'Tidigare hyresförhållande'; };
  const ready = Boolean(current && !loading && !saving);
  const knownAccountedIds = new Set(customers.flatMap(c => c.accountedInvoices.map(i => i.accounted_invoice_id)));
  const unknownInvoices = current ? [...new Map(current.accountedInvoices.filter(i => !knownAccountedIds.has(i.accounted_invoice_id)).map(i => [i.accounted_invoice_id, i])).values()] : [];
  const refreshInvoiceCustomers = async () => {
    if (!current || !current.accountedInvoices.length) return;
    const n = request.current; setInvoiceLoading(true); setInvoiceWarning('');
    try {
      const rows = await loadInvoiceCustomers(companyId, current.accountedInvoices.map(i => i.id));
      if (n === request.current) setInvoiceCustomerIds(Object.fromEntries(rows.map(r => [r.id, r.accounted_customer_id])));
    } catch (err) { if (n === request.current) setInvoiceWarning(`Kundkopplingarna kunde inte läsas: ${errorText(err)}. Fakturorna finns kvar i listan nedan.`); }
    finally { if (n === request.current) setInvoiceLoading(false); }
  };
  useEffect(() => {
    if (current?.accountedInvoices.length) void refreshInvoiceCustomers();
    // A snapshot change resets the customer map, then reloads it for that company.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const openInvoice = async (id: string, number: string, accounted: boolean) => {
    if (!ready) return;
    setOpenInvoiceId(id); setError('');
    // Open during the click to avoid Safari blocking a tab after async fetch.
    const win = !Capacitor.isNativePlatform() ? window.open('', '_blank') : null;
    if (win) win.opener = null;
    try {
      const blob = await getRentInvoicePdf(companyId, id, accounted);
      if (Capacitor.isNativePlatform()) await saveOrShareFile(blob, `faktura-${number}.pdf`);
      else { const url = URL.createObjectURL(blob); if (win) win.location.href = url; else await saveOrShareFile(blob, `faktura-${number}.pdf`); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    } catch (err) { win?.close(); setError(errorText(err)); }
    finally { setOpenInvoiceId(''); }
  };
  const handleSaveChange = async (event: React.FormEvent) => {
    event.preventDefault(); if (!ready || !canWrite || !user?.organisation_id || !tenancyId) return;
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0 || !description.trim() || !/^\d{4}-\d{2}$/.test(startMonth) || (kind === 'recurring' && endMonth && endMonth < startMonth)) { setError('Ange belopp större än noll, beskrivning och en giltig period. Slutperiod får inte vara före startperiod.'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      await saveRentChange({ organisationId: user.organisation_id, userId: user.id, companyId, tenancyId, kind, amount: direction === 'deduction' ? -value : value, description: description.trim(), startPeriod: `${startMonth}-01`, endPeriod: kind === 'recurring' && endMonth ? `${endMonth}-01` : null });
      setChangeModal(false); setAmount(''); setDescription(''); setMessage('Justeringen har sparats. Förhandsvisningen är uppdaterad.'); await load();
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  };
  const handleEndChange = async () => {
    if (!endChange || !ready || !canWrite) return; setSaving(true); setError('');
    try {
      if (endChange.origin === 'rent') await cancelRentChange(companyId, endChange.change);
      else await updateBillingAdjustmentStatus({ companyId, id: endChange.change.id, status: 'cancelled' });
      setEndChange(null); setMessage('Justeringen är avslutad. Redan skapade fakturor påverkas inte.'); await load();
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  };
  const prepare = async () => {
    if (!ready || !canWrite || (issues.some(r => r.company_missing) && !companyChecked)) return;
    setSaving(true); setError(''); setMessage('');
    try { await createOrGetRentBillingRun(companyId, `${month}-01`); setMessage('Körningen är förberedd. Kontrollera raderna innan fakturor skapas.'); await load(); }
    catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  };
  const createInvoices = async () => {
    if (!ready || !canWrite || !run || pending.some(r => r.state === 'unprepared') || issues.some(r => r.warnings.some(w => !w.startsWith('Hyresförhållandet och lägenheten saknar bolagskoppling'))) || (issues.some(r => r.company_missing) && !companyChecked)) return;
    setSaving(true); setError(''); setMessage('');
    try {
      if (current?.companyLink?.enabled) {
        const result = await createRentBillingInvoices({ companyId, runId: run.id, combineByCustomer: combine, send: false });
        setMessage(`${result.summary.succeeded} hyresrader behandlade. ${result.summary.failed} misslyckades. Inga fakturor har skickats.`);
        const failures = result.results.filter(r => !r.ok).map(r => r.error?.message || 'Okänt faktureringsfel');
        if (failures.length) setInvoiceWarning(failures.join(' '));
      } else {
        const { error: invoiceError } = await supabase.rpc('vihem_generate_rent_invoices', { target_run_id: run.id });
        if (invoiceError) throw invoiceError;
        setMessage('Fakturautkasten är skapade i Vi-hem. Inga fakturor har skickats.');
      }
      setCreateModal(false); await load();
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  };
  const showChangeForm = (target?: string) => { setTenancyId(target || current?.tenancies.find(t => ['active', 'terminated'].includes(t.status))?.id || ''); setStartMonth(month); setEndMonth(''); setError(''); setChangeModal(true); };
  const invoiceCards = (legacy: typeof customers[number]['invoices'], accounted: typeof customers[number]['accountedInvoices']) => <div className="space-y-3">
    {!legacy.length && !accounted.length && <EmptyState title="Inga fakturor kopplade ännu" description="Fakturorna visas här när ett underlag har skapats för kunden." />}
    {[...legacy].sort((a, b) => b.invoice_date.localeCompare(a.invoice_date)).map(i => <Card key={i.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">Faktura {i.invoice_number || 'utkast'}</p><p className="mt-1 text-sm text-slate-500">{formatDate(i.invoice_date)} · Förfallodag {formatDate(i.due_date)}</p><Badge className="mt-2 bg-slate-100 text-slate-700">{statusText[i.payment_status] || statusText[i.status] || i.status}</Badge></div><div className="text-right"><p className="font-bold">{invoiceMoney(Number(i.total_amount), i.currency)}</p><p className="text-sm text-slate-500">Kvar {invoiceMoney(Number(i.balance_due ?? Number(i.total_amount) - Number(i.paid_amount)), i.currency)}</p></div><Button variant="secondary" size="sm" onClick={() => void openInvoice(i.id, i.invoice_number || i.id.slice(0, 8), false)} loading={openInvoiceId === i.id}><FileText className="h-4 w-4" />Öppna faktura</Button></div></Card>)}
    {[...accounted].sort((a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || '')).map(i => <Card key={i.accounted_invoice_id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">Faktura {i.accounted_invoice_number || 'utkast'}</p><p className="mt-1 text-sm text-slate-500">{i.invoice_date ? formatDate(i.invoice_date) : 'Datum saknas'} · Förfallodag {i.due_date ? formatDate(i.due_date) : 'saknas'}</p><Badge className="mt-2 bg-slate-100 text-slate-700">{statusText[i.status] || i.status}</Badge></div><div className="text-right"><p className="font-bold">{i.total == null ? 'Belopp saknas' : invoiceMoney(Number(i.total), i.currency)}</p><p className="text-sm text-slate-500">Kvar {i.remaining_amount == null ? 'okänt' : invoiceMoney(Number(i.remaining_amount), i.currency)}</p></div><Button variant="secondary" size="sm" onClick={() => void openInvoice(i.id, i.accounted_invoice_number || i.id.slice(0, 8), true)} loading={openInvoiceId === i.id}><FileText className="h-4 w-4" />Öppna faktura</Button></div></Card>)}
  </div>;
  if (loading && !companies.length) return <LoadingPage />;
  return <div className="min-w-0 space-y-5 p-4 md:p-6">
    <PageHeader icon={Building2} title="Hyror" subtitle="Hyreskunder, fakturor och justeringar inför nästa hyreskörning." action={<Button variant="secondary" onClick={() => void load()} loading={loading} disabled={saving || !companyId}><RefreshCw className="h-4 w-4" />Uppdatera</Button>} />
    <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl"><Select label="Bolag" value={companyId} onChange={e => setCompanyId(e.target.value)} disabled={saving} options={companies.map(c => ({ value: c.id, label: c.name }))} /><Input label="Hyresmånad" type="month" value={month} required disabled={saving} onChange={e => { if (e.target.value) setMonth(e.target.value); }} /></div>
    <nav aria-label="Hyresmodul" className="grid grid-cols-3 gap-1 border-b border-slate-200 sm:flex sm:overflow-x-auto">{TABS.map(t => <button key={t.key} type="button" aria-current={tab === t.key ? 'page' : undefined} disabled={saving} onClick={() => { setTab(t.key); setCustomerKey(''); setSearch(''); onNavigate(t.page); }} className={`inline-flex min-w-0 flex-col items-center gap-1 border-b-2 px-2 py-3 text-xs font-semibold sm:shrink-0 sm:flex-row sm:gap-2 sm:px-3 sm:text-sm ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'}`}><t.icon className="h-4 w-4" />{t.label}</button>)}</nav>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {message && <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{message}</div>}
    {invoiceWarning && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{invoiceWarning}</div>}
    {!companies.length && <Card className="p-5"><EmptyState title="Inga bolag tillgängliga" description="Du behöver åtkomst till ett bolag för att se dess hyror och fakturor." /></Card>}
    {loading && companies.length > 0 && <p role="status" className="text-sm text-slate-500">Hämtar hyresunderlag…</p>}
    {!loading && current && tab === 'customers' && <>
      {selectedCustomer ? <><Button variant="ghost" onClick={() => setCustomerKey('')}><ArrowLeft className="h-4 w-4" />Alla kunder</Button><Card className="space-y-3 p-5"><h2 className="text-xl font-bold">{selectedCustomer.name}</h2><p className="break-words text-sm text-slate-500">{[selectedCustomer.email, selectedCustomer.phone].filter(Boolean).join(' · ')}</p>{selectedCustomer.tenancies.map(t => <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3"><div><p className="font-semibold">{t.property?.name} · {t.apartment?.apartment_number}</p><p className="text-sm text-slate-500">{formatDate(t.start_date)} – {t.end_date ? formatDate(t.end_date) : 'tills vidare'} · {statusText[t.status] || t.status}</p></div><p className="font-bold">{formatCurrency(Number(t.monthly_rent || t.apartment?.rent || 0))}/mån</p>{canWrite && ['active', 'terminated'].includes(t.status) && <Button size="sm" variant="secondary" onClick={() => showChangeForm(t.id)}>Avdrag / tillägg</Button>}</div>)}</Card><h3 className="font-bold">Alla kopplade fakturor ({selectedCustomer.invoices.length + selectedCustomer.accountedInvoices.length})</h3>{invoiceCards(selectedCustomer.invoices, selectedCustomer.accountedInvoices)}</> : <>
        <div className="grid grid-cols-2 gap-3"><Stat label="Kunder" value={customers.length} /><Stat label="Hyresförhållanden" value={current.tenancies.filter(t => ['active', 'terminated'].includes(t.status)).length} /></div>
        <Input label="Sök kund eller lägenhet" placeholder="Namn, e-post eller lägenhetsnummer" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{customers.filter(c => `${c.name} ${c.email} ${c.tenancies.map(t => `${t.property?.name} ${t.apartment?.apartment_number}`).join(' ')}`.toLowerCase().includes(search.toLowerCase())).map(c => <button key={c.key} type="button" onClick={() => setCustomerKey(c.key)} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-400 focus-visible:outline-blue-500"><p className="truncate font-bold text-slate-950">{c.name}</p><p className="mt-1 truncate text-sm text-slate-500">{c.email || 'Ingen e-postadress'}</p><p className="mt-3 text-sm text-slate-700">{c.tenancies.length ? c.tenancies.map(t => `${t.property?.name || ''} ${t.apartment?.apartment_number || ''}`).join(', ') : 'Ingen hyra kopplad'}</p><p className="mt-2 text-sm font-semibold text-blue-700">{c.invoices.length + c.accountedInvoices.length} fakturor · Öppna kund →</p></button>)}</div>
        {!customers.length && <EmptyState title="Inga kunder ännu" description="Befintliga ekonomikunder och hyresgäster visas här." />}
        {current.accountedInvoices.length > 0 && <Button variant="secondary" onClick={() => void refreshInvoiceCustomers()} loading={invoiceLoading}>Hämta kundkopplingar för övriga fakturor</Button>}
        {unknownInvoices.length > 0 && <details className="rounded-lg border border-slate-200 bg-white p-4"><summary className="cursor-pointer font-semibold">Fakturor utan läst kundkoppling ({unknownInvoices.length})</summary><p className="my-3 text-sm text-slate-500">Hämta kundkopplingarna ovan för att placera fakturorna under respektive kund. Alla fakturor kan även öppnas här.</p>{invoiceCards([], unknownInvoices)}</details>}
      </>}
    </>}
    {!loading && current && tab === 'adjustments' && <>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Avdrag & tillägg</h2><p className="text-sm text-slate-500">Engångsbelopp för en bestämd månad eller återkommande tills du avslutar dem.</p></div><Button onClick={() => showChangeForm()} disabled={!canWrite || !ready || !current.tenancies.some(t => ['active', 'terminated'].includes(t.status))}><Plus className="h-4 w-4" />Ny justering</Button></div>
      <Input label="Sök justering" value={search} onChange={e => setSearch(e.target.value)} placeholder="Kund, lägenhet eller beskrivning" />
      {[...current.rentChanges.map(change => ({ change, origin: 'rent' as const })), ...current.billingChanges.map(change => ({ change, origin: 'billing' as const }))].filter(({ change }) => `${tenancyLabel(change.tenancy_id || change.target_id || '')} ${change.description}`.toLowerCase().includes(search.toLowerCase())).map(({ change, origin }) => <Card key={`${origin}:${change.id}`} className="space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-bold">{change.description || (Number(change.amount) < 0 ? 'Avdrag' : 'Tillägg')}</p><p className="text-sm text-slate-500">{tenancyLabel(change.tenancy_id || change.target_id || '')}</p></div><p className={`font-bold ${Number(change.amount) < 0 ? 'text-emerald-700' : 'text-slate-950'}`}>{formatCurrency(Number(change.amount))}{change.adjustment_type === 'indexed' && ` + ${change.percentage_rate}%`}</p></div><div className="flex flex-wrap items-center gap-2"><Badge className="bg-slate-100 text-slate-700">{statusText[change.status] || change.status}</Badge><Badge className="bg-blue-50 text-blue-700">{change.adjustment_type === 'one_time' ? 'Engångsbelopp' : change.end_period ? 'Återkommande under period' : 'Återkommande tills vidare'}</Badge><span className="text-sm text-slate-500">{(change.start_period || change.rent_period || '').slice(0, 7)}{change.adjustment_type !== 'one_time' ? ` – ${change.end_period?.slice(0, 7) || 'tills vidare'}` : ''}</span>{origin === 'billing' && <span className="text-xs text-slate-500">Via Ekonomi V2 · {change.applied_count || 0} använda tillfällen</span>}</div>{canWrite && ['active', 'paused'].includes(change.status) && <Button size="sm" variant="secondary" onClick={() => setEndChange({ change, origin })} disabled={!ready}>Avsluta justering</Button>}</Card>)}
      {!current.rentChanges.length && !current.billingChanges.length && <Card className="p-5"><EmptyState title="Inga justeringar" description="Lägg till exempelvis ett tillfälligt hyresavdrag eller ett permanent tillägg för internet." /></Card>}
    </>}
    {!loading && current && tab === 'billing' && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Hyresrader kvar" value={pending.length} /><Stat label="Avdrag" value={formatCurrency(pending.reduce((s, r) => s + r.deductions, 0))} /><Stat label="Tillägg" value={formatCurrency(pending.reduce((s, r) => s + r.additions, 0))} /><Stat label="Att fakturera inkl. moms" value={formatCurrency(total)} /></div>
      <Card className="space-y-4 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Hyra för {month}</h2><p className="mt-1 text-sm text-slate-500">Förfallodag {dueDate} · {run ? 'Sparat körningsunderlag' : 'Förhandsvisning'} · {current.companyLink?.enabled ? 'Fakturering via Accounted' : 'Fakturering i Vi-hem'}</p><p className="mt-1 text-xs text-slate-500">Uppdaterad {new Date(current.fetchedAt).toLocaleTimeString('sv-SE')}.</p></div><Button variant="secondary" onClick={() => void prepare()} loading={saving} disabled={!canWrite || !ready || !pending.length || (issues.some(r => r.company_missing) && !companyChecked)}>{run ? 'Komplettera körningsunderlag' : 'Förbered körning'}</Button></div><p className="text-sm text-slate-600">Här visas grundhyra och varje avdrag eller tillägg. Upp­sagda hyresförhållanden ingår till avtalets slutdatum. Redan fakturerade rader räknas inte med i nästa körning.</p>
        {issues.some(r => r.company_missing) && <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><input type="checkbox" checked={companyChecked} onChange={e => setCompanyChecked(e.target.checked)} className="mt-1" /><span>Det finns hyresförhållanden utan bolagskoppling. Jag har kontrollerat att de tillhör {companies.find(c => c.id === companyId)?.name} inför denna körning.</span></label>}
        {issues.length > 0 && <p className="text-sm text-amber-800">{issues.length} rader behöver granskas före fakturering.</p>}
        {run && <Button onClick={() => setCreateModal(true)} disabled={!canWrite || !ready || !pending.length || pending.some(r => r.state === 'unprepared') || issues.some(r => r.warnings.some(w => !w.startsWith('Hyresförhållandet och lägenheten saknar bolagskoppling'))) || (issues.some(r => r.company_missing) && !companyChecked)}>Skapa fakturautkast</Button>}
      </Card>
      <div className="space-y-3">{current.preview.map(r => <Card key={r.tenancy_id} className="space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><button type="button" onClick={() => { const c = customers.find(c => c.tenantIds.includes(r.tenant_id)); setCustomerKey(c?.key || ''); setTab('customers'); onNavigate('rent-customers'); }} className="font-bold text-blue-700 hover:underline">{r.name}</button><p className="text-sm text-slate-500">{r.property} · {r.apartment}</p><Badge className="mt-2 bg-slate-100 text-slate-700">{statusText[r.state] || r.state}</Badge></div><p className="text-xl font-bold">{r.state === 'invoiced' ? 'Fakturerad' : formatCurrency(r.total)}</p></div>{['draft', 'unprepared'].includes(r.state) && <><div className="space-y-2 border-t border-slate-100 pt-3 text-sm"><div className="flex justify-between gap-3"><span>Grundhyra</span><span>{formatCurrency(r.base)}</span></div>{r.lines.map(line => <div key={`${line.origin}:${line.id}`} className="flex justify-between gap-3"><span className="min-w-0 break-words">{line.description || (line.amount < 0 ? 'Avdrag' : 'Tillägg')}</span><span className="shrink-0">{formatCurrency(line.amount)}</span></div>)}{r.vat !== 0 && <div className="flex justify-between"><span>Moms</span><span>{formatCurrency(r.vat)}</span></div>}</div>{r.warnings.filter(w => !companyChecked || !w.startsWith('Hyresförhållandet och lägenheten saknar bolagskoppling')).map(w => <p key={w} className="text-sm text-amber-800">{w}</p>)}{canWrite && <Button size="sm" variant="ghost" onClick={() => showChangeForm(r.tenancy_id)}>Lägg till avdrag / tillägg</Button>}</>}</Card>)}</div>
      {!current.preview.length && <Card className="p-5"><EmptyState title="Inga hyror för vald månad" description="Ingen aktiv eller uppsagd hyresperiod matchar månaden. Ett tillträde efter månadens första dag behöver hanteras separat enligt nuvarande körningsregler." /></Card>}
    </>}
    <Modal open={changeModal} onClose={() => { if (!saving) setChangeModal(false); }} title="Nytt avdrag eller tillägg"><form className="space-y-4" onSubmit={e => void handleSaveChange(e)}><Select label="Hyresförhållande" value={tenancyId} disabled={saving} onChange={e => setTenancyId(e.target.value)} options={(current?.tenancies || []).filter(t => ['active', 'terminated'].includes(t.status)).map(t => ({ value: t.id, label: tenancyLabel(t.id) }))} /><div className="grid gap-3 sm:grid-cols-2"><Select label="Typ" value={direction} disabled={saving} onChange={e => setDirection(e.target.value)} options={[{ value: 'deduction', label: 'Avdrag (minskar hyran)' }, { value: 'addition', label: 'Tillägg (ökar hyran)' }]} /><Select label="Varaktighet" value={kind} disabled={saving} onChange={e => setKind(e.target.value as typeof kind)} options={[{ value: 'one_time', label: 'Engångsbelopp för vald månad' }, { value: 'recurring', label: 'Återkommande / permanent' }]} /></div><Input label="Belopp i kronor" inputMode="decimal" placeholder="Exempelvis 350" value={amount} required disabled={saving} onChange={e => setAmount(e.target.value)} /><Input label="Beskrivning på fakturaunderlaget" value={description} required disabled={saving} onChange={e => setDescription(e.target.value)} /><Input label={kind === 'one_time' ? 'Hyresmånad' : 'Från hyresmånad'} type="month" value={startMonth} required disabled={saving} onChange={e => setStartMonth(e.target.value)} />{kind === 'recurring' && <Input label="Till och med (valfritt)" type="month" value={endMonth} min={startMonth} disabled={saving} hint="Lämna tomt för permanent justering tills den avslutas." onChange={e => setEndMonth(e.target.value)} />}<p className="text-sm text-slate-500">Justeringen följer hyrans moms och påverkar bara hyresunderlag som ännu inte har fakturerats.</p>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<Button type="submit" loading={saving} disabled={!tenancyId || !canWrite}>Spara justering</Button></form></Modal>
    <Modal open={Boolean(endChange)} onClose={() => { if (!saving) setEndChange(null); }} title="Avsluta justering"><p className="mb-4 text-sm text-slate-600">{endChange?.change.description} tas bort från kommande ofakturerade hyror. Befintliga fakturor ändras inte.</p><Button onClick={() => void handleEndChange()} loading={saving}>Avsluta justering</Button></Modal>
    <Modal open={createModal} onClose={() => { if (!saving) setCreateModal(false); }} title="Skapa fakturautkast"><p className="text-sm text-slate-600">{pending.length} hyresrader för {month}, totalt {formatCurrency(total)}. Utkasten skapas i {current?.companyLink?.enabled ? 'Accounted' : 'Vi-hem'}. Inga fakturor skickas från detta steg.</p>{current?.companyLink?.enabled && <label className="my-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={combine} disabled={saving} onChange={e => setCombine(e.target.checked)} />Samlingsfaktura per kund med flera lägenheter</label>}<Button className="mt-4" onClick={() => void createInvoices()} loading={saving}>Skapa {pending.length} hyresrader som fakturautkast</Button></Modal>
  </div>;
}
