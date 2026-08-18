import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, FileUp, Pause, Play, Plus, ReceiptText, Trash2, UserPlus, WalletCards } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { allocatePaymentOldestFirst, calculateInstallmentSchedule, deriveInstallmentPlanStatus } from '../lib/installmentPlans';
import { buildInstallmentPaymentPdfBlob } from '../lib/installmentPaymentPdf';
import { archiveFileInGoogleDrive } from '../lib/googleDriveStorage';
import { Badge, Button, Card, EmptyState, Input, Select, Textarea } from './ui';
import type { FinanceCompany, FinanceCustomer, InstallmentPayment, InstallmentPlan, InstallmentPlanDocument, InstallmentPlanInvoice, InstallmentSchedule, Invoice } from '../types';

type Props = {
  organisationId: string;
  companies: FinanceCompany[];
  customers: FinanceCustomer[];
  invoices: Invoice[];
  userId: string;
};

type PlanForm = {
  companyId: string;
  customerId: string;
  firstDueDate: string;
  installmentCount: string;
  intervalMonths: string;
  dayOfMonth: string;
  terms: string;
  notes: string;
};

type ExternalInvoiceDraft = {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  amount: string;
  description: string;
};

type CustomerDraft = {
  name: string;
  customerType: FinanceCustomer['customer_type'];
  companyId: string;
  organisationNumber: string;
  email: string;
  phone: string;
};

const today = new Date().toISOString().slice(0, 10);
const emptyForm: PlanForm = {
  companyId: '', customerId: '', firstDueDate: today, installmentCount: '3', intervalMonths: '1', dayOfMonth: String(new Date().getDate()),
  terms: '', notes: '',
};

const money = (value: number) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(Number(value || 0));

function statusLabel(status: InstallmentPlan['status']) {
  return ({ draft: 'Utkast', pending_approval: 'Väntar godkännande', active: 'Aktiv', overdue: 'Förfallen', completed: 'Slutförd', paused: 'Pausad', cancelled: 'Avbruten' } as Record<string, string>)[status] ?? status;
}

