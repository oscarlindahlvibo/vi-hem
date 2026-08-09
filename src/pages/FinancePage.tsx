import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, CalendarDays, CheckCircle2, CircleDollarSign, CreditCard, FileText, Hash, Landmark, Link2, Mail, Plus, Printer, ReceiptText, RotateCcw, Send, Truck, Upload, Users, WalletCards } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { buildInvoicePdfBlob } from '../lib/invoicePdf';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, Select, Textarea } from '../components/ui';
import type { AccountingIntegration, AccountingSyncQueueItem, CustomerProject, FinanceCompany, FinanceCustomer, FinanceReminderSettings, FinanceSupplier, Invoice, InvoiceEmailOutbox, InvoiceLine, InvoiceNumberSeries, Payment, ProjectInvoiceBasis, RentBillingItem, RentBillingRun, SupplierInvoice, SupplierInvoiceLine } from '../types';

interface FinancePageProps {
  onNavigate: (page: string) => void;
}

type FinanceTab = 'overview' | 'companies' | 'customers' | 'invoices' | 'payments' | 'email' | 'rent' | 'project-basis' | 'suppliers' | 'supplier-invoices' | 'number-series' | 'integrations';

const customerTypeOptions = [
  { value: 'company', label: 'Företag' },
  { value: 'private', label: 'Privatperson' },
  { value: 'brf', label: 'BRF' },
  { value: 'property_owner', label: 'Fastighetsägare' },
  { value: 'internal', label: 'Internt' },
];

const emptyCompanyForm = {
  name: '',
  legal_name: '',
  organisation_number: '',
  email: '',
  phone: '',
  invoice_prefix: '',
  default_payment_terms_days: '30',
};

const emptyCustomerForm = {
  company_id: '',
  customer_type: 'company',
  name: '',
  organisation_number: '',
  email: '',
  invoice_email: '',
  payment_terms_days: '30',
  notes: '',
};

const emptySupplierForm = {
  company_id: '',
  name: '',
  organisation_number: '',
  email: '',
  payment_terms_days: '30',
  default_account_code: '',
  notes: '',
};

const emptyInvoiceForm = {
  company_id: '',
  customer_id: '',
  invoice_date: new Date().toISOString().slice(0, 10),
  due_date: '',
  description: '',
  quantity: '1',
  unit_price: '0',
  vat_rate: '25',
  notes: '',
};

const emptyPaymentForm = {
  amount: '',
  payment_date: new Date().toISOString().slice(0, 10),
  reference: '',
};

const emptyPaymentImportForm = {
  company_id: '',
  source: 'bank' as Payment['source'],
  csv: '',
};

const emptyInvoiceEmailForm = {
  recipient_email: '',
  recipient_name: '',
  subject: '',
  message: '',
};

const emptyCreditInvoiceForm = {
  reason: '',
};

const emptySupplierInvoiceForm = {
  company_id: '',
  supplier_id: '',
  supplier_invoice_number: '',
  invoice_date: new Date().toISOString().slice(0, 10),
  due_date: '',
  description: '',
  quantity: '1',
  unit_price: '0',
  vat_rate: '25',
  account_code: '',
  notes: '',
};

const emptyProjectInvoiceForm = {
  basis_id: '',
  company_id: '',
  customer_id: '',
  invoice_date: new Date().toISOString().slice(0, 10),
  due_date: '',
};

const emptyRentRunForm = {
  company_id: '',
  rent_period: new Date().toISOString().slice(0, 7),
  include_existing: false,
};

const emptyNumberSeriesForm = {
  company_id: '',
  name: 'Standard',
  prefix: '',
  next_number: '1',
  padding: '4',
  fiscal_year: '',
  active: true,
};

const defaultReminderSettingsDraft = {
  enabled: true,
  first_after_days: '1',
  interval_days: '7',
  max_reminders: '3',
  reminder_fee: '0',
};

type ReminderSettingsDraft = typeof defaultReminderSettingsDraft;

function toNumber(value: string, fallback = 0) {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function formatCurrency(amount: number, currency = 'SEK') {
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency }).format(amount || 0);
}

function safePathPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/[ö]/g, 'o')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'faktura';
}

function parseDelimitedRows(text: string) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];

  const firstLine = normalized.split('\n')[0] || '';
  const delimiter = firstLine.includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      row.push(current.trim());
      current = '';
      continue;
    }

    if (char === '\n' && !quoted) {
      row.push(current.trim());
      rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  rows.push(row);

  const headers = (rows.shift() || []).map(header => header.trim().toLowerCase());
  return rows
    .filter(values => values.some(value => value.trim()))
    .map(values => headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = values[index] || '';
      return record;
    }, {}));
}

function invoiceStatusLabel(status: Invoice['status']) {
  const labels: Record<Invoice['status'], string> = {
    draft: 'Utkast',
    approved: 'Godkänd',
    sent: 'Skickad',
    partially_paid: 'Delbetald',
    paid: 'Betald',
    overdue: 'Försenad',
    credited: 'Krediterad',
    cancelled: 'Makulerad',
  };
  return labels[status] ?? status;
}

function rentRunStatusLabel(status: RentBillingRun['status']) {
  const labels: Record<RentBillingRun['status'], string> = {
    draft: 'Utkast',
    generated: 'Fakturor skapade',
    approved: 'Godkänd',
    sent: 'Skickad',
    cancelled: 'Makulerad',
  };
  return labels[status] ?? status;
}

function rentItemStatusLabel(status: RentBillingItem['status']) {
  const labels: Record<RentBillingItem['status'], string> = {
    draft: 'Utkast',
    invoiced: 'Fakturerad',
    skipped: 'Hoppas över',
    cancelled: 'Makulerad',
  };
  return labels[status] ?? status;
}

function paymentSourceLabel(source: Payment['source']) {
  const labels: Record<Payment['source'], string> = {
    manual: 'Manuell',
    accounting: 'Bokföring',
    bank: 'Bank',
    swish: 'Swish',
    autogiro: 'Autogiro',
  };
  return labels[source] ?? source;
}

function invoiceEmailStatusLabel(status: InvoiceEmailOutbox['status']) {
  const labels: Record<InvoiceEmailOutbox['status'], string> = {
    draft: 'Utkast',
    queued: 'Köad',
    sent: 'Skickad',
    failed: 'Misslyckad',
    cancelled: 'Avbruten',
  };
  return labels[status] ?? status;
}

function accountingSyncStatusLabel(status: AccountingSyncQueueItem['status']) {
  const labels: Record<AccountingSyncQueueItem['status'], string> = {
    queued: 'Köad',
    processing: 'Bearbetas',
    synced: 'Synkad',
    failed: 'Misslyckad',
    cancelled: 'Avbruten',
  };
  return labels[status] ?? status;
}

export function FinancePage({ onNavigate: _onNavigate }: FinancePageProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<FinanceTab>('overview');
  const [companies, setCompanies] = useState<FinanceCompany[]>([]);
  const [customers, setCustomers] = useState<FinanceCustomer[]>([]);
  const [suppliers, setSuppliers] = useState<FinanceSupplier[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoiceEmails, setInvoiceEmails] = useState<InvoiceEmailOutbox[]>([]);
  const [supplierInvoices, setSupplierInvoices] = useState<SupplierInvoice[]>([]);
  const [rentRuns, setRentRuns] = useState<RentBillingRun[]>([]);
  const [numberSeries, setNumberSeries] = useState<InvoiceNumberSeries[]>([]);
  const [integrations, setIntegrations] = useState<AccountingIntegration[]>([]);
  const [reminderSettings, setReminderSettings] = useState<FinanceReminderSettings[]>([]);
  const [reminderSettingsDrafts, setReminderSettingsDrafts] = useState<Record<string, ReminderSettingsDraft>>({});
  const [accountingQueue, setAccountingQueue] = useState<AccountingSyncQueueItem[]>([]);
  const [projectBases, setProjectBases] = useState<Array<ProjectInvoiceBasis & { project?: CustomerProject | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [invoiceDetailOpen, setInvoiceDetailOpen] = useState(false);
  const [invoiceEmailModalOpen, setInvoiceEmailModalOpen] = useState(false);
  const [creditInvoiceModalOpen, setCreditInvoiceModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentImportModalOpen, setPaymentImportModalOpen] = useState(false);
  const [supplierInvoiceModalOpen, setSupplierInvoiceModalOpen] = useState(false);
  const [supplierInvoiceDetailOpen, setSupplierInvoiceDetailOpen] = useState(false);
  const [projectInvoiceModalOpen, setProjectInvoiceModalOpen] = useState(false);
  const [rentRunModalOpen, setRentRunModalOpen] = useState(false);
  const [rentRunDetailOpen, setRentRunDetailOpen] = useState(false);
  const [numberSeriesModalOpen, setNumberSeriesModalOpen] = useState(false);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoiceForm);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [paymentImportForm, setPaymentImportForm] = useState(emptyPaymentImportForm);
  const [invoiceEmailForm, setInvoiceEmailForm] = useState(emptyInvoiceEmailForm);
  const [creditInvoiceForm, setCreditInvoiceForm] = useState(emptyCreditInvoiceForm);
  const [paymentImportResult, setPaymentImportResult] = useState('');
  const [supplierInvoiceForm, setSupplierInvoiceForm] = useState(emptySupplierInvoiceForm);
  const [supplierInvoiceReviewForm, setSupplierInvoiceReviewForm] = useState(emptySupplierInvoiceForm);
  const [supplierInvoiceFile, setSupplierInvoiceFile] = useState<File | null>(null);
  const [projectInvoiceForm, setProjectInvoiceForm] = useState(emptyProjectInvoiceForm);
  const [rentRunForm, setRentRunForm] = useState(emptyRentRunForm);
  const [numberSeriesForm, setNumberSeriesForm] = useState(emptyNumberSeriesForm);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [selectedInvoiceLines, setSelectedInvoiceLines] = useState<InvoiceLine[]>([]);
  const [selectedSupplierInvoice, setSelectedSupplierInvoice] = useState<SupplierInvoice | null>(null);
  const [selectedSupplierInvoiceLines, setSelectedSupplierInvoiceLines] = useState<SupplierInvoiceLine[]>([]);
  const [selectedRentRun, setSelectedRentRun] = useState<RentBillingRun | null>(null);
  const [selectedRentItems, setSelectedRentItems] = useState<RentBillingItem[]>([]);
  const [selectedNumberSeries, setSelectedNumberSeries] = useState<InvoiceNumberSeries | null>(null);
  const [selectedApprovalSeriesId, setSelectedApprovalSeriesId] = useState('');

  const organisationId = user?.organisation_id ?? null;

  const companyOptions = useMemo(() => {
    return [
      { value: '', label: 'Välj bolag' },
      ...companies.map(company => ({ value: company.id, label: company.name })),
    ];
  }, [companies]);

  const customerOptions = useMemo(() => {
    const scoped = invoiceForm.company_id
      ? customers.filter(customer => !customer.company_id || customer.company_id === invoiceForm.company_id)
      : customers;

    return [
      { value: '', label: 'Välj kund' },
      ...scoped.map(customer => ({ value: customer.id, label: customer.name })),
    ];
  }, [customers, invoiceForm.company_id]);

  const supplierOptions = useMemo(() => {
    const scoped = supplierInvoiceForm.company_id
      ? suppliers.filter(supplier => !supplier.company_id || supplier.company_id === supplierInvoiceForm.company_id)
      : suppliers;

    return [
      { value: '', label: 'Välj leverantör' },
      ...scoped.map(supplier => ({ value: supplier.id, label: supplier.name })),
    ];
  }, [suppliers, supplierInvoiceForm.company_id]);

  const selectedInvoiceSeriesOptions = useMemo(() => {
    const scopedSeries = selectedInvoice
      ? numberSeries.filter(series => series.company_id === selectedInvoice.company_id && series.active)
      : [];

    return [
      { value: '', label: scopedSeries.length > 0 ? 'Automatisk serie' : 'Ingen aktiv serie finns' },
      ...scopedSeries.map(series => ({
        value: series.id,
        label: `${series.name} · ${series.prefix || 'utan prefix'}${String(series.next_number).padStart(series.padding, '0')}`,
      })),
    ];
  }, [numberSeries, selectedInvoice]);

  const openAmount = useMemo(() => {
    return invoices
      .filter(invoice => !['paid', 'credited', 'cancelled'].includes(invoice.status))
      .reduce((sum, invoice) => sum + Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0), 0);
  }, [invoices]);

  const draftCount = invoices.filter(invoice => invoice.status === 'draft').length;
  const queuedEmailCount = invoiceEmails.filter(email => email.status === 'queued').length;

  const paidAmount = useMemo(() => {
    return payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  }, [payments]);

  const selectedInvoiceCanBeCredited = Boolean(
    selectedInvoice &&
    !selectedInvoice.original_invoice_id &&
    !selectedInvoice.credited_by_invoice_id &&
    ['approved', 'sent', 'partially_paid', 'paid', 'overdue'].includes(selectedInvoice.status),
  );

  const loadFinance = useCallback(async () => {
    if (!organisationId) return;
    setLoading(true);
    setError('');

    const [companyResult, customerResult, supplierResult, invoiceResult, paymentResult, invoiceEmailResult, supplierInvoiceResult, integrationResult, reminderSettingsResult, accountingQueueResult, projectBasisResult, rentRunResult, numberSeriesResult] = await Promise.all([
      supabase
        .from('vihem_companies')
        .select('*')
        .eq('organisation_id', organisationId)
        .order('name', { ascending: true }),
      supabase
        .from('vihem_finance_customers')
        .select('*, company:company_id(*)')
        .eq('organisation_id', organisationId)
        .order('name', { ascending: true }),
      supabase
        .from('vihem_finance_suppliers')
        .select('*, company:company_id(*)')
        .eq('organisation_id', organisationId)
        .order('name', { ascending: true }),
      supabase
        .from('vihem_invoices')
        .select('*, company:company_id(*), customer:customer_id(*)')
        .eq('organisation_id', organisationId)
        .order('created_at', { ascending: false }),
      supabase
        .from('vihem_payments')
        .select('*, company:company_id(*), invoice:invoice_id(*, customer:customer_id(*))')
        .eq('organisation_id', organisationId)
        .order('payment_date', { ascending: false }),
      supabase
        .from('vihem_invoice_email_outbox')
        .select('*, company:company_id(*), invoice:invoice_id(*, customer:customer_id(*))')
        .eq('organisation_id', organisationId)
        .order('created_at', { ascending: false }),
      supabase
        .from('vihem_supplier_invoices')
        .select('*, company:company_id(*), supplier:supplier_id(*)')
        .eq('organisation_id', organisationId)
        .order('due_date', { ascending: true }),
      supabase
        .from('vihem_accounting_integrations')
        .select('*')
        .eq('organisation_id', organisationId)
        .order('created_at', { ascending: true }),
      supabase
        .from('vihem_finance_reminder_settings')
        .select('*, company:company_id(*)')
        .eq('organisation_id', organisationId)
        .order('created_at', { ascending: true }),
      supabase
        .from('vihem_accounting_sync_queue')
        .select('*, company:company_id(*), integration:integration_id(*)')
        .eq('organisation_id', organisationId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('vihem_project_invoice_basis')
        .select('*, lines:vihem_project_invoice_basis_lines(*), project:project_id(*)')
        .in('status', ['draft', 'ready_for_invoicing'])
        .order('created_at', { ascending: false }),
      supabase
        .from('vihem_rent_billing_runs')
        .select('*, company:company_id(*)')
        .eq('organisation_id', organisationId)
        .order('rent_period', { ascending: false }),
      supabase
        .from('vihem_invoice_number_series')
        .select('*, company:company_id(*)')
        .eq('organisation_id', organisationId)
        .order('created_at', { ascending: true }),
    ]);

    const firstError = companyResult.error ?? customerResult.error ?? supplierResult.error ?? invoiceResult.error ?? paymentResult.error ?? invoiceEmailResult.error ?? supplierInvoiceResult.error ?? integrationResult.error ?? reminderSettingsResult.error ?? accountingQueueResult.error ?? projectBasisResult.error ?? rentRunResult.error ?? numberSeriesResult.error;
    if (firstError) {
      setError(firstError.message.includes('schema cache')
        ? 'Databasen saknar ekonomitabellerna ännu. Kör senaste Supabase-migreringarna och ladda om appen.'
        : firstError.message);
      setLoading(false);
      return;
    }

    setCompanies((companyResult.data ?? []) as FinanceCompany[]);
    setCustomers((customerResult.data ?? []) as FinanceCustomer[]);
    setSuppliers((supplierResult.data ?? []) as FinanceSupplier[]);
    setInvoices((invoiceResult.data ?? []) as Invoice[]);
    setPayments((paymentResult.data ?? []) as Payment[]);
    setInvoiceEmails((invoiceEmailResult.data ?? []) as InvoiceEmailOutbox[]);
    setSupplierInvoices((supplierInvoiceResult.data ?? []) as SupplierInvoice[]);
    setIntegrations((integrationResult.data ?? []) as AccountingIntegration[]);
    const nextReminderSettings = (reminderSettingsResult.data ?? []) as FinanceReminderSettings[];
    setReminderSettings(nextReminderSettings);
    setReminderSettingsDrafts(
      (companyResult.data ?? []).reduce<Record<string, ReminderSettingsDraft>>((drafts, company) => {
        const setting = nextReminderSettings.find(item => item.company_id === company.id);
        drafts[company.id] = {
          enabled: setting?.enabled ?? true,
          first_after_days: String(setting?.first_after_days ?? 1),
          interval_days: String(setting?.interval_days ?? 7),
          max_reminders: String(setting?.max_reminders ?? 3),
          reminder_fee: String(setting?.reminder_fee ?? 0),
        };
        return drafts;
      }, {}),
    );
    setAccountingQueue((accountingQueueResult.data ?? []) as AccountingSyncQueueItem[]);
    setProjectBases((projectBasisResult.data ?? []) as Array<ProjectInvoiceBasis & { project?: CustomerProject | null }>);
    setRentRuns((rentRunResult.data ?? []) as RentBillingRun[]);
    setNumberSeries((numberSeriesResult.data ?? []) as InvoiceNumberSeries[]);
    setLoading(false);
  }, [organisationId]);

  useEffect(() => {
    void loadFinance();
  }, [loadFinance]);

  const resetCompanyForm = () => setCompanyForm(emptyCompanyForm);
  const resetCustomerForm = () => setCustomerForm({ ...emptyCustomerForm, company_id: companies[0]?.id ?? '' });
  const resetSupplierForm = () => setSupplierForm({ ...emptySupplierForm, company_id: companies[0]?.id ?? '' });
  const resetInvoiceForm = () => {
    const company = companies[0];
    const invoiceDate = new Date().toISOString().slice(0, 10);
    setInvoiceForm({
      ...emptyInvoiceForm,
      company_id: company?.id ?? '',
      invoice_date: invoiceDate,
      due_date: addDays(invoiceDate, company?.default_payment_terms_days ?? 30),
    });
  };

  const resetSupplierInvoiceForm = () => {
    const company = companies[0];
    const invoiceDate = new Date().toISOString().slice(0, 10);
    setSupplierInvoiceForm({
      ...emptySupplierInvoiceForm,
      company_id: company?.id ?? '',
      invoice_date: invoiceDate,
      due_date: addDays(invoiceDate, 30),
    });
    setSupplierInvoiceFile(null);
  };

  const resetProjectInvoiceForm = (basis?: ProjectInvoiceBasis & { project?: CustomerProject | null }) => {
    const company = companies.find(item => item.id === basis?.project?.company_id) ?? companies[0];
    const invoiceDate = new Date().toISOString().slice(0, 10);
    setProjectInvoiceForm({
      ...emptyProjectInvoiceForm,
      basis_id: basis?.id ?? '',
      company_id: company?.id ?? '',
      invoice_date: invoiceDate,
      due_date: addDays(invoiceDate, 30),
    });
  };

  const resetRentRunForm = () => {
    setRentRunForm({
      ...emptyRentRunForm,
      company_id: companies[0]?.id ?? '',
      rent_period: new Date().toISOString().slice(0, 7),
    });
  };

  const resetNumberSeriesForm = (series?: InvoiceNumberSeries) => {
    setSelectedNumberSeries(series ?? null);
    setNumberSeriesForm({
      ...emptyNumberSeriesForm,
      company_id: series?.company_id ?? companies[0]?.id ?? '',
      name: series?.name ?? 'Standard',
      prefix: series?.prefix ?? companies[0]?.invoice_prefix ?? '',
      next_number: String(series?.next_number ?? 1),
      padding: String(series?.padding ?? 4),
      fiscal_year: series?.fiscal_year ? String(series.fiscal_year) : '',
      active: series?.active ?? true,
    });
  };

  const resetPaymentImportForm = () => {
    setPaymentImportForm({
      ...emptyPaymentImportForm,
      company_id: companies[0]?.id ?? '',
    });
    setPaymentImportResult('');
  };

  const resetInvoiceEmailForm = (invoice: Invoice) => {
    const recipientEmail = invoice.customer?.invoice_email || invoice.customer?.email || '';
    const recipientName = invoice.customer?.name || '';
    const invoiceLabel = invoice.invoice_number || invoice.id.slice(0, 8);

    setInvoiceEmailForm({
      recipient_email: recipientEmail,
      recipient_name: recipientName,
      subject: `Faktura ${invoiceLabel}`,
      message: `Hej ${recipientName || ''}!\n\nHär kommer faktura ${invoiceLabel} som PDF.\n\nVänliga hälsningar\n${invoice.company?.name || 'VI-HEM'}`,
    });
  };

  const createCompany = async () => {
    if (!organisationId || !companyForm.name.trim()) return;
    setSaving(true);
    setError('');

    const { data, error: companyError } = await supabase
      .from('vihem_companies')
      .insert({
        organisation_id: organisationId,
        name: companyForm.name.trim(),
        legal_name: companyForm.legal_name.trim() || companyForm.name.trim(),
        organisation_number: companyForm.organisation_number.trim(),
        email: companyForm.email.trim(),
        phone: companyForm.phone.trim(),
        invoice_prefix: companyForm.invoice_prefix.trim().toUpperCase(),
        default_payment_terms_days: Math.max(0, Math.round(toNumber(companyForm.default_payment_terms_days, 30))),
        created_by: user?.id ?? null,
        updated_by: user?.id ?? null,
      })
      .select('*')
      .single();

    if (companyError) {
      setError(companyError.message);
      setSaving(false);
      return;
    }

    if (data) {
      await supabase.from('vihem_invoice_number_series').insert({
        organisation_id: organisationId,
        company_id: data.id,
        name: 'Standard',
        prefix: data.invoice_prefix || 'F',
        padding: 4,
      });
    }

    setCompanyModalOpen(false);
    resetCompanyForm();
    setSaving(false);
    await loadFinance();
  };

  const createCustomer = async () => {
    if (!organisationId || !customerForm.name.trim()) return;
    setSaving(true);
    setError('');

    const { error: customerError } = await supabase
      .from('vihem_finance_customers')
      .insert({
        organisation_id: organisationId,
        company_id: customerForm.company_id || null,
        customer_type: customerForm.customer_type,
        name: customerForm.name.trim(),
        organisation_number: customerForm.organisation_number.trim(),
        email: customerForm.email.trim(),
        invoice_email: customerForm.invoice_email.trim() || customerForm.email.trim(),
        payment_terms_days: Math.max(0, Math.round(toNumber(customerForm.payment_terms_days, 30))),
        notes: customerForm.notes.trim(),
        created_by: user?.id ?? null,
      });

    if (customerError) {
      setError(customerError.message);
      setSaving(false);
      return;
    }

    setCustomerModalOpen(false);
    resetCustomerForm();
    setSaving(false);
    await loadFinance();
  };

  const createSupplier = async () => {
    if (!organisationId || !supplierForm.name.trim()) return;
    setSaving(true);
    setError('');

    const { error: supplierError } = await supabase
      .from('vihem_finance_suppliers')
      .insert({
        organisation_id: organisationId,
        company_id: supplierForm.company_id || null,
        name: supplierForm.name.trim(),
        organisation_number: supplierForm.organisation_number.trim(),
        email: supplierForm.email.trim(),
        payment_terms_days: Math.max(0, Math.round(toNumber(supplierForm.payment_terms_days, 30))),
        default_account_code: supplierForm.default_account_code.trim(),
        notes: supplierForm.notes.trim(),
        created_by: user?.id ?? null,
      });

    if (supplierError) {
      setError(supplierError.message);
      setSaving(false);
      return;
    }

    setSupplierModalOpen(false);
    resetSupplierForm();
    setSaving(false);
    await loadFinance();
  };

  const createInvoice = async () => {
    if (!organisationId || !invoiceForm.company_id || !invoiceForm.customer_id || !invoiceForm.description.trim()) return;
    setSaving(true);
    setError('');

    const quantity = toNumber(invoiceForm.quantity, 1);
    const unitPrice = toNumber(invoiceForm.unit_price, 0);
    const vatRate = toNumber(invoiceForm.vat_rate, 25);
    const subtotal = Math.round(quantity * unitPrice * 100) / 100;
    const vat = Math.round(subtotal * (vatRate / 100) * 100) / 100;
    const total = subtotal + vat;
    const selectedCustomer = customers.find(customer => customer.id === invoiceForm.customer_id);
    const terms = selectedCustomer?.payment_terms_days ?? 30;
    const invoiceDate = invoiceForm.invoice_date || new Date().toISOString().slice(0, 10);
    const dueDate = invoiceForm.due_date || addDays(invoiceDate, terms);

    const { data: invoice, error: invoiceError } = await supabase
      .from('vihem_invoices')
      .insert({
        organisation_id: organisationId,
        company_id: invoiceForm.company_id,
        customer_id: invoiceForm.customer_id,
        invoice_date: invoiceDate,
        due_date: dueDate,
        payment_terms_days: terms,
        status: 'draft',
        subtotal_amount: subtotal,
        vat_amount: vat,
        total_amount: total,
        notes: invoiceForm.notes.trim(),
        created_by: user?.id ?? null,
      })
      .select('*')
      .single();

    if (invoiceError || !invoice) {
      setError(invoiceError?.message ?? 'Kunde inte skapa fakturan.');
      setSaving(false);
      return;
    }

    const { error: lineError } = await supabase
      .from('vihem_invoice_lines')
      .insert({
        organisation_id: organisationId,
        company_id: invoiceForm.company_id,
        invoice_id: invoice.id,
        line_no: 1,
        description: invoiceForm.description.trim(),
        quantity,
        unit_price: unitPrice,
        vat_rate: vatRate,
        line_total_excl_vat: subtotal,
        vat_amount: vat,
        line_total_incl_vat: total,
      });

    if (lineError) {
      setError(lineError.message);
      setSaving(false);
      return;
    }

    setInvoiceModalOpen(false);
    resetInvoiceForm();
    setSaving(false);
    await loadFinance();
  };

  const attachSupplierInvoiceDocument = async (supplierInvoice: SupplierInvoice, file: File) => {
    if (!organisationId) return true;

    const extension = file.name.includes('.') ? file.name.split('.').pop() || 'pdf' : 'pdf';
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const fileName = `${safePathPart(baseName)}.${safePathPart(extension)}`;
    const storagePath = `${organisationId}/supplier-invoices/${supplierInvoice.id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('vihem-documents')
      .upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: true,
      });

    if (uploadError) {
      setError(uploadError.message.toLowerCase().includes('bucket')
        ? 'Storage-bucketen vihem-documents saknas. Kör senaste Supabase-migreringarna först.'
        : uploadError.message);
      return false;
    }

    const { data: documentRow, error: documentError } = await supabase
      .from('vihem_documents')
      .insert({
        organisation_id: organisationId,
        title: `Leverantörsfaktura ${supplierInvoice.supplier_invoice_number || supplierInvoice.id.slice(0, 8)}`,
        file_url: '',
        file_name: file.name,
        file_size: file.size,
        document_type: 'invoice',
        company_id: supplierInvoice.company_id,
        document_category: 'supplier_invoice',
        contract_status: 'not_applicable',
        visibility: 'admin',
        tenant_id: null,
        property_id: null,
        apartment_id: null,
        storage_bucket: 'vihem-documents',
        storage_path: storagePath,
        description: 'Bilaga till leverantörsfaktura',
        created_by: user?.id ?? null,
      })
      .select('id')
      .single();

    if (documentError) {
      setError(documentError.message);
      return false;
    }

    const { error: updateError } = await supabase
      .from('vihem_supplier_invoices')
      .update({
        document_id: documentRow.id,
        ocr_status: 'queued',
        ocr_data: {
          file_name: file.name,
          content_type: file.type || 'application/octet-stream',
          storage_path: storagePath,
          queued_at: new Date().toISOString(),
        },
      })
      .eq('id', supplierInvoice.id);

    if (updateError) {
      setError(updateError.message);
      return false;
    }

    return true;
  };

  const createSupplierInvoice = async () => {
    if (!organisationId || !supplierInvoiceForm.company_id || !supplierInvoiceForm.description.trim()) return;
    setSaving(true);
    setError('');

    const quantity = toNumber(supplierInvoiceForm.quantity, 1);
    const unitPrice = toNumber(supplierInvoiceForm.unit_price, 0);
    const vatRate = toNumber(supplierInvoiceForm.vat_rate, 25);
    const subtotal = Math.round(quantity * unitPrice * 100) / 100;
    const vat = Math.round(subtotal * (vatRate / 100) * 100) / 100;
    const total = subtotal + vat;

    const { data: supplierInvoice, error: supplierInvoiceError } = await supabase
      .from('vihem_supplier_invoices')
      .insert({
        organisation_id: organisationId,
        company_id: supplierInvoiceForm.company_id,
        supplier_id: supplierInvoiceForm.supplier_id || null,
        supplier_invoice_number: supplierInvoiceForm.supplier_invoice_number.trim(),
        invoice_date: supplierInvoiceForm.invoice_date,
        due_date: supplierInvoiceForm.due_date || addDays(supplierInvoiceForm.invoice_date, 30),
        status: 'needs_review',
        approval_status: 'pending',
        subtotal_amount: subtotal,
        vat_amount: vat,
        total_amount: total,
        notes: supplierInvoiceForm.notes.trim(),
        created_by: user?.id ?? null,
      })
      .select('*')
      .single();

    if (supplierInvoiceError || !supplierInvoice) {
      setError(supplierInvoiceError?.message ?? 'Kunde inte skapa leverantörsfakturan.');
      setSaving(false);
      return;
    }

    const { error: lineError } = await supabase
      .from('vihem_supplier_invoice_lines')
      .insert({
        organisation_id: organisationId,
        company_id: supplierInvoiceForm.company_id,
        supplier_invoice_id: supplierInvoice.id,
        line_no: 1,
        description: supplierInvoiceForm.description.trim(),
        quantity,
        unit_price: unitPrice,
        vat_rate: vatRate,
        account_code: supplierInvoiceForm.account_code.trim(),
        line_total_excl_vat: subtotal,
        vat_amount: vat,
        line_total_incl_vat: total,
      });

    if (lineError) {
      setError(lineError.message);
      setSaving(false);
      return;
    }

    if (supplierInvoiceFile) {
      const attached = await attachSupplierInvoiceDocument(supplierInvoice as SupplierInvoice, supplierInvoiceFile);
      if (!attached) {
        setSaving(false);
        return;
      }
    }

    setSupplierInvoiceModalOpen(false);
    resetSupplierInvoiceForm();
    setSaving(false);
    await loadFinance();
  };

  const openSupplierInvoiceDetail = async (supplierInvoice: SupplierInvoice) => {
    setSelectedSupplierInvoice(supplierInvoice);
    setSelectedSupplierInvoiceLines([]);
    setSupplierInvoiceFile(null);
    setError('');

    const { data: lines, error: lineError } = await supabase
      .from('vihem_supplier_invoice_lines')
      .select('*')
      .eq('supplier_invoice_id', supplierInvoice.id)
      .order('line_no', { ascending: true });

    if (lineError) {
      setError(lineError.message);
      return;
    }

    const firstLine = (lines?.[0] ?? null) as SupplierInvoiceLine | null;
    setSelectedSupplierInvoiceLines((lines ?? []) as SupplierInvoiceLine[]);
    setSupplierInvoiceReviewForm({
      company_id: supplierInvoice.company_id,
      supplier_id: supplierInvoice.supplier_id ?? '',
      supplier_invoice_number: supplierInvoice.supplier_invoice_number,
      invoice_date: supplierInvoice.invoice_date,
      due_date: supplierInvoice.due_date,
      description: firstLine?.description ?? '',
      quantity: String(firstLine?.quantity ?? 1),
      unit_price: String(firstLine?.unit_price ?? 0),
      vat_rate: String(firstLine?.vat_rate ?? 25),
      account_code: firstLine?.account_code ?? '',
      notes: supplierInvoice.notes,
    });
    setSupplierInvoiceDetailOpen(true);
  };

  const saveSupplierInvoiceReview = async () => {
    if (!organisationId || !selectedSupplierInvoice || !supplierInvoiceReviewForm.company_id || !supplierInvoiceReviewForm.description.trim()) return;
    setSaving(true);
    setError('');

    const quantity = toNumber(supplierInvoiceReviewForm.quantity, 1);
    const unitPrice = toNumber(supplierInvoiceReviewForm.unit_price, 0);
    const vatRate = toNumber(supplierInvoiceReviewForm.vat_rate, 25);
    const subtotal = Math.round(quantity * unitPrice * 100) / 100;
    const vat = Math.round(subtotal * (vatRate / 100) * 100) / 100;
    const total = subtotal + vat;

    const { data: updatedInvoice, error: invoiceError } = await supabase
      .from('vihem_supplier_invoices')
      .update({
        company_id: supplierInvoiceReviewForm.company_id,
        supplier_id: supplierInvoiceReviewForm.supplier_id || null,
        supplier_invoice_number: supplierInvoiceReviewForm.supplier_invoice_number.trim(),
        invoice_date: supplierInvoiceReviewForm.invoice_date,
        due_date: supplierInvoiceReviewForm.due_date || addDays(supplierInvoiceReviewForm.invoice_date, 30),
        subtotal_amount: subtotal,
        vat_amount: vat,
        total_amount: total,
        notes: supplierInvoiceReviewForm.notes.trim(),
      })
      .eq('id', selectedSupplierInvoice.id)
      .select('*, company:company_id(*), supplier:supplier_id(*)')
      .single();

    if (invoiceError || !updatedInvoice) {
      setError(invoiceError?.message ?? 'Kunde inte spara leverantörsfakturan.');
      setSaving(false);
      return;
    }

    const firstLine = selectedSupplierInvoiceLines[0];
    const linePayload = {
      organisation_id: organisationId,
      company_id: supplierInvoiceReviewForm.company_id,
      supplier_invoice_id: selectedSupplierInvoice.id,
      line_no: 1,
      description: supplierInvoiceReviewForm.description.trim(),
      quantity,
      unit_price: unitPrice,
      vat_rate: vatRate,
      account_code: supplierInvoiceReviewForm.account_code.trim(),
      line_total_excl_vat: subtotal,
      vat_amount: vat,
      line_total_incl_vat: total,
    };

    const lineRequest = firstLine
      ? supabase.from('vihem_supplier_invoice_lines').update(linePayload).eq('id', firstLine.id)
      : supabase.from('vihem_supplier_invoice_lines').insert(linePayload);

    const { error: lineError } = await lineRequest;

    if (lineError) {
      setError(lineError.message);
      setSaving(false);
      return;
    }

    if (supplierInvoiceFile) {
      const attached = await attachSupplierInvoiceDocument(updatedInvoice as SupplierInvoice, supplierInvoiceFile);
      if (!attached) {
        setSaving(false);
        return;
      }
    }

    setSelectedSupplierInvoice(updatedInvoice as SupplierInvoice);
    setSupplierInvoiceFile(null);
    await openSupplierInvoiceDetail(updatedInvoice as SupplierInvoice);
    await loadFinance();
    setSaving(false);
  };

  const approveSupplierInvoice = async (supplierInvoiceId: string) => {
    setSaving(true);
    setError('');

    const { error: approveError } = await supabase.rpc('vihem_approve_supplier_invoice', {
      target_supplier_invoice_id: supplierInvoiceId,
    });

    if (approveError) setError(approveError.message);
    setSaving(false);
    await loadFinance();
  };

  const scheduleSupplierInvoicePayment = async (supplierInvoiceId: string) => {
    setSaving(true);
    setError('');

    const { data, error: scheduleError } = await supabase.rpc('vihem_schedule_supplier_invoice_payment', {
      target_supplier_invoice_id: supplierInvoiceId,
    });

    if (scheduleError) {
      setError(scheduleError.message);
      setSaving(false);
      return;
    }

    const updatedInvoice = (Array.isArray(data) ? data[0] : data) as SupplierInvoice | null;
    if (updatedInvoice) setSelectedSupplierInvoice(updatedInvoice);
    setSaving(false);
    await loadFinance();
  };

  const markSupplierInvoicePaid = async (supplierInvoiceId: string) => {
    setSaving(true);
    setError('');

    const { data, error: paidError } = await supabase.rpc('vihem_mark_supplier_invoice_paid', {
      target_supplier_invoice_id: supplierInvoiceId,
      paid_date: new Date().toISOString().slice(0, 10),
    });

    if (paidError) {
      setError(paidError.message);
      setSaving(false);
      return;
    }

    const updatedInvoice = (Array.isArray(data) ? data[0] : data) as SupplierInvoice | null;
    if (updatedInvoice) setSelectedSupplierInvoice(updatedInvoice);
    setSaving(false);
    await loadFinance();
  };

  const processSupplierInvoiceOcrQueue = async () => {
    setSaving(true);
    setError('');

    const { data, error: ocrError } = await supabase.functions.invoke('vihem-process-supplier-invoice-ocr', {
      body: { limit: 25 },
    });

    if (ocrError || data?.error) {
      setError(data?.error || ocrError?.message || 'Kunde inte behandla OCR-kön.');
      setSaving(false);
      return;
    }

    setSaving(false);
    await loadFinance();
  };

  const ensureIntegration = async (companyId: string, provider: AccountingIntegration['provider']) => {
    if (!organisationId || !companyId) return;
    setSaving(true);
    setError('');

    const { error: integrationError } = await supabase
      .from('vihem_accounting_integrations')
      .upsert({
        organisation_id: organisationId,
        company_id: companyId,
        provider,
        status: provider === 'none' ? 'not_configured' : 'paused',
        config: {},
      }, { onConflict: 'company_id,provider' });

    if (integrationError) setError(integrationError.message);
    setSaving(false);
    await loadFinance();
  };

  const updateReminderSettingsDraft = (companyId: string, patch: Partial<ReminderSettingsDraft>) => {
    setReminderSettingsDrafts(prev => ({
      ...prev,
      [companyId]: {
        ...(prev[companyId] ?? defaultReminderSettingsDraft),
        ...patch,
      },
    }));
  };

  const saveReminderSettings = async (company: FinanceCompany) => {
    if (!organisationId) return;
    const draft = reminderSettingsDrafts[company.id] ?? defaultReminderSettingsDraft;
    setSaving(true);
    setError('');

    const { error: settingsError } = await supabase
      .from('vihem_finance_reminder_settings')
      .upsert({
        organisation_id: organisationId,
        company_id: company.id,
        enabled: draft.enabled,
        first_after_days: Math.max(0, Math.round(toNumber(draft.first_after_days, 1))),
        interval_days: Math.max(1, Math.round(toNumber(draft.interval_days, 7))),
        max_reminders: Math.max(0, Math.round(toNumber(draft.max_reminders, 3))),
        reminder_fee: Math.max(0, toNumber(draft.reminder_fee, 0)),
        created_by: user?.id ?? null,
      }, { onConflict: 'company_id' });

    if (settingsError) setError(settingsError.message);
    setSaving(false);
    await loadFinance();
  };

  const queueSelectedInvoiceAccountingSync = async () => {
    if (!selectedInvoice) return;
    setSaving(true);
    setError('');

    const { error: syncError } = await supabase.rpc('vihem_queue_invoice_accounting_sync', {
      target_invoice_id: selectedInvoice.id,
    });

    if (syncError) {
      setError(syncError.message);
      setSaving(false);
      return;
    }

    await refreshSelectedInvoice(selectedInvoice.id);
    await loadFinance();
    setSaving(false);
  };

  const updateAccountingQueueStatus = async (
    queueId: string,
    status: AccountingSyncQueueItem['status'],
    errorMessage = '',
  ) => {
    setSaving(true);
    setError('');

    const { error: queueError } = await supabase.rpc('vihem_update_accounting_sync_queue_status', {
      target_queue_id: queueId,
      target_status: status,
      target_external_id: '',
      target_error_message: errorMessage,
    });

    if (queueError) {
      setError(queueError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    await loadFinance();
  };

  const exportAccountingQueueCsv = async () => {
    setSaving(true);
    setError('');

    const { data, error: exportError } = await supabase.functions.invoke('vihem-export-accounting-csv', {
      body: { statuses: ['queued', 'processing'] },
    });

    if (exportError || data?.error) {
      setError(data?.error || exportError?.message || 'Kunde inte exportera bokföringskön.');
      setSaving(false);
      return;
    }

    const csv = String(data?.csv || '');
    const filename = String(data?.filename || 'vihem-bokforing.csv');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setSaving(false);
  };

  const createInvoiceFromProjectBasis = async () => {
    if (!projectInvoiceForm.basis_id || !projectInvoiceForm.company_id || !projectInvoiceForm.customer_id) return;
    setSaving(true);
    setError('');

    const { data, error: conversionError } = await supabase.rpc('vihem_create_invoice_from_project_basis', {
      target_basis_id: projectInvoiceForm.basis_id,
      target_company_id: projectInvoiceForm.company_id,
      target_customer_id: projectInvoiceForm.customer_id,
      invoice_date: projectInvoiceForm.invoice_date,
      due_date: projectInvoiceForm.due_date || null,
    });

    if (conversionError) {
      setError(conversionError.message);
      setSaving(false);
      return;
    }

    const invoice = (Array.isArray(data) ? data[0] : data) as Invoice | null;
    setProjectInvoiceModalOpen(false);
    setSaving(false);
    await loadFinance();
    if (invoice) {
      setActiveTab('invoices');
      const hydrated = await refreshSelectedInvoice(invoice.id);
      if (hydrated) await openInvoiceDetail(hydrated);
    }
  };

  const createRentRun = async () => {
    if (!rentRunForm.company_id || !rentRunForm.rent_period) return;
    setSaving(true);
    setError('');

    const { error: rentError } = await supabase.rpc('vihem_create_rent_billing_run', {
      target_company_id: rentRunForm.company_id,
      target_rent_period: `${rentRunForm.rent_period}-01`,
      include_existing: rentRunForm.include_existing,
    });

    if (rentError) {
      setError(rentError.message);
      setSaving(false);
      return;
    }

    setRentRunModalOpen(false);
    setSaving(false);
    setActiveTab('rent');
    await loadFinance();
  };

  const saveNumberSeries = async () => {
    if (!organisationId || !numberSeriesForm.company_id || !numberSeriesForm.name.trim()) return;
    setSaving(true);
    setError('');

    const payload = {
      organisation_id: organisationId,
      company_id: numberSeriesForm.company_id,
      name: numberSeriesForm.name.trim(),
      prefix: numberSeriesForm.prefix.trim().toUpperCase(),
      next_number: Math.max(1, Math.round(toNumber(numberSeriesForm.next_number, 1))),
      padding: Math.max(0, Math.round(toNumber(numberSeriesForm.padding, 4))),
      fiscal_year: numberSeriesForm.fiscal_year ? Math.round(toNumber(numberSeriesForm.fiscal_year, new Date().getFullYear())) : null,
      active: numberSeriesForm.active,
    };

    const request = selectedNumberSeries
      ? supabase
          .from('vihem_invoice_number_series')
          .update(payload)
          .eq('id', selectedNumberSeries.id)
      : supabase
          .from('vihem_invoice_number_series')
          .insert(payload);

    const { error: seriesError } = await request;

    if (seriesError) {
      setError(seriesError.message);
      setSaving(false);
      return;
    }

    setNumberSeriesModalOpen(false);
    resetNumberSeriesForm();
    setSaving(false);
    await loadFinance();
  };

  const generateRentInvoices = async (runId: string) => {
    setSaving(true);
    setError('');

    const { error: generateError } = await supabase.rpc('vihem_generate_rent_invoices', {
      target_run_id: runId,
    });

    if (generateError) {
      setError(generateError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    await loadFinance();
  };

  const refreshRentRun = async (runId: string) => {
    const { data, error: runError } = await supabase
      .from('vihem_rent_billing_runs')
      .select('*, company:company_id(*)')
      .eq('id', runId)
      .single();

    if (runError) {
      setError(runError.message);
      return null;
    }

    const run = data as RentBillingRun;
    setSelectedRentRun(run);
    setRentRuns(prev => prev.map(item => item.id === run.id ? run : item));
    return run;
  };

  const openRentRunDetail = async (run: RentBillingRun) => {
    setSelectedRentRun(run);
    setSelectedRentItems([]);
    setRentRunDetailOpen(true);
    setError('');

    const { data, error: itemError } = await supabase
      .from('vihem_rent_billing_items')
      .select('*, tenant:tenant_id(*), property:property_id(*), apartment:apartment_id(*), invoice:invoice_id(*)')
      .eq('run_id', run.id)
      .order('created_at', { ascending: true });

    if (itemError) {
      setError(itemError.message);
      return;
    }

    setSelectedRentItems((data ?? []) as RentBillingItem[]);
  };

  const updateRentItemStatus = async (item: RentBillingItem, status: RentBillingItem['status']) => {
    setSaving(true);
    setError('');

    const { error: updateError } = await supabase
      .from('vihem_rent_billing_items')
      .update({
        status,
        skip_reason: status === 'skipped' ? 'Hoppas över i denna hyreskörning' : '',
      })
      .eq('id', item.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    const run = selectedRentRun ? await refreshRentRun(selectedRentRun.id) : null;
    if (run) await openRentRunDetail(run);
    await loadFinance();
    setSaving(false);
  };

  const openInvoiceDetail = async (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setSelectedInvoiceLines([]);
    setSelectedApprovalSeriesId('');
    setInvoiceDetailOpen(true);
    setError('');

    const { data, error: lineError } = await supabase
      .from('vihem_invoice_lines')
      .select('*')
      .eq('invoice_id', invoice.id)
      .order('line_no', { ascending: true });

    if (lineError) {
      setError(lineError.message);
      return;
    }

    setSelectedInvoiceLines((data ?? []) as InvoiceLine[]);
  };

  const refreshSelectedInvoice = async (invoiceId: string) => {
    const { data, error: invoiceError } = await supabase
      .from('vihem_invoices')
      .select('*, company:company_id(*), customer:customer_id(*)')
      .eq('id', invoiceId)
      .single();

    if (invoiceError) {
      setError(invoiceError.message);
      return null;
    }

    const nextInvoice = data as Invoice;
    setSelectedInvoice(nextInvoice);
    setInvoices(prev => prev.map(invoice => invoice.id === invoiceId ? nextInvoice : invoice));
    return nextInvoice;
  };

  const saveInvoiceDocument = async (invoice: Invoice, lines: InvoiceLine[]) => {
    if (!organisationId) return;
    const invoiceTitle = `Faktura ${invoice.invoice_number || invoice.id.slice(0, 8)}`;
    const fileName = `${safePathPart(invoiceTitle)}.pdf`;
    const storagePath = `${organisationId}/invoices/${invoice.id}/${fileName}`;
    const pdfBlob = buildInvoicePdfBlob({ invoice, lines, formatCurrency });

    const { error: uploadError } = await supabase.storage
      .from('vihem-documents')
      .upload(storagePath, pdfBlob, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      setError(uploadError.message.toLowerCase().includes('bucket')
        ? 'Storage-bucketen vihem-documents saknas. Kör senaste Supabase-migreringarna först.'
        : uploadError.message);
      return;
    }

    const documentPayload = {
      organisation_id: organisationId,
      title: invoiceTitle,
      file_url: '',
      file_name: fileName,
      file_size: pdfBlob.size,
      document_type: 'invoice',
      company_id: invoice.company_id,
      document_category: 'invoice',
      contract_status: 'not_applicable',
      visibility: 'admin',
      tenant_id: null,
      property_id: null,
      apartment_id: null,
      storage_bucket: 'vihem-documents',
      storage_path: storagePath,
      description: `Faktura till ${invoice.customer?.name || 'kund'}`,
      created_by: user?.id ?? null,
    };

    const { data, error: documentError } = await supabase
      .from('vihem_documents')
      .insert(documentPayload)
      .select('id, storage_bucket, storage_path')
      .single();

    if (documentError) {
      setError(documentError.message);
      return;
    }

    await supabase
      .from('vihem_invoices')
      .update({ document_id: data.id })
      .eq('id', invoice.id);

    const { data: signedData } = await supabase.storage
      .from('vihem-documents')
      .createSignedUrl(storagePath, 60 * 10, { download: fileName });

    if (signedData?.signedUrl) {
      const link = document.createElement('a');
      link.href = signedData.signedUrl;
      link.download = fileName;
      link.click();
    }
  };

  const renderInvoiceDocument = async (invoice: Invoice, lines: InvoiceLine[]) => {
    const { data, error: renderError } = await supabase.functions.invoke('vihem-render-invoice-pdf', {
      body: { invoice_id: invoice.id },
    });

    if (!renderError && !data?.error) {
      if (data?.signed_url) {
        const link = document.createElement('a');
        link.href = data.signed_url;
        link.download = `${safePathPart(`Faktura ${invoice.invoice_number || invoice.id.slice(0, 8)}`)}.pdf`;
        link.click();
      }
      return;
    }

    await saveInvoiceDocument(invoice, lines);
  };

  const approveInvoice = async () => {
    if (!selectedInvoice) return;
    setSaving(true);
    setError('');

    const { data, error: approveError } = await supabase.rpc('vihem_approve_invoice', {
      target_invoice_id: selectedInvoice.id,
      target_series_id: selectedApprovalSeriesId || null,
    });

    if (approveError) {
      setError(approveError.message);
      setSaving(false);
      return;
    }

    const approvedInvoice = (Array.isArray(data) ? data[0] : data) as Invoice | null;
    const hydratedInvoice = approvedInvoice ? await refreshSelectedInvoice(approvedInvoice.id) : await refreshSelectedInvoice(selectedInvoice.id);
    if (hydratedInvoice) await renderInvoiceDocument(hydratedInvoice, selectedInvoiceLines);
    await loadFinance();
    setSaving(false);
  };

  const markInvoiceSent = async () => {
    if (!selectedInvoice) return;
    setSaving(true);
    setError('');

    const { data, error: sentError } = await supabase.rpc('vihem_mark_invoice_sent', {
      target_invoice_id: selectedInvoice.id,
    });

    if (sentError) {
      setError(sentError.message);
      setSaving(false);
      return;
    }

    const sentInvoice = (Array.isArray(data) ? data[0] : data) as Invoice | null;
    await refreshSelectedInvoice(sentInvoice?.id ?? selectedInvoice.id);
    await loadFinance();
    setSaving(false);
  };

  const refreshOverdueInvoices = async () => {
    if (!organisationId) return;
    setSaving(true);
    setError('');

    const { error: overdueError } = await supabase.rpc('vihem_refresh_overdue_invoices', {
      target_organisation_id: organisationId,
    });

    if (overdueError) {
      setError(overdueError.message);
      setSaving(false);
      return;
    }

    await loadFinance();
    if (selectedInvoice) await refreshSelectedInvoice(selectedInvoice.id);
    setSaving(false);
  };

  const queueInvoiceEmail = async () => {
    if (!selectedInvoice) return;
    setSaving(true);
    setError('');

    const { error: queueError } = await supabase.rpc('vihem_queue_invoice_email', {
      target_invoice_id: selectedInvoice.id,
      recipient_email: invoiceEmailForm.recipient_email.trim(),
      recipient_name: invoiceEmailForm.recipient_name.trim(),
      email_subject: invoiceEmailForm.subject.trim(),
      email_message: invoiceEmailForm.message.trim(),
    });

    if (queueError) {
      setError(queueError.message);
      setSaving(false);
      return;
    }

    setInvoiceEmailModalOpen(false);
    setInvoiceEmailForm(emptyInvoiceEmailForm);
    setActiveTab('email');
    await loadFinance();
    setSaving(false);
  };

  const createCreditInvoice = async () => {
    if (!selectedInvoice) return;
    setSaving(true);
    setError('');

    const { data, error: creditError } = await supabase.rpc('vihem_create_credit_invoice', {
      target_invoice_id: selectedInvoice.id,
      credit_reason: creditInvoiceForm.reason.trim(),
    });

    if (creditError) {
      setError(creditError.message);
      setSaving(false);
      return;
    }

    const creditInvoice = (Array.isArray(data) ? data[0] : data) as Invoice | null;
    setCreditInvoiceModalOpen(false);
    setCreditInvoiceForm(emptyCreditInvoiceForm);
    await loadFinance();
    if (creditInvoice) {
      const hydrated = await refreshSelectedInvoice(creditInvoice.id);
      if (hydrated) await openInvoiceDetail(hydrated);
    }
    setSaving(false);
  };

  const sendQueuedInvoiceEmails = async (emailId?: string) => {
    if (!organisationId) return;
    setSaving(true);
    setError('');

    const { data, error: sendError } = await supabase.functions.invoke('vihem-send-invoice-emails', {
      body: {
        organisation_id: organisationId,
        email_id: emailId || undefined,
        limit: emailId ? 1 : 20,
      },
    });

    if (sendError || data?.error) {
      setError(sendError?.message || data.error || 'Kunde inte skicka fakturamejl.');
      setSaving(false);
      await loadFinance();
      return;
    }

    await loadFinance();
    setSaving(false);
  };

  const queueOverdueInvoiceReminders = async () => {
    if (!organisationId) return;
    setSaving(true);
    setError('');

    const { error: reminderError } = await supabase.rpc('vihem_queue_overdue_invoice_reminders', {
      target_organisation_id: organisationId,
      target_company_id: null,
    });

    if (reminderError) {
      setError(reminderError.message);
      setSaving(false);
      return;
    }

    setActiveTab('email');
    await loadFinance();
    setSaving(false);
  };

  const registerPayment = async () => {
    if (!selectedInvoice) return;
    setSaving(true);
    setError('');

    const { data, error: paymentError } = await supabase.rpc('vihem_register_invoice_payment', {
      target_invoice_id: selectedInvoice.id,
      payment_amount: toNumber(paymentForm.amount, 0),
      payment_date: paymentForm.payment_date,
      payment_reference: paymentForm.reference.trim(),
    });

    if (paymentError) {
      setError(paymentError.message);
      setSaving(false);
      return;
    }

    const paidInvoice = (Array.isArray(data) ? data[0] : data) as Invoice | null;
    await refreshSelectedInvoice(paidInvoice?.id ?? selectedInvoice.id);
    await loadFinance();
    setPaymentModalOpen(false);
    setPaymentForm(emptyPaymentForm);
    setSaving(false);
  };

  const importPayments = async () => {
    if (!paymentImportForm.company_id || !paymentImportForm.csv.trim()) return;
    setSaving(true);
    setError('');
    setPaymentImportResult('');

    const rows = parseDelimitedRows(paymentImportForm.csv);
    if (rows.length === 0) {
      setError('CSV-filen saknar betalrader.');
      setSaving(false);
      return;
    }

    const { data, error: importError } = await supabase.rpc('vihem_import_invoice_payments', {
      target_company_id: paymentImportForm.company_id,
      payment_rows: rows,
      payment_source: paymentImportForm.source,
    });

    if (importError) {
      setError(importError.message);
      setSaving(false);
      return;
    }

    const imported = Number(data?.imported || 0);
    const skipped = Number(data?.skipped || 0);
    const failed = Number(data?.failed || 0);
    setPaymentImportResult(`Importerade ${imported}, hoppade över ${skipped}, fel ${failed}.`);
    await loadFinance();
    setSaving(false);
  };

  const readPaymentImportFile = async (file?: File | null) => {
    if (!file) return;
    const text = await file.text();
    setPaymentImportForm(prev => ({ ...prev, csv: text }));
  };

  const printInvoice = () => {
    if (!selectedInvoice) return;
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1000');
    if (!printWindow) return;

    const linesHtml = selectedInvoiceLines.map(line => `
      <tr>
        <td>${line.description}</td>
        <td>${line.quantity} ${line.unit}</td>
        <td>${formatCurrency(Number(line.unit_price), selectedInvoice.currency)}</td>
        <td>${line.vat_rate}%</td>
        <td>${formatCurrency(Number(line.line_total_incl_vat), selectedInvoice.currency)}</td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Faktura ${selectedInvoice.invoice_number || 'utkast'}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; color: #0f172a; }
            h1 { font-size: 32px; margin: 0 0 8px; }
            .muted { color: #64748b; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin: 32px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 24px; }
            th, td { border-bottom: 1px solid #e2e8f0; padding: 10px; text-align: left; }
            th { background: #f8fafc; font-size: 12px; text-transform: uppercase; color: #475569; }
            .totals { margin-left: auto; margin-top: 24px; width: 320px; }
            .total-row { display: flex; justify-content: space-between; padding: 8px 0; }
            .grand { font-weight: 800; font-size: 20px; border-top: 2px solid #0f172a; }
          </style>
        </head>
        <body>
          <h1>Faktura ${selectedInvoice.invoice_number || 'Utkast'}</h1>
          <p class="muted">Fakturadatum ${selectedInvoice.invoice_date} · Förfallodatum ${selectedInvoice.due_date}</p>
          <div class="grid">
            <section>
              <h2>Från</h2>
              <strong>${selectedInvoice.company?.legal_name || selectedInvoice.company?.name || ''}</strong><br />
              ${selectedInvoice.company?.organisation_number || ''}<br />
              ${selectedInvoice.company?.email || ''}
            </section>
            <section>
              <h2>Till</h2>
              <strong>${selectedInvoice.customer?.name || ''}</strong><br />
              ${selectedInvoice.customer?.organisation_number || ''}<br />
              ${selectedInvoice.customer?.invoice_email || selectedInvoice.customer?.email || ''}
            </section>
          </div>
          <table>
            <thead><tr><th>Beskrivning</th><th>Antal</th><th>Pris</th><th>Moms</th><th>Summa</th></tr></thead>
            <tbody>${linesHtml}</tbody>
          </table>
          <div class="totals">
            <div class="total-row"><span>Exkl. moms</span><strong>${formatCurrency(Number(selectedInvoice.subtotal_amount), selectedInvoice.currency)}</strong></div>
            <div class="total-row"><span>Moms</span><strong>${formatCurrency(Number(selectedInvoice.vat_amount), selectedInvoice.currency)}</strong></div>
            <div class="total-row grand"><span>Att betala</span><span>${formatCurrency(Number(selectedInvoice.total_amount), selectedInvoice.currency)}</span></div>
          </div>
          <script>window.print();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  if (loading) return <LoadingPage />;

  const overdueInvoiceCount = invoices.filter(invoice => invoice.status === 'overdue').length;

  const tabs: { key: FinanceTab; label: string }[] = [
    { key: 'overview', label: 'Översikt' },
    { key: 'companies', label: 'Bolag' },
    { key: 'customers', label: 'Kunder' },
    { key: 'invoices', label: 'Fakturor' },
    { key: 'payments', label: 'Betalningar' },
    { key: 'email', label: 'E-post' },
    { key: 'rent', label: 'Hyra' },
    { key: 'project-basis', label: 'Projektunderlag' },
    { key: 'suppliers', label: 'Leverantörer' },
    { key: 'supplier-invoices', label: 'Leverantörsfakturor' },
    { key: 'number-series', label: 'Nummerserier' },
    { key: 'integrations', label: 'Bokföring' },
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">Ekonomi</p>
          <h1 className="mt-1 text-3xl font-bold text-slate-950">Bolag, kunder och fakturering</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Här hanteras bolag, kunder, fakturor, projektunderlag, leverantörsfakturor och förberedda bokföringskopplingar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { resetCompanyForm(); setCompanyModalOpen(true); }}>
            <Plus className="h-4 w-4" />
            Nytt bolag
          </Button>
          <Button variant="secondary" onClick={() => { resetCustomerForm(); setCustomerModalOpen(true); }}>
            <Users className="h-4 w-4" />
            Ny kund
          </Button>
          <Button variant="secondary" onClick={() => { resetSupplierForm(); setSupplierModalOpen(true); }}>
            <Truck className="h-4 w-4" />
            Ny leverantör
          </Button>
          <Button variant="secondary" onClick={() => { resetSupplierInvoiceForm(); setSupplierInvoiceModalOpen(true); }} disabled={companies.length === 0}>
            <FileText className="h-4 w-4" />
            Leverantörsfaktura
          </Button>
          <Button variant="secondary" onClick={() => { resetRentRunForm(); setRentRunModalOpen(true); }} disabled={companies.length === 0}>
            <CalendarDays className="h-4 w-4" />
            Hyreskörning
          </Button>
          <Button onClick={() => { resetInvoiceForm(); setInvoiceModalOpen(true); }} disabled={companies.length === 0 || customers.length === 0}>
            <ReceiptText className="h-4 w-4" />
            Fakturautkast
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto border-b border-slate-200">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-4">
          <MetricCard icon={<Landmark className="h-5 w-5" />} label="Bolag" value={companies.length.toString()} />
          <MetricCard icon={<Users className="h-5 w-5" />} label="Kunder" value={customers.length.toString()} />
          <MetricCard icon={<FileText className="h-5 w-5" />} label="Fakturautkast" value={draftCount.toString()} />
          <MetricCard icon={<CircleDollarSign className="h-5 w-5" />} label="Öppet belopp" value={formatCurrency(openAmount)} />
          <MetricCard icon={<WalletCards className="h-5 w-5" />} label="Registrerat betalt" value={formatCurrency(paidAmount)} />
          <MetricCard icon={<Mail className="h-5 w-5" />} label="E-postkö" value={queuedEmailCount.toString()} />
          <MetricCard icon={<CalendarDays className="h-5 w-5" />} label="Hyreskörningar" value={rentRuns.length.toString()} />
          <MetricCard icon={<Truck className="h-5 w-5" />} label="Leverantörsfakturor" value={supplierInvoices.length.toString()} />
          <MetricCard icon={<Link2 className="h-5 w-5" />} label="Projektunderlag" value={projectBases.length.toString()} />
          <MetricCard icon={<Hash className="h-5 w-5" />} label="Nummerserier" value={numberSeries.length.toString()} />

          <Card className="p-5 lg:col-span-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-950">Ekonomigrunden är redo för nästa integrationslager</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Datamodellen är förberedd för flera juridiska bolag, bolagsbehörigheter, fakturanummerserier,
                  kunder, leverantörer, fakturarader, betalningar, attest och adapterlager för bokföringssystem.
                  Nästa större steg är serverrenderad PDF, e-postutskick och riktiga API-adaptrar.
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'companies' && (
        <Card className="overflow-hidden">
          {companies.length === 0 ? (
            <EmptyState title="Inga bolag ännu" description="Skapa första bolaget som fakturor ska ställas ut från." />
          ) : (
            <div className="divide-y divide-slate-100">
              {companies.map(company => (
                <div key={company.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-slate-950">{company.name}</h3>
                      <Badge className={company.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
                        {company.active ? 'Aktiv' : 'Inaktiv'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {company.organisation_number || 'Organisationsnummer saknas'} · {company.email || 'Ingen e-post'} · Betalvillkor {company.default_payment_terms_days} dagar
                    </p>
                  </div>
                  <Badge className="bg-blue-50 text-blue-700">
                    Serie {company.invoice_prefix || 'F'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'customers' && (
        <Card className="overflow-hidden">
          {customers.length === 0 ? (
            <EmptyState title="Inga kunder ännu" description="Lägg upp kundregister så fakturor kan kopplas till rätt mottagare." />
          ) : (
            <div className="divide-y divide-slate-100">
              {customers.map(customer => (
                <div key={customer.id} className="grid gap-3 p-4 md:grid-cols-[1.5fr_1fr_1fr_auto] md:items-center">
                  <div>
                    <h3 className="font-bold text-slate-950">{customer.name}</h3>
                    <p className="text-sm text-slate-500">{customer.organisation_number || 'Organisationsnummer saknas'}</p>
                  </div>
                  <p className="text-sm text-slate-600">{customer.invoice_email || customer.email || 'Ingen faktura-e-post'}</p>
                  <p className="text-sm text-slate-600">{customer.company?.name ?? 'Alla bolag'}</p>
                  <Badge className="bg-slate-100 text-slate-700">{customer.payment_terms_days} dagar</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'invoices' && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-950">Fakturor</h2>
              <p className="text-sm text-slate-500">
                {overdueInvoiceCount > 0
                  ? `${overdueInvoiceCount} fakturor är markerade som försenade.`
                  : 'Kundfakturor, betalstatus och förfallodatum.'}
              </p>
            </div>
            <Button variant="secondary" onClick={refreshOverdueInvoices} loading={saving}>
              <CalendarDays className="h-4 w-4" />
              Uppdatera förfallna
            </Button>
          </div>
          {invoices.length === 0 ? (
            <EmptyState title="Inga fakturor ännu" description="Skapa ett fakturautkast för att testa den nya ekonomigrunden." />
          ) : (
            <div className="divide-y divide-slate-100">
              {invoices.map(invoice => (
                <div key={invoice.id} className="grid gap-3 p-4 lg:grid-cols-[1.2fr_1fr_0.8fr_0.8fr_auto_auto] lg:items-center">
                  <div>
                    <h3 className="font-bold text-slate-950">{invoice.invoice_number ?? 'Utkast utan fakturanummer'}</h3>
                    <p className="text-sm text-slate-500">{invoice.customer?.name ?? 'Kund saknas'}</p>
                  </div>
                  <p className="text-sm text-slate-600">{invoice.company?.name ?? 'Bolag saknas'}</p>
                  <p className="text-sm text-slate-600">Förfaller {invoice.due_date}</p>
                  <p className="font-semibold text-slate-950">{formatCurrency(Number(invoice.total_amount), invoice.currency)}</p>
                  <Badge className="bg-blue-50 text-blue-700">{invoiceStatusLabel(invoice.status)}</Badge>
                  <Button variant="secondary" size="sm" onClick={() => openInvoiceDetail(invoice)}>Öppna</Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'payments' && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-950">Betalningar</h2>
              <p className="text-sm text-slate-500">Manuella betalningar och importerade bank-/bokföringsrader.</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                resetPaymentImportForm();
                setPaymentImportModalOpen(true);
              }}
              disabled={companies.length === 0}
            >
              <Upload className="h-4 w-4" />
              Importera CSV
            </Button>
          </div>
          {payments.length === 0 ? (
            <EmptyState title="Inga betalningar registrerade" description="När betalningar registreras på fakturor visas de här som betalningshistorik." />
          ) : (
            <div className="divide-y divide-slate-100">
              {payments.map(payment => (
                <div key={payment.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_1fr_0.8fr_0.8fr_auto] lg:items-center">
                  <div>
                    <h3 className="font-bold text-slate-950">{formatCurrency(Number(payment.amount), payment.currency)}</h3>
                    <p className="text-sm text-slate-500">{payment.reference || 'Ingen referens'}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">{payment.invoice?.invoice_number || 'Faktura utan nummer'}</p>
                    <p className="text-sm text-slate-500">{payment.invoice?.customer?.name || 'Kund saknas'}</p>
                  </div>
                  <p className="text-sm text-slate-600">{payment.company?.name || 'Bolag saknas'}</p>
                  <p className="text-sm text-slate-600">{payment.payment_date}</p>
                  <Badge className="bg-emerald-50 text-emerald-700">{paymentSourceLabel(payment.source)}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'email' && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-950">Faktura-e-post</h2>
              <p className="text-sm text-slate-500">Köade och skickade fakturamejl, inklusive betalningspåminnelser.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={queueOverdueInvoiceReminders}
                loading={saving}
              >
                <Mail className="h-4 w-4" />
                Köa påminnelser
              </Button>
              <Button
                variant="secondary"
                onClick={() => sendQueuedInvoiceEmails()}
                loading={saving}
                disabled={queuedEmailCount === 0}
              >
                <Send className="h-4 w-4" />
                Skicka köade
              </Button>
            </div>
          </div>
          {invoiceEmails.length === 0 ? (
            <EmptyState
              title="Inga fakturamejl köade"
              description="Öppna en godkänd faktura och välj Köa e-post för att förbereda utskick med faktura-PDF."
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {invoiceEmails.map(email => (
                <div key={email.id} className="grid gap-3 p-4 lg:grid-cols-[1.2fr_1fr_1fr_0.8fr_auto_auto] lg:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-slate-950">{email.subject || 'Fakturamejl'}</h3>
                      {email.email_kind === 'payment_reminder' && (
                        <Badge className="bg-amber-50 text-amber-700">Påminnelse {email.reminder_level || 1}</Badge>
                      )}
                      {email.email_kind === 'payment_reminder' && Number(email.reminder_fee_amount || 0) > 0 && (
                        <Badge className="bg-slate-100 text-slate-700">
                          Avgift {formatCurrency(Number(email.reminder_fee_amount || 0))}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-500">
                      {email.recipient_name ? `${email.recipient_name} · ` : ''}{email.recipient_email}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">{email.invoice?.invoice_number || 'Faktura utan nummer'}</p>
                    <p className="text-sm text-slate-500">{email.invoice?.customer?.name || 'Kund saknas'}</p>
                  </div>
                  <p className="text-sm text-slate-600">{email.company?.name || 'Bolag saknas'}</p>
                  <p className="text-sm text-slate-600">{email.sent_at ? `Skickad ${email.sent_at.slice(0, 16).replace('T', ' ')}` : email.queued_at ? `Köad ${email.queued_at.slice(0, 16).replace('T', ' ')}` : email.created_at.slice(0, 16).replace('T', ' ')}</p>
                  <Badge className={email.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : email.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}>
                    {invoiceEmailStatusLabel(email.status)}
                  </Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => sendQueuedInvoiceEmails(email.id)}
                    loading={saving}
                    disabled={email.status !== 'queued'}
                  >
                    Skicka
                  </Button>
                  {email.error_message && (
                    <p className="lg:col-span-6 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{email.error_message}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'rent' && (
        <Card className="overflow-hidden">
          {rentRuns.length === 0 ? (
            <EmptyState
              title="Inga hyreskörningar ännu"
              description="Skapa en körning per bolag och månad. Systemet hämtar aktiva hyresförhållanden och sätter förfallodatum till sista dagen i månaden innan."
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {rentRuns.map(run => (
                <div key={run.id} className="grid gap-3 p-4 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_auto_auto_auto] lg:items-center">
                  <div>
                    <h3 className="font-bold text-slate-950">
                      Hyra {run.rent_period.slice(0, 7)}
                    </h3>
                    <p className="text-sm text-slate-500">{run.company?.name ?? 'Bolag saknas'}</p>
                  </div>
                  <p className="text-sm text-slate-600">Förfaller {run.due_date}</p>
                  <p className="text-sm text-slate-600">{run.invoice_count} underlag/fakturor</p>
                  <p className="font-semibold text-slate-950">{formatCurrency(Number(run.total_amount))}</p>
                  <Badge className={run.status === 'generated' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}>
                    {rentRunStatusLabel(run.status)}
                  </Badge>
                  <Button variant="secondary" size="sm" onClick={() => openRentRunDetail(run)}>
                    Granska
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={saving}
                    onClick={() => generateRentInvoices(run.id)}
                    disabled={run.status !== 'draft' || run.invoice_count === 0}
                  >
                    Skapa fakturautkast
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'project-basis' && (
        <Card className="overflow-hidden">
          {projectBases.length === 0 ? (
            <EmptyState title="Inga öppna projektunderlag" description="När kundprojekt får faktureringsunderlag visas de här och kan omvandlas till fakturautkast." />
          ) : (
            <div className="divide-y divide-slate-100">
              {projectBases.map(basis => (
                <div key={basis.id} className="grid gap-3 p-4 lg:grid-cols-[1.2fr_1fr_0.7fr_0.7fr_auto] lg:items-center">
                  <div>
                    <h3 className="font-bold text-slate-950">{basis.title || basis.basis_number || 'Faktureringsunderlag'}</h3>
                    <p className="text-sm text-slate-500">{basis.project?.title || basis.project?.name || 'Kundprojekt'} · {basis.basis_number}</p>
                  </div>
                  <p className="text-sm text-slate-600">{basis.project?.customer_name || 'Kund saknas'}</p>
                  <p className="text-sm text-slate-600">{basis.status === 'ready_for_invoicing' ? 'Redo' : 'Utkast'}</p>
                  <p className="font-semibold text-slate-950">{formatCurrency(Number(basis.total_amount || 0) + Number(basis.vat_amount || 0))}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      resetProjectInvoiceForm(basis);
                      setProjectInvoiceModalOpen(true);
                    }}
                    disabled={customers.length === 0 || companies.length === 0}
                  >
                    Skapa faktura
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'suppliers' && (
        <Card className="overflow-hidden">
          {suppliers.length === 0 ? (
            <EmptyState title="Inga leverantörer ännu" description="Leverantörsregistret är förberett för kommande OCR- och attestflöde." />
          ) : (
            <div className="divide-y divide-slate-100">
              {suppliers.map(supplier => (
                <div key={supplier.id} className="grid gap-3 p-4 md:grid-cols-[1.5fr_1fr_1fr_auto] md:items-center">
                  <div>
                    <h3 className="font-bold text-slate-950">{supplier.name}</h3>
                    <p className="text-sm text-slate-500">{supplier.organisation_number || 'Organisationsnummer saknas'}</p>
                  </div>
                  <p className="text-sm text-slate-600">{supplier.email || 'Ingen e-post'}</p>
                  <p className="text-sm text-slate-600">{supplier.company?.name ?? 'Alla bolag'}</p>
                  <Badge className="bg-slate-100 text-slate-700">{supplier.payment_terms_days} dagar</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'supplier-invoices' && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-950">Leverantörsfakturor</h2>
              <p className="text-sm text-slate-500">Granska, attestera och förbered inkommande fakturor för OCR och bokföring.</p>
            </div>
            <Button
              variant="secondary"
              onClick={processSupplierInvoiceOcrQueue}
              loading={saving}
              disabled={!supplierInvoices.some(invoice => invoice.ocr_status === 'queued' && invoice.document_id)}
            >
              <FileText className="h-4 w-4" />
              Behandla OCR-kö ({supplierInvoices.filter(invoice => invoice.ocr_status === 'queued' && invoice.document_id).length})
            </Button>
          </div>
          {supplierInvoices.length === 0 ? (
            <EmptyState title="Inga leverantörsfakturor ännu" description="Registrera inkommande fakturor manuellt nu, OCR och e-postimport kopplas på i nästa lager." />
          ) : (
            <div className="divide-y divide-slate-100">
              {supplierInvoices.map(invoice => (
                <div key={invoice.id} className="grid gap-3 p-4 lg:grid-cols-[1.1fr_1fr_0.7fr_0.8fr_auto_auto_auto_auto_auto] lg:items-center">
                  <div>
                    <h3 className="font-bold text-slate-950">{invoice.supplier?.name || 'Leverantör saknas'}</h3>
                    <p className="text-sm text-slate-500">{invoice.supplier_invoice_number || 'Fakturanummer saknas'}</p>
                  </div>
                  <p className="text-sm text-slate-600">{invoice.company?.name || 'Bolag saknas'}</p>
                  <p className="text-sm text-slate-600">Förfaller {invoice.due_date}</p>
                  <p className="font-semibold text-slate-950">{formatCurrency(Number(invoice.total_amount), invoice.currency)}</p>
                  <Badge className={invoice.approval_status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
                    {invoice.approval_status === 'approved' ? 'Godkänd' : 'Väntar attest'}
                  </Badge>
                  <Badge className={invoice.payment_status === 'paid' ? 'bg-emerald-50 text-emerald-700' : invoice.payment_status === 'scheduled' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'}>
                    {invoice.payment_status === 'paid' ? 'Betald' : invoice.payment_status === 'scheduled' ? 'Betalning planerad' : 'Obetald'}
                  </Badge>
                  <div className="flex flex-wrap gap-2">
                    {invoice.document_id && <Badge className="bg-blue-50 text-blue-700">Bilaga</Badge>}
                    {invoice.ocr_status !== 'not_started' && (
                      <Badge className="bg-purple-50 text-purple-700">
                        OCR {invoice.ocr_status === 'queued' ? 'köad' : invoice.ocr_status}
                      </Badge>
                    )}
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => openSupplierInvoiceDetail(invoice)}>
                    Öppna
                  </Button>
                  {invoice.approval_status !== 'approved' && (
                    <Button variant="secondary" size="sm" loading={saving} onClick={() => approveSupplierInvoice(invoice.id)}>
                      Attestera
                    </Button>
                  )}
                  {invoice.approval_status === 'approved' && invoice.payment_status === 'unpaid' && (
                    <Button variant="secondary" size="sm" loading={saving} onClick={() => scheduleSupplierInvoicePayment(invoice.id)}>
                      Planera betalning
                    </Button>
                  )}
                  {invoice.approval_status === 'approved' && invoice.payment_status !== 'paid' && (
                    <Button variant="secondary" size="sm" loading={saving} onClick={() => markSupplierInvoicePaid(invoice.id)}>
                      Markera betald
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'number-series' && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-950">Fakturanummerserier</h2>
              <p className="text-sm text-slate-500">Styr prefix och nästa fakturanummer per bolag.</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                resetNumberSeriesForm();
                setNumberSeriesModalOpen(true);
              }}
              disabled={companies.length === 0}
            >
              <Plus className="h-4 w-4" />
              Ny nummerserie
            </Button>
          </div>
          {numberSeries.length === 0 ? (
            <EmptyState title="Inga nummerserier" description="När ett bolag skapas läggs en standardserie upp automatiskt för fakturanummer." />
          ) : (
            <div className="divide-y divide-slate-100">
              {numberSeries.map(series => (
                <div key={series.id} className="grid gap-3 p-4 md:grid-cols-[1.2fr_1fr_0.8fr_0.8fr_auto_auto] md:items-center">
                  <div>
                    <h3 className="font-bold text-slate-950">{series.name}</h3>
                    <p className="text-sm text-slate-500">{series.company?.name || 'Bolag saknas'}</p>
                  </div>
                  <p className="text-sm text-slate-600">Prefix {series.prefix || 'inget'}</p>
                  <p className="text-sm text-slate-600">Nästa nr {series.next_number}</p>
                  <p className="text-sm text-slate-600">{series.fiscal_year ? `År ${series.fiscal_year}` : `Padding ${series.padding}`}</p>
                  <Badge className={series.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
                    {series.active ? 'Aktiv' : 'Inaktiv'}
                  </Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      resetNumberSeriesForm(series);
                      setNumberSeriesModalOpen(true);
                    }}
                  >
                    Redigera
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'integrations' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5 lg:col-span-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-950">Bokföringskö</h3>
                <p className="mt-1 text-sm text-slate-500">Fakturor och betalningar som väntar på export till vald bokföringsadapter.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-blue-50 text-blue-700">
                  {accountingQueue.filter(item => ['queued', 'processing'].includes(item.status)).length} aktiva
                </Badge>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={exportAccountingQueueCsv}
                  loading={saving}
                  disabled={!accountingQueue.some(item => ['queued', 'processing'].includes(item.status))}
                >
                  <Upload className="h-4 w-4" />
                  Exportera CSV
                </Button>
              </div>
            </div>
            {accountingQueue.length === 0 ? (
              <EmptyState title="Inget köat ännu" description="Köa en godkänd faktura från fakturadetaljen när den ska vidare till bokföring." />
            ) : (
              <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
                <div className="grid gap-3 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid-cols-[1fr_0.7fr_0.7fr_0.7fr_1.1fr]">
                  <span>Objekt</span>
                  <span>Bolag</span>
                  <span>Status</span>
                  <span>Skapad</span>
                  <span>Åtgärder</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {accountingQueue.slice(0, 12).map(item => (
                    <div key={item.id} className="grid gap-3 px-4 py-3 text-sm lg:grid-cols-[1fr_0.7fr_0.7fr_0.7fr_1.1fr] lg:items-center">
                      <div>
                        <p className="font-semibold text-slate-900">{item.entity_type} · {item.action}</p>
                        {item.error_message && <p className="mt-1 text-xs text-red-600">{item.error_message}</p>}
                      </div>
                      <span className="text-slate-600">{item.company?.name || 'Bolag saknas'}</span>
                      <span>
                        <Badge className={
                          item.status === 'failed' ? 'bg-red-50 text-red-700' :
                            item.status === 'synced' ? 'bg-emerald-50 text-emerald-700' :
                              'bg-amber-50 text-amber-700'
                        }>
                          {accountingSyncStatusLabel(item.status)}
                        </Badge>
                      </span>
                      <span className="text-slate-500">{new Date(item.created_at).toLocaleDateString('sv-SE')}</span>
                      <div className="flex flex-wrap gap-2">
                        {item.status === 'queued' && (
                          <Button variant="secondary" size="sm" loading={saving} onClick={() => updateAccountingQueueStatus(item.id, 'processing')}>
                            Bearbetas
                          </Button>
                        )}
                        {item.status !== 'synced' && (
                          <Button variant="secondary" size="sm" loading={saving} onClick={() => updateAccountingQueueStatus(item.id, 'synced')}>
                            Synkad
                          </Button>
                        )}
                        {item.status !== 'failed' && item.status !== 'synced' && (
                          <Button variant="secondary" size="sm" loading={saving} onClick={() => updateAccountingQueueStatus(item.id, 'failed')}>
                            Misslyckad
                          </Button>
                        )}
                        {['failed', 'cancelled'].includes(item.status) && (
                          <Button variant="secondary" size="sm" loading={saving} onClick={() => updateAccountingQueueStatus(item.id, 'queued')}>
                            Återköa
                          </Button>
                        )}
                        {!['cancelled', 'synced'].includes(item.status) && (
                          <Button variant="secondary" size="sm" loading={saving} onClick={() => updateAccountingQueueStatus(item.id, 'cancelled')}>
                            Avbryt
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
          {companies.length === 0 ? (
            <Card className="p-6 lg:col-span-2">
              <EmptyState title="Skapa ett bolag först" description="Bokföringskopplingar styrs per juridiskt bolag." />
            </Card>
          ) : (
            <Card className="p-5 lg:col-span-2">
              <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-950">Påminnelseregler</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Styr när automatiska betalningspåminnelser får köas per bolag. Utskicken sker fortfarande via e-postkön.
                  </p>
                </div>
                <Badge className="bg-slate-100 text-slate-700">{reminderSettings.length} sparade</Badge>
              </div>
              <div className="mt-4 grid gap-3">
                {companies.map(company => {
                  const draft = reminderSettingsDrafts[company.id] ?? defaultReminderSettingsDraft;
                  return (
                    <div key={company.id} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:grid-cols-[1.2fr_0.7fr_0.7fr_0.7fr_0.7fr_auto] lg:items-end">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={draft.enabled}
                          onChange={event => updateReminderSettingsDraft(company.id, { enabled: event.target.checked })}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                        <span>
                          <span className="block font-bold text-slate-950">{company.name}</span>
                          <span className="block text-sm text-slate-500">{draft.enabled ? 'Automatiska påminnelser aktiva' : 'Automatiska påminnelser avstängda'}</span>
                        </span>
                      </label>
                      <Input
                        label="Första efter dagar"
                        type="number"
                        min="0"
                        value={draft.first_after_days}
                        onChange={event => updateReminderSettingsDraft(company.id, { first_after_days: event.target.value })}
                      />
                      <Input
                        label="Intervall dagar"
                        type="number"
                        min="1"
                        value={draft.interval_days}
                        onChange={event => updateReminderSettingsDraft(company.id, { interval_days: event.target.value })}
                      />
                      <Input
                        label="Max antal"
                        type="number"
                        min="0"
                        value={draft.max_reminders}
                        onChange={event => updateReminderSettingsDraft(company.id, { max_reminders: event.target.value })}
                      />
                      <Input
                        label="Avgift"
                        type="number"
                        min="0"
                        value={draft.reminder_fee}
                        onChange={event => updateReminderSettingsDraft(company.id, { reminder_fee: event.target.value })}
                      />
                      <Button variant="secondary" size="sm" loading={saving} onClick={() => saveReminderSettings(company)}>
                        Spara
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
          {companies.map(company => {
            const companyIntegrations = integrations.filter(integration => integration.company_id === company.id);
            return (
              <Card key={company.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-950">{company.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">Välj vilken bokföringsadapter bolaget ska använda när API-koppling byggs på.</p>
                  </div>
                  <Badge className="bg-slate-100 text-slate-700">{companyIntegrations.length} kopplingar</Badge>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {(['spiris', 'accounted', 'fortnox', 'sie', 'manual'] as AccountingIntegration['provider'][]).map(provider => {
                    const existing = companyIntegrations.find(integration => integration.provider === provider);
                    return (
                      <button
                        key={provider}
                        onClick={() => ensureIntegration(company.id, provider)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50"
                      >
                        <span className="capitalize">{provider}</span>
                        <span className="mt-1 block text-xs font-medium text-slate-500">
                          {existing ? existing.status : 'Ej upplagd'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={companyModalOpen} onClose={() => setCompanyModalOpen(false)} title="Nytt bolag" size="lg">
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Namn" value={companyForm.name} onChange={e => setCompanyForm(prev => ({ ...prev, name: e.target.value }))} />
          <Input label="Juridiskt namn" value={companyForm.legal_name} onChange={e => setCompanyForm(prev => ({ ...prev, legal_name: e.target.value }))} />
          <Input label="Organisationsnummer" value={companyForm.organisation_number} onChange={e => setCompanyForm(prev => ({ ...prev, organisation_number: e.target.value }))} />
          <Input label="Fakturaprefix" value={companyForm.invoice_prefix} onChange={e => setCompanyForm(prev => ({ ...prev, invoice_prefix: e.target.value }))} />
          <Input label="E-post" type="email" value={companyForm.email} onChange={e => setCompanyForm(prev => ({ ...prev, email: e.target.value }))} />
          <Input label="Telefon" value={companyForm.phone} onChange={e => setCompanyForm(prev => ({ ...prev, phone: e.target.value }))} />
          <Input label="Betalvillkor dagar" type="number" value={companyForm.default_payment_terms_days} onChange={e => setCompanyForm(prev => ({ ...prev, default_payment_terms_days: e.target.value }))} />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCompanyModalOpen(false)}>Avbryt</Button>
          <Button onClick={createCompany} loading={saving} disabled={!companyForm.name.trim()}>Skapa bolag</Button>
        </div>
      </Modal>

      <Modal open={customerModalOpen} onClose={() => setCustomerModalOpen(false)} title="Ny kund" size="lg">
        <div className="grid gap-4 md:grid-cols-2">
          <Select label="Bolag" value={customerForm.company_id} options={companyOptions} onChange={e => setCustomerForm(prev => ({ ...prev, company_id: e.target.value }))} />
          <Select label="Kundtyp" value={customerForm.customer_type} options={customerTypeOptions} onChange={e => setCustomerForm(prev => ({ ...prev, customer_type: e.target.value }))} />
          <Input label="Namn" value={customerForm.name} onChange={e => setCustomerForm(prev => ({ ...prev, name: e.target.value }))} />
          <Input label="Organisationsnummer/personnummer" value={customerForm.organisation_number} onChange={e => setCustomerForm(prev => ({ ...prev, organisation_number: e.target.value }))} />
          <Input label="E-post" type="email" value={customerForm.email} onChange={e => setCustomerForm(prev => ({ ...prev, email: e.target.value }))} />
          <Input label="Faktura-e-post" type="email" value={customerForm.invoice_email} onChange={e => setCustomerForm(prev => ({ ...prev, invoice_email: e.target.value }))} />
          <Input label="Betalvillkor dagar" type="number" value={customerForm.payment_terms_days} onChange={e => setCustomerForm(prev => ({ ...prev, payment_terms_days: e.target.value }))} />
          <Textarea label="Anteckningar" value={customerForm.notes} onChange={e => setCustomerForm(prev => ({ ...prev, notes: e.target.value }))} />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCustomerModalOpen(false)}>Avbryt</Button>
          <Button onClick={createCustomer} loading={saving} disabled={!customerForm.name.trim()}>Skapa kund</Button>
        </div>
      </Modal>

      <Modal open={supplierModalOpen} onClose={() => setSupplierModalOpen(false)} title="Ny leverantör" size="lg">
        <div className="grid gap-4 md:grid-cols-2">
          <Select label="Bolag" value={supplierForm.company_id} options={companyOptions} onChange={e => setSupplierForm(prev => ({ ...prev, company_id: e.target.value }))} />
          <Input label="Namn" value={supplierForm.name} onChange={e => setSupplierForm(prev => ({ ...prev, name: e.target.value }))} />
          <Input label="Organisationsnummer" value={supplierForm.organisation_number} onChange={e => setSupplierForm(prev => ({ ...prev, organisation_number: e.target.value }))} />
          <Input label="E-post" type="email" value={supplierForm.email} onChange={e => setSupplierForm(prev => ({ ...prev, email: e.target.value }))} />
          <Input label="Betalvillkor dagar" type="number" value={supplierForm.payment_terms_days} onChange={e => setSupplierForm(prev => ({ ...prev, payment_terms_days: e.target.value }))} />
          <Input label="Standardkonto" value={supplierForm.default_account_code} onChange={e => setSupplierForm(prev => ({ ...prev, default_account_code: e.target.value }))} />
          <Textarea label="Anteckningar" value={supplierForm.notes} onChange={e => setSupplierForm(prev => ({ ...prev, notes: e.target.value }))} />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setSupplierModalOpen(false)}>Avbryt</Button>
          <Button onClick={createSupplier} loading={saving} disabled={!supplierForm.name.trim()}>Skapa leverantör</Button>
        </div>
      </Modal>

      <Modal open={invoiceModalOpen} onClose={() => setInvoiceModalOpen(false)} title="Nytt fakturautkast" size="lg">
        <div className="grid gap-4 md:grid-cols-2">
          <Select label="Bolag" value={invoiceForm.company_id} options={companyOptions} onChange={e => {
            const company = companies.find(item => item.id === e.target.value);
            setInvoiceForm(prev => ({
              ...prev,
              company_id: e.target.value,
              customer_id: '',
              due_date: addDays(prev.invoice_date, company?.default_payment_terms_days ?? 30),
            }));
          }} />
          <Select label="Kund" value={invoiceForm.customer_id} options={customerOptions} onChange={e => {
            const customer = customers.find(item => item.id === e.target.value);
            setInvoiceForm(prev => ({
              ...prev,
              customer_id: e.target.value,
              due_date: addDays(prev.invoice_date, customer?.payment_terms_days ?? 30),
            }));
          }} />
          <Input label="Fakturadatum" type="date" value={invoiceForm.invoice_date} onChange={e => setInvoiceForm(prev => ({ ...prev, invoice_date: e.target.value }))} />
          <Input label="Förfallodatum" type="date" value={invoiceForm.due_date} onChange={e => setInvoiceForm(prev => ({ ...prev, due_date: e.target.value }))} />
          <Input className="md:col-span-2" label="Radtext" value={invoiceForm.description} onChange={e => setInvoiceForm(prev => ({ ...prev, description: e.target.value }))} />
          <Input label="Antal" inputMode="decimal" value={invoiceForm.quantity} onChange={e => setInvoiceForm(prev => ({ ...prev, quantity: e.target.value }))} />
          <Input label="Pris exkl. moms" inputMode="decimal" value={invoiceForm.unit_price} onChange={e => setInvoiceForm(prev => ({ ...prev, unit_price: e.target.value }))} />
          <Input label="Moms %" inputMode="decimal" value={invoiceForm.vat_rate} onChange={e => setInvoiceForm(prev => ({ ...prev, vat_rate: e.target.value }))} />
          <Textarea label="Intern anteckning" value={invoiceForm.notes} onChange={e => setInvoiceForm(prev => ({ ...prev, notes: e.target.value }))} />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setInvoiceModalOpen(false)}>Avbryt</Button>
          <Button
            onClick={createInvoice}
            loading={saving}
            disabled={!invoiceForm.company_id || !invoiceForm.customer_id || !invoiceForm.description.trim()}
          >
            Skapa utkast
          </Button>
        </div>
      </Modal>

      <Modal open={supplierInvoiceModalOpen} onClose={() => setSupplierInvoiceModalOpen(false)} title="Ny leverantörsfaktura" size="lg">
        <div className="grid gap-4 md:grid-cols-2">
          <Select label="Bolag" value={supplierInvoiceForm.company_id} options={companyOptions} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, company_id: e.target.value, supplier_id: '' }))} />
          <Select label="Leverantör" value={supplierInvoiceForm.supplier_id} options={supplierOptions} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, supplier_id: e.target.value }))} />
          <Input label="Leverantörens fakturanummer" value={supplierInvoiceForm.supplier_invoice_number} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, supplier_invoice_number: e.target.value }))} />
          <Input label="Fakturadatum" type="date" value={supplierInvoiceForm.invoice_date} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, invoice_date: e.target.value }))} />
          <Input label="Förfallodatum" type="date" value={supplierInvoiceForm.due_date} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, due_date: e.target.value }))} />
          <Input label="Konto" value={supplierInvoiceForm.account_code} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, account_code: e.target.value }))} />
          <Input className="md:col-span-2" label="Radtext" value={supplierInvoiceForm.description} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, description: e.target.value }))} />
          <Input label="Antal" inputMode="decimal" value={supplierInvoiceForm.quantity} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, quantity: e.target.value }))} />
          <Input label="Pris exkl. moms" inputMode="decimal" value={supplierInvoiceForm.unit_price} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, unit_price: e.target.value }))} />
          <Input label="Moms %" inputMode="decimal" value={supplierInvoiceForm.vat_rate} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, vat_rate: e.target.value }))} />
          <Textarea label="Intern anteckning" value={supplierInvoiceForm.notes} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, notes: e.target.value }))} />
          <label className="block text-sm font-semibold text-slate-700 md:col-span-2">
            Fakturafil
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
              onChange={e => setSupplierInvoiceFile(e.target.files?.[0] ?? null)}
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-blue-700"
            />
            {supplierInvoiceFile && (
              <span className="mt-2 block text-xs font-medium text-slate-500">
                {supplierInvoiceFile.name} · {Math.round(supplierInvoiceFile.size / 1024)} kB
              </span>
            )}
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setSupplierInvoiceModalOpen(false)}>Avbryt</Button>
          <Button
            onClick={createSupplierInvoice}
            loading={saving}
            disabled={!supplierInvoiceForm.company_id || !supplierInvoiceForm.description.trim()}
          >
            Skapa för attest
          </Button>
        </div>
      </Modal>

      <Modal open={supplierInvoiceDetailOpen} onClose={() => setSupplierInvoiceDetailOpen(false)} title="Granska leverantörsfaktura" size="xl">
        {selectedSupplierInvoice && (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-4">
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</p>
                <p className="mt-2 text-lg font-bold text-slate-950">
                  {selectedSupplierInvoice.approval_status === 'approved' ? 'Godkänd' : 'Väntar attest'}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">OCR</p>
                <p className="mt-2 text-lg font-bold text-slate-950">
                  {selectedSupplierInvoice.ocr_status === 'not_started' ? 'Ej startad' : selectedSupplierInvoice.ocr_status === 'queued' ? 'Köad' : selectedSupplierInvoice.ocr_status}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bilaga</p>
                <p className="mt-2 text-lg font-bold text-slate-950">{selectedSupplierInvoice.document_id ? 'Finns' : 'Saknas'}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total</p>
                <p className="mt-2 text-lg font-bold text-slate-950">
                  {formatCurrency(Number(selectedSupplierInvoice.total_amount), selectedSupplierInvoice.currency)}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Betalning</p>
                <p className="mt-2 text-lg font-bold text-slate-950">
                  {selectedSupplierInvoice.payment_status === 'paid' ? 'Betald' : selectedSupplierInvoice.payment_status === 'scheduled' ? 'Planerad' : 'Obetald'}
                </p>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Select
                label="Bolag"
                value={supplierInvoiceReviewForm.company_id}
                options={companyOptions}
                onChange={e => setSupplierInvoiceReviewForm(prev => ({ ...prev, company_id: e.target.value, supplier_id: '' }))}
              />
              <Select
                label="Leverantör"
                value={supplierInvoiceReviewForm.supplier_id}
                options={[
                  { value: '', label: 'Välj leverantör' },
                  ...suppliers
                    .filter(supplier => !supplier.company_id || supplier.company_id === supplierInvoiceReviewForm.company_id)
                    .map(supplier => ({ value: supplier.id, label: supplier.name })),
                ]}
                onChange={e => setSupplierInvoiceReviewForm(prev => ({ ...prev, supplier_id: e.target.value }))}
              />
              <Input
                label="Leverantörens fakturanummer"
                value={supplierInvoiceReviewForm.supplier_invoice_number}
                onChange={e => setSupplierInvoiceReviewForm(prev => ({ ...prev, supplier_invoice_number: e.target.value }))}
              />
              <Input
                label="Fakturadatum"
                type="date"
                value={supplierInvoiceReviewForm.invoice_date}
                onChange={e => setSupplierInvoiceReviewForm(prev => ({ ...prev, invoice_date: e.target.value }))}
              />
              <Input
                label="Förfallodatum"
                type="date"
                value={supplierInvoiceReviewForm.due_date}
                onChange={e => setSupplierInvoiceReviewForm(prev => ({ ...prev, due_date: e.target.value }))}
              />
              <Input
                label="Konto"
                value={supplierInvoiceReviewForm.account_code}
                onChange={e => setSupplierInvoiceReviewForm(prev => ({ ...prev, account_code: e.target.value }))}
              />
              <Input
                className="md:col-span-2"
                label="Radtext"
                value={supplierInvoiceReviewForm.description}
                onChange={e => setSupplierInvoiceReviewForm(prev => ({ ...prev, description: e.target.value }))}
              />
              <Input
                label="Antal"
                inputMode="decimal"
                value={supplierInvoiceReviewForm.quantity}
                onChange={e => setSupplierInvoiceReviewForm(prev => ({ ...prev, quantity: e.target.value }))}
              />
              <Input
                label="Pris exkl. moms"
                inputMode="decimal"
                value={supplierInvoiceReviewForm.unit_price}
                onChange={e => setSupplierInvoiceReviewForm(prev => ({ ...prev, unit_price: e.target.value }))}
              />
              <Input
                label="Moms %"
                inputMode="decimal"
                value={supplierInvoiceReviewForm.vat_rate}
                onChange={e => setSupplierInvoiceReviewForm(prev => ({ ...prev, vat_rate: e.target.value }))}
              />
              <Textarea
                className="md:col-span-2"
                label="Intern anteckning"
                value={supplierInvoiceReviewForm.notes}
                onChange={e => setSupplierInvoiceReviewForm(prev => ({ ...prev, notes: e.target.value }))}
              />
              <label className="block text-sm font-semibold text-slate-700 md:col-span-2">
                Byt eller lägg till fakturafil
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
                  onChange={e => setSupplierInvoiceFile(e.target.files?.[0] ?? null)}
                  className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-blue-700"
                />
                {supplierInvoiceFile && (
                  <span className="mt-2 block text-xs font-medium text-slate-500">
                    {supplierInvoiceFile.name} · {Math.round(supplierInvoiceFile.size / 1024)} kB
                  </span>
                )}
              </label>
            </div>

            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-700">Beräknad total</p>
              <p className="mt-1 text-2xl font-bold text-slate-950">
                {formatCurrency(
                  toNumber(supplierInvoiceReviewForm.quantity, 1) *
                    toNumber(supplierInvoiceReviewForm.unit_price, 0) *
                    (1 + toNumber(supplierInvoiceReviewForm.vat_rate, 25) / 100),
                )}
              </p>
            </div>

            {selectedSupplierInvoice.ocr_status !== 'not_started' && (
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">OCR-underlag</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {String(selectedSupplierInvoice.ocr_data?.extraction_note || 'Kontrollera uppgifterna mot bilagan innan attest.')}
                    </p>
                  </div>
                  <Badge className="bg-purple-50 text-purple-700">
                    {selectedSupplierInvoice.ocr_status === 'queued' ? 'Köad' : selectedSupplierInvoice.ocr_status === 'needs_review' ? 'Behöver granskas' : selectedSupplierInvoice.ocr_status}
                  </Badge>
                </div>
                <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fil</p>
                    <p className="mt-1 font-semibold text-slate-900">{String(selectedSupplierInvoice.ocr_data?.source_file_name || selectedSupplierInvoice.ocr_data?.file_name || 'Saknas')}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Föreslaget datum</p>
                    <p className="mt-1 font-semibold text-slate-900">{String(selectedSupplierInvoice.ocr_data?.suggested_invoice_date || '-')}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Föreslaget fakturanr</p>
                    <p className="mt-1 font-semibold text-slate-900">{String(selectedSupplierInvoice.ocr_data?.suggested_supplier_invoice_number || '-')}</p>
                  </div>
                </div>
              </Card>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setSupplierInvoiceDetailOpen(false)}>Stäng</Button>
              <Button
                variant="secondary"
                onClick={saveSupplierInvoiceReview}
                loading={saving}
                disabled={!supplierInvoiceReviewForm.company_id || !supplierInvoiceReviewForm.description.trim()}
              >
                Spara granskning
              </Button>
              {selectedSupplierInvoice.approval_status !== 'approved' && (
                <Button onClick={() => approveSupplierInvoice(selectedSupplierInvoice.id)} loading={saving}>
                  <CheckCircle2 className="h-4 w-4" />
                  Attestera
                </Button>
              )}
              {selectedSupplierInvoice.approval_status === 'approved' && selectedSupplierInvoice.payment_status === 'unpaid' && (
                <Button variant="secondary" onClick={() => scheduleSupplierInvoicePayment(selectedSupplierInvoice.id)} loading={saving}>
                  Planera betalning
                </Button>
              )}
              {selectedSupplierInvoice.approval_status === 'approved' && selectedSupplierInvoice.payment_status !== 'paid' && (
                <Button onClick={() => markSupplierInvoicePaid(selectedSupplierInvoice.id)} loading={saving}>
                  <CreditCard className="h-4 w-4" />
                  Markera betald
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={projectInvoiceModalOpen} onClose={() => setProjectInvoiceModalOpen(false)} title="Skapa faktura från projektunderlag" size="lg">
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Underlag"
            value={projectInvoiceForm.basis_id}
            options={[
              { value: '', label: 'Välj underlag' },
              ...projectBases.map(basis => ({
                value: basis.id,
                label: `${basis.basis_number || 'Underlag'} · ${basis.project?.title || basis.project?.name || 'Projekt'}`,
              })),
            ]}
            onChange={e => {
              const basis = projectBases.find(item => item.id === e.target.value);
              resetProjectInvoiceForm(basis);
            }}
          />
          <Select label="Bolag" value={projectInvoiceForm.company_id} options={companyOptions} onChange={e => setProjectInvoiceForm(prev => ({ ...prev, company_id: e.target.value }))} />
          <Select
            label="Ekonomikund"
            value={projectInvoiceForm.customer_id}
            options={[
              { value: '', label: 'Välj kund' },
              ...customers.map(customer => ({ value: customer.id, label: customer.name })),
            ]}
            onChange={e => setProjectInvoiceForm(prev => ({ ...prev, customer_id: e.target.value }))}
          />
          <Input label="Fakturadatum" type="date" value={projectInvoiceForm.invoice_date} onChange={e => setProjectInvoiceForm(prev => ({ ...prev, invoice_date: e.target.value }))} />
          <Input label="Förfallodatum" type="date" value={projectInvoiceForm.due_date} onChange={e => setProjectInvoiceForm(prev => ({ ...prev, due_date: e.target.value }))} />
        </div>
        <div className="mt-6 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
          Projektets faktureringsrader kopieras till ett vanligt fakturautkast. Underlaget markeras som fakturerat så det inte kan skapas dubbelt.
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setProjectInvoiceModalOpen(false)}>Avbryt</Button>
          <Button
            onClick={createInvoiceFromProjectBasis}
            loading={saving}
            disabled={!projectInvoiceForm.basis_id || !projectInvoiceForm.company_id || !projectInvoiceForm.customer_id}
          >
            Skapa fakturautkast
          </Button>
        </div>
      </Modal>

      <Modal open={rentRunModalOpen} onClose={() => setRentRunModalOpen(false)} title="Ny hyreskörning" size="lg">
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Bolag"
            value={rentRunForm.company_id}
            options={companyOptions}
            onChange={e => setRentRunForm(prev => ({ ...prev, company_id: e.target.value }))}
          />
          <Input
            label="Hyresmånad"
            type="month"
            value={rentRunForm.rent_period}
            onChange={e => setRentRunForm(prev => ({ ...prev, rent_period: e.target.value }))}
          />
        </div>
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={rentRunForm.include_existing}
            onChange={e => setRentRunForm(prev => ({ ...prev, include_existing: e.target.checked }))}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
          />
          <span>
            <span className="block font-semibold text-slate-900">Uppdatera befintlig körning om den redan finns</span>
            <span className="mt-1 block text-slate-500">
              Befintliga hyresrader dupliceras inte, men körningen räknas om så nya aktiva hyresförhållanden kan läggas till.
            </span>
          </span>
        </label>
        <div className="mt-4 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
          Förfallodag sätts automatiskt till sista dagen i månaden före hyresmånaden. Juni-hyran får alltså 31 maj som förfallodag.
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRentRunModalOpen(false)}>Avbryt</Button>
          <Button
            onClick={createRentRun}
            loading={saving}
            disabled={!rentRunForm.company_id || !rentRunForm.rent_period}
          >
            Skapa hyreskörning
          </Button>
        </div>
      </Modal>

      <Modal
        open={numberSeriesModalOpen}
        onClose={() => setNumberSeriesModalOpen(false)}
        title={selectedNumberSeries ? 'Redigera nummerserie' : 'Ny nummerserie'}
        size="lg"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Bolag"
            value={numberSeriesForm.company_id}
            options={companyOptions}
            onChange={e => setNumberSeriesForm(prev => ({ ...prev, company_id: e.target.value }))}
            disabled={Boolean(selectedNumberSeries)}
          />
          <Input
            label="Namn"
            value={numberSeriesForm.name}
            onChange={e => setNumberSeriesForm(prev => ({ ...prev, name: e.target.value }))}
          />
          <Input
            label="Prefix"
            value={numberSeriesForm.prefix}
            onChange={e => setNumberSeriesForm(prev => ({ ...prev, prefix: e.target.value }))}
          />
          <Input
            label="Nästa nummer"
            type="number"
            min="1"
            value={numberSeriesForm.next_number}
            onChange={e => setNumberSeriesForm(prev => ({ ...prev, next_number: e.target.value }))}
          />
          <Input
            label="Padding"
            type="number"
            min="0"
            value={numberSeriesForm.padding}
            onChange={e => setNumberSeriesForm(prev => ({ ...prev, padding: e.target.value }))}
          />
          <Input
            label="Räkenskapsår"
            type="number"
            value={numberSeriesForm.fiscal_year}
            onChange={e => setNumberSeriesForm(prev => ({ ...prev, fiscal_year: e.target.value }))}
            placeholder="Valfritt"
          />
        </div>
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={numberSeriesForm.active}
            onChange={e => setNumberSeriesForm(prev => ({ ...prev, active: e.target.checked }))}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
          />
          <span>
            <span className="block font-semibold text-slate-900">Aktiv nummerserie</span>
            <span className="mt-1 block text-slate-500">
              Fakturor hämtar nummer från en aktiv serie för bolaget när de godkänns.
            </span>
          </span>
        </label>
        <div className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          Ändra nästa nummer med försiktighet. Serien används när fakturautkast godkänns och får fakturanummer.
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setNumberSeriesModalOpen(false)}>Avbryt</Button>
          <Button
            onClick={saveNumberSeries}
            loading={saving}
            disabled={!numberSeriesForm.company_id || !numberSeriesForm.name.trim()}
          >
            Spara nummerserie
          </Button>
        </div>
      </Modal>

      <Modal
        open={rentRunDetailOpen}
        onClose={() => setRentRunDetailOpen(false)}
        title={selectedRentRun ? `Hyreskörning ${selectedRentRun.rent_period.slice(0, 7)}` : 'Hyreskörning'}
        size="xl"
      >
        {selectedRentRun && (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-4">
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bolag</p>
                <p className="mt-2 font-bold text-slate-950">{selectedRentRun.company?.name ?? 'Bolag saknas'}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Förfallodatum</p>
                <p className="mt-2 font-bold text-slate-950">{selectedRentRun.due_date}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rader</p>
                <p className="mt-2 font-bold text-slate-950">{selectedRentRun.invoice_count}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Summa</p>
                <p className="mt-2 font-bold text-slate-950">{formatCurrency(Number(selectedRentRun.total_amount))}</p>
              </Card>
            </div>

            <Card className="overflow-hidden">
              {selectedRentItems.length === 0 ? (
                <EmptyState title="Inga hyresrader i körningen" description="Kontrollera att det finns aktiva hyresförhållanden för vald månad och valt bolag." />
              ) : (
                <div className="divide-y divide-slate-100">
                  {selectedRentItems.map(item => (
                    <div key={item.id} className="grid gap-3 p-4 lg:grid-cols-[1.3fr_1fr_0.8fr_0.8fr_auto_auto] lg:items-center">
                      <div>
                        <h3 className="font-bold text-slate-950">{item.tenant?.name ?? 'Hyresgäst saknas'}</h3>
                        <p className="text-sm text-slate-500">
                          {item.apartment?.number || item.apartment?.address || 'Lägenhet saknas'} · {item.property?.name || 'Fastighet saknas'}
                        </p>
                      </div>
                      <p className="text-sm text-slate-600">{item.description}</p>
                      <p className="text-sm text-slate-600">Förfaller {item.due_date}</p>
                      <p className="font-semibold text-slate-950">{formatCurrency(Number(item.total_amount))}</p>
                      <Badge className={item.status === 'invoiced' ? 'bg-emerald-50 text-emerald-700' : item.status === 'skipped' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}>
                        {rentItemStatusLabel(item.status)}
                      </Badge>
                      <div className="flex flex-wrap justify-end gap-2">
                        {item.invoice_id ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              const invoice = invoices.find(existing => existing.id === item.invoice_id);
                              if (invoice) void openInvoiceDetail(invoice);
                            }}
                            disabled={!invoices.some(existing => existing.id === item.invoice_id)}
                          >
                            Faktura
                          </Button>
                        ) : item.status === 'skipped' ? (
                          <Button variant="secondary" size="sm" loading={saving} onClick={() => updateRentItemStatus(item, 'draft')}>
                            Ta med
                          </Button>
                        ) : (
                          <Button variant="secondary" size="sm" loading={saving} onClick={() => updateRentItemStatus(item, 'skipped')}>
                            Hoppa över
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setRentRunDetailOpen(false)}>Stäng</Button>
              <Button
                onClick={() => generateRentInvoices(selectedRentRun.id)}
                loading={saving}
                disabled={selectedRentRun.status !== 'draft' || selectedRentRun.invoice_count === 0}
              >
                Skapa fakturautkast
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={invoiceDetailOpen} onClose={() => setInvoiceDetailOpen(false)} title={selectedInvoice?.invoice_number ? `Faktura ${selectedInvoice.invoice_number}` : 'Fakturautkast'} size="xl">
        {selectedInvoice && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</p>
                <p className="mt-2 text-lg font-bold text-slate-950">{invoiceStatusLabel(selectedInvoice.status)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Att betala</p>
                <p className="mt-2 text-lg font-bold text-slate-950">{formatCurrency(Number(selectedInvoice.total_amount), selectedInvoice.currency)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Betalt</p>
                <p className="mt-2 text-lg font-bold text-slate-950">{formatCurrency(Number(selectedInvoice.paid_amount), selectedInvoice.currency)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Förfallodatum</p>
                <p className="mt-2 text-lg font-bold text-slate-950">{selectedInvoice.due_date}</p>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bolag</p>
                <h3 className="mt-2 font-bold text-slate-950">{selectedInvoice.company?.legal_name || selectedInvoice.company?.name || 'Bolag saknas'}</h3>
                <p className="text-sm text-slate-500">{selectedInvoice.company?.organisation_number || 'Organisationsnummer saknas'}</p>
                <p className="text-sm text-slate-500">{selectedInvoice.company?.email || 'Ingen e-post'}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kund</p>
                <h3 className="mt-2 font-bold text-slate-950">{selectedInvoice.customer?.name || 'Kund saknas'}</h3>
                <p className="text-sm text-slate-500">{selectedInvoice.customer?.organisation_number || 'Organisationsnummer saknas'}</p>
                <p className="text-sm text-slate-500">{selectedInvoice.customer?.invoice_email || selectedInvoice.customer?.email || 'Ingen faktura-e-post'}</p>
              </Card>
            </div>

            <Card className="overflow-hidden">
              <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="font-bold text-slate-950">Fakturarader</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {selectedInvoiceLines.map(line => (
                  <div key={line.id} className="grid gap-3 p-4 md:grid-cols-[1.4fr_0.5fr_0.6fr_0.4fr_0.6fr] md:items-center">
                    <p className="font-semibold text-slate-900">{line.description}</p>
                    <p className="text-sm text-slate-600">{line.quantity} {line.unit}</p>
                    <p className="text-sm text-slate-600">{formatCurrency(Number(line.unit_price), selectedInvoice.currency)}</p>
                    <p className="text-sm text-slate-600">{line.vat_rate}%</p>
                    <p className="font-semibold text-slate-950">{formatCurrency(Number(line.line_total_incl_vat), selectedInvoice.currency)}</p>
                  </div>
                ))}
              </div>
              <div className="flex justify-end border-t border-slate-100 bg-slate-50 p-4">
                <div className="w-full max-w-sm space-y-2 text-sm">
                  <div className="flex justify-between"><span>Exkl. moms</span><strong>{formatCurrency(Number(selectedInvoice.subtotal_amount), selectedInvoice.currency)}</strong></div>
                  <div className="flex justify-between"><span>Moms</span><strong>{formatCurrency(Number(selectedInvoice.vat_amount), selectedInvoice.currency)}</strong></div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 text-base"><span>Att betala</span><strong>{formatCurrency(Number(selectedInvoice.total_amount), selectedInvoice.currency)}</strong></div>
                </div>
              </div>
            </Card>

            {selectedInvoice.status === 'draft' && (
              <Card className="p-4">
                <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                  <Select
                    label="Nummerserie vid godkännande"
                    value={selectedApprovalSeriesId}
                    options={selectedInvoiceSeriesOptions}
                    onChange={e => setSelectedApprovalSeriesId(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setActiveTab('number-series');
                      setInvoiceDetailOpen(false);
                    }}
                  >
                    Hantera serier
                  </Button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Om ingen serie väljs används första aktiva serien för bolaget.
                </p>
              </Card>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={printInvoice}>
                <Printer className="h-4 w-4" />
                Skriv ut
              </Button>
              {selectedInvoice.original_invoice_id && (
                <Badge className="bg-amber-50 text-amber-700">
                  Kreditfaktura
                </Badge>
              )}
              {selectedInvoice.credited_by_invoice_id && (
                <Badge className="bg-slate-100 text-slate-700">
                  Krediterad
                </Badge>
              )}
              {selectedInvoice.status === 'draft' && (
                <Button onClick={approveInvoice} loading={saving}>
                  <CheckCircle2 className="h-4 w-4" />
                  Godkänn och skapa PDF
                </Button>
              )}
              {selectedInvoiceCanBeCredited && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCreditInvoiceForm(emptyCreditInvoiceForm);
                    setCreditInvoiceModalOpen(true);
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                  Skapa kreditfaktura
                </Button>
              )}
              {['approved', 'sent'].includes(selectedInvoice.status) && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      resetInvoiceEmailForm(selectedInvoice);
                      setInvoiceEmailModalOpen(true);
                    }}
                    disabled={!selectedInvoice.document_id}
                  >
                    <Mail className="h-4 w-4" />
                    Köa e-post
                  </Button>
                  <Button variant="secondary" onClick={markInvoiceSent} loading={saving}>
                    <Send className="h-4 w-4" />
                    Markera skickad
                  </Button>
                  <Button variant="secondary" onClick={queueSelectedInvoiceAccountingSync} loading={saving}>
                    <Landmark className="h-4 w-4" />
                    Köa bokföring
                  </Button>
                  <Button onClick={() => {
                    setPaymentForm({
                      ...emptyPaymentForm,
                      amount: String(Math.max(0, Number(selectedInvoice.total_amount) - Number(selectedInvoice.paid_amount))),
                    });
                    setPaymentModalOpen(true);
                  }}>
                    <CreditCard className="h-4 w-4" />
                    Registrera betalning
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} title="Registrera betalning" size="md">
        <div className="space-y-4">
          <Input label="Belopp" inputMode="decimal" value={paymentForm.amount} onChange={e => setPaymentForm(prev => ({ ...prev, amount: e.target.value }))} />
          <Input label="Betaldatum" type="date" value={paymentForm.payment_date} onChange={e => setPaymentForm(prev => ({ ...prev, payment_date: e.target.value }))} />
          <Input label="Referens" value={paymentForm.reference} onChange={e => setPaymentForm(prev => ({ ...prev, reference: e.target.value }))} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPaymentModalOpen(false)}>Avbryt</Button>
            <Button onClick={registerPayment} loading={saving} disabled={toNumber(paymentForm.amount, 0) <= 0}>Registrera</Button>
          </div>
        </div>
      </Modal>

      <Modal open={paymentImportModalOpen} onClose={() => setPaymentImportModalOpen(false)} title="Importera betalningar" size="lg">
        <div className="space-y-4">
          <div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
            Importen matchar betalningar mot fakturanummer. Använd rubrikerna invoice_number, amount, payment_date, reference och gärna external_payment_id för att undvika dubbletter.
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Bolag"
              value={paymentImportForm.company_id}
              options={companyOptions}
              onChange={e => setPaymentImportForm(prev => ({ ...prev, company_id: e.target.value }))}
            />
            <Select
              label="Källa"
              value={paymentImportForm.source}
              options={[
                { value: 'bank', label: 'Bank' },
                { value: 'accounting', label: 'Bokföring' },
                { value: 'swish', label: 'Swish' },
                { value: 'autogiro', label: 'Autogiro' },
              ]}
              onChange={e => setPaymentImportForm(prev => ({ ...prev, source: e.target.value as Payment['source'] }))}
            />
          </div>
          <label className="block text-sm font-semibold text-slate-700">
            CSV-fil
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={e => readPaymentImportFile(e.target.files?.[0])}
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-blue-700"
            />
          </label>
          <Textarea
            label="CSV-innehåll"
            value={paymentImportForm.csv}
            onChange={e => setPaymentImportForm(prev => ({ ...prev, csv: e.target.value }))}
            rows={8}
            placeholder={'invoice_number;amount;payment_date;reference;external_payment_id\nF0001;1250,00;2026-08-09;Bankgiro;bank-123'}
          />
          {paymentImportResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
              {paymentImportResult}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPaymentImportModalOpen(false)}>Stäng</Button>
            <Button
              onClick={importPayments}
              loading={saving}
              disabled={!paymentImportForm.company_id || !paymentImportForm.csv.trim()}
            >
              <Upload className="h-4 w-4" />
              Importera
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={creditInvoiceModalOpen} onClose={() => setCreditInvoiceModalOpen(false)} title="Skapa kreditfaktura" size="md">
        <div className="space-y-4">
          <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            En separat kreditfaktura skapas som utkast med negativa fakturarader. När kreditfakturan godkänns får den eget fakturanummer och originalfakturan markeras som krediterad.
          </div>
          {selectedInvoice && (
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Originalfaktura</p>
              <p className="mt-2 font-bold text-slate-950">{selectedInvoice.invoice_number || selectedInvoice.id.slice(0, 8)}</p>
              <p className="text-sm text-slate-500">{selectedInvoice.customer?.name || 'Kund saknas'} · {formatCurrency(Number(selectedInvoice.total_amount), selectedInvoice.currency)}</p>
            </Card>
          )}
          <Textarea
            label="Orsak"
            value={creditInvoiceForm.reason}
            onChange={e => setCreditInvoiceForm(prev => ({ ...prev, reason: e.target.value }))}
            rows={4}
            placeholder="Till exempel: Felaktigt belopp, kund annullerade eller ny faktura skapas."
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreditInvoiceModalOpen(false)}>Avbryt</Button>
            <Button onClick={createCreditInvoice} loading={saving}>
              <RotateCcw className="h-4 w-4" />
              Skapa kreditutkast
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={invoiceEmailModalOpen} onClose={() => setInvoiceEmailModalOpen(false)} title="Köa fakturamejl" size="lg">
        <div className="space-y-4">
          <div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
            Mejlet läggs i en e-postkö tillsammans med fakturans PDF. En serverfunktion kan sedan skicka köade mejl via SMTP/Postfix eller vald mejlleverantör.
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Mottagarens e-post"
              type="email"
              value={invoiceEmailForm.recipient_email}
              onChange={e => setInvoiceEmailForm(prev => ({ ...prev, recipient_email: e.target.value }))}
            />
            <Input
              label="Mottagarens namn"
              value={invoiceEmailForm.recipient_name}
              onChange={e => setInvoiceEmailForm(prev => ({ ...prev, recipient_name: e.target.value }))}
            />
          </div>
          <Input
            label="Ämne"
            value={invoiceEmailForm.subject}
            onChange={e => setInvoiceEmailForm(prev => ({ ...prev, subject: e.target.value }))}
          />
          <Textarea
            label="Meddelande"
            value={invoiceEmailForm.message}
            onChange={e => setInvoiceEmailForm(prev => ({ ...prev, message: e.target.value }))}
            rows={7}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setInvoiceEmailModalOpen(false)}>Avbryt</Button>
            <Button
              onClick={queueInvoiceEmail}
              loading={saving}
              disabled={!invoiceEmailForm.recipient_email.trim() || !invoiceEmailForm.subject.trim()}
            >
              <Mail className="h-4 w-4" />
              Lägg i e-postkö
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
        </div>
        <div className="rounded-lg bg-blue-50 p-3 text-blue-600">{icon}</div>
      </div>
    </Card>
  );
}