export function InstallmentPlansPanel({ organisationId, companies, customers, invoices, userId }: Props) {
  const [plans, setPlans] = useState<InstallmentPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<InstallmentPlan | null>(null);
  const [planInvoices, setPlanInvoices] = useState<InstallmentPlanInvoice[]>([]);
  const [schedule, setSchedule] = useState<InstallmentSchedule[]>([]);
  const [payments, setPayments] = useState<InstallmentPayment[]>([]);
  const [documents, setDocuments] = useState<InstallmentPlanDocument[]>([]);
  const [form, setForm] = useState<PlanForm>({ ...emptyForm, companyId: companies[0]?.id ?? '' });
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [externalInvoices, setExternalInvoices] = useState<ExternalInvoiceDraft[]>([]);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [inlineCustomers, setInlineCustomers] = useState<FinanceCustomer[]>([]);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>({ name: '', customerType: 'company', companyId: companies[0]?.id ?? '', organisationNumber: '', email: '', phone: '' });
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InstallmentPlan['status']>('all');

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from('vihem_installment_plans')
      .select('*, company:company_id(*), customer:customer_id(*)')
      .eq('organisation_id', organisationId)
      .order('created_at', { ascending: false });
    if (queryError) setError(queryError.message);
    setPlans((data ?? []) as InstallmentPlan[]);
    setLoading(false);
  }, [organisationId]);

  const loadPlan = async (plan: InstallmentPlan) => {
    setSelectedPlan(plan);
    const [invoiceResult, scheduleResult, paymentResult, documentResult] = await Promise.all([
      supabase.from('vihem_installment_plan_invoices').select('*, invoice:invoice_id(*)').eq('plan_id', plan.id).order('external_due_date', { ascending: true }),
      supabase.from('vihem_installment_schedule').select('*').eq('plan_id', plan.id).order('installment_no', { ascending: true }),
      supabase.from('vihem_installment_payments').select('*').eq('plan_id', plan.id).order('payment_date', { ascending: false }),
      supabase.from('vihem_installment_plan_documents').select('*').eq('plan_id', plan.id).order('created_at', { ascending: false }),
    ]);
    setPlanInvoices((invoiceResult.data ?? []) as InstallmentPlanInvoice[]);
    setSchedule((scheduleResult.data ?? []) as InstallmentSchedule[]);
    setPayments((paymentResult.data ?? []) as InstallmentPayment[]);
    setDocuments((documentResult.data ?? []) as InstallmentPlanDocument[]);
  };

  const persistDocument = async (file: File, plan: InstallmentPlan, paymentId: string | null, documentType: InstallmentPlanDocument['document_type'], title: string) => {
    const uniqueId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const storagePath = `${organisationId}/installment-plans/${plan.id}/${uniqueId}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from('vihem-documents').upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (uploadError) throw uploadError;
    let driveFile: Awaited<ReturnType<typeof archiveFileInGoogleDrive>> = null;
    try {
      driveFile = await archiveFileInGoogleDrive({ file, folder: `Ekonomi/Avbetalningsplaner/${plan.company?.name ?? organisationId}/${plan.plan_number}`, organisation_id: organisationId, source_type: 'installment_plan_document', source_id: plan.id, source_key: storagePath, created_by: userId });
    } catch (driveError) {
      console.warn('Google Drive-arkivering av avbetalningsplandokument misslyckades:', driveError);
    }
    const { error: documentError } = await supabase.from('vihem_installment_plan_documents').insert({ organisation_id: organisationId, plan_id: plan.id, payment_id: paymentId, document_type: documentType, title, file_name: file.name, mime_type: file.type || 'application/octet-stream', storage_bucket: 'vihem-documents', storage_path: storagePath, size_bytes: file.size, drive_file_id: driveFile?.id ?? null, drive_web_url: driveFile?.webViewLink ?? null, created_by: userId });
    if (documentError) {
      await supabase.storage.from('vihem-documents').remove([storagePath]);
      throw documentError;
    }
  };

  const downloadPaymentUnderlay = async (payment: InstallmentPayment) => {
    if (!selectedPlan) return;
    const blob = buildInstallmentPaymentPdfBlob({
      organisationName: selectedPlan.company?.name ?? 'VI-HEM',
      planNumber: selectedPlan.plan_number,
      paymentNumber: payment.payment_number,
      paymentDate: payment.payment_date,
      amount: Number(payment.amount),
      method: payment.payment_method,
      reference: payment.reference,
      customerName: selectedPlan.customer?.name ?? '',
    });
    const file = new File([blob], `${selectedPlan.plan_number}-${payment.payment_number}.pdf`, { type: 'application/pdf' });
    setSaving(true);
    try {
      await persistDocument(file, selectedPlan, payment.id, 'payment_underlay', `Betalningsunderlag ${payment.payment_number}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
      await loadPlan(selectedPlan);
    } catch (documentError) {
      setError(documentError instanceof Error ? documentError.message : 'Kunde inte spara betalningsunderlaget.');
    } finally {
      setSaving(false);
    }
  };

  const downloadDocument = async (doc: InstallmentPlanDocument) => {
    const { data, error: signedUrlError } = await supabase.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 60 * 10, { download: doc.file_name });
    if (signedUrlError || !data?.signedUrl) {
      if (doc.drive_web_url) window.open(doc.drive_web_url, '_blank', 'noopener,noreferrer');
      else setError(signedUrlError?.message ?? 'Dokumentet kunde inte öppnas.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const uploadAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedPlan) return;
    setSaving(true); setError('');
    try {
      await persistDocument(file, selectedPlan, null, 'attachment', file.name);
      await loadPlan(selectedPlan);
    } catch (documentError) {
      setError(documentError instanceof Error ? documentError.message : 'Bilagan kunde inte sparas.');
    } finally { setSaving(false); }
  };

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!form.companyId && companies[0]) setForm(current => ({ ...current, companyId: companies[0].id }));
  }, [companies, form.companyId]);

  const eligibleInvoices = useMemo(() => invoices.filter(invoice =>
    invoice.company_id === form.companyId &&
    invoice.status !== 'cancelled' && invoice.status !== 'credited' &&
    Number(invoice.balance_due ?? Number(invoice.total_amount) - Number(invoice.paid_amount)) > 0,
  ), [form.companyId, invoices]);

  const filteredPlans = useMemo(() => plans.filter(plan => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || plan.plan_number.toLowerCase().includes(query) || (plan.company?.name ?? '').toLowerCase().includes(query) || (plan.customer?.name ?? '').toLowerCase().includes(query);
    return matchesSearch && (statusFilter === 'all' || plan.status === statusFilter);
  }), [plans, search, statusFilter]);

  const availableCustomers = useMemo(() => {
    const merged = [...customers, ...inlineCustomers];
    return merged.filter((customer, index) => merged.findIndex(item => item.id === customer.id) === index);
  }, [customers, inlineCustomers]);

  const updateForm = (key: keyof PlanForm, value: string) => setForm(current => ({ ...current, [key]: value }));

  const addExternalInvoice = () => {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    setExternalInvoices(current => [...current, { id, number: '', date: today, dueDate: today, amount: '', description: '' }]);
  };

  const updateExternalInvoice = (id: string, key: keyof Omit<ExternalInvoiceDraft, 'id'>, value: string) => {
    setExternalInvoices(current => current.map(row => row.id === id ? { ...row, [key]: value } : row));
  };

  const createInlineCustomer = async () => {
    if (!organisationId || !customerDraft.name.trim() || !customerDraft.companyId) {
      setError('Fyll i kundnamn och välj bolag innan kunden sparas.');
      return;
    }
    setSaving(true);
    setError('');
    const { data, error: customerError } = await supabase.from('vihem_finance_customers').insert({
      organisation_id: organisationId,
      company_id: customerDraft.companyId,
      customer_type: customerDraft.customerType,
      name: customerDraft.name.trim(),
      organisation_number: customerDraft.organisationNumber.trim(),
      email: customerDraft.email.trim(),
      phone: customerDraft.phone.trim(),
      invoice_email: customerDraft.email.trim(),
      payment_terms_days: 30,
      notes: '',
      created_by: userId,
    }).select('*').single();
    if (customerError || !data) {
      setError(customerError?.message ?? 'Kunden kunde inte skapas.');
      setSaving(false);
      return;
    }
    setInlineCustomers(current => [...current.filter(customer => customer.id !== data.id), data as FinanceCustomer]);
    setForm(current => ({ ...current, customerId: data.id }));
    setCustomerDraft({ name: '', customerType: 'company', companyId: form.companyId, organisationNumber: '', email: '', phone: '' });
    setShowNewCustomer(false);
    setSaving(false);
  };

  const createPlan = async () => {
    setError('');
    setNotice('');
    setNoticeIsError(false);
    const linked = invoices.filter(invoice => selectedInvoiceIds.includes(invoice.id));
    const validExternalInvoices = externalInvoices.filter(invoice => Number(invoice.amount) > 0);
    const externalAmount = validExternalInvoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
    const total = linked.reduce((sum, invoice) => sum + Number(invoice.balance_due ?? Number(invoice.total_amount) - Number(invoice.paid_amount)), 0) + externalAmount;
    const count = Math.max(1, Number.parseInt(form.installmentCount, 10) || 1);
    const customerId = form.customerId || '';
    if (!form.companyId || total <= 0) { setError('Välj bolag och minst en faktura eller ett externt underlag.'); return; }
    setSaving(true);
    const planNumber = `AP-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
    const { data: plan, error: planError } = await supabase.from('vihem_installment_plans').insert({
      organisation_id: organisationId, company_id: form.companyId, customer_id: form.customerId || null,
      plan_number: planNumber, status: 'pending_approval', total_amount: total, paid_amount: 0, remaining_amount: total,
      installment_count: count, first_due_date: form.firstDueDate, interval_months: Math.max(1, Number(form.intervalMonths) || 1),
      day_of_month: Math.min(31, Math.max(1, Number(form.dayOfMonth) || 1)), payment_amount: total / count,
      terms: form.terms, notes: form.notes, accounting_exportable: false, created_by: userId, updated_by: userId,
    }).select('*').single();
    if (planError || !plan) { setError(planError?.message ?? 'Kunde inte skapa avbetalningsplanen.'); setSaving(false); return; }

    const rows = [
      ...linked.map(invoice => ({ organisation_id: organisationId, plan_id: plan.id, invoice_id: invoice.id, source_type: 'original', description: invoice.invoice_number ?? 'Faktura', amount: Number(invoice.balance_due ?? Number(invoice.total_amount) - Number(invoice.paid_amount)), balance_remaining: Number(invoice.balance_due ?? Number(invoice.total_amount) - Number(invoice.paid_amount)) })),
      ...validExternalInvoices.map(invoice => ({ organisation_id: organisationId, plan_id: plan.id, invoice_id: null, source_type: 'external', external_invoice_number: invoice.number || null, external_invoice_date: invoice.date || null, external_due_date: invoice.dueDate || null, description: invoice.description || 'Externt underlag', amount: Number(invoice.amount), balance_remaining: Number(invoice.amount) })),
    ];
    const planRows = await supabase.from('vihem_installment_plan_invoices').insert(rows);
    const scheduleRows = calculateInstallmentSchedule({ totalAmount: total, installmentCount: count, firstDueDate: form.firstDueDate, intervalMonths: Number(form.intervalMonths) || 1, dayOfMonth: Number(form.dayOfMonth) || 1 }).map(row => ({ organisation_id: organisationId, plan_id: plan.id, installment_no: row.installmentNo, due_date: row.dueDate, amount: row.amount, paid_amount: 0, status: 'pending' }));
    const scheduleInsert = await supabase.from('vihem_installment_schedule').insert(scheduleRows);
    await supabase.from('vihem_installment_audit_log').insert({ organisation_id: organisationId, plan_id: plan.id, action: 'created', metadata: { source_invoice_count: linked.length, external_invoice_count: validExternalInvoices.length, external_amount: externalAmount }, created_by: userId });
    const persistenceError = planRows.error ?? scheduleInsert.error;
    if (persistenceError) {
      setError(persistenceError.message ?? 'Planen skapades delvis och behöver kontrolleras.');
    } else if (!customerId) {
      setNoticeIsError(true);
      setNotice('Avbetalningsplanen skapades. Ingen kund är kopplad, så inget mejl skickades.');
    } else {
      const { data: emailResult, error: emailError } = await supabase.functions.invoke('vihem-send-installment-plan-email', { body: { organisation_id: organisationId, plan_id: plan.id } });
      if (emailError || emailResult?.error) {
        setNoticeIsError(true);
        setNotice(`Planen skapades, men e-post kunde inte skickas: ${emailResult?.error ?? emailError?.message ?? 'Okänt fel.'}`);
      } else {
        setNotice(`Avbetalningsplanen skapades och skickades till ${emailResult?.sent_to ?? 'kunden'}.`);
      }
    }
    setForm({ ...emptyForm, companyId: companies[0]?.id ?? '' }); setSelectedInvoiceIds([]); setExternalInvoices([]); setShowCreate(false); setSaving(false); await refresh();
  };

  const registerPayment = async () => {
    if (!selectedPlan || Number(paymentAmount) <= 0) return;
    setSaving(true); setError('');
    const amount = Number(paymentAmount);
    if (amount > Number(selectedPlan.remaining_amount) + 0.005) {
      setError(`Beloppet är större än återstående skuld (${money(Number(selectedPlan.remaining_amount))}).`);
      setSaving(false);
      return;
    }
    const { data: payment, error: paymentError } = await supabase.from('vihem_installment_payments').insert({ organisation_id: organisationId, plan_id: selectedPlan.id, payment_number: `P-${Date.now()}`, payment_date: paymentDate, amount, payment_method: paymentMethod, reference: paymentReference, notes: paymentNotes, accounting_exportable: false, created_by: userId }).select('*').single();
    if (paymentError || !payment) { setError(paymentError?.message ?? 'Kunde inte registrera betalningen.'); setSaving(false); return; }
    const allocations = allocatePaymentOldestFirst(planInvoices.map(row => ({ id: row.id, dueDate: row.external_due_date ?? row.invoice?.due_date ?? today, balanceRemaining: Number(row.balance_remaining) })), amount);
    if (allocations.length) {
      await supabase.from('vihem_installment_payment_allocations').insert(allocations.map(allocation => ({ organisation_id: organisationId, payment_id: payment.id, plan_invoice_id: allocation.invoiceId, invoice_id: planInvoices.find(row => row.id === allocation.invoiceId)?.invoice_id ?? null, amount: allocation.amount })));
      for (const allocation of allocations) {
        const row = planInvoices.find(item => item.id === allocation.invoiceId);
        if (row) await supabase.from('vihem_installment_plan_invoices').update({ balance_remaining: Math.max(0, Number(row.balance_remaining) - allocation.amount) }).eq('id', row.id);
      }
    }
    let scheduleRemainingCents = Math.round(amount * 100);
    const scheduleUpdates = [...schedule]
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.installment_no - b.installment_no)
      .map(row => {
        const dueCents = Math.max(0, Math.round((Number(row.amount) - Number(row.paid_amount)) * 100));
        const appliedCents = Math.min(scheduleRemainingCents, dueCents);
        scheduleRemainingCents -= appliedCents;
        return { row, paidAmount: Number(row.paid_amount) + appliedCents / 100 };
      })
      .filter(update => update.paidAmount !== Number(update.row.paid_amount));
    for (const update of scheduleUpdates) {
      const fullyPaid = update.paidAmount >= Number(update.row.amount) - 0.005;
      const status = fullyPaid ? 'paid' : 'partially_paid';
      await supabase.from('vihem_installment_schedule').update({ paid_amount: Math.min(Number(update.row.amount), update.paidAmount), status, payment_reference: paymentReference || payment.payment_number, updated_at: new Date().toISOString() }).eq('id', update.row.id);
    }
    const nextPaid = Math.min(Number(selectedPlan.total_amount), Number(selectedPlan.paid_amount) + amount);
    const hasOverdue = schedule.some(row => row.status === 'overdue' || (row.due_date < paymentDate && Number(row.paid_amount) < Number(row.amount)));
    const nextStatus = deriveInstallmentPlanStatus(Number(selectedPlan.total_amount), nextPaid, hasOverdue, selectedPlan.status);
    await supabase.from('vihem_installment_plans').update({ paid_amount: nextPaid, remaining_amount: Math.max(0, Number(selectedPlan.total_amount) - nextPaid), status: nextStatus, updated_by: userId }).eq('id', selectedPlan.id);
    await supabase.from('vihem_installment_audit_log').insert({ organisation_id: organisationId, plan_id: selectedPlan.id, action: 'payment_registered', metadata: { amount, payment_id: payment.id, allocations }, created_by: userId });
    setPaymentAmount(''); setPaymentReference(''); setPaymentNotes(''); setSaving(false); await refresh(); const updated = plans.find(item => item.id === selectedPlan.id); if (updated) await loadPlan({ ...updated, paid_amount: nextPaid, remaining_amount: Math.max(0, Number(updated.total_amount) - nextPaid), status: nextStatus });
  };

  const changeStatus = async (status: InstallmentPlan['status']) => {
    if (!selectedPlan) return;
    await supabase.from('vihem_installment_plans').update({ status, approved_by: status === 'active' ? userId : selectedPlan.approved_by, approved_at: status === 'active' ? new Date().toISOString() : selectedPlan.approved_at, updated_by: userId }).eq('id', selectedPlan.id);
    await supabase.from('vihem_installment_audit_log').insert({ organisation_id: organisationId, plan_id: selectedPlan.id, action: `status_${status}`, metadata: {}, created_by: userId });
    await refresh(); const next = plans.find(item => item.id === selectedPlan.id); if (next) await loadPlan({ ...next, status });
  };

  if (loading) return <Card><p className="text-sm text-slate-500">Laddar avbetalningsplaner...</p></Card>;

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-950">Avbetalningsplaner</h2><p className="mt-1 text-sm text-slate-500">Administrativ uppföljning av skuld. Ingen ny faktura eller bokföringspost skapas.</p></div><Button size="sm" onClick={() => setShowCreate(value => !value)}><Plus className="h-4 w-4" />Ny plan</Button></div>
        <div className="mt-4 flex flex-wrap gap-2"><Badge className="bg-amber-50 text-amber-800">Ej bokföringsbar</Badge><Badge className="bg-slate-100 text-slate-700">{plans.length} planer</Badge></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><Input label="Sök plan" placeholder="Plan, bolag eller kund" value={search} onChange={event => setSearch(event.target.value)} /><Select label="Status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)} options={[{ value: 'all', label: 'Alla statusar' }, ...(['draft', 'pending_approval', 'active', 'overdue', 'completed', 'paused', 'cancelled'] as const).map(status => ({ value: status, label: statusLabel(status) }))]} /></div>
      </Card>
      {notice && <p className={`rounded-xl border p-3 text-sm font-medium ${noticeIsError ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{notice}</p>}
      {showCreate && <Card className="overflow-hidden border-blue-100 p-0 shadow-md"><div className="bg-gradient-to-r from-blue-700 to-indigo-600 px-5 py-5 text-white"><div className="flex items-center gap-3"><div className="rounded-xl bg-white/15 p-2"><ReceiptText className="h-5 w-5" /></div><div><h3 className="text-lg font-bold">Ny avbetalningsplan</h3><p className="mt-0.5 text-sm text-blue-100">Samla flera underlag i en tydlig plan.</p></div></div></div><div className="space-y-6 p-5">
        <section><p className="mb-3 text-xs font-bold uppercase tracking-wider text-blue-700">1. Vem gäller planen?</p><div className="grid gap-3 sm:grid-cols-2"><Select label="Bolag" value={form.companyId} onChange={event => { updateForm('companyId', event.target.value); setSelectedInvoiceIds([]); setCustomerDraft(current => ({ ...current, companyId: event.target.value })); }} options={companies.map(company => ({ value: company.id, label: company.name }))} /><div><Select label="Kund" value={form.customerId} onChange={event => updateForm('customerId', event.target.value)} options={[{ value: '', label: 'Ingen vald kund' }, ...availableCustomers.filter(customer => !form.companyId || customer.company_id === form.companyId).map(customer => ({ value: customer.id, label: customer.name }))]} /><button type="button" onClick={() => setShowNewCustomer(value => !value)} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-900"><UserPlus className="h-4 w-4" />{showNewCustomer ? 'Stäng kundskapande' : 'Skapa ny kund här'}</button></div></div>
          {showNewCustomer && <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4"><p className="mb-3 text-sm font-bold text-slate-900">Ny kund</p><div className="grid gap-3 sm:grid-cols-2"><Input label="Namn" value={customerDraft.name} onChange={event => setCustomerDraft(current => ({ ...current, name: event.target.value }))} /><Select label="Typ" value={customerDraft.customerType} onChange={event => setCustomerDraft(current => ({ ...current, customerType: event.target.value as CustomerDraft['customerType'], organisationNumber: event.target.value === 'private' ? '' : current.organisationNumber }))} options={[{ value: 'company', label: 'Företag' }, { value: 'private', label: 'Privatperson' }, { value: 'brf', label: 'Bostadsrättsförening' }]} />{customerDraft.customerType !== 'private' && <Input label="Organisationsnummer" value={customerDraft.organisationNumber} onChange={event => setCustomerDraft(current => ({ ...current, organisationNumber: event.target.value }))} />}<Input label="E-post" type="email" value={customerDraft.email} onChange={event => setCustomerDraft(current => ({ ...current, email: event.target.value }))} /><Input label="Telefon" value={customerDraft.phone} onChange={event => setCustomerDraft(current => ({ ...current, phone: event.target.value }))} /></div><Button className="mt-3" size="sm" onClick={() => void createInlineCustomer()} loading={saving}><UserPlus className="h-4 w-4" />Spara kund och välj</Button></div>}
        </section>
        <section><div className="mb-3 flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-blue-700">2. Ursprungsfakturor</p><p className="mt-1 text-sm text-slate-500">Välj en eller flera obetalda fakturor. De kopplas till samma plan.</p></div>{eligibleInvoices.length > 0 && <button type="button" className="text-sm font-semibold text-blue-700" onClick={() => setSelectedInvoiceIds(current => current.length === eligibleInvoices.length ? [] : eligibleInvoices.map(invoice => invoice.id))}>{selectedInvoiceIds.length === eligibleInvoices.length ? 'Avmarkera alla' : 'Välj alla'}</button>}</div>{eligibleInvoices.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">Inga obetalda fakturor för valt bolag.</div> : <div className="max-h-56 space-y-2 overflow-auto rounded-xl border border-slate-200 bg-slate-50/70 p-3">{eligibleInvoices.map(invoice => { const amount = Number(invoice.balance_due ?? Number(invoice.total_amount) - Number(invoice.paid_amount)); return <label key={invoice.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${selectedInvoiceIds.includes(invoice.id) ? 'border-blue-300 bg-blue-50' : 'border-transparent bg-white hover:border-slate-200'}`}><input className="h-4 w-4 accent-blue-600" type="checkbox" checked={selectedInvoiceIds.includes(invoice.id)} onChange={event => setSelectedInvoiceIds(current => event.target.checked ? [...current, invoice.id] : current.filter(id => id !== invoice.id))} /><ReceiptText className="h-4 w-4 text-slate-400" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-900">{invoice.invoice_number ?? 'Utan nummer'}</span><span className="block text-xs text-slate-500">Förfallo {invoice.due_date ?? 'saknas'}</span></span><span className="text-sm font-bold text-slate-900">{money(amount)}</span></label>; })}</div>}<p className="mt-2 text-xs font-semibold text-slate-500">{selectedInvoiceIds.length} valda fakturor</p></section>
        <section><div className="mb-3 flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-blue-700">3. Övriga ursprungsunderlag</p><p className="mt-1 text-sm text-slate-500">Lägg till flera externa fakturor eller äldre underlag.</p></div><Button size="sm" variant="secondary" onClick={addExternalInvoice}><Plus className="h-4 w-4" />Lägg till underlag</Button></div>{externalInvoices.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">Inga externa underlag tillagda.</div> : <div className="space-y-3">{externalInvoices.map((invoice, index) => <div key={invoice.id} className="rounded-xl border border-slate-200 bg-white p-4"><div className="mb-3 flex items-center justify-between"><p className="text-sm font-bold text-slate-900">Externt underlag {index + 1}</p><button type="button" aria-label="Ta bort underlag" onClick={() => setExternalInvoices(current => current.filter(row => row.id !== invoice.id))} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></div><div className="grid gap-3 sm:grid-cols-2"><Input label="Fakturanummer" value={invoice.number} onChange={event => updateExternalInvoice(invoice.id, 'number', event.target.value)} /><Input label="Belopp" type="number" min="0" step="0.01" value={invoice.amount} onChange={event => updateExternalInvoice(invoice.id, 'amount', event.target.value)} /><Input label="Fakturadatum" type="date" value={invoice.date} onChange={event => updateExternalInvoice(invoice.id, 'date', event.target.value)} /><Input label="Förfallodatum" type="date" value={invoice.dueDate} onChange={event => updateExternalInvoice(invoice.id, 'dueDate', event.target.value)} /><Input label="Beskrivning" value={invoice.description} onChange={event => updateExternalInvoice(invoice.id, 'description', event.target.value)} /></div></div>)}</div>}</section>
        <section><p className="mb-3 text-xs font-bold uppercase tracking-wider text-blue-700">4. Betalningsupplägg</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Input label="Första förfallodag" type="date" value={form.firstDueDate} onChange={event => updateForm('firstDueDate', event.target.value)} /><Input label="Antal delar" type="number" min="1" value={form.installmentCount} onChange={event => updateForm('installmentCount', event.target.value)} /><Input label="Intervall (mån)" type="number" min="1" value={form.intervalMonths} onChange={event => updateForm('intervalMonths', event.target.value)} /><Input label="Dag i månaden" type="number" min="1" max="31" value={form.dayOfMonth} onChange={event => updateForm('dayOfMonth', event.target.value)} /></div></section>
        <section className="grid gap-3 sm:grid-cols-2"><Textarea label="Villkor" rows={3} value={form.terms} onChange={event => updateForm('terms', event.target.value)} /><Textarea label="Interna anteckningar" rows={3} value={form.notes} onChange={event => updateForm('notes', event.target.value)} /></section>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-900 p-4 text-white"><div><p className="text-xs text-slate-300">Underlag totalt</p><p className="text-xl font-bold">{money(selectedInvoiceIds.reduce((sum, id) => { const invoice = invoices.find(item => item.id === id); return sum + Number(invoice?.balance_due ?? Number(invoice?.total_amount ?? 0) - Number(invoice?.paid_amount ?? 0)); }, 0) + externalInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0))}</p></div><Button onClick={createPlan} loading={saving}>Skapa plan för godkännande</Button></div>{error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}</div></Card>}
      {plans.length === 0 ? <Card><EmptyState title="Inga avbetalningsplaner" description="Skapa en plan från befintliga fakturor eller lägg in ett äldre externt underlag." /></Card> : filteredPlans.length === 0 ? <Card><EmptyState title="Inga träffar" description="Ändra sökningen eller statusfiltret." /></Card> : filteredPlans.map(plan => <button type="button" key={plan.id} onClick={() => void loadPlan(plan)} className={`w-full rounded-lg border bg-white p-4 text-left shadow-sm transition hover:border-blue-300 ${selectedPlan?.id === plan.id ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'}`}><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-950">{plan.plan_number}</p><p className="mt-1 text-sm text-slate-500">{plan.company?.name ?? 'Bolag'}{plan.customer ? ` · ${plan.customer.name}` : ''}</p></div><Badge className="bg-slate-100 text-slate-700">{statusLabel(plan.status)}</Badge></div><div className="mt-3 flex justify-between text-sm"><span>{money(Number(plan.remaining_amount))} kvar</span><span>{plan.installment_count} delar</span></div></button>)}
    </div>
    <Card>{!selectedPlan ? <EmptyState title="Välj en plan" description="Här visas betalningsplan, fördelningar och manuellt registrerade betalningar." /> : <div className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold uppercase tracking-wide text-blue-600">{selectedPlan.plan_number}</p><h2 className="mt-1 text-2xl font-bold text-slate-950">{selectedPlan.company?.name ?? 'Avbetalningsplan'}</h2><p className="text-sm text-slate-500">{selectedPlan.customer?.name ?? 'Ingen kund kopplad'}</p></div><div className="flex flex-wrap gap-2">{selectedPlan.status === 'pending_approval' && <Button size="sm" onClick={() => void changeStatus('active')}><CheckCircle2 className="h-4 w-4" />Godkänn</Button>}{selectedPlan.status === 'active' || selectedPlan.status === 'overdue' ? <Button size="sm" variant="secondary" onClick={() => void changeStatus('paused')}><Pause className="h-4 w-4" />Pausa</Button> : selectedPlan.status === 'paused' && <Button size="sm" variant="secondary" onClick={() => void changeStatus('active')}><Play className="h-4 w-4" />Återuppta</Button>}</div></div>
      <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Totalt</p><p className="mt-1 font-bold">{money(Number(selectedPlan.total_amount))}</p></div><div className="rounded-lg bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Betalt</p><p className="mt-1 font-bold text-emerald-900">{money(Number(selectedPlan.paid_amount))}</p></div><div className="rounded-lg bg-amber-50 p-3"><p className="text-xs text-amber-700">Kvar</p><p className="mt-1 font-bold text-amber-900">{money(Number(selectedPlan.remaining_amount))}</p></div></div>
      <div><h3 className="mb-2 font-bold text-slate-950">Betalningsplan</h3><div className="overflow-x-auto rounded-lg border border-slate-200"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Del</th><th className="p-3">Förfallodag</th><th className="p-3">Belopp</th><th className="p-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{schedule.map(row => <tr key={row.id}><td className="p-3">{row.installment_no}</td><td className="p-3">{row.due_date}</td><td className="p-3">{money(Number(row.amount))}</td><td className="p-3"><Badge className="bg-slate-100 text-slate-700">{row.status}</Badge></td></tr>)}</tbody></table></div></div>
      <div><h3 className="mb-2 font-bold text-slate-950">Registrera manuell betalning</h3><div className="grid gap-3 sm:grid-cols-2"><Input label="Belopp" type="number" min="0.01" step="0.01" value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} /><Input label="Betalningsdatum" type="date" value={paymentDate} onChange={event => setPaymentDate(event.target.value)} /><Select label="Metod" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)} options={[{ value: 'bank_transfer', label: 'Banköverföring' }, { value: 'card', label: 'Kort' }, { value: 'cash', label: 'Kontant' }, { value: 'swish', label: 'Swish' }, { value: 'other', label: 'Annat' }]} /><Input label="Referens" value={paymentReference} onChange={event => setPaymentReference(event.target.value)} /></div><Textarea label="Anteckning" rows={2} value={paymentNotes} onChange={event => setPaymentNotes(event.target.value)} /><Button className="mt-3" onClick={registerPayment} loading={saving} disabled={Number(paymentAmount) <= 0}><WalletCards className="h-4 w-4" />Registrera betalning</Button>{error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}</div>
      <div><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-slate-950">Underlag</h3><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50"><FileUp className="h-4 w-4" />Lägg till bilaga<input type="file" className="sr-only" onChange={uploadAttachment} /></label></div><div className="mt-2 space-y-2">{planInvoices.map(row => <div key={row.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm"><span>{row.description}</span><span>{money(Number(row.balance_remaining))} kvar</span></div>)}{documents.map(doc => <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm"><div><p className="font-semibold text-slate-900">{doc.title}</p><p className="text-xs text-slate-500">{doc.file_name} · {doc.document_type === 'payment_underlay' ? 'Betalningsunderlag' : 'Bilaga'}{doc.drive_file_id ? ' · Arkiverad i Drive' : ''}</p></div><Button size="sm" variant="secondary" onClick={() => void downloadDocument(doc)}><Download className="h-4 w-4" />Öppna</Button></div>)}</div><p className="mt-3 text-xs text-slate-500">Betalningar och underlag är administrativa. De ändrar inte originalfakturor och exporteras aldrig som bokföring.</p></div>
      <div><h3 className="mb-2 font-bold text-slate-950">Registrerade betalningar</h3>{payments.length === 0 ? <p className="text-sm text-slate-500">Inga betalningar registrerade ännu.</p> : <div className="space-y-2">{payments.map(payment => <div key={payment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm"><div><p className="font-semibold text-slate-900">{payment.payment_number} · {money(Number(payment.amount))}</p><p className="text-slate-500">{payment.payment_date} · {payment.payment_method}{payment.reference ? ` · ${payment.reference}` : ''}</p></div><Button size="sm" variant="secondary" onClick={() => void downloadPaymentUnderlay(payment)} loading={saving}><Download className="h-4 w-4" />Betalningsunderlag</Button></div>)}</div>}</div>
    </div>}</Card>
  </div>;
}
