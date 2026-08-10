import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, CalendarDays, Camera, CheckCircle2, CircleDollarSign, CreditCard, FileText, Hash, Landmark, Link2, Mail, Plus, Printer, ReceiptText, RotateCcw, Send, Sparkles, Truck, Upload, Users, WalletCards } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { buildInvoicePdfBlob } from '../lib/invoicePdf';
import { DocumentCapture } from '../components/DocumentCapture';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, Select, Textarea } from '../components/ui';
import type { AccountingAccount, AccountingIntegration, AccountingSyncQueueItem, CustomerProject, DirectDebitMandate, FinanceAuditLog, FinanceAutomationRun, FinanceAutomationSettings, FinanceCompany, FinanceCustomer, FinanceReminderSettings, FinanceSupplier, Invoice, InvoiceEmailOutbox, InvoiceLine, InvoiceNumberSeries, OcrUsageLog, Payment, ProjectInvoiceBasis, RentAdjustment, RentBillingItem, RentBillingRun, SupplierInvoice, SupplierInvoiceLine, Tenancy, VatCode } from '../types';

interface FinancePageProps {
  onNavigate: (page: string) => void;
}

type FinanceTab = 'overview' | 'companies' | 'customers' | 'invoices' | 'payments' | 'email' | 'rent' | 'project-basis' | 'suppliers' | 'supplier-invoices' | 'number-series' | 'integrations' | 'ocr-usage' | 'audit';

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
  bankgiro: '',
  plusgiro: '',
  iban: '',
  bic: '',
  bank_account: '',
  payment_reference: '',
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
  vat_code: '',
  account_code: '',
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

const emptyInvoiceLineForm = {
  description: '',
  quantity: '1',
  unit: 'st',
  unit_price: '0',
  vat_code: '',
  vat_rate: '25',
  account_code: '',
};

const emptySupplierInvoiceForm = {
  document_kind: 'supplier_invoice',
  company_id: '',
  supplier_id: '',
  supplier_invoice_number: '',
  invoice_date: new Date().toISOString().slice(0, 10),
  due_date: '',
  description: '',
  quantity: '1',
  unit_price: '0',
  vat_rate: '25',
  vat_code: '',
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

const emptyRentAdjustmentForm = {
  company_id: '',
  tenancy_id: '',
  adjustment_type: 'one_time',
  rent_period: new Date().toISOString().slice(0, 7),
  end_period: '',
  description: '',
  amount: '',
  percentage_rate: '',
  vat_rate: '0',
};

const emptyDirectDebitMandateForm = {
  company_id: '',
  tenancy_id: '',
  mandate_reference: '',
  bankgiro_number: '',
  payer_number: '',
  account_holder: '',
  account_mask: '',
  status: 'draft' as DirectDebitMandate['status'],
  notes: '',
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

const defaultAutomationSettingsDraft = {
  finance_cron_enabled: true,
  queue_reminders: true,
  send_emails: false,
  email_limit: '20',
  process_accounting_sync: false,
  accounting_sync_limit: '50',
  create_rent_billing: false,
  rent_billing_months_ahead: '1',
  auto_generate_rent_invoices: false,
};

type AutomationSettingsDraft = typeof defaultAutomationSettingsDraft;

const emptyIntegrationConfigForm = {
  company_id: '',
  provider: 'manual' as AccountingIntegration['provider'],
  status: 'paused' as AccountingIntegration['status'],
  mode: 'manual',
  export_format: 'csv',
  external_tenant_id: '',
  notes: '',
  config_json: '{}',
  secret_value: '',
};

type IntegrationConfigForm = typeof emptyIntegrationConfigForm;

const emptyAccountingAccountForm = {
  company_id: '',
  account_code: '',
  name: '',
  account_type: 'other' as AccountingAccount['account_type'],
  default_role: '' as AccountingAccount['default_role'],
  active: true,
};

const emptyVatCodeForm = {
  company_id: '',
  code: '',
  name: '',
  rate: '25',
  sales_account_code: '',
  purchase_account_code: '',
  output_vat_account_code: '',
  input_vat_account_code: '',
  active: true,
};

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

function prettyJson(value: unknown) {
  return JSON.stringify(value && typeof value === 'object' ? value : {}, null, 2);
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

function rentAdjustmentStatusLabel(status: RentAdjustment['status']) {
  const labels: Record<RentAdjustment['status'], string> = {
    active: 'Aktiv',
    cancelled: 'Avbruten',
    applied: 'Tillämpad',
  };
  return labels[status] ?? status;
}

function tenancyLabel(tenancy: Tenancy | null | undefined) {
  if (!tenancy) return 'Hyresförhållande saknas';
  const tenantName = tenancy.tenant?.name || 'Hyresgäst saknas';
  const apartmentName = tenancy.apartment?.apartment_number ? `Lgh ${tenancy.apartment.apartment_number}` : 'Lägenhet saknas';
  const propertyName = tenancy.property?.name || tenancy.property?.address || '';
  return [tenantName, apartmentName, propertyName].filter(Boolean).join(' · ');
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
  const [rentAdjustments, setRentAdjustments] = useState<RentAdjustment[]>([]);
  const [directDebitMandates, setDirectDebitMandates] = useState<DirectDebitMandate[]>([]);
  const [tenancies, setTenancies] = useState<Tenancy[]>([]);
  const [numberSeries, setNumberSeries] = useState<InvoiceNumberSeries[]>([]);
  const [integrations, setIntegrations] = useState<AccountingIntegration[]>([]);
  const [accountingAccounts, setAccountingAccounts] = useState<AccountingAccount[]>([]);
  const [vatCodes, setVatCodes] = useState<VatCode[]>([]);
  const [reminderSettings, setReminderSettings] = useState<FinanceReminderSettings[]>([]);
  const [reminderSettingsDrafts, setReminderSettingsDrafts] = useState<Record<string, ReminderSettingsDraft>>({});
  const [accountingQueue, setAccountingQueue] = useState<AccountingSyncQueueItem[]>([]);
  const [financeAuditLogs, setFinanceAuditLogs] = useState<FinanceAuditLog[]>([]);
  const [ocrUsageLogs, setOcrUsageLogs] = useState<OcrUsageLog[]>([]);
  const [automationRuns, setAutomationRuns] = useState<FinanceAutomationRun[]>([]);
  const [automationSettings, setAutomationSettings] = useState<FinanceAutomationSettings | null>(null);
  const [automationSettingsDraft, setAutomationSettingsDraft] = useState<AutomationSettingsDraft>(defaultAutomationSettingsDraft);
  const [projectBases, setProjectBases] = useState<Array<ProjectInvoiceBasis & { project?: CustomerProject | null }>>([]);
  const [rentItems, setRentItems] = useState<RentBillingItem[]>([]);
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
  const [integrationConfigModalOpen, setIntegrationConfigModalOpen] = useState(false);
  const [accountingAccountModalOpen, setAccountingAccountModalOpen] = useState(false);
  const [vatCodeModalOpen, setVatCodeModalOpen] = useState(false);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoiceForm);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [paymentImportForm, setPaymentImportForm] = useState(emptyPaymentImportForm);
  const [invoiceEmailForm, setInvoiceEmailForm] = useState(emptyInvoiceEmailForm);
  const [creditInvoiceForm, setCreditInvoiceForm] = useState(emptyCreditInvoiceForm);
  const [invoiceLineForm, setInvoiceLineForm] = useState(emptyInvoiceLineForm);
  const [paymentImportResult, setPaymentImportResult] = useState('');
  const [supplierInvoiceForm, setSupplierInvoiceForm] = useState(emptySupplierInvoiceForm);
  const [supplierInvoiceReviewForm, setSupplierInvoiceReviewForm] = useState(emptySupplierInvoiceForm);
  const [supplierInvoiceLineForm, setSupplierInvoiceLineForm] = useState(emptySupplierInvoiceForm);
  const [supplierInvoiceFile, setSupplierInvoiceFile] = useState<File | null>(null);
  const [projectInvoiceForm, setProjectInvoiceForm] = useState(emptyProjectInvoiceForm);
  const [selectedProjectBasisIds, setSelectedProjectBasisIds] = useState<string[]>([]);
  const [rentRunForm, setRentRunForm] = useState(emptyRentRunForm);
  const [rentAdjustmentForm, setRentAdjustmentForm] = useState(emptyRentAdjustmentForm);
  const [directDebitMandateForm, setDirectDebitMandateForm] = useState(emptyDirectDebitMandateForm);
  const [rentEmailQueueResult, setRentEmailQueueResult] = useState('');
  const [numberSeriesForm, setNumberSeriesForm] = useState(emptyNumberSeriesForm);
  const [integrationConfigForm, setIntegrationConfigForm] = useState<IntegrationConfigForm>(emptyIntegrationConfigForm);
  const [accountingAccountForm, setAccountingAccountForm] = useState(emptyAccountingAccountForm);
  const [vatCodeForm, setVatCodeForm] = useState(emptyVatCodeForm);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [selectedInvoiceLines, setSelectedInvoiceLines] = useState<InvoiceLine[]>([]);
  const [selectedInvoiceLine, setSelectedInvoiceLine] = useState<InvoiceLine | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<FinanceSupplier | null>(null);
  const [selectedSupplierInvoice, setSelectedSupplierInvoice] = useState<SupplierInvoice | null>(null);
  const [selectedSupplierInvoiceLines, setSelectedSupplierInvoiceLines] = useState<SupplierInvoiceLine[]>([]);
  const [selectedSupplierInvoiceLine, setSelectedSupplierInvoiceLine] = useState<SupplierInvoiceLine | null>(null);
  const [selectedRentRun, setSelectedRentRun] = useState<RentBillingRun | null>(null);
  const [selectedRentItems, setSelectedRentItems] = useState<RentBillingItem[]>([]);
  const [rentDirectDebitExportResult, setRentDirectDebitExportResult] = useState('');
  const [supplierPaymentExportResult, setSupplierPaymentExportResult] = useState('');
  const [selectedNumberSeries, setSelectedNumberSeries] = useState<InvoiceNumberSeries | null>(null);
  const [selectedIntegration, setSelectedIntegration] = useState<AccountingIntegration | null>(null);
  const [selectedAccountingAccount, setSelectedAccountingAccount] = useState<AccountingAccount | null>(null);
  const [selectedVatCode, setSelectedVatCode] = useState<VatCode | null>(null);
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

  const selectedProjectBases = useMemo(() => {
    return projectBases.filter(basis => selectedProjectBasisIds.includes(basis.id));
  }, [projectBases, selectedProjectBasisIds]);

  const invoiceAccountOptions = useMemo(() => {
    const scoped = invoiceForm.company_id
      ? accountingAccounts.filter(account => account.company_id === invoiceForm.company_id && account.active)
      : [];
    return [
      { value: '', label: 'Automatiskt försäljningskonto' },
      ...scoped
        .sort((a, b) => a.account_code.localeCompare(b.account_code, 'sv-SE'))
        .map(account => ({ value: account.account_code, label: `${account.account_code} · ${account.name}` })),
    ];
  }, [accountingAccounts, invoiceForm.company_id]);

  const invoiceVatCodeOptions = useMemo(() => {
    const scoped = invoiceForm.company_id
      ? vatCodes.filter(code => code.company_id === invoiceForm.company_id && code.active)
      : [];
    return [
      { value: '', label: 'Ange moms manuellt' },
      ...scoped
        .sort((a, b) => a.code.localeCompare(b.code, 'sv-SE'))
        .map(code => ({ value: code.code, label: `${code.code} · ${code.name} · ${Number(code.rate)}%` })),
    ];
  }, [invoiceForm.company_id, vatCodes]);

  const selectedInvoiceAccountOptions = useMemo(() => {
    const scoped = selectedInvoice
      ? accountingAccounts.filter(account => account.company_id === selectedInvoice.company_id && account.active)
      : [];
    return [
      { value: '', label: 'Automatiskt försäljningskonto' },
      ...scoped
        .sort((a, b) => a.account_code.localeCompare(b.account_code, 'sv-SE'))
        .map(account => ({ value: account.account_code, label: `${account.account_code} · ${account.name}` })),
    ];
  }, [accountingAccounts, selectedInvoice]);

  const selectedInvoiceVatCodeOptions = useMemo(() => {
    const scoped = selectedInvoice
      ? vatCodes.filter(code => code.company_id === selectedInvoice.company_id && code.active)
      : [];
    return [
      { value: '', label: 'Ange moms manuellt' },
      ...scoped
        .sort((a, b) => a.code.localeCompare(b.code, 'sv-SE'))
        .map(code => ({ value: code.code, label: `${code.code} · ${code.name} · ${Number(code.rate)}%` })),
    ];
  }, [selectedInvoice, vatCodes]);

  const supplierInvoiceAccountOptions = useMemo(() => {
    const scoped = supplierInvoiceForm.company_id
      ? accountingAccounts.filter(account => account.company_id === supplierInvoiceForm.company_id && account.active)
      : [];
    return [
      { value: '', label: 'Välj konto' },
      ...scoped
        .sort((a, b) => a.account_code.localeCompare(b.account_code, 'sv-SE'))
        .map(account => ({ value: account.account_code, label: `${account.account_code} · ${account.name}` })),
    ];
  }, [accountingAccounts, supplierInvoiceForm.company_id]);

  const supplierInvoiceVatCodeOptions = useMemo(() => {
    const scoped = supplierInvoiceForm.company_id
      ? vatCodes.filter(code => code.company_id === supplierInvoiceForm.company_id && code.active)
      : [];
    return [
      { value: '', label: 'Ange moms manuellt' },
      ...scoped
        .sort((a, b) => a.code.localeCompare(b.code, 'sv-SE'))
        .map(code => ({ value: code.code, label: `${code.code} · ${code.name} · ${Number(code.rate)}%` })),
    ];
  }, [supplierInvoiceForm.company_id, vatCodes]);

  const supplierInvoiceReviewAccountOptions = useMemo(() => {
    const companyId = supplierInvoiceReviewForm.company_id || selectedSupplierInvoice?.company_id || '';
    const scoped = companyId
      ? accountingAccounts.filter(account => account.company_id === companyId && account.active)
      : [];
    return [
      { value: '', label: 'Välj konto' },
      ...scoped
        .sort((a, b) => a.account_code.localeCompare(b.account_code, 'sv-SE'))
        .map(account => ({ value: account.account_code, label: `${account.account_code} · ${account.name}` })),
    ];
  }, [accountingAccounts, selectedSupplierInvoice, supplierInvoiceReviewForm.company_id]);

  const supplierInvoiceReviewVatCodeOptions = useMemo(() => {
    const companyId = supplierInvoiceReviewForm.company_id || selectedSupplierInvoice?.company_id || '';
    const scoped = companyId
      ? vatCodes.filter(code => code.company_id === companyId && code.active)
      : [];
    return [
      { value: '', label: 'Ange moms manuellt' },
      ...scoped
        .sort((a, b) => a.code.localeCompare(b.code, 'sv-SE'))
        .map(code => ({ value: code.code, label: `${code.code} · ${code.name} · ${Number(code.rate)}%` })),
    ];
  }, [selectedSupplierInvoice, supplierInvoiceReviewForm.company_id, vatCodes]);

  const accountingAccountOptions = useMemo(() => {
    const scoped = vatCodeForm.company_id
      ? accountingAccounts.filter(account => account.company_id === vatCodeForm.company_id && account.active)
      : accountingAccounts.filter(account => account.active);

    return [
      { value: '', label: 'Välj konto' },
      ...scoped
        .sort((a, b) => a.account_code.localeCompare(b.account_code, 'sv-SE'))
        .map(account => ({ value: account.account_code, label: `${account.account_code} · ${account.name}` })),
    ];
  }, [accountingAccounts, vatCodeForm.company_id]);

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

  const ocrUsageThisMonth = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7);
    const rows = ocrUsageLogs.filter(log => log.created_at.slice(0, 7) === month);
    const documents = new Set(rows.map(log => log.supplier_invoice_id || log.document_id || log.id)).size;
    const totalCost = rows.reduce((sum, log) => sum + Number(log.estimated_cost_sek || 0), 0);
    return {
      documents,
      pdfText: rows.filter(log => log.extraction_method.includes('pdf_text')).length,
      ocr: rows.filter(log => log.ocr_provider && !['', 'none'].includes(log.ocr_provider)).length,
      vision: rows.filter(log => log.vision_fallback_used).length,
      cost: totalCost,
      average: documents > 0 ? totalCost / documents : 0,
    };
  }, [ocrUsageLogs]);

  const confidenceBadgeClass = (value: unknown) => {
    const number = Number(value ?? 0);
    if (number >= 0.85) return 'bg-emerald-50 text-emerald-700';
    if (number >= 0.6) return 'bg-amber-50 text-amber-700';
    return 'bg-red-50 text-red-700';
  };

  const paidAmount = useMemo(() => {
    return payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  }, [payments]);

  const financeReadiness = useMemo(() => {
    return companies.map(company => {
      const companySeries = numberSeries.filter(series => series.company_id === company.id && series.active);
      const companyAccounts = accountingAccounts.filter(account => account.company_id === company.id && account.active);
      const companyVatCodes = vatCodes.filter(code => code.company_id === company.id && code.active);
      const companyIntegration = integrations.find(integration => integration.company_id === company.id && integration.enabled);
      const companySuppliers = suppliers.filter(supplier => !supplier.company_id || supplier.company_id === company.id);
      const suppliersMissingPayment = companySuppliers.filter(supplier => !supplier.bankgiro && !supplier.plusgiro && !supplier.iban && !supplier.bank_account).length;
      const companyInvoices = invoices.filter(invoice => invoice.company_id === company.id);
      const emailReady = Boolean(company.email);
      const checks = [
        { key: 'series', label: 'Fakturanummerserie', ok: companySeries.length > 0, detail: companySeries.length > 0 ? `${companySeries.length} aktiv` : 'Skapa en aktiv serie' },
        { key: 'accounts', label: 'Kontoplan', ok: companyAccounts.length > 0, detail: companyAccounts.length > 0 ? `${companyAccounts.length} konton` : 'Lägg upp konton' },
        { key: 'vat', label: 'Momskoder', ok: companyVatCodes.length > 0, detail: companyVatCodes.length > 0 ? `${companyVatCodes.length} momskoder` : 'Lägg upp momskoder' },
        { key: 'email', label: 'Fakturaavsändare', ok: emailReady, detail: emailReady ? company.email : 'Bolaget saknar e-post' },
        { key: 'integration', label: 'Bokföring', ok: Boolean(companyIntegration), detail: companyIntegration ? companyIntegration.provider.toUpperCase() : 'Ingen aktiv adapter' },
        { key: 'supplier-payments', label: 'Leverantörsbetalningar', ok: suppliersMissingPayment === 0, detail: suppliersMissingPayment === 0 ? 'Betaluppgifter ok' : `${suppliersMissingPayment} saknar betaluppgift` },
      ];
      const missing = checks.filter(check => !check.ok).length;
      return {
        company,
        checks,
        missing,
        invoiceCount: companyInvoices.length,
        openAmount: companyInvoices
          .filter(invoice => !['paid', 'credited', 'cancelled'].includes(invoice.status))
          .reduce((sum, invoice) => sum + Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0), 0),
      };
    });
  }, [accountingAccounts, companies, integrations, invoices, numberSeries, suppliers, vatCodes]);

  const selectedInvoiceCanBeCredited = Boolean(
    selectedInvoice &&
    !selectedInvoice.original_invoice_id &&
    !selectedInvoice.credited_by_invoice_id &&
    ['approved', 'sent', 'partially_paid', 'paid', 'overdue'].includes(selectedInvoice.status),
  );

  const rentAdjustmentTenancyOptions = useMemo(() => {
    const scoped = rentAdjustmentForm.company_id
      ? tenancies.filter(tenancy => !tenancy.company_id || tenancy.company_id === rentAdjustmentForm.company_id)
      : tenancies;

    return [
      { value: '', label: 'Välj hyresgäst/lägenhet' },
      ...scoped.map(tenancy => ({ value: tenancy.id, label: tenancyLabel(tenancy) })),
    ];
  }, [rentAdjustmentForm.company_id, tenancies]);

  const directDebitTenancyOptions = useMemo(() => {
    const scoped = directDebitMandateForm.company_id
      ? tenancies.filter(tenancy => !tenancy.company_id || tenancy.company_id === directDebitMandateForm.company_id)
      : tenancies;
    const usedTenancyIds = new Set(directDebitMandates.map(mandate => mandate.tenancy_id));

    return [
      { value: '', label: 'Välj hyresgäst/lägenhet' },
      ...scoped
        .filter(tenancy => tenancy.id === directDebitMandateForm.tenancy_id || !usedTenancyIds.has(tenancy.id))
        .map(tenancy => ({ value: tenancy.id, label: tenancyLabel(tenancy) })),
    ];
  }, [directDebitMandateForm.company_id, directDebitMandateForm.tenancy_id, directDebitMandates, tenancies]);

  const rentLedgerRows = useMemo(() => {
    return tenancies
      .filter(tenancy => tenancy.status === 'active')
      .map(tenancy => {
        const items = rentItems.filter(item => item.tenancy_id === tenancy.id);
        const mandate = directDebitMandates.find(item => item.tenancy_id === tenancy.id && item.status === 'active');
        const invoicedItems = items.filter(item => item.status === 'invoiced' && item.invoice);
        const invoicedAmount = invoicedItems.reduce((sum, item) => sum + Number(item.invoice?.total_amount ?? item.total_amount ?? 0), 0);
        const paidAmountForTenancy = invoicedItems.reduce((sum, item) => sum + Number(item.invoice?.paid_amount ?? 0), 0);
        const balance = invoicedItems.reduce((sum, item) => {
          const fallbackBalance = Math.max(Number(item.invoice?.total_amount ?? item.total_amount ?? 0) - Number(item.invoice?.paid_amount ?? 0), 0);
          return sum + Number(item.invoice?.balance_due ?? fallbackBalance);
        }, 0);
        const unpaidCount = invoicedItems.filter(item => item.invoice && !['paid', 'credited', 'cancelled'].includes(item.invoice.status)).length;
        const latestItem = items
          .slice()
          .sort((a, b) => b.rent_period.localeCompare(a.rent_period) || b.created_at.localeCompare(a.created_at))[0];
        return {
          tenancy,
          latestPeriod: latestItem?.rent_period ? latestItem.rent_period.slice(0, 7) : '-',
          invoicedAmount,
          paidAmount: paidAmountForTenancy,
          balance,
          unpaidCount,
          mandate,
          lastInvoiceStatus: latestItem?.invoice?.payment_status || latestItem?.status || '-',
        };
      })
      .sort((a, b) => b.balance - a.balance || tenancyLabel(a.tenancy).localeCompare(tenancyLabel(b.tenancy), 'sv-SE'));
  }, [directDebitMandates, rentItems, tenancies]);

  const loadFinance = useCallback(async () => {
    if (!organisationId) return;
    setLoading(true);
    setError('');

    const [companyResult, customerResult, supplierResult, invoiceResult, paymentResult, invoiceEmailResult, supplierInvoiceResult, integrationResult, accountingAccountsResult, vatCodesResult, reminderSettingsResult, accountingQueueResult, financeAuditResult, ocrUsageResult, automationRunsResult, automationSettingsResult, projectBasisResult, rentRunResult, rentItemResult, rentAdjustmentResult, directDebitMandateResult, tenancyResult, numberSeriesResult] = await Promise.all([
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
        .select('*, company:company_id(*), supplier:supplier_id(*), document:document_id(id, storage_bucket, storage_path)')
        .eq('organisation_id', organisationId)
        .order('due_date', { ascending: true }),
      supabase
        .from('vihem_accounting_integrations')
        .select('*')
        .eq('organisation_id', organisationId)
        .order('created_at', { ascending: true }),
      supabase
        .from('vihem_accounting_accounts')
        .select('*')
        .eq('organisation_id', organisationId)
        .order('account_code', { ascending: true }),
      supabase
        .from('vihem_vat_codes')
        .select('*')
        .eq('organisation_id', organisationId)
        .order('rate', { ascending: false }),
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
        .from('vihem_finance_audit_log')
        .select('*, company:company_id(*), changed_by_profile:changed_by(id,name,email)')
        .eq('organisation_id', organisationId)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('vihem_ocr_usage_logs')
        .select('*, company:company_id(*)')
        .eq('organisation_id', organisationId)
        .order('created_at', { ascending: false })
        .limit(250),
      supabase
        .from('vihem_finance_automation_runs')
        .select('*')
        .or(`organisation_id.eq.${organisationId},organisation_id.is.null`)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('vihem_finance_automation_settings')
        .select('*')
        .eq('organisation_id', organisationId)
        .maybeSingle(),
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
        .from('vihem_rent_billing_items')
        .select('*, company:company_id(*), tenant:tenant_id(id,name,email), property:property_id(id,name,address), apartment:apartment_id(id,apartment_number), invoice:invoice_id(*)')
        .eq('organisation_id', organisationId)
        .order('rent_period', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('vihem_rent_adjustments')
        .select('*, company:company_id(*), tenancy:tenancy_id(*, tenant:tenant_id(id,name,email), property:property_id(id,name,address), apartment:apartment_id(id,apartment_number))')
        .eq('organisation_id', organisationId)
        .order('rent_period', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('vihem_direct_debit_mandates')
        .select('*, company:company_id(*), tenancy:tenancy_id(*, tenant:tenant_id(id,name,email), property:property_id(id,name,address), apartment:apartment_id(id,apartment_number)), finance_customer:finance_customer_id(*)')
        .eq('organisation_id', organisationId)
        .order('created_at', { ascending: false }),
      supabase
        .from('vihem_tenancies')
        .select('*, tenant:tenant_id(id,name,email), property:property_id(id,name,address), apartment:apartment_id(id,apartment_number)')
        .eq('organisation_id', organisationId)
        .eq('status', 'active')
        .order('start_date', { ascending: false }),
      supabase
        .from('vihem_invoice_number_series')
        .select('*, company:company_id(*)')
        .eq('organisation_id', organisationId)
        .order('created_at', { ascending: true }),
    ]);

    const firstError = companyResult.error ?? customerResult.error ?? supplierResult.error ?? invoiceResult.error ?? paymentResult.error ?? invoiceEmailResult.error ?? supplierInvoiceResult.error ?? integrationResult.error ?? accountingAccountsResult.error ?? vatCodesResult.error ?? reminderSettingsResult.error ?? accountingQueueResult.error ?? financeAuditResult.error ?? ocrUsageResult.error ?? automationRunsResult.error ?? automationSettingsResult.error ?? projectBasisResult.error ?? rentRunResult.error ?? rentItemResult.error ?? rentAdjustmentResult.error ?? directDebitMandateResult.error ?? tenancyResult.error ?? numberSeriesResult.error;
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
    setAccountingAccounts((accountingAccountsResult.data ?? []) as AccountingAccount[]);
    setVatCodes((vatCodesResult.data ?? []) as VatCode[]);
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
    setOcrUsageLogs((ocrUsageResult.data ?? []) as OcrUsageLog[]);
    setFinanceAuditLogs((financeAuditResult.data ?? []) as FinanceAuditLog[]);
    setAutomationRuns((automationRunsResult.data ?? []) as FinanceAutomationRun[]);
    const nextAutomationSettings = automationSettingsResult.data as FinanceAutomationSettings | null;
    setAutomationSettings(nextAutomationSettings);
    setAutomationSettingsDraft({
      finance_cron_enabled: nextAutomationSettings?.finance_cron_enabled ?? true,
      queue_reminders: nextAutomationSettings?.queue_reminders ?? true,
      send_emails: nextAutomationSettings?.send_emails ?? false,
      email_limit: String(nextAutomationSettings?.email_limit ?? 20),
      process_accounting_sync: nextAutomationSettings?.process_accounting_sync ?? false,
      accounting_sync_limit: String(nextAutomationSettings?.accounting_sync_limit ?? 50),
      create_rent_billing: nextAutomationSettings?.create_rent_billing ?? false,
      rent_billing_months_ahead: String(nextAutomationSettings?.rent_billing_months_ahead ?? 1),
      auto_generate_rent_invoices: nextAutomationSettings?.auto_generate_rent_invoices ?? false,
    });
    setProjectBases((projectBasisResult.data ?? []) as Array<ProjectInvoiceBasis & { project?: CustomerProject | null }>);
    setRentRuns((rentRunResult.data ?? []) as RentBillingRun[]);
    setRentItems((rentItemResult.data ?? []) as RentBillingItem[]);
    setRentAdjustments((rentAdjustmentResult.data ?? []) as RentAdjustment[]);
    setDirectDebitMandates((directDebitMandateResult.data ?? []) as DirectDebitMandate[]);
    setTenancies((tenancyResult.data ?? []) as Tenancy[]);
    setNumberSeries((numberSeriesResult.data ?? []) as InvoiceNumberSeries[]);
    setLoading(false);
  }, [organisationId]);

  useEffect(() => {
    void loadFinance();
  }, [loadFinance]);

  const resetCompanyForm = () => setCompanyForm(emptyCompanyForm);
  const resetCustomerForm = () => setCustomerForm({ ...emptyCustomerForm, company_id: companies[0]?.id ?? '' });
  const resetSupplierForm = () => {
    setSelectedSupplier(null);
    setSupplierForm({ ...emptySupplierForm, company_id: companies[0]?.id ?? '' });
  };
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

  const openEditSupplier = (supplier: FinanceSupplier) => {
    setSelectedSupplier(supplier);
    setSupplierForm({
      company_id: supplier.company_id || '',
      name: supplier.name || '',
      organisation_number: supplier.organisation_number || '',
      email: supplier.email || '',
      payment_terms_days: String(supplier.payment_terms_days ?? 30),
      bankgiro: supplier.bankgiro || '',
      plusgiro: supplier.plusgiro || '',
      iban: supplier.iban || '',
      bic: supplier.bic || '',
      bank_account: supplier.bank_account || '',
      payment_reference: supplier.payment_reference || '',
      default_account_code: supplier.default_account_code || '',
      notes: supplier.notes || '',
    });
    setSupplierModalOpen(true);
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

    const payload = {
      company_id: supplierForm.company_id || null,
      name: supplierForm.name.trim(),
      organisation_number: supplierForm.organisation_number.trim(),
      email: supplierForm.email.trim(),
      payment_terms_days: Math.max(0, Math.round(toNumber(supplierForm.payment_terms_days, 30))),
      bankgiro: supplierForm.bankgiro.trim(),
      plusgiro: supplierForm.plusgiro.trim(),
      iban: supplierForm.iban.trim(),
      bic: supplierForm.bic.trim(),
      bank_account: supplierForm.bank_account.trim(),
      payment_reference: supplierForm.payment_reference.trim(),
      default_account_code: supplierForm.default_account_code.trim(),
      notes: supplierForm.notes.trim(),
    };

    const { error: supplierError } = selectedSupplier
      ? await supabase
        .from('vihem_finance_suppliers')
        .update(payload)
        .eq('id', selectedSupplier.id)
      : await supabase
        .from('vihem_finance_suppliers')
        .insert({
          ...payload,
          organisation_id: organisationId,
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
        account_code: invoiceForm.account_code.trim(),
        line_total_excl_vat: subtotal,
        vat_amount: vat,
        line_total_incl_vat: total,
        metadata: invoiceForm.vat_code ? { vat_code: invoiceForm.vat_code } : {},
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
          ...(supplierInvoice.ocr_data ?? {}),
          file_name: file.name,
          content_type: file.type || 'application/octet-stream',
          storage_path: storagePath,
          document_kind: supplierInvoice.document_kind || supplierInvoiceForm.document_kind,
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
    if (!organisationId || !supplierInvoiceForm.company_id || (!supplierInvoiceForm.description.trim() && !supplierInvoiceFile)) return;
    setSaving(true);
    setError('');

    const description = supplierInvoiceForm.description.trim()
      || (supplierInvoiceForm.document_kind === 'receipt' ? 'Skannat kvitto' : 'Skannad leverantörsfaktura');
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
        document_kind: supplierInvoiceForm.document_kind,
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
        description,
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
    setSelectedSupplierInvoiceLine(null);
    setSupplierInvoiceReviewForm({
      company_id: supplierInvoice.company_id,
      document_kind: supplierInvoice.document_kind || 'supplier_invoice',
      supplier_id: supplierInvoice.supplier_id ?? '',
      supplier_invoice_number: supplierInvoice.supplier_invoice_number,
      invoice_date: supplierInvoice.invoice_date,
      due_date: supplierInvoice.due_date,
      description: '',
      quantity: '1',
      unit_price: '0',
      vat_code: '',
      vat_rate: '25',
      account_code: '',
      notes: supplierInvoice.notes,
    });
    setSupplierInvoiceLineForm({
      ...emptySupplierInvoiceForm,
      company_id: supplierInvoice.company_id,
      description: firstLine?.description ?? '',
      quantity: String(firstLine?.quantity ?? 1),
      unit_price: String(firstLine?.unit_price ?? 0),
      vat_code: typeof firstLine?.metadata?.vat_code === 'string' ? firstLine.metadata.vat_code : '',
      vat_rate: String(firstLine?.vat_rate ?? 25),
      account_code: firstLine?.account_code ?? '',
    });
    setSupplierInvoiceDetailOpen(true);
  };

  const saveSupplierInvoiceReview = async () => {
    if (!organisationId || !selectedSupplierInvoice || !supplierInvoiceReviewForm.company_id) return;
    setSaving(true);
    setError('');

    const subtotal = selectedSupplierInvoiceLines.reduce((sum, line) => sum + Number(line.line_total_excl_vat || 0), 0);
    const vat = selectedSupplierInvoiceLines.reduce((sum, line) => sum + Number(line.vat_amount || 0), 0);
    const total = selectedSupplierInvoiceLines.reduce((sum, line) => sum + Number(line.line_total_incl_vat || 0), 0);

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

  const refreshSupplierInvoice = async (supplierInvoiceId: string) => {
    const { data, error: invoiceError } = await supabase
      .from('vihem_supplier_invoices')
      .select('*, company:company_id(*), supplier:supplier_id(*)')
      .eq('id', supplierInvoiceId)
      .single();

    if (invoiceError) {
      setError(invoiceError.message);
      return null;
    }

    const nextInvoice = data as SupplierInvoice;
    setSelectedSupplierInvoice(nextInvoice);
    setSupplierInvoices(prev => prev.map(invoice => invoice.id === supplierInvoiceId ? nextInvoice : invoice));
    return nextInvoice;
  };

  const reloadSupplierInvoiceLines = async (supplierInvoiceId: string) => {
    const { data, error: lineError } = await supabase
      .from('vihem_supplier_invoice_lines')
      .select('*')
      .eq('supplier_invoice_id', supplierInvoiceId)
      .order('line_no', { ascending: true });

    if (lineError) {
      setError(lineError.message);
      return false;
    }

    setSelectedSupplierInvoiceLines((data ?? []) as SupplierInvoiceLine[]);
    return true;
  };

  const resetSupplierInvoiceLineDraft = () => {
    setSelectedSupplierInvoiceLine(null);
    setSupplierInvoiceLineForm(prev => ({
      ...emptySupplierInvoiceForm,
      company_id: supplierInvoiceReviewForm.company_id || selectedSupplierInvoice?.company_id || prev.company_id,
    }));
  };

  const editSupplierInvoiceLineInReview = (line: SupplierInvoiceLine) => {
    setSelectedSupplierInvoiceLine(line);
    setSupplierInvoiceLineForm({
      ...emptySupplierInvoiceForm,
      company_id: line.company_id,
      description: line.description,
      quantity: String(line.quantity ?? 1),
      unit_price: String(line.unit_price ?? 0),
      vat_code: typeof line.metadata?.vat_code === 'string' ? line.metadata.vat_code : '',
      vat_rate: String(line.vat_rate ?? 25),
      account_code: line.account_code || '',
    });
  };

  const saveSupplierInvoiceLineInReview = async () => {
    if (!organisationId || !selectedSupplierInvoice || selectedSupplierInvoice.approval_status === 'approved' || !supplierInvoiceLineForm.description.trim()) return;
    const companyId = supplierInvoiceReviewForm.company_id || selectedSupplierInvoice.company_id;
    if (!companyId) return;

    setSaving(true);
    setError('');

    const quantity = toNumber(supplierInvoiceLineForm.quantity, 1);
    const unitPrice = toNumber(supplierInvoiceLineForm.unit_price, 0);
    const vatRate = toNumber(supplierInvoiceLineForm.vat_rate, 25);
    const subtotal = Math.round(quantity * unitPrice * 100) / 100;
    const vat = Math.round(subtotal * (vatRate / 100) * 100) / 100;
    const total = subtotal + vat;
    const nextLineNo = selectedSupplierInvoiceLines.reduce((max, line) => Math.max(max, Number(line.line_no || 0)), 0) + 1;

    const payload = {
      organisation_id: organisationId,
      company_id: companyId,
      supplier_invoice_id: selectedSupplierInvoice.id,
      line_no: selectedSupplierInvoiceLine?.line_no ?? nextLineNo,
      description: supplierInvoiceLineForm.description.trim(),
      quantity,
      unit_price: unitPrice,
      vat_rate: vatRate,
      account_code: supplierInvoiceLineForm.account_code.trim(),
      line_total_excl_vat: subtotal,
      vat_amount: vat,
      line_total_incl_vat: total,
      metadata: supplierInvoiceLineForm.vat_code ? { ...(selectedSupplierInvoiceLine?.metadata ?? {}), vat_code: supplierInvoiceLineForm.vat_code } : { ...(selectedSupplierInvoiceLine?.metadata ?? {}), vat_code: '' },
    };

    const request = selectedSupplierInvoiceLine
      ? supabase.from('vihem_supplier_invoice_lines').update(payload).eq('id', selectedSupplierInvoiceLine.id)
      : supabase.from('vihem_supplier_invoice_lines').insert(payload);

    const { error: lineError } = await request;

    if (lineError) {
      setError(lineError.message);
      setSaving(false);
      return;
    }

    resetSupplierInvoiceLineDraft();
    await reloadSupplierInvoiceLines(selectedSupplierInvoice.id);
    const refreshed = await refreshSupplierInvoice(selectedSupplierInvoice.id);
    if (refreshed) setSelectedSupplierInvoice(refreshed);
    await loadFinance();
    setSaving(false);
  };

  const deleteSupplierInvoiceLineInReview = async (line: SupplierInvoiceLine) => {
    if (!selectedSupplierInvoice || selectedSupplierInvoice.approval_status === 'approved' || selectedSupplierInvoiceLines.length <= 1) return;
    setSaving(true);
    setError('');

    const { error: deleteError } = await supabase
      .from('vihem_supplier_invoice_lines')
      .delete()
      .eq('id', line.id);

    if (deleteError) {
      setError(deleteError.message);
      setSaving(false);
      return;
    }

    if (selectedSupplierInvoiceLine?.id === line.id) resetSupplierInvoiceLineDraft();
    await reloadSupplierInvoiceLines(selectedSupplierInvoice.id);
    const refreshed = await refreshSupplierInvoice(selectedSupplierInvoice.id);
    if (refreshed) setSelectedSupplierInvoice(refreshed);
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

  const exportSupplierPayments = async (format: 'csv' | 'bankgirot' = 'csv') => {
    setSaving(true);
    setError('');
    setSupplierPaymentExportResult('');

    const { data, error: exportError } = await supabase.functions.invoke('vihem-export-supplier-payments', {
      body: { format },
    });

    if (exportError || data?.error) {
      setError(data?.error || exportError?.message || 'Kunde inte exportera leverantörsbetalningar.');
      setSaving(false);
      return;
    }

    const content = String(data.content || data.csv || '');
    const filename = String(data.filename || `vihem-leverantorsbetalningar.${format === 'bankgirot' ? 'txt' : 'csv'}`);
    const blob = new Blob([format === 'csv' ? `\uFEFF${content}` : content], { type: format === 'bankgirot' ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);

    const skipped = (data.skipped || {}) as Record<string, number>;
    setSupplierPaymentExportResult(
      `${Number(data.count || 0)} leverantörsbetalningar exporterade (${format === 'bankgirot' ? 'Bankgirot-underlag' : 'CSV'}). ` +
      `${Number(skipped.missing_payment_target || 0)} saknar betaluppgift, ` +
      `${Number(skipped.already_exported || 0)} redan exporterade, ` +
      `${Number(skipped.zero_amount || 0)} saknar belopp.`,
    );
    setSaving(false);
    await loadFinance();
  };

  const queueSupplierInvoiceAccountingSync = async (supplierInvoiceId: string) => {
    setSaving(true);
    setError('');

    const { error: syncError } = await supabase.rpc('vihem_queue_supplier_invoice_accounting_sync', {
      target_supplier_invoice_id: supplierInvoiceId,
    });

    if (syncError) {
      setError(syncError.message);
      setSaving(false);
      return;
    }

    const refreshed = await refreshSupplierInvoice(supplierInvoiceId);
    if (refreshed) setSelectedSupplierInvoice(refreshed);
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

  const processSingleSupplierInvoiceOcr = async (supplierInvoiceId: string, forceVision = false) => {
    setSaving(true);
    setError('');

    const { data, error: ocrError } = await supabase.functions.invoke('vihem-process-supplier-invoice-ocr', {
      body: { supplier_invoice_id: supplierInvoiceId, force_vision: forceVision },
    });

    if (ocrError || data?.error) {
      setError(data?.error || ocrError?.message || 'Kunde inte tolka dokumentet.');
      setSaving(false);
      return;
    }

    const refreshed = await refreshSupplierInvoice(supplierInvoiceId);
    if (refreshed) await openSupplierInvoiceDetail(refreshed);
    setSaving(false);
    await loadFinance();
  };

  const applySupplierInvoiceOcrSuggestion = () => {
    if (!selectedSupplierInvoice) return;
    const extracted = selectedSupplierInvoice.ocr_data?.extracted as Record<string, unknown> | undefined;
    if (!extracted) return;
    setSupplierInvoiceReviewForm(prev => ({
      ...prev,
      company_id: String(extracted.suggested_company_id || prev.company_id || selectedSupplierInvoice.company_id),
      supplier_invoice_number: String(extracted.invoice_number || extracted.receipt_number || prev.supplier_invoice_number),
      invoice_date: String(extracted.invoice_date || prev.invoice_date),
      due_date: String(extracted.due_date || prev.due_date),
      notes: [
        prev.notes,
        String(extracted.payment_method || '') ? `Betalsätt: ${String(extracted.payment_method)}` : '',
        String(extracted.ocr_reference || '') ? `OCR: ${String(extracted.ocr_reference)}` : '',
      ].filter(Boolean).join('\n'),
    }));
    const accountCode = String(extracted.suggested_account_code || '');
    if (accountCode) {
      setSupplierInvoiceLineForm(prev => ({ ...prev, account_code: accountCode }));
    }
  };

  const openSupplierInvoiceOriginal = async () => {
    if (!selectedSupplierInvoice) return;
    const popup = window.open('about:blank', '_blank');
    let storageBucket = selectedSupplierInvoice.document?.storage_bucket || 'vihem-documents';
    let storagePath = String(
      selectedSupplierInvoice.ocr_data?.storage_path ||
      selectedSupplierInvoice.ocr_data?.source_storage_path ||
      selectedSupplierInvoice.document?.storage_path ||
      '',
    );

    if (!storagePath && selectedSupplierInvoice.document_id) {
      const { data: documentRow, error: documentError } = await supabase
        .from('vihem_documents')
        .select('storage_bucket, storage_path')
        .eq('id', selectedSupplierInvoice.document_id)
        .maybeSingle();

      if (documentError) {
        popup?.close();
        setError(documentError.message);
        return;
      }

      storageBucket = documentRow?.storage_bucket || storageBucket;
      storagePath = documentRow?.storage_path || '';
    }

    if (!storagePath || !storageBucket) {
      popup?.close();
      setError('Originalfilens sökväg saknas på dokumentet.');
      return;
    }

    const { data, error: signedUrlError } = await supabase.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, 60 * 10);
    if (signedUrlError || !data?.signedUrl) {
      popup?.close();
      setError(signedUrlError?.message || 'Kunde inte öppna originaldokumentet.');
      return;
    }
    if (popup) popup.location.href = data.signedUrl;
    else window.location.href = data.signedUrl;
  };

  const openIntegrationConfig = (
    company: FinanceCompany,
    provider: AccountingIntegration['provider'],
    integration?: AccountingIntegration,
  ) => {
    const config = integration?.config ?? {};
    setSelectedIntegration(integration ?? null);
    setIntegrationConfigForm({
      company_id: company.id,
      provider,
      status: integration?.status ?? (provider === 'manual' || provider === 'sie' ? 'active' : 'paused'),
      mode: String(config.mode || (provider === 'sie' ? 'sie_export' : provider === 'manual' ? 'manual_export' : 'api')),
      export_format: String(config.export_format || (provider === 'sie' ? 'sie' : 'csv')),
      external_tenant_id: String(config.external_tenant_id || ''),
      notes: String(config.notes || ''),
      config_json: prettyJson(config.extra || {}),
      secret_value: '',
    });
    setIntegrationConfigModalOpen(true);
  };

  const saveIntegrationConfig = async () => {
    if (!organisationId || !integrationConfigForm.company_id) return;
    setSaving(true);
    setError('');

    let extraConfig: Record<string, unknown> = {};
    try {
      extraConfig = JSON.parse(integrationConfigForm.config_json || '{}');
      if (!extraConfig || typeof extraConfig !== 'object' || Array.isArray(extraConfig)) {
        throw new Error('Extra JSON måste vara ett objekt.');
      }
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Extra JSON är inte giltig.');
      setSaving(false);
      return;
    }

    const { data: integrationData, error: integrationError } = await supabase
      .from('vihem_accounting_integrations')
      .upsert({
        organisation_id: organisationId,
        company_id: integrationConfigForm.company_id,
        provider: integrationConfigForm.provider,
        status: integrationConfigForm.status,
        config: {
          mode: integrationConfigForm.mode.trim(),
          export_format: integrationConfigForm.export_format.trim(),
          external_tenant_id: integrationConfigForm.external_tenant_id.trim(),
          notes: integrationConfigForm.notes.trim(),
          extra: extraConfig,
        },
      }, { onConflict: 'company_id,provider' })
      .select('*')
      .single();

    if (integrationError) {
      setError(integrationError.message);
      setSaving(false);
      return;
    }

    if (integrationConfigForm.secret_value.trim()) {
      const { data: secretData, error: secretError } = await supabase.functions.invoke('vihem-save-accounting-secret', {
        body: {
          integration_id: integrationData.id,
          secret_name: 'primary_token',
          secret_value: integrationConfigForm.secret_value.trim(),
        },
      });

      if (secretError || secretData?.error) {
        setError(secretData?.error || secretError?.message || 'Kunde inte spara bokföringstoken.');
        setSaving(false);
        return;
      }
    }

    setIntegrationConfigModalOpen(false);
    setSelectedIntegration(null);
    setSaving(false);
    await loadFinance();
  };

  const testIntegrationConfig = async () => {
    if (!selectedIntegration) return;
    setSaving(true);
    setError('');

    const { data, error: testError } = await supabase.functions.invoke('vihem-test-accounting-integration', {
      body: { integration_id: selectedIntegration.id },
    });

    if (testError || data?.error) {
      setError(data?.error || testError?.message || 'Kunde inte testa bokföringskopplingen.');
      setSaving(false);
      await loadFinance();
      return;
    }

    setSaving(false);
    await loadFinance();
  };

  const createDefaultAccountingSetup = async (company: FinanceCompany) => {
    if (!organisationId) return;
    setSaving(true);
    setError('');

    const accountRows = [
      ['1510', 'Kundfordringar', 'receivable', 'customer_receivable'],
      ['1930', 'Företagskonto', 'bank', 'bank'],
      ['2440', 'Leverantörsskulder', 'payable', 'supplier_payable'],
      ['2611', 'Utgående moms', 'vat', 'output_vat'],
      ['2641', 'Ingående moms', 'vat', 'input_vat'],
      ['3001', 'Försäljning inom Sverige', 'income', 'sales'],
      ['4000', 'Inköp', 'expense', 'purchase'],
    ].map(([account_code, name, account_type, default_role]) => ({
      organisation_id: organisationId,
      company_id: company.id,
      account_code,
      name,
      account_type,
      default_role,
      active: true,
      created_by: user?.id ?? null,
    }));

    const vatRows = [
      { code: 'SE25', name: 'Svensk moms 25%', rate: 25 },
      { code: 'SE12', name: 'Svensk moms 12%', rate: 12 },
      { code: 'SE06', name: 'Svensk moms 6%', rate: 6 },
      { code: 'SE00', name: 'Momsfri försäljning', rate: 0 },
    ].map(row => ({
      organisation_id: organisationId,
      company_id: company.id,
      ...row,
      sales_account_code: '3001',
      purchase_account_code: '4000',
      output_vat_account_code: row.rate > 0 ? '2611' : '',
      input_vat_account_code: row.rate > 0 ? '2641' : '',
      active: true,
      created_by: user?.id ?? null,
    }));

    const { error: accountError } = await supabase
      .from('vihem_accounting_accounts')
      .upsert(accountRows, { onConflict: 'company_id,account_code' });

    if (accountError) {
      setError(accountError.message);
      setSaving(false);
      return;
    }

    const { error: vatError } = await supabase
      .from('vihem_vat_codes')
      .upsert(vatRows, { onConflict: 'company_id,code' });

    if (vatError) setError(vatError.message);
    setSaving(false);
    await loadFinance();
  };

  const openAccountingAccountModal = (company: FinanceCompany, account?: AccountingAccount) => {
    setError('');
    setSelectedAccountingAccount(account ?? null);
    setAccountingAccountForm(account
      ? {
          company_id: account.company_id,
          account_code: account.account_code,
          name: account.name,
          account_type: account.account_type,
          default_role: account.default_role,
          active: account.active,
        }
      : {
          ...emptyAccountingAccountForm,
          company_id: company.id,
        });
    setAccountingAccountModalOpen(true);
  };

  const saveAccountingAccount = async () => {
    if (!organisationId) return;
    if (!accountingAccountForm.company_id || !accountingAccountForm.account_code.trim() || !accountingAccountForm.name.trim()) {
      setError('Fyll i bolag, kontonummer och namn.');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      organisation_id: organisationId,
      company_id: accountingAccountForm.company_id,
      account_code: accountingAccountForm.account_code.trim(),
      name: accountingAccountForm.name.trim(),
      account_type: accountingAccountForm.account_type,
      default_role: accountingAccountForm.default_role,
      active: accountingAccountForm.active,
      created_by: user?.id ?? null,
    };

    const query = selectedAccountingAccount
      ? supabase.from('vihem_accounting_accounts').update(payload).eq('id', selectedAccountingAccount.id)
      : supabase.from('vihem_accounting_accounts').insert(payload);

    const { error: accountError } = await query;

    if (accountError) {
      setError(accountError.message);
      setSaving(false);
      return;
    }

    setAccountingAccountModalOpen(false);
    setSelectedAccountingAccount(null);
    setSaving(false);
    await loadFinance();
  };

  const openVatCodeModal = (company: FinanceCompany, code?: VatCode) => {
    setError('');
    setSelectedVatCode(code ?? null);
    setVatCodeForm(code
      ? {
          company_id: code.company_id,
          code: code.code,
          name: code.name,
          rate: String(code.rate ?? 0),
          sales_account_code: code.sales_account_code || '',
          purchase_account_code: code.purchase_account_code || '',
          output_vat_account_code: code.output_vat_account_code || '',
          input_vat_account_code: code.input_vat_account_code || '',
          active: code.active,
        }
      : {
          ...emptyVatCodeForm,
          company_id: company.id,
        });
    setVatCodeModalOpen(true);
  };

  const saveVatCode = async () => {
    if (!organisationId) return;
    if (!vatCodeForm.company_id || !vatCodeForm.code.trim() || !vatCodeForm.name.trim()) {
      setError('Fyll i bolag, kod och namn.');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      organisation_id: organisationId,
      company_id: vatCodeForm.company_id,
      code: vatCodeForm.code.trim().toUpperCase(),
      name: vatCodeForm.name.trim(),
      rate: toNumber(vatCodeForm.rate, 0),
      sales_account_code: vatCodeForm.sales_account_code,
      purchase_account_code: vatCodeForm.purchase_account_code,
      output_vat_account_code: vatCodeForm.output_vat_account_code,
      input_vat_account_code: vatCodeForm.input_vat_account_code,
      active: vatCodeForm.active,
      created_by: user?.id ?? null,
    };

    const query = selectedVatCode
      ? supabase.from('vihem_vat_codes').update(payload).eq('id', selectedVatCode.id)
      : supabase.from('vihem_vat_codes').insert(payload);

    const { error: vatError } = await query;

    if (vatError) {
      setError(vatError.message);
      setSaving(false);
      return;
    }

    setVatCodeModalOpen(false);
    setSelectedVatCode(null);
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

  const saveAutomationSettings = async () => {
    if (!organisationId) return;
    setSaving(true);
    setError('');

    const { error: settingsError } = await supabase
      .from('vihem_finance_automation_settings')
      .upsert({
        organisation_id: organisationId,
        finance_cron_enabled: automationSettingsDraft.finance_cron_enabled,
        queue_reminders: automationSettingsDraft.queue_reminders,
        send_emails: automationSettingsDraft.send_emails,
        email_limit: Math.min(Math.max(Math.round(toNumber(automationSettingsDraft.email_limit, 20)), 1), 50),
        process_accounting_sync: automationSettingsDraft.process_accounting_sync,
        accounting_sync_limit: Math.min(Math.max(Math.round(toNumber(automationSettingsDraft.accounting_sync_limit, 50)), 1), 200),
        create_rent_billing: automationSettingsDraft.create_rent_billing,
        rent_billing_months_ahead: Math.min(Math.max(Math.round(toNumber(automationSettingsDraft.rent_billing_months_ahead, 1)), 0), 12),
        auto_generate_rent_invoices: automationSettingsDraft.auto_generate_rent_invoices,
        created_by: user?.id ?? null,
      }, { onConflict: 'organisation_id' });

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

  const exportAccountingQueueSie = async () => {
    setSaving(true);
    setError('');

    const { data, error: exportError } = await supabase.functions.invoke('vihem-export-accounting-sie', {
      body: { statuses: ['queued', 'processing'] },
    });

    if (exportError || data?.error) {
      setError(data?.error || exportError?.message || 'Kunde inte exportera SIE-filen.');
      setSaving(false);
      return;
    }

    const sie = String(data?.sie || '');
    const filename = String(data?.filename || 'vihem-bokforing.se');
    const blob = new Blob([sie], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setSaving(false);
  };

  const processAccountingQueue = async () => {
    setSaving(true);
    setError('');

    const { data, error: processError } = await supabase.functions.invoke('vihem-process-accounting-sync', {
      body: { limit: 50 },
    });

    if (processError || data?.error) {
      setError(data?.error || processError?.message || 'Kunde inte behandla bokföringskön.');
      setSaving(false);
      return;
    }

    setSaving(false);
    await loadFinance();
  };

  const createInvoiceFromProjectBasis = async () => {
    if (!projectInvoiceForm.basis_id || !projectInvoiceForm.company_id) return;
    setSaving(true);
    setError('');

    const { data, error: conversionError } = await supabase.rpc('vihem_create_invoice_from_project_basis', {
      target_basis_id: projectInvoiceForm.basis_id,
      target_company_id: projectInvoiceForm.company_id,
      target_customer_id: projectInvoiceForm.customer_id || null,
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

  const createInvoiceFromSelectedProjectBases = async () => {
    if (selectedProjectBasisIds.length === 0 || companies.length === 0) return;
    setSaving(true);
    setError('');

    const firstBasis = selectedProjectBases[0];
    const company = companies.find(item => item.id === firstBasis?.project?.company_id) ?? companies[0];
    const invoiceDate = new Date().toISOString().slice(0, 10);

    const { data, error: conversionError } = await supabase.rpc('vihem_create_invoice_from_project_basis_batch', {
      target_basis_ids: selectedProjectBasisIds,
      target_company_id: company.id,
      target_customer_id: null,
      invoice_date: invoiceDate,
      due_date: addDays(invoiceDate, 30),
    });

    if (conversionError) {
      setError(conversionError.message);
      setSaving(false);
      return;
    }

    const invoice = (Array.isArray(data) ? data[0] : data) as Invoice | null;
    setSelectedProjectBasisIds([]);
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

  const createRentAdjustment = async () => {
    if (!organisationId || !rentAdjustmentForm.company_id || !rentAdjustmentForm.tenancy_id || !rentAdjustmentForm.description.trim()) return;
    setSaving(true);
    setError('');

    const { error: adjustmentError } = await supabase
      .from('vihem_rent_adjustments')
      .insert({
        organisation_id: organisationId,
        company_id: rentAdjustmentForm.company_id,
        tenancy_id: rentAdjustmentForm.tenancy_id,
        rent_period: `${rentAdjustmentForm.rent_period}-01`,
        adjustment_type: rentAdjustmentForm.adjustment_type,
        start_period: `${rentAdjustmentForm.rent_period}-01`,
        end_period: rentAdjustmentForm.adjustment_type === 'one_time'
          ? `${rentAdjustmentForm.rent_period}-01`
          : rentAdjustmentForm.end_period
            ? `${rentAdjustmentForm.end_period}-01`
            : null,
        description: rentAdjustmentForm.description.trim(),
        amount: toNumber(rentAdjustmentForm.amount, 0),
        percentage_rate: rentAdjustmentForm.adjustment_type === 'indexed' ? toNumber(rentAdjustmentForm.percentage_rate, 0) : 0,
        vat_rate: Math.max(0, toNumber(rentAdjustmentForm.vat_rate, 0)),
        status: 'active',
        created_by: user?.id ?? null,
      });

    if (adjustmentError) {
      setError(adjustmentError.message);
      setSaving(false);
      return;
    }

    setRentAdjustmentForm(prev => ({
      ...emptyRentAdjustmentForm,
      company_id: prev.company_id,
      rent_period: prev.rent_period,
      adjustment_type: prev.adjustment_type,
    }));
    setSaving(false);
    await loadFinance();
  };

  const cancelRentAdjustment = async (adjustmentId: string) => {
    setSaving(true);
    setError('');

    const { error: adjustmentError } = await supabase
      .from('vihem_rent_adjustments')
      .update({ status: 'cancelled' })
      .eq('id', adjustmentId);

    if (adjustmentError) setError(adjustmentError.message);
    setSaving(false);
    await loadFinance();
  };

  const createDirectDebitMandate = async () => {
    if (!organisationId || !directDebitMandateForm.company_id || !directDebitMandateForm.tenancy_id) return;
    setSaving(true);
    setError('');

    const tenancy = tenancies.find(item => item.id === directDebitMandateForm.tenancy_id);
    const existingCustomer = customers.find(customer => customer.name === tenancy?.tenant?.name && (!customer.company_id || customer.company_id === directDebitMandateForm.company_id));

    const { error: mandateError } = await supabase
      .from('vihem_direct_debit_mandates')
      .insert({
        organisation_id: organisationId,
        company_id: directDebitMandateForm.company_id,
        tenancy_id: directDebitMandateForm.tenancy_id,
        tenant_id: tenancy?.tenant_id ?? null,
        finance_customer_id: existingCustomer?.id ?? null,
        mandate_reference: directDebitMandateForm.mandate_reference.trim(),
        bankgiro_number: directDebitMandateForm.bankgiro_number.trim(),
        payer_number: directDebitMandateForm.payer_number.trim(),
        account_holder: directDebitMandateForm.account_holder.trim() || tenancy?.tenant?.name || '',
        account_mask: directDebitMandateForm.account_mask.trim(),
        status: directDebitMandateForm.status,
        notes: directDebitMandateForm.notes.trim(),
        created_by: user?.id ?? null,
      });

    if (mandateError) {
      setError(mandateError.message);
      setSaving(false);
      return;
    }

    setDirectDebitMandateForm(prev => ({
      ...emptyDirectDebitMandateForm,
      company_id: prev.company_id,
      bankgiro_number: prev.bankgiro_number,
    }));
    setSaving(false);
    await loadFinance();
  };

  const setDirectDebitMandateStatus = async (mandateId: string, status: DirectDebitMandate['status']) => {
    setSaving(true);
    setError('');

    const { error: statusError } = await supabase.rpc('vihem_set_direct_debit_mandate_status', {
      target_mandate_id: mandateId,
      next_status: status,
    });

    if (statusError) setError(statusError.message);
    setSaving(false);
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
    setRentEmailQueueResult('');
    setRentDirectDebitExportResult('');
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

  const queueRentRunInvoiceEmails = async () => {
    if (!selectedRentRun) return;
    setSaving(true);
    setError('');
    setRentEmailQueueResult('');

    const { data, error: queueError } = await supabase.rpc('vihem_queue_rent_run_invoice_emails', {
      target_run_id: selectedRentRun.id,
    });

    if (queueError) {
      setError(queueError.message);
      setSaving(false);
      return;
    }

    const result = (data || {}) as Record<string, unknown>;
    setRentEmailQueueResult(
      `${Number(result.queued || 0)} mejl köade. ` +
      `${Number(result.skipped_missing_document || 0)} saknar PDF, ` +
      `${Number(result.skipped_missing_email || 0)} saknar e-post, ` +
      `${Number(result.skipped_duplicate || 0)} redan köade/skickade, ` +
      `${Number(result.skipped_not_ready || 0)} inte godkända.`,
    );
    setSaving(false);
    await loadFinance();
  };

  const exportRentRunDirectDebit = async (format: 'csv' | 'bankgirot' = 'csv') => {
    if (!selectedRentRun) return;
    setSaving(true);
    setError('');
    setRentDirectDebitExportResult('');

    const { data, error: exportError } = await supabase.functions.invoke('vihem-export-direct-debit', {
      body: { run_id: selectedRentRun.id, format },
    });

    if (exportError || data?.error) {
      setError(data?.error || exportError?.message || 'Kunde inte skapa autogiroexport.');
      setSaving(false);
      return;
    }

    const content = String(data.content || data.csv || '');
    const filename = String(data.filename || `vihem-autogiro-${selectedRentRun.rent_period.slice(0, 7)}.${format === 'bankgirot' ? 'txt' : 'csv'}`);
    const blob = new Blob([content], { type: format === 'bankgirot' ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);

    const skipped = (data.skipped || {}) as Record<string, number>;
    setRentDirectDebitExportResult(
      `${Number(data.count || 0)} autogirorader exporterade (${format === 'bankgirot' ? 'Bankgirot-fil' : 'CSV'}). ` +
      `${Number(skipped.missing_mandate || 0)} saknar aktivt mandat, ` +
      `${Number(skipped.missing_invoice || 0)} saknar faktura, ` +
      `${Number(skipped.not_collectable || 0)} är redan betalda/annullerade.`,
    );
    setSaving(false);
  };

  const openInvoiceDetail = async (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setSelectedInvoiceLines([]);
    setSelectedInvoiceLine(null);
    setSelectedApprovalSeriesId('');
    setInvoiceLineForm(emptyInvoiceLineForm);
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

  const reloadSelectedInvoiceLines = async (invoiceId: string) => {
    const { data, error: lineError } = await supabase
      .from('vihem_invoice_lines')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('line_no', { ascending: true });

    if (lineError) {
      setError(lineError.message);
      return false;
    }

    setSelectedInvoiceLines((data ?? []) as InvoiceLine[]);
    return true;
  };

  const editInvoiceLineInDraft = (line: InvoiceLine) => {
    setSelectedInvoiceLine(line);
    setInvoiceLineForm({
      description: line.description,
      quantity: String(line.quantity ?? 1),
      unit: line.unit || 'st',
      unit_price: String(line.unit_price ?? 0),
      vat_code: typeof line.metadata?.vat_code === 'string' ? line.metadata.vat_code : '',
      vat_rate: String(line.vat_rate ?? 25),
      account_code: line.account_code || '',
    });
  };

  const resetInvoiceLineDraft = () => {
    setSelectedInvoiceLine(null);
    setInvoiceLineForm(emptyInvoiceLineForm);
  };

  const saveInvoiceLineToDraft = async () => {
    if (!organisationId || !selectedInvoice || selectedInvoice.status !== 'draft' || !invoiceLineForm.description.trim()) return;
    setSaving(true);
    setError('');

    const quantity = toNumber(invoiceLineForm.quantity, 1);
    const unitPrice = toNumber(invoiceLineForm.unit_price, 0);
    const vatRate = toNumber(invoiceLineForm.vat_rate, 25);
    const subtotal = Math.round(quantity * unitPrice * 100) / 100;
    const vat = Math.round(subtotal * (vatRate / 100) * 100) / 100;
    const total = subtotal + vat;
    const nextLineNo = selectedInvoiceLines.reduce((max, line) => Math.max(max, Number(line.line_no || 0)), 0) + 1;

    const payload = {
      organisation_id: organisationId,
      company_id: selectedInvoice.company_id,
      invoice_id: selectedInvoice.id,
      line_no: selectedInvoiceLine?.line_no ?? nextLineNo,
      description: invoiceLineForm.description.trim(),
      quantity,
      unit: invoiceLineForm.unit.trim() || 'st',
      unit_price: unitPrice,
      vat_rate: vatRate,
      account_code: invoiceLineForm.account_code.trim(),
      line_total_excl_vat: subtotal,
      vat_amount: vat,
      line_total_incl_vat: total,
      line_type: selectedInvoiceLine?.line_type ?? 'manual',
      metadata: invoiceLineForm.vat_code ? { ...(selectedInvoiceLine?.metadata ?? {}), vat_code: invoiceLineForm.vat_code } : { ...(selectedInvoiceLine?.metadata ?? {}), vat_code: '' },
    };

    const request = selectedInvoiceLine
      ? supabase
          .from('vihem_invoice_lines')
          .update(payload)
          .eq('id', selectedInvoiceLine.id)
      : supabase
          .from('vihem_invoice_lines')
          .insert({
            ...payload,
            project_id: null,
            work_order_id: null,
            time_entry_id: null,
          });

    const { error: lineError } = await request;

    if (lineError) {
      setError(lineError.message);
      setSaving(false);
      return;
    }

    resetInvoiceLineDraft();
    await refreshSelectedInvoice(selectedInvoice.id);
    await reloadSelectedInvoiceLines(selectedInvoice.id);
    await loadFinance();
    setSaving(false);
  };

  const deleteInvoiceLineFromDraft = async (line: InvoiceLine) => {
    if (!selectedInvoice || selectedInvoice.status !== 'draft' || selectedInvoiceLines.length <= 1) return;
    setSaving(true);
    setError('');

    const { error: deleteError } = await supabase
      .from('vihem_invoice_lines')
      .delete()
      .eq('id', line.id);

    if (deleteError) {
      setError(deleteError.message);
      setSaving(false);
      return;
    }

    if (selectedInvoiceLine?.id === line.id) resetInvoiceLineDraft();
    await refreshSelectedInvoice(selectedInvoice.id);
    await reloadSelectedInvoiceLines(selectedInvoice.id);
    await loadFinance();
    setSaving(false);
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
    { key: 'ocr-usage', label: 'OCR-logg' },
    { key: 'audit', label: 'Logg' },
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-950">Produktionshygien</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Kontroll av bolag, nummerserier, konton, moms, e-post, bokföring och leverantörsbetalningar inför skarp drift.
                </p>
              </div>
              <Badge className={financeReadiness.every(item => item.missing === 0) ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
                {financeReadiness.every(item => item.missing === 0) ? 'Redo' : `${financeReadiness.reduce((sum, item) => sum + item.missing, 0)} saker att kontrollera`}
              </Badge>
            </div>
            {financeReadiness.length === 0 ? (
              <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">Lägg upp minst ett bolag för att få en komplett driftcheck.</p>
            ) : (
              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                {financeReadiness.map(item => (
                  <div key={item.company.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-slate-950">{item.company.name}</h3>
                        <p className="text-sm text-slate-500">
                          {item.invoiceCount} fakturor · öppet {formatCurrency(item.openAmount, item.company.default_currency || 'SEK')}
                        </p>
                      </div>
                      <Badge className={item.missing === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
                        {item.missing === 0 ? 'Klar' : `${item.missing} kvar`}
                      </Badge>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {item.checks.map(check => (
                        <div key={check.key} className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2">
                          <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${check.ok ? 'text-emerald-600' : 'text-amber-500'}`} />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800">{check.label}</p>
                            <p className="truncate text-xs text-slate-500">{check.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

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
        <div className="grid gap-5">
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-950">Hyresreskontra</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Översikt per aktivt hyresförhållande med fakturerat, betalt, saldo, senaste hyresperiod och autogirostatus.
                </p>
              </div>
              <Badge className={rentLedgerRows.some(row => row.balance > 0) ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}>
                {formatCurrency(rentLedgerRows.reduce((sum, row) => sum + row.balance, 0))} öppet
              </Badge>
            </div>
            {rentLedgerRows.length === 0 ? (
              <EmptyState title="Ingen hyresreskontra ännu" description="När hyresgäster och hyreskörningar finns visas saldo per hyresförhållande här." />
            ) : (
              <div className="divide-y divide-slate-100">
                {rentLedgerRows.slice(0, 12).map(row => (
                  <div key={row.tenancy.id} className="grid gap-3 p-4 text-sm lg:grid-cols-[1.4fr_0.7fr_0.8fr_0.8fr_0.8fr_0.9fr] lg:items-center">
                    <div>
                      <p className="font-bold text-slate-950">{tenancyLabel(row.tenancy)}</p>
                      <p className="text-slate-500">{row.tenancy.tenant?.email || row.tenancy.property?.name || 'Aktivt hyresförhållande'}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-700">{row.latestPeriod}</p>
                      <p className="text-xs text-slate-500">Senaste period</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-950">{formatCurrency(row.invoicedAmount)}</p>
                      <p className="text-xs text-slate-500">Fakturerat</p>
                    </div>
                    <div>
                      <p className="font-semibold text-emerald-700">{formatCurrency(row.paidAmount)}</p>
                      <p className="text-xs text-slate-500">Betalt</p>
                    </div>
                    <div>
                      <p className={row.balance > 0 ? 'font-bold text-amber-700' : 'font-semibold text-slate-700'}>{formatCurrency(row.balance)}</p>
                      <p className="text-xs text-slate-500">{row.unpaidCount} öppna</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className={row.mandate ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
                        {row.mandate ? 'Autogiro' : 'Ingen AG'}
                      </Badge>
                      <Badge className={row.lastInvoiceStatus === 'paid' ? 'bg-emerald-50 text-emerald-700' : row.lastInvoiceStatus === 'partially_paid' ? 'bg-blue-50 text-blue-700' : row.lastInvoiceStatus === 'unpaid' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}>
                        {row.lastInvoiceStatus === 'paid' ? 'Betald' : row.lastInvoiceStatus === 'partially_paid' ? 'Delbetald' : row.lastInvoiceStatus === 'unpaid' ? 'Obetald' : row.lastInvoiceStatus}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-950">Hyresjusteringar</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Lägg in engångstillägg, löpande tillägg/avdrag eller indexjusteringar innan hyreskörningen skapas. Negativt belopp blir avdrag.
                </p>
              </div>
              <Badge className="bg-slate-100 text-slate-700">{rentAdjustments.filter(item => item.status === 'active').length} aktiva</Badge>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-4 lg:items-end">
              <Select
                label="Bolag"
                value={rentAdjustmentForm.company_id}
                onChange={event => setRentAdjustmentForm(prev => ({ ...prev, company_id: event.target.value, tenancy_id: '' }))}
                options={[{ value: '', label: 'Välj bolag' }, ...companies.map(company => ({ value: company.id, label: company.name }))]}
              />
              <Select
                label="Hyresförhållande"
                value={rentAdjustmentForm.tenancy_id}
                onChange={event => setRentAdjustmentForm(prev => ({ ...prev, tenancy_id: event.target.value }))}
                options={rentAdjustmentTenancyOptions}
              />
              <Select
                label="Typ"
                value={rentAdjustmentForm.adjustment_type}
                onChange={event => setRentAdjustmentForm(prev => ({ ...prev, adjustment_type: event.target.value, end_period: event.target.value === 'one_time' ? '' : prev.end_period }))}
                options={[
                  { value: 'one_time', label: 'Engångsjustering' },
                  { value: 'recurring', label: 'Återkommande' },
                  { value: 'indexed', label: 'Indexerad/procent' },
                ]}
              />
              <Input
                label={rentAdjustmentForm.adjustment_type === 'one_time' ? 'Hyresmånad' : 'Från månad'}
                type="month"
                value={rentAdjustmentForm.rent_period}
                onChange={event => setRentAdjustmentForm(prev => ({ ...prev, rent_period: event.target.value }))}
              />
              {rentAdjustmentForm.adjustment_type !== 'one_time' && (
                <Input
                  label="Till månad"
                  type="month"
                  value={rentAdjustmentForm.end_period}
                  onChange={event => setRentAdjustmentForm(prev => ({ ...prev, end_period: event.target.value }))}
                  helperText="Lämna tom för tills vidare"
                />
              )}
              <Input
                className={rentAdjustmentForm.adjustment_type === 'one_time' ? 'lg:col-span-2' : ''}
                label="Beskrivning"
                value={rentAdjustmentForm.description}
                onChange={event => setRentAdjustmentForm(prev => ({ ...prev, description: event.target.value }))}
                placeholder="Ex. rabatt, parkeringsplats, tillägg"
              />
              <Input
                label="Belopp"
                type="number"
                value={rentAdjustmentForm.amount}
                onChange={event => setRentAdjustmentForm(prev => ({ ...prev, amount: event.target.value }))}
                placeholder="-500"
              />
              {rentAdjustmentForm.adjustment_type === 'indexed' && (
                <Input
                  label="Procent %"
                  type="number"
                  value={rentAdjustmentForm.percentage_rate}
                  onChange={event => setRentAdjustmentForm(prev => ({ ...prev, percentage_rate: event.target.value }))}
                  placeholder="2"
                />
              )}
              <Input
                label="Moms %"
                type="number"
                min="0"
                value={rentAdjustmentForm.vat_rate}
                onChange={event => setRentAdjustmentForm(prev => ({ ...prev, vat_rate: event.target.value }))}
              />
              <Button
                variant="secondary"
                loading={saving}
                onClick={createRentAdjustment}
                disabled={!rentAdjustmentForm.company_id || !rentAdjustmentForm.tenancy_id || !rentAdjustmentForm.description.trim() || (!rentAdjustmentForm.amount && rentAdjustmentForm.adjustment_type !== 'indexed')}
              >
                Lägg till
              </Button>
            </div>
            {rentAdjustments.length > 0 && (
              <div className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                {rentAdjustments.slice(0, 8).map(adjustment => (
                  <div key={adjustment.id} className="grid gap-3 p-3 text-sm lg:grid-cols-[1.4fr_0.8fr_1fr_0.8fr_0.7fr_auto] lg:items-center">
                    <div>
                      <p className="font-bold text-slate-950">{adjustment.description}</p>
                      <p className="text-slate-500">{tenancyLabel(adjustment.tenancy)}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-700">
                        {adjustment.adjustment_type === 'one_time'
                          ? adjustment.rent_period.slice(0, 7)
                          : `${(adjustment.start_period || adjustment.rent_period).slice(0, 7)} - ${adjustment.end_period ? adjustment.end_period.slice(0, 7) : 'tills vidare'}`}
                      </p>
                      <p className="text-xs font-semibold text-slate-500">
                        {adjustment.adjustment_type === 'indexed' ? 'Indexerad' : adjustment.adjustment_type === 'recurring' ? 'Återkommande' : 'Engång'}
                      </p>
                    </div>
                    <p className="text-slate-600">{adjustment.company?.name || 'Bolag saknas'}</p>
                    <p className={Number(adjustment.amount) < 0 ? 'font-bold text-emerald-700' : 'font-bold text-slate-950'}>
                      {formatCurrency(Number(adjustment.amount))}
                      {adjustment.adjustment_type === 'indexed' && Number(adjustment.percentage_rate || 0) !== 0 && (
                        <span className="ml-1 text-slate-500">+ {Number(adjustment.percentage_rate)}%</span>
                      )}
                    </p>
                    <Badge className={adjustment.status === 'active' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}>
                      {rentAdjustmentStatusLabel(adjustment.status)}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={saving}
                      disabled={adjustment.status !== 'active'}
                      onClick={() => cancelRentAdjustment(adjustment.id)}
                    >
                      Avbryt
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-950">Autogiro</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Registrera autogiromandat per hyresförhållande och exportera hyreskörningar som CSV eller Bankgirot-fil.
                </p>
              </div>
              <Badge className="bg-slate-100 text-slate-700">{directDebitMandates.filter(item => item.status === 'active').length} aktiva</Badge>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-4 lg:items-end">
              <Select
                label="Bolag"
                value={directDebitMandateForm.company_id}
                onChange={event => setDirectDebitMandateForm(prev => ({ ...prev, company_id: event.target.value, tenancy_id: '' }))}
                options={[{ value: '', label: 'Välj bolag' }, ...companies.map(company => ({ value: company.id, label: company.name }))]}
              />
              <Select
                label="Hyresförhållande"
                value={directDebitMandateForm.tenancy_id}
                onChange={event => {
                  const tenancy = tenancies.find(item => item.id === event.target.value);
                  setDirectDebitMandateForm(prev => ({
                    ...prev,
                    tenancy_id: event.target.value,
                    account_holder: prev.account_holder || tenancy?.tenant?.name || '',
                  }));
                }}
                options={directDebitTenancyOptions}
              />
              <Input
                label="Mandatreferens"
                value={directDebitMandateForm.mandate_reference}
                onChange={event => setDirectDebitMandateForm(prev => ({ ...prev, mandate_reference: event.target.value }))}
                placeholder="Ex. AG-1001"
              />
              <Input
                label="Bankgiro"
                value={directDebitMandateForm.bankgiro_number}
                onChange={event => setDirectDebitMandateForm(prev => ({ ...prev, bankgiro_number: event.target.value }))}
              />
              <Input
                label="Betalarnummer"
                value={directDebitMandateForm.payer_number}
                onChange={event => setDirectDebitMandateForm(prev => ({ ...prev, payer_number: event.target.value }))}
              />
              <Input
                label="Kontohavare"
                value={directDebitMandateForm.account_holder}
                onChange={event => setDirectDebitMandateForm(prev => ({ ...prev, account_holder: event.target.value }))}
              />
              <Input
                label="Konto maskerat"
                value={directDebitMandateForm.account_mask}
                onChange={event => setDirectDebitMandateForm(prev => ({ ...prev, account_mask: event.target.value }))}
                placeholder="****1234"
              />
              <Select
                label="Status"
                value={directDebitMandateForm.status}
                onChange={event => setDirectDebitMandateForm(prev => ({ ...prev, status: event.target.value as DirectDebitMandate['status'] }))}
                options={[
                  { value: 'draft', label: 'Utkast' },
                  { value: 'pending_signature', label: 'Väntar signatur' },
                  { value: 'active', label: 'Aktiv' },
                ]}
              />
              <Textarea
                className="lg:col-span-3"
                label="Anteckning"
                value={directDebitMandateForm.notes}
                onChange={event => setDirectDebitMandateForm(prev => ({ ...prev, notes: event.target.value }))}
                rows={2}
              />
              <Button
                variant="secondary"
                loading={saving}
                onClick={createDirectDebitMandate}
                disabled={!directDebitMandateForm.company_id || !directDebitMandateForm.tenancy_id}
              >
                Lägg till mandat
              </Button>
            </div>
            {directDebitMandates.length > 0 && (
              <div className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                {directDebitMandates.slice(0, 10).map(mandate => (
                  <div key={mandate.id} className="grid gap-3 p-3 text-sm lg:grid-cols-[1.5fr_0.9fr_0.8fr_0.8fr_0.8fr_auto] lg:items-center">
                    <div>
                      <p className="font-bold text-slate-950">{tenancyLabel(mandate.tenancy)}</p>
                      <p className="text-slate-500">{mandate.mandate_reference || 'Referens saknas'} · {mandate.account_holder || mandate.tenancy?.tenant?.name || 'Kontohavare saknas'}</p>
                    </div>
                    <p className="text-slate-600">{mandate.company?.name || 'Bolag saknas'}</p>
                    <p className="text-slate-600">{mandate.payer_number || 'Betalarnr saknas'}</p>
                    <p className="text-slate-600">{mandate.account_mask || 'Konto saknas'}</p>
                    <Badge className={mandate.status === 'active' ? 'bg-emerald-50 text-emerald-700' : mandate.status === 'cancelled' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'}>
                      {mandate.status === 'pending_signature' ? 'Väntar signatur' : mandate.status === 'active' ? 'Aktiv' : mandate.status === 'paused' ? 'Pausad' : mandate.status === 'cancelled' ? 'Avslutad' : mandate.status === 'rejected' ? 'Nekad' : 'Utkast'}
                    </Badge>
                    <div className="flex flex-wrap justify-end gap-2">
                      {mandate.status !== 'active' && (
                        <Button variant="ghost" size="sm" loading={saving} onClick={() => setDirectDebitMandateStatus(mandate.id, 'active')}>
                          Aktivera
                        </Button>
                      )}
                      {mandate.status === 'active' && (
                        <Button variant="ghost" size="sm" loading={saving} onClick={() => setDirectDebitMandateStatus(mandate.id, 'paused')}>
                          Pausa
                        </Button>
                      )}
                      {mandate.status !== 'cancelled' && (
                        <Button variant="ghost" size="sm" loading={saving} onClick={() => setDirectDebitMandateStatus(mandate.id, 'cancelled')}>
                          Avsluta
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

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
        </div>
      )}

      {activeTab === 'project-basis' && (
        <Card className="overflow-hidden">
          {projectBases.length === 0 ? (
            <EmptyState title="Inga öppna projektunderlag" description="När kundprojekt får faktureringsunderlag visas de här och kan omvandlas till fakturautkast." />
          ) : (
            <>
              <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="font-bold text-slate-950">Projektunderlag</h3>
                  <p className="text-sm text-slate-500">
                    {selectedProjectBasisIds.length > 0
                      ? `${selectedProjectBasisIds.length} valda · ${formatCurrency(selectedProjectBases.reduce((sum, basis) => sum + Number(basis.total_amount || 0) + Number(basis.vat_amount || 0), 0))}`
                      : 'Välj flera underlag för att skapa en samlingsfaktura.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedProjectBasisIds.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setSelectedProjectBasisIds([])} disabled={saving}>
                      Rensa val
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={createInvoiceFromSelectedProjectBases}
                    loading={saving}
                    disabled={selectedProjectBasisIds.length === 0 || companies.length === 0}
                  >
                    Skapa samlingsfaktura
                  </Button>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
              {projectBases.map(basis => (
                <div key={basis.id} className="grid gap-3 p-4 lg:grid-cols-[auto_1.2fr_1fr_0.7fr_0.7fr_auto] lg:items-center">
                  <label className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-blue-600"
                      checked={selectedProjectBasisIds.includes(basis.id)}
                      onChange={e => {
                        setSelectedProjectBasisIds(prev => e.target.checked
                          ? [...prev, basis.id]
                          : prev.filter(id => id !== basis.id));
                      }}
                      aria-label={`Välj ${basis.basis_number || basis.title || 'projektunderlag'}`}
                    />
                  </label>
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
                    disabled={companies.length === 0}
                  >
                    Skapa faktura
                  </Button>
                </div>
              ))}
            </div>
            </>
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
                <div key={supplier.id} className="grid gap-3 p-4 md:grid-cols-[1.5fr_1fr_1fr_auto_auto_auto] md:items-center">
                  <div>
                    <h3 className="font-bold text-slate-950">{supplier.name}</h3>
                    <p className="text-sm text-slate-500">{supplier.organisation_number || 'Organisationsnummer saknas'}</p>
                  </div>
                  <p className="text-sm text-slate-600">{supplier.email || 'Ingen e-post'}</p>
                  <p className="text-sm text-slate-600">{supplier.company?.name ?? 'Alla bolag'}</p>
                  <Badge className="bg-slate-100 text-slate-700">{supplier.payment_terms_days} dagar</Badge>
                  <Badge className={(supplier.bankgiro || supplier.plusgiro || supplier.iban || supplier.bank_account) ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
                    {(supplier.bankgiro || supplier.plusgiro || supplier.iban || supplier.bank_account) ? 'Betalinfo' : 'Saknar betalinfo'}
                  </Badge>
                  <Button variant="secondary" size="sm" onClick={() => openEditSupplier(supplier)}>
                    Redigera
                  </Button>
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
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  resetSupplierInvoiceForm();
                  setSupplierInvoiceForm(prev => ({ ...prev, document_kind: 'receipt' }));
                  setSupplierInvoiceModalOpen(true);
                }}
                disabled={companies.length === 0}
              >
                <Camera className="h-4 w-4" />
                Scanna kvitto
              </Button>
              <Button
                variant="secondary"
                onClick={processSupplierInvoiceOcrQueue}
                loading={saving}
                disabled={!supplierInvoices.some(invoice => invoice.ocr_status === 'queued' && invoice.document_id)}
              >
                <Sparkles className="h-4 w-4" />
                Tolka kö ({supplierInvoices.filter(invoice => invoice.ocr_status === 'queued' && invoice.document_id).length})
              </Button>
              <Button
                variant="secondary"
                onClick={() => exportSupplierPayments('csv')}
                loading={saving}
                disabled={!supplierInvoices.some(invoice => invoice.approval_status === 'approved' && invoice.payment_status === 'scheduled' && !invoice.payment_exported_at)}
              >
                <Upload className="h-4 w-4" />
                Exportera betalningar CSV
              </Button>
              <Button
                variant="secondary"
                onClick={() => exportSupplierPayments('bankgirot')}
                loading={saving}
                disabled={!supplierInvoices.some(invoice => invoice.approval_status === 'approved' && invoice.payment_status === 'scheduled' && !invoice.payment_exported_at)}
              >
                <Landmark className="h-4 w-4" />
                Bankgirot-underlag
              </Button>
            </div>
          </div>
          {supplierPaymentExportResult && (
            <div className="border-b border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
              {supplierPaymentExportResult}
            </div>
          )}
          {supplierInvoices.length === 0 ? (
            <EmptyState title="Inga leverantörsfakturor ännu" description="Registrera inkommande fakturor manuellt nu, OCR och e-postimport kopplas på i nästa lager." />
          ) : (
            <div className="divide-y divide-slate-100">
              {supplierInvoices.map(invoice => (
                <div key={invoice.id} className="grid gap-3 p-4 lg:grid-cols-[1.1fr_1fr_0.7fr_0.8fr_auto_auto_auto_auto_auto] lg:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-slate-950">{invoice.supplier?.name || 'Leverantör saknas'}</h3>
                      <Badge className={invoice.document_kind === 'receipt' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}>
                        {invoice.document_kind === 'receipt' ? 'Kvitto' : 'Faktura'}
                      </Badge>
                    </div>
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
                    {invoice.payment_exported_at && <Badge className="bg-emerald-50 text-emerald-700">Exporterad</Badge>}
                    {invoice.ocr_status !== 'not_started' && (
                      <Badge className={
                        invoice.ocr_status === 'failed' ? 'bg-red-50 text-red-700' :
                          invoice.ocr_status === 'needs_review' ? 'bg-amber-50 text-amber-700' :
                            'bg-purple-50 text-purple-700'
                      }>
                        OCR {invoice.ocr_status === 'queued' ? 'köad' : invoice.ocr_status}
                      </Badge>
                    )}
                    {invoice.duplicate_supplier_invoice_id && <Badge className="bg-red-50 text-red-700">Möjlig dubblett</Badge>}
                    {Array.isArray(invoice.validation_results?.errors) && invoice.validation_results.errors.length > 0 && (
                      <Badge className="bg-red-50 text-red-700">Valideringsfel</Badge>
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={exportAccountingQueueSie}
                  loading={saving}
                  disabled={!accountingQueue.some(item => ['queued', 'processing'].includes(item.status))}
                >
                  <Upload className="h-4 w-4" />
                  Exportera SIE
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={processAccountingQueue}
                  loading={saving}
                  disabled={!accountingQueue.some(item => ['queued', 'processing'].includes(item.status))}
                >
                  Behandla kö
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
          <Card className="p-5 lg:col-span-2">
            <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-950">Automationsinställningar</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Standardbeteende för schemalagd ekonomi-cron. Servern kan fortfarande överstyra vid en enskild körning.
                </p>
              </div>
              <Badge className={automationSettings ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}>
                {automationSettings ? 'Sparad' : 'Standard'}
              </Badge>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4 xl:items-end">
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <input
                  type="checkbox"
                  checked={automationSettingsDraft.finance_cron_enabled}
                  onChange={event => setAutomationSettingsDraft(prev => ({ ...prev, finance_cron_enabled: event.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span>
                  <span className="block font-bold text-slate-950">Aktivera ekonomi-cron</span>
                  <span className="block text-sm text-slate-500">Om avstängd loggas körningen som hoppad.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <input
                  type="checkbox"
                  checked={automationSettingsDraft.queue_reminders}
                  onChange={event => setAutomationSettingsDraft(prev => ({ ...prev, queue_reminders: event.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span>
                  <span className="block font-bold text-slate-950">Köa påminnelser</span>
                  <span className="block text-sm text-slate-500">Följer bolagens påminnelseregler.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <input
                  type="checkbox"
                  checked={automationSettingsDraft.send_emails}
                  onChange={event => setAutomationSettingsDraft(prev => ({ ...prev, send_emails: event.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span>
                  <span className="block font-bold text-slate-950">Skicka köade mejl</span>
                  <span className="block text-sm text-slate-500">Kräver SMTP-inställningar i edge-miljön.</span>
                </span>
              </label>
              <Input
                label="Mejl per körning"
                type="number"
                min="1"
                max="50"
                value={automationSettingsDraft.email_limit}
                onChange={event => setAutomationSettingsDraft(prev => ({ ...prev, email_limit: event.target.value }))}
              />
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <input
                  type="checkbox"
                  checked={automationSettingsDraft.process_accounting_sync}
                  onChange={event => setAutomationSettingsDraft(prev => ({ ...prev, process_accounting_sync: event.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span>
                  <span className="block font-bold text-slate-950">Behandla bokföringskö</span>
                  <span className="block text-sm text-slate-500">Synkar manual/SIE automatiskt.</span>
                </span>
              </label>
              <Input
                label="Köposter"
                type="number"
                min="1"
                max="200"
                value={automationSettingsDraft.accounting_sync_limit}
                onChange={event => setAutomationSettingsDraft(prev => ({ ...prev, accounting_sync_limit: event.target.value }))}
              />
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <input
                  type="checkbox"
                  checked={automationSettingsDraft.create_rent_billing}
                  onChange={event => setAutomationSettingsDraft(prev => ({ ...prev, create_rent_billing: event.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span>
                  <span className="block font-bold text-slate-950">Skapa hyreskörning</span>
                  <span className="block text-sm text-slate-500">Skapar kommande månad per bolag med dubblettskydd.</span>
                </span>
              </label>
              <Input
                label="Månader framåt"
                type="number"
                min="0"
                max="12"
                value={automationSettingsDraft.rent_billing_months_ahead}
                onChange={event => setAutomationSettingsDraft(prev => ({ ...prev, rent_billing_months_ahead: event.target.value }))}
              />
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <input
                  type="checkbox"
                  checked={automationSettingsDraft.auto_generate_rent_invoices}
                  onChange={event => setAutomationSettingsDraft(prev => ({ ...prev, auto_generate_rent_invoices: event.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span>
                  <span className="block font-bold text-slate-950">Skapa fakturautkast</span>
                  <span className="block text-sm text-slate-500">Hyresrader blir utkast direkt, inte godkända fakturor.</span>
                </span>
              </label>
              <Button variant="secondary" loading={saving} onClick={saveAutomationSettings}>
                Spara
              </Button>
            </div>
          </Card>
          <Card className="p-5 lg:col-span-2">
            <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-950">Automationshistorik</h3>
                <p className="mt-1 text-sm text-slate-500">Senaste ekonomi-cron-körningarna med status, påminnelser och utskick.</p>
              </div>
              <Badge className="bg-slate-100 text-slate-700">{automationRuns.length} senaste</Badge>
            </div>
            {automationRuns.length === 0 ? (
              <EmptyState title="Ingen automation körd ännu" description="När ekonomi-cron körs visas resultatet här för admin." />
            ) : (
              <div className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                {automationRuns.map(run => (
                  <div key={run.id} className="grid gap-3 p-4 text-sm lg:grid-cols-[1fr_0.7fr_0.7fr_0.7fr_1fr] lg:items-center">
                    <div>
                      <p className="font-bold text-slate-950">{run.job_key === 'finance_cron' ? 'Ekonomi-cron' : run.job_key}</p>
                      <p className="text-slate-500">
                        {new Date(run.started_at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                    </div>
                    <Badge className={run.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}>
                      {run.status === 'success' ? 'Lyckad' : 'Misslyckad'}
                    </Badge>
                    <p className="text-slate-600">{run.overdue_updated} förfallna</p>
                    <p className="text-slate-600">{run.reminders_queued} påminnelser</p>
                    <div>
                      <p className="font-semibold text-slate-700">{run.emails_processed} mejl behandlade</p>
                      {run.details?.rent_billing && typeof run.details.rent_billing === 'object' && (
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          Hyra: {Number((run.details.rent_billing as Record<string, unknown>).created_items || 0)} rader,
                          {' '}{Number((run.details.rent_billing as Record<string, unknown>).generated_invoices || 0)} utkast
                        </p>
                      )}
                      {run.error_message && <p className="mt-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">{run.error_message}</p>}
                    </div>
                  </div>
                ))}
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
            const companyAccounts = accountingAccounts.filter(account => account.company_id === company.id);
            const companyVatCodes = vatCodes.filter(code => code.company_id === company.id);
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
                        onClick={() => openIntegrationConfig(company, provider, existing)}
                        className={[
                          'rounded-lg border px-3 py-2 text-left text-sm font-semibold transition',
                          existing?.status === 'active'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50',
                        ].join(' ')}
                      >
                        <span className="capitalize">{provider}</span>
                        <span className="mt-1 block text-xs font-medium text-slate-500">
                          {existing ? existing.status : 'Ej upplagd'}
                        </span>
                        {existing?.config && typeof existing.config === 'object' && 'export_format' in existing.config && (
                          <span className="mt-1 block text-xs font-medium text-slate-400">
                            Format {String(existing.config.export_format || '').toUpperCase()}
                          </span>
                        )}
                        {existing && !['manual', 'sie'].includes(provider) && (
                          <span className={[
                            'mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-bold',
                            existing.has_secret ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
                          ].join(' ')}>
                            {existing.has_secret ? `Token ${existing.secret_hint || 'sparad'}` : 'Saknar token'}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-2">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-bold text-slate-900">Kontoplan</h4>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-slate-100 text-slate-700">{companyAccounts.length} konton</Badge>
                        <Button variant="ghost" size="sm" onClick={() => openAccountingAccountModal(company)}>
                          Nytt konto
                        </Button>
                      </div>
                    </div>
                    {companyAccounts.length === 0 ? (
                      <div className="mt-2 rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">
                        Inga konton upplagda ännu.
                      </div>
                    ) : (
                      <div className="mt-2 grid gap-2">
                        {companyAccounts
                          .slice()
                          .sort((a, b) => a.account_code.localeCompare(b.account_code, 'sv-SE'))
                          .slice(0, 8)
                          .map(account => (
                          <button
                            key={account.id}
                            type="button"
                            onClick={() => openAccountingAccountModal(company, account)}
                            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm transition hover:border-blue-200 hover:bg-blue-50"
                          >
                            <span>
                              <span className="font-bold text-slate-900">{account.account_code}</span>
                              <span className="ml-2 text-slate-600">{account.name}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              {account.default_role && <Badge className="bg-blue-50 text-blue-700">{account.default_role}</Badge>}
                              {!account.active && <Badge className="bg-slate-100 text-slate-500">Inaktiv</Badge>}
                            </span>
                          </button>
                        ))}
                        {companyAccounts.length > 8 && (
                          <p className="text-xs font-semibold text-slate-500">+ {companyAccounts.length - 8} konton till</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-bold text-slate-900">Momskoder</h4>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-slate-100 text-slate-700">{companyVatCodes.length} koder</Badge>
                        <Button variant="ghost" size="sm" onClick={() => openVatCodeModal(company)}>
                          Ny kod
                        </Button>
                      </div>
                    </div>
                    {companyVatCodes.length === 0 ? (
                      <div className="mt-2 rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">
                        Inga momskoder upplagda ännu.
                      </div>
                    ) : (
                      <div className="mt-2 grid gap-2">
                        {companyVatCodes.map(code => (
                          <button
                            key={code.id}
                            type="button"
                            onClick={() => openVatCodeModal(company, code)}
                            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm transition hover:border-emerald-200 hover:bg-emerald-50"
                          >
                            <span>
                              <span className="font-bold text-slate-900">{code.code}</span>
                              <span className="ml-2 text-slate-600">{code.name}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <Badge className="bg-emerald-50 text-emerald-700">{Number(code.rate)}%</Badge>
                              {!code.active && <Badge className="bg-slate-100 text-slate-500">Inaktiv</Badge>}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => createDefaultAccountingSetup(company)}
                    loading={saving}
                  >
                    Skapa standardkonton
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {activeTab === 'ocr-usage' && (
        <div className="grid gap-4">
          <Card className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-950">AI/OCR-användning</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Kostnadslogg för kvitto- och leverantörsfakturascannern. Kopplingar och nycklar hanteras under Inställningar.
                </p>
              </div>
              <Badge className={ocrUsageThisMonth.average <= 0.05 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
                {ocrUsageThisMonth.average.toFixed(3)} kr/dokument
              </Badge>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <MetricCard icon={<FileText className="h-5 w-5" />} label="Dokument" value={ocrUsageThisMonth.documents.toString()} />
              <MetricCard icon={<FileText className="h-5 w-5" />} label="PDF direktlästa" value={ocrUsageThisMonth.pdfText.toString()} />
              <MetricCard icon={<Camera className="h-5 w-5" />} label="OCR" value={ocrUsageThisMonth.ocr.toString()} />
              <MetricCard icon={<Sparkles className="h-5 w-5" />} label="Vision fallback" value={ocrUsageThisMonth.vision.toString()} />
              <MetricCard icon={<CircleDollarSign className="h-5 w-5" />} label="Total API-kostnad" value={`${ocrUsageThisMonth.cost.toFixed(2)} kr`} />
              <MetricCard icon={<Hash className="h-5 w-5" />} label="Anrop" value={ocrUsageLogs.reduce((sum, log) => sum + Number(log.ai_call_count || 0), 0).toString()} />
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 p-4">
              <h3 className="font-bold text-slate-950">Senaste OCR-körningar</h3>
              <p className="text-sm text-slate-500">Visar provider, modell, tokens, retries och uppskattad kostnad per dokument.</p>
            </div>
            {ocrUsageLogs.length === 0 ? (
              <EmptyState title="Ingen OCR-användning loggad ännu" description="När du tolkar fakturor eller kvitton visas kostnader och pipelineval här." />
            ) : (
              <div className="divide-y divide-slate-100">
                {ocrUsageLogs.slice(0, 40).map(log => (
                  <div key={log.id} className="grid gap-3 p-4 text-sm lg:grid-cols-[0.8fr_1fr_1fr_0.7fr_0.8fr_0.7fr_0.7fr] lg:items-center">
                    <div>
                      <p className="font-semibold text-slate-900">{log.document_kind === 'receipt' ? 'Kvitto' : 'Leverantörsfaktura'}</p>
                      <p className="text-xs text-slate-500">{new Date(log.created_at).toLocaleString('sv-SE')}</p>
                    </div>
                    <p className="text-slate-600">{log.company?.name || 'Bolag saknas'}</p>
                    <p className="text-slate-600">{log.extraction_method || '-'}</p>
                    <p className="text-slate-600">{log.ocr_provider || '-'}</p>
                    <p className="text-slate-600">{log.ai_model || '-'}</p>
                    <p className="text-slate-600">{Number(log.input_tokens || 0) + Number(log.output_tokens || 0)} tokens</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={log.status === 'failed' ? 'bg-red-50 text-red-700' : log.vision_fallback_used ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}>
                        {log.status === 'failed' ? 'Fel' : log.vision_fallback_used ? 'Vision' : 'OK'}
                      </Badge>
                      <span className="font-semibold text-slate-900">{Number(log.estimated_cost_sek || 0).toFixed(4)} kr</span>
                    </div>
                    {log.error_message && <p className="lg:col-span-7 text-sm text-red-600">{log.error_message}</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'audit' && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-950">Ekonomilogg</h2>
              <p className="mt-1 text-sm text-slate-500">
                Senaste ändringarna i ekonomimodulen. Loggen skapas av databasens audit-triggers.
              </p>
            </div>
            <Badge className="bg-slate-100 text-slate-700">{financeAuditLogs.length} senaste</Badge>
          </div>
          {financeAuditLogs.length === 0 ? (
            <EmptyState title="Ingen ekonomilogg ännu" description="När ekonomiobjekt skapas, ändras eller raderas visas händelserna här." />
          ) : (
            <div className="divide-y divide-slate-100">
              {financeAuditLogs.map(log => {
                const changedFields = Object.keys(log.new_data || {}).filter(key => {
                  const oldValue = (log.old_data || {})[key];
                  const newValue = (log.new_data || {})[key];
                  return JSON.stringify(oldValue) !== JSON.stringify(newValue);
                }).slice(0, 6);
                return (
                  <div key={log.id} className="grid gap-3 p-4 text-sm lg:grid-cols-[0.8fr_1fr_0.8fr_0.8fr_1.4fr] lg:items-center">
                    <div>
                      <Badge className={
                        log.action === 'INSERT' ? 'bg-emerald-50 text-emerald-700' :
                          log.action === 'DELETE' ? 'bg-red-50 text-red-700' :
                            'bg-blue-50 text-blue-700'
                      }>
                        {log.action === 'INSERT' ? 'Skapad' : log.action === 'UPDATE' ? 'Ändrad' : log.action === 'DELETE' ? 'Raderad' : log.action}
                      </Badge>
                    </div>
                    <div>
                      <p className="font-bold text-slate-950">{financeTableLabel(log.table_name)}</p>
                      <p className="text-xs text-slate-500">{log.record_id?.slice(0, 8) || 'Post saknas'}</p>
                    </div>
                    <p className="text-slate-600">{log.company?.name || 'Organisation'}</p>
                    <div>
                      <p className="font-semibold text-slate-700">{log.changed_by_profile?.name || log.changed_by_profile?.email || 'System'}</p>
                      <p className="text-xs text-slate-500">{new Date(log.created_at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {changedFields.length === 0 ? (
                        <span className="text-slate-500">Ingen fältsammanfattning</span>
                      ) : changedFields.map(field => (
                        <Badge key={field} className="bg-slate-100 text-slate-700">{field}</Badge>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <Modal
        open={integrationConfigModalOpen}
        onClose={() => {
          setIntegrationConfigModalOpen(false);
          setSelectedIntegration(null);
        }}
        title="Bokföringskoppling"
        size="lg"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="Provider"
            value={integrationConfigForm.provider}
            disabled
          />
          <Select
            label="Status"
            value={integrationConfigForm.status}
            onChange={event => setIntegrationConfigForm(prev => ({ ...prev, status: event.target.value as AccountingIntegration['status'] }))}
            options={[
              { value: 'not_configured', label: 'Ej konfigurerad' },
              { value: 'active', label: 'Aktiv' },
              { value: 'paused', label: 'Pausad' },
              { value: 'error', label: 'Fel' },
            ]}
          />
          <Input
            label="Driftläge"
            value={integrationConfigForm.mode}
            onChange={event => setIntegrationConfigForm(prev => ({ ...prev, mode: event.target.value }))}
            placeholder="manual_export, sie_export eller api"
          />
          <Input
            label="Exportformat"
            value={integrationConfigForm.export_format}
            onChange={event => setIntegrationConfigForm(prev => ({ ...prev, export_format: event.target.value }))}
            placeholder="csv, sie, api"
          />
          <Input
            label="Externt bolags-/tenant-id"
            value={integrationConfigForm.external_tenant_id}
            onChange={event => setIntegrationConfigForm(prev => ({ ...prev, external_tenant_id: event.target.value }))}
          />
          <Input
            label="Senast ändrad"
            value={selectedIntegration?.updated_at ? new Date(selectedIntegration.updated_at).toLocaleString('sv-SE') : 'Ny koppling'}
            disabled
          />
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm md:col-span-2">
            <p className="font-bold text-slate-900">
              {selectedIntegration?.has_secret ? 'Token finns sparad' : 'Ingen token sparad'}
            </p>
            <p className="mt-1 text-slate-500">
              {selectedIntegration?.has_secret
                ? `${selectedIntegration.secret_hint || 'Maskerad token'}${selectedIntegration.secret_rotated_at ? ` · roterad ${new Date(selectedIntegration.secret_rotated_at).toLocaleString('sv-SE')}` : ''}`
                : 'Fyll i fältet nedan för att spara eller rotera token.'}
            </p>
          </div>
          <Input
            className="md:col-span-2"
            label="Ny API-token/hemlighet"
            type="password"
            value={integrationConfigForm.secret_value}
            onChange={event => setIntegrationConfigForm(prev => ({ ...prev, secret_value: event.target.value }))}
            placeholder="Lämna tomt för att behålla befintlig token"
          />
          <Textarea
            className="md:col-span-2"
            label="Anteckning"
            value={integrationConfigForm.notes}
            onChange={event => setIntegrationConfigForm(prev => ({ ...prev, notes: event.target.value }))}
            rows={2}
            placeholder="T.ex. vilket bolag i bokföringssystemet kopplingen avser."
          />
          <Textarea
            className="font-mono md:col-span-2"
            label="Extra public config som JSON"
            value={integrationConfigForm.config_json}
            onChange={event => setIntegrationConfigForm(prev => ({ ...prev, config_json: event.target.value }))}
            rows={5}
            placeholder={'{\n  "cost_center": "100"\n}'}
          />
          <div className="rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-800 md:col-span-2">
            API-hemligheten sparas separat via edge function och går inte att läsa tillbaka i appen. Extra JSON ska bara innehålla publik adapterkonfiguration.
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setIntegrationConfigModalOpen(false);
              setSelectedIntegration(null);
            }}
          >
            Avbryt
          </Button>
          {selectedIntegration && (
            <Button variant="secondary" onClick={testIntegrationConfig} loading={saving}>
              Testa koppling
            </Button>
          )}
          <Button onClick={saveIntegrationConfig} loading={saving}>Spara koppling</Button>
        </div>
      </Modal>

      <Modal
        open={accountingAccountModalOpen}
        onClose={() => {
          setAccountingAccountModalOpen(false);
          setSelectedAccountingAccount(null);
        }}
        title={selectedAccountingAccount ? 'Redigera konto' : 'Nytt konto'}
        size="lg"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Bolag"
            value={accountingAccountForm.company_id}
            options={companyOptions}
            onChange={event => setAccountingAccountForm(prev => ({ ...prev, company_id: event.target.value }))}
            disabled={Boolean(selectedAccountingAccount)}
          />
          <Input
            label="Kontonummer"
            value={accountingAccountForm.account_code}
            onChange={event => setAccountingAccountForm(prev => ({ ...prev, account_code: event.target.value }))}
            disabled={Boolean(selectedAccountingAccount)}
            placeholder="1510"
          />
          <Input
            className="md:col-span-2"
            label="Namn"
            value={accountingAccountForm.name}
            onChange={event => setAccountingAccountForm(prev => ({ ...prev, name: event.target.value }))}
            placeholder="Kundfordringar"
          />
          <Select
            label="Kontotyp"
            value={accountingAccountForm.account_type}
            onChange={event => setAccountingAccountForm(prev => ({ ...prev, account_type: event.target.value as AccountingAccount['account_type'] }))}
            options={[
              { value: 'asset', label: 'Tillgång' },
              { value: 'liability', label: 'Skuld' },
              { value: 'income', label: 'Intäkt' },
              { value: 'expense', label: 'Kostnad' },
              { value: 'vat', label: 'Moms' },
              { value: 'bank', label: 'Bank' },
              { value: 'receivable', label: 'Kundfordran' },
              { value: 'payable', label: 'Leverantörsskuld' },
              { value: 'other', label: 'Övrigt' },
            ]}
          />
          <Select
            label="Standardroll i export"
            value={accountingAccountForm.default_role}
            onChange={event => setAccountingAccountForm(prev => ({ ...prev, default_role: event.target.value as AccountingAccount['default_role'] }))}
            options={[
              { value: '', label: 'Ingen standardroll' },
              { value: 'customer_receivable', label: 'Kundfordran' },
              { value: 'supplier_payable', label: 'Leverantörsskuld' },
              { value: 'bank', label: 'Bank' },
              { value: 'sales', label: 'Försäljning' },
              { value: 'purchase', label: 'Inköp' },
              { value: 'output_vat', label: 'Utgående moms' },
              { value: 'input_vat', label: 'Ingående moms' },
            ]}
          />
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-semibold text-slate-700 md:col-span-2">
            <input
              type="checkbox"
              checked={accountingAccountForm.active}
              onChange={event => setAccountingAccountForm(prev => ({ ...prev, active: event.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            Aktivt konto
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setAccountingAccountModalOpen(false);
              setSelectedAccountingAccount(null);
            }}
          >
            Avbryt
          </Button>
          <Button onClick={saveAccountingAccount} loading={saving}>
            Spara konto
          </Button>
        </div>
      </Modal>

      <Modal
        open={vatCodeModalOpen}
        onClose={() => {
          setVatCodeModalOpen(false);
          setSelectedVatCode(null);
        }}
        title={selectedVatCode ? 'Redigera momskod' : 'Ny momskod'}
        size="lg"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Bolag"
            value={vatCodeForm.company_id}
            options={companyOptions}
            onChange={event => setVatCodeForm(prev => ({ ...prev, company_id: event.target.value }))}
            disabled={Boolean(selectedVatCode)}
          />
          <Input
            label="Kod"
            value={vatCodeForm.code}
            onChange={event => setVatCodeForm(prev => ({ ...prev, code: event.target.value }))}
            disabled={Boolean(selectedVatCode)}
            placeholder="SE25"
          />
          <Input
            label="Namn"
            value={vatCodeForm.name}
            onChange={event => setVatCodeForm(prev => ({ ...prev, name: event.target.value }))}
            placeholder="Svensk moms 25%"
          />
          <Input
            label="Momsprocent"
            type="number"
            min="0"
            step="0.01"
            value={vatCodeForm.rate}
            onChange={event => setVatCodeForm(prev => ({ ...prev, rate: event.target.value }))}
          />
          <Select
            label="Försäljningskonto"
            value={vatCodeForm.sales_account_code}
            options={accountingAccountOptions}
            onChange={event => setVatCodeForm(prev => ({ ...prev, sales_account_code: event.target.value }))}
          />
          <Select
            label="Inköpskonto"
            value={vatCodeForm.purchase_account_code}
            options={accountingAccountOptions}
            onChange={event => setVatCodeForm(prev => ({ ...prev, purchase_account_code: event.target.value }))}
          />
          <Select
            label="Utgående momskonto"
            value={vatCodeForm.output_vat_account_code}
            options={accountingAccountOptions}
            onChange={event => setVatCodeForm(prev => ({ ...prev, output_vat_account_code: event.target.value }))}
          />
          <Select
            label="Ingående momskonto"
            value={vatCodeForm.input_vat_account_code}
            options={accountingAccountOptions}
            onChange={event => setVatCodeForm(prev => ({ ...prev, input_vat_account_code: event.target.value }))}
          />
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-semibold text-slate-700 md:col-span-2">
            <input
              type="checkbox"
              checked={vatCodeForm.active}
              onChange={event => setVatCodeForm(prev => ({ ...prev, active: event.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            Aktiv momskod
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setVatCodeModalOpen(false);
              setSelectedVatCode(null);
            }}
          >
            Avbryt
          </Button>
          <Button onClick={saveVatCode} loading={saving}>
            Spara momskod
          </Button>
        </div>
      </Modal>

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

      <Modal open={supplierModalOpen} onClose={() => setSupplierModalOpen(false)} title={selectedSupplier ? 'Redigera leverantör' : 'Ny leverantör'} size="lg">
        <div className="grid gap-4 md:grid-cols-2">
          <Select label="Bolag" value={supplierForm.company_id} options={companyOptions} onChange={e => setSupplierForm(prev => ({ ...prev, company_id: e.target.value }))} />
          <Input label="Namn" value={supplierForm.name} onChange={e => setSupplierForm(prev => ({ ...prev, name: e.target.value }))} />
          <Input label="Organisationsnummer" value={supplierForm.organisation_number} onChange={e => setSupplierForm(prev => ({ ...prev, organisation_number: e.target.value }))} />
          <Input label="E-post" type="email" value={supplierForm.email} onChange={e => setSupplierForm(prev => ({ ...prev, email: e.target.value }))} />
          <Input label="Betalvillkor dagar" type="number" value={supplierForm.payment_terms_days} onChange={e => setSupplierForm(prev => ({ ...prev, payment_terms_days: e.target.value }))} />
          <Input label="Bankgiro" value={supplierForm.bankgiro} onChange={e => setSupplierForm(prev => ({ ...prev, bankgiro: e.target.value }))} />
          <Input label="Plusgiro" value={supplierForm.plusgiro} onChange={e => setSupplierForm(prev => ({ ...prev, plusgiro: e.target.value }))} />
          <Input label="IBAN" value={supplierForm.iban} onChange={e => setSupplierForm(prev => ({ ...prev, iban: e.target.value }))} />
          <Input label="BIC/SWIFT" value={supplierForm.bic} onChange={e => setSupplierForm(prev => ({ ...prev, bic: e.target.value }))} />
          <Input label="Bankkonto" value={supplierForm.bank_account} onChange={e => setSupplierForm(prev => ({ ...prev, bank_account: e.target.value }))} />
          <Input label="Standardreferens" value={supplierForm.payment_reference} onChange={e => setSupplierForm(prev => ({ ...prev, payment_reference: e.target.value }))} />
          <Input label="Standardkonto" value={supplierForm.default_account_code} onChange={e => setSupplierForm(prev => ({ ...prev, default_account_code: e.target.value }))} />
          <Textarea label="Anteckningar" value={supplierForm.notes} onChange={e => setSupplierForm(prev => ({ ...prev, notes: e.target.value }))} />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setSupplierModalOpen(false)}>Avbryt</Button>
          <Button onClick={createSupplier} loading={saving} disabled={!supplierForm.name.trim()}>
            {selectedSupplier ? 'Spara ändringar' : 'Skapa leverantör'}
          </Button>
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
              vat_code: '',
              account_code: '',
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
          <Select
            label="Momskod"
            value={invoiceForm.vat_code}
            options={invoiceVatCodeOptions}
            onChange={e => {
              const selectedCode = vatCodes.find(code => code.company_id === invoiceForm.company_id && code.code === e.target.value);
              setInvoiceForm(prev => ({
                ...prev,
                vat_code: e.target.value,
                vat_rate: selectedCode ? String(selectedCode.rate) : prev.vat_rate,
                account_code: selectedCode?.sales_account_code || prev.account_code,
              }));
            }}
          />
          <Input label="Moms %" inputMode="decimal" value={invoiceForm.vat_rate} onChange={e => setInvoiceForm(prev => ({ ...prev, vat_rate: e.target.value }))} />
          <Select
            className="md:col-span-2"
            label="Försäljningskonto"
            value={invoiceForm.account_code}
            options={invoiceAccountOptions}
            onChange={e => setInvoiceForm(prev => ({ ...prev, account_code: e.target.value }))}
          />
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

      <Modal
        open={supplierInvoiceModalOpen}
        onClose={() => {
          setSupplierInvoiceModalOpen(false);
        }}
        title="Ny leverantörsfaktura"
        size="lg"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Dokumenttyp"
            value={supplierInvoiceForm.document_kind}
            options={[
              { value: 'supplier_invoice', label: 'Leverantörsfaktura' },
              { value: 'receipt', label: 'Kvitto' },
            ]}
            onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, document_kind: e.target.value as 'supplier_invoice' | 'receipt' }))}
          />
          <Select label="Bolag" value={supplierInvoiceForm.company_id} options={companyOptions} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, company_id: e.target.value, supplier_id: '', vat_code: '', account_code: '' }))} />
          <Select label="Leverantör" value={supplierInvoiceForm.supplier_id} options={supplierOptions} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, supplier_id: e.target.value }))} />
          <Input label="Leverantörens fakturanummer" value={supplierInvoiceForm.supplier_invoice_number} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, supplier_invoice_number: e.target.value }))} />
          <Input label="Fakturadatum" type="date" value={supplierInvoiceForm.invoice_date} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, invoice_date: e.target.value }))} />
          <Input label="Förfallodatum" type="date" value={supplierInvoiceForm.due_date} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, due_date: e.target.value }))} />
          <Select
            label="Konto"
            value={supplierInvoiceForm.account_code}
            options={supplierInvoiceAccountOptions}
            onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, account_code: e.target.value }))}
          />
          <Input className="md:col-span-2" label="Radtext" value={supplierInvoiceForm.description} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, description: e.target.value }))} />
          <Input label="Antal" inputMode="decimal" value={supplierInvoiceForm.quantity} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, quantity: e.target.value }))} />
          <Input label="Pris exkl. moms" inputMode="decimal" value={supplierInvoiceForm.unit_price} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, unit_price: e.target.value }))} />
          <Select
            label="Momskod"
            value={supplierInvoiceForm.vat_code}
            options={supplierInvoiceVatCodeOptions}
            onChange={e => {
              const selectedCode = vatCodes.find(code => code.company_id === supplierInvoiceForm.company_id && code.code === e.target.value);
              setSupplierInvoiceForm(prev => ({
                ...prev,
                vat_code: e.target.value,
                vat_rate: selectedCode ? String(selectedCode.rate) : prev.vat_rate,
                account_code: selectedCode?.purchase_account_code || prev.account_code,
              }));
            }}
          />
          <Input label="Moms %" inputMode="decimal" value={supplierInvoiceForm.vat_rate} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, vat_rate: e.target.value }))} />
          <Textarea label="Intern anteckning" value={supplierInvoiceForm.notes} onChange={e => setSupplierInvoiceForm(prev => ({ ...prev, notes: e.target.value }))} />
          <div className="md:col-span-2">
            <DocumentCapture
              documentKind={supplierInvoiceForm.document_kind}
              file={supplierInvoiceFile}
              onFileChange={setSupplierInvoiceFile}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setSupplierInvoiceModalOpen(false)}>Avbryt</Button>
          <Button
            onClick={createSupplierInvoice}
            loading={saving}
            disabled={!supplierInvoiceForm.company_id || (!supplierInvoiceForm.description.trim() && !supplierInvoiceFile)}
          >
            Skapa för tolkning/attest
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
                onChange={e => {
                  setSupplierInvoiceReviewForm(prev => ({ ...prev, company_id: e.target.value, supplier_id: '' }));
                  setSupplierInvoiceLineForm(prev => ({ ...prev, company_id: e.target.value, vat_code: '', account_code: '' }));
                }}
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

            <Card className="overflow-hidden">
              <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-bold text-slate-950">Kostnadsrader</h3>
                  <p className="text-sm text-slate-500">Raderna summerar leverantörsfakturan och styr bokföringskonto i exporten.</p>
                </div>
                <Badge className="bg-slate-100 text-slate-700">{selectedSupplierInvoiceLines.length} rader</Badge>
              </div>
              {selectedSupplierInvoiceLines.length === 0 ? (
                <EmptyState title="Inga rader" description="Lägg till minst en kostnadsrad innan fakturan attesteras." />
              ) : (
                <div className="divide-y divide-slate-100">
                  {selectedSupplierInvoiceLines.map(line => (
                    <div key={line.id} className="grid gap-3 p-4 md:grid-cols-[1.4fr_0.5fr_0.6fr_0.45fr_0.55fr_0.6fr_auto] md:items-center">
                      <div>
                        <p className="font-semibold text-slate-900">{line.description}</p>
                        {line.account_code && <p className="mt-1 text-xs font-semibold text-slate-500">Konto {line.account_code}</p>}
                      </div>
                      <p className="text-sm text-slate-600">{line.quantity} {line.unit}</p>
                      <p className="text-sm text-slate-600">{formatCurrency(Number(line.unit_price), selectedSupplierInvoice.currency)}</p>
                      <p className="text-sm text-slate-600">{line.vat_rate}%</p>
                      <p className="text-sm text-slate-600">{formatCurrency(Number(line.vat_amount), selectedSupplierInvoice.currency)}</p>
                      <p className="font-semibold text-slate-950">{formatCurrency(Number(line.line_total_incl_vat), selectedSupplierInvoice.currency)}</p>
                      {selectedSupplierInvoice.approval_status !== 'approved' ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => editSupplierInvoiceLineInReview(line)} disabled={saving}>
                            Redigera
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteSupplierInvoiceLineInReview(line)}
                            disabled={selectedSupplierInvoiceLines.length <= 1 || saving}
                          >
                            Ta bort
                          </Button>
                        </div>
                      ) : (
                        <span />
                      )}
                    </div>
                  ))}
                </div>
              )}
              {selectedSupplierInvoice.approval_status !== 'approved' && (
                <div className="border-t border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h4 className="font-bold text-slate-900">{selectedSupplierInvoiceLine ? 'Redigera rad' : 'Lägg till rad'}</h4>
                    {selectedSupplierInvoiceLine && (
                      <Button variant="ghost" size="sm" onClick={resetSupplierInvoiceLineDraft}>
                        Avbryt redigering
                      </Button>
                    )}
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-6">
                    <Input
                      className="md:col-span-2"
                      label="Radtext"
                      value={supplierInvoiceLineForm.description}
                      onChange={e => setSupplierInvoiceLineForm(prev => ({ ...prev, description: e.target.value }))}
                    />
                    <Input
                      label="Antal"
                      inputMode="decimal"
                      value={supplierInvoiceLineForm.quantity}
                      onChange={e => setSupplierInvoiceLineForm(prev => ({ ...prev, quantity: e.target.value }))}
                    />
                    <Input
                      label="Pris exkl. moms"
                      inputMode="decimal"
                      value={supplierInvoiceLineForm.unit_price}
                      onChange={e => setSupplierInvoiceLineForm(prev => ({ ...prev, unit_price: e.target.value }))}
                    />
                    <Select
                      label="Momskod"
                      value={supplierInvoiceLineForm.vat_code}
                      options={supplierInvoiceReviewVatCodeOptions}
                      onChange={e => {
                        const companyId = supplierInvoiceReviewForm.company_id || selectedSupplierInvoice.company_id;
                        const selectedCode = vatCodes.find(code => code.company_id === companyId && code.code === e.target.value);
                        setSupplierInvoiceLineForm(prev => ({
                          ...prev,
                          vat_code: e.target.value,
                          vat_rate: selectedCode ? String(selectedCode.rate) : prev.vat_rate,
                          account_code: selectedCode?.purchase_account_code || prev.account_code,
                        }));
                      }}
                    />
                    <Input
                      label="Moms %"
                      inputMode="decimal"
                      value={supplierInvoiceLineForm.vat_rate}
                      onChange={e => setSupplierInvoiceLineForm(prev => ({ ...prev, vat_rate: e.target.value }))}
                    />
                    <Select
                      className="md:col-span-3"
                      label="Konto"
                      value={supplierInvoiceLineForm.account_code}
                      options={supplierInvoiceReviewAccountOptions}
                      onChange={e => setSupplierInvoiceLineForm(prev => ({ ...prev, account_code: e.target.value }))}
                    />
                    <Button
                      className="self-end md:col-span-3"
                      onClick={saveSupplierInvoiceLineInReview}
                      loading={saving}
                      disabled={!supplierInvoiceLineForm.description.trim()}
                    >
                      {selectedSupplierInvoiceLine ? 'Spara rad' : 'Lägg till rad'}
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex justify-end border-t border-slate-100 bg-slate-50 p-4">
                <div className="w-full max-w-sm space-y-2 text-sm">
                  <div className="flex justify-between"><span>Exkl. moms</span><strong>{formatCurrency(selectedSupplierInvoiceLines.reduce((sum, line) => sum + Number(line.line_total_excl_vat || 0), 0), selectedSupplierInvoice.currency)}</strong></div>
                  <div className="flex justify-between"><span>Moms</span><strong>{formatCurrency(selectedSupplierInvoiceLines.reduce((sum, line) => sum + Number(line.vat_amount || 0), 0), selectedSupplierInvoice.currency)}</strong></div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 text-base"><span>Total</span><strong>{formatCurrency(selectedSupplierInvoiceLines.reduce((sum, line) => sum + Number(line.line_total_incl_vat || 0), 0), selectedSupplierInvoice.currency)}</strong></div>
                </div>
              </div>
            </Card>

            {selectedSupplierInvoice.ocr_status !== 'not_started' && (
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">OCR-underlag</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {String(selectedSupplierInvoice.ocr_data?.extraction_note || 'Kontrollera uppgifterna mot bilagan innan attest.')}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Badge className={
                      selectedSupplierInvoice.validation_results?.severity === 'red' ? 'bg-red-50 text-red-700' :
                        selectedSupplierInvoice.validation_results?.severity === 'yellow' ? 'bg-amber-50 text-amber-700' :
                          'bg-emerald-50 text-emerald-700'
                    }>
                      {selectedSupplierInvoice.validation_results?.severity === 'red' ? 'Kontroll krävs' :
                        selectedSupplierInvoice.validation_results?.severity === 'yellow' ? 'Kontrollera' : 'Stämmer'}
                    </Badge>
                    <Badge className="bg-purple-50 text-purple-700">
                      {selectedSupplierInvoice.ocr_status === 'queued' ? 'Köad' : selectedSupplierInvoice.ocr_status === 'needs_review' ? 'Behöver granskas' : selectedSupplierInvoice.ocr_status}
                    </Badge>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-sm md:grid-cols-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fil</p>
                    <p className="mt-1 font-semibold text-slate-900">{String(selectedSupplierInvoice.ocr_data?.source_file_name || selectedSupplierInvoice.ocr_data?.file_name || 'Saknas')}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Metod</p>
                    <p className="mt-1 font-semibold text-slate-900">{String(selectedSupplierInvoice.ocr_data?.extraction_method || selectedSupplierInvoice.ocr_provider || '-')}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI-modell</p>
                    <p className="mt-1 font-semibold text-slate-900">{selectedSupplierInvoice.ai_model || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kostnad</p>
                    <p className="mt-1 font-semibold text-slate-900">{Number(selectedSupplierInvoice.estimated_cost_sek || 0).toFixed(4)} kr</p>
                  </div>
                </div>
                {Array.isArray(selectedSupplierInvoice.validation_results?.errors) && selectedSupplierInvoice.validation_results.errors.length > 0 && (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <p className="font-bold">Valideringsfel</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {selectedSupplierInvoice.validation_results.errors.map((item, index) => (
                        <li key={index}>{String(item)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(selectedSupplierInvoice.validation_results?.warnings) && selectedSupplierInvoice.validation_results.warnings.length > 0 && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="font-bold">Behöver kontrolleras</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {selectedSupplierInvoice.validation_results.warnings.map((item, index) => (
                        <li key={index}>{String(item)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {selectedSupplierInvoice.duplicate_supplier_invoice_id && (
                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                    <AlertTriangle className="h-4 w-4" />
                    Möjlig dubblett hittad. Kontrollera innan attest.
                  </div>
                )}
                {selectedSupplierInvoice.confidence && Object.keys(selectedSupplierInvoice.confidence).length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Säkerhet per fält</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {Object.entries(selectedSupplierInvoice.confidence).map(([field, value]) => (
                        <Badge key={field} className={confidenceBadgeClass(value)}>
                          {field}: {Math.round(Number(value || 0) * 100)}%
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={openSupplierInvoiceOriginal}>
                    <FileText className="h-4 w-4" />
                    Öppna original
                  </Button>
                  <Button variant="secondary" size="sm" onClick={applySupplierInvoiceOcrSuggestion}>
                    Använd förslag
                  </Button>
                  <Button variant="secondary" size="sm" loading={saving} onClick={() => processSingleSupplierInvoiceOcr(selectedSupplierInvoice.id)}>
                    <RotateCcw className="h-4 w-4" />
                    Kör om tolkning
                  </Button>
                  <Button variant="secondary" size="sm" loading={saving} onClick={() => processSingleSupplierInvoiceOcr(selectedSupplierInvoice.id, true)}>
                    <Sparkles className="h-4 w-4" />
                    Kör vision-fallback
                  </Button>
                </div>
              </Card>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setSupplierInvoiceDetailOpen(false)}>Stäng</Button>
              <Button
                variant="secondary"
                onClick={saveSupplierInvoiceReview}
                loading={saving}
                disabled={!supplierInvoiceReviewForm.company_id}
              >
                Spara granskning
              </Button>
              {selectedSupplierInvoice.approval_status !== 'approved' && (
                <Button onClick={() => approveSupplierInvoice(selectedSupplierInvoice.id)} loading={saving} disabled={selectedSupplierInvoiceLines.length === 0}>
                  <CheckCircle2 className="h-4 w-4" />
                  Attestera
                </Button>
              )}
              {selectedSupplierInvoice.approval_status === 'approved' && selectedSupplierInvoice.payment_status === 'unpaid' && (
                <Button variant="secondary" onClick={() => scheduleSupplierInvoicePayment(selectedSupplierInvoice.id)} loading={saving}>
                  Planera betalning
                </Button>
              )}
              {selectedSupplierInvoice.approval_status === 'approved' && (
                <Button
                  variant="secondary"
                  onClick={() => queueSupplierInvoiceAccountingSync(selectedSupplierInvoice.id)}
                  loading={saving}
                >
                  <Landmark className="h-4 w-4" />
                  Köa bokföring
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
            label="Ekonomikund (valfritt)"
            value={projectInvoiceForm.customer_id}
            options={[
              { value: '', label: 'Matcha eller skapa automatiskt' },
              ...customers.map(customer => ({ value: customer.id, label: customer.name })),
            ]}
            onChange={e => setProjectInvoiceForm(prev => ({ ...prev, customer_id: e.target.value }))}
          />
          <Input label="Fakturadatum" type="date" value={projectInvoiceForm.invoice_date} onChange={e => setProjectInvoiceForm(prev => ({ ...prev, invoice_date: e.target.value }))} />
          <Input label="Förfallodatum" type="date" value={projectInvoiceForm.due_date} onChange={e => setProjectInvoiceForm(prev => ({ ...prev, due_date: e.target.value }))} />
        </div>
        <div className="mt-6 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
          Projektets faktureringsrader kopieras till ett vanligt fakturautkast. Om du inte väljer en ekonomikund matchar systemet på projektkundens namn eller skapar en ny kund automatiskt.
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setProjectInvoiceModalOpen(false)}>Avbryt</Button>
          <Button
            onClick={createInvoiceFromProjectBasis}
            loading={saving}
            disabled={!projectInvoiceForm.basis_id || !projectInvoiceForm.company_id}
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
                    <div key={item.id} className="grid gap-3 p-4 lg:grid-cols-[1.3fr_1fr_0.8fr_0.8fr_0.8fr_auto_auto] lg:items-center">
                      <div>
                        <h3 className="font-bold text-slate-950">{item.tenant?.name ?? 'Hyresgäst saknas'}</h3>
                        <p className="text-sm text-slate-500">
                          {item.apartment?.apartment_number || 'Lägenhet saknas'} · {item.property?.name || item.property?.address || 'Fastighet saknas'}
                        </p>
                      </div>
                      <p className="text-sm text-slate-600">{item.description}</p>
                      <p className="text-sm text-slate-600">Förfaller {item.due_date}</p>
                      <p className="text-sm text-slate-600">
                        Grund {formatCurrency(Number(item.base_rent_amount || item.amount || 0))}
                        {Number(item.adjustment_amount || 0) !== 0 && (
                          <span className={Number(item.adjustment_amount || 0) < 0 ? 'ml-1 font-bold text-emerald-700' : 'ml-1 font-bold text-slate-700'}>
                            {Number(item.adjustment_amount || 0) < 0 ? '' : '+'}{formatCurrency(Number(item.adjustment_amount || 0))}
                          </span>
                        )}
                      </p>
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
              {rentEmailQueueResult && (
                <p className="mr-auto rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700">
                  {rentEmailQueueResult}
                </p>
              )}
              {rentDirectDebitExportResult && (
                <p className="mr-auto rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                  {rentDirectDebitExportResult}
                </p>
              )}
              <Button variant="secondary" onClick={() => setRentRunDetailOpen(false)}>Stäng</Button>
              <Button
                variant="secondary"
                onClick={() => exportRentRunDirectDebit('csv')}
                loading={saving}
                disabled={!selectedRentItems.some(item => item.invoice_id)}
              >
                Exportera autogiro CSV
              </Button>
              <Button
                variant="secondary"
                onClick={() => exportRentRunDirectDebit('bankgirot')}
                loading={saving}
                disabled={!selectedRentItems.some(item => item.invoice_id)}
              >
                Exportera Bankgirot-fil
              </Button>
              <Button
                variant="secondary"
                onClick={queueRentRunInvoiceEmails}
                loading={saving}
                disabled={!selectedRentItems.some(item => item.invoice_id)}
              >
                Köa hyresmejl
              </Button>
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
                  <div key={line.id} className="grid gap-3 p-4 md:grid-cols-[1.4fr_0.5fr_0.6fr_0.45fr_0.55fr_0.6fr_auto] md:items-center">
                    <div>
                      <p className="font-semibold text-slate-900">{line.description}</p>
                      {line.account_code && <p className="mt-1 text-xs font-semibold text-slate-500">Konto {line.account_code}</p>}
                    </div>
                    <p className="text-sm text-slate-600">{line.quantity} {line.unit}</p>
                    <p className="text-sm text-slate-600">{formatCurrency(Number(line.unit_price), selectedInvoice.currency)}</p>
                    <p className="text-sm text-slate-600">{line.vat_rate}%</p>
                    <p className="text-sm text-slate-600">{formatCurrency(Number(line.vat_amount), selectedInvoice.currency)}</p>
                    <p className="font-semibold text-slate-950">{formatCurrency(Number(line.line_total_incl_vat), selectedInvoice.currency)}</p>
                    {selectedInvoice.status === 'draft' ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => editInvoiceLineInDraft(line)}
                          disabled={saving}
                        >
                          Redigera
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteInvoiceLineFromDraft(line)}
                          disabled={selectedInvoiceLines.length <= 1 || saving}
                        >
                          Ta bort
                        </Button>
                      </div>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
              </div>
              {selectedInvoice.status === 'draft' && (
                <div className="border-t border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h4 className="font-bold text-slate-900">{selectedInvoiceLine ? 'Redigera rad' : 'Lägg till rad'}</h4>
                    {selectedInvoiceLine && (
                      <Button variant="ghost" size="sm" onClick={resetInvoiceLineDraft}>
                        Avbryt redigering
                      </Button>
                    )}
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-6">
                    <Input
                      className="md:col-span-2"
                      label="Radtext"
                      value={invoiceLineForm.description}
                      onChange={e => setInvoiceLineForm(prev => ({ ...prev, description: e.target.value }))}
                    />
                    <Input
                      label="Antal"
                      inputMode="decimal"
                      value={invoiceLineForm.quantity}
                      onChange={e => setInvoiceLineForm(prev => ({ ...prev, quantity: e.target.value }))}
                    />
                    <Input
                      label="Enhet"
                      value={invoiceLineForm.unit}
                      onChange={e => setInvoiceLineForm(prev => ({ ...prev, unit: e.target.value }))}
                    />
                    <Input
                      label="Pris exkl. moms"
                      inputMode="decimal"
                      value={invoiceLineForm.unit_price}
                      onChange={e => setInvoiceLineForm(prev => ({ ...prev, unit_price: e.target.value }))}
                    />
                    <Button
                      className="self-end"
                      onClick={saveInvoiceLineToDraft}
                      loading={saving}
                      disabled={!invoiceLineForm.description.trim()}
                    >
                      {selectedInvoiceLine ? 'Spara rad' : 'Lägg till'}
                    </Button>
                    <Select
                      className="md:col-span-2"
                      label="Momskod"
                      value={invoiceLineForm.vat_code}
                      options={selectedInvoiceVatCodeOptions}
                      onChange={e => {
                        const selectedCode = vatCodes.find(code => code.company_id === selectedInvoice.company_id && code.code === e.target.value);
                        setInvoiceLineForm(prev => ({
                          ...prev,
                          vat_code: e.target.value,
                          vat_rate: selectedCode ? String(selectedCode.rate) : prev.vat_rate,
                          account_code: selectedCode?.sales_account_code || prev.account_code,
                        }));
                      }}
                    />
                    <Input
                      label="Moms %"
                      inputMode="decimal"
                      value={invoiceLineForm.vat_rate}
                      onChange={e => setInvoiceLineForm(prev => ({ ...prev, vat_rate: e.target.value }))}
                    />
                    <Select
                      className="md:col-span-3"
                      label="Försäljningskonto"
                      value={invoiceLineForm.account_code}
                      options={selectedInvoiceAccountOptions}
                      onChange={e => setInvoiceLineForm(prev => ({ ...prev, account_code: e.target.value }))}
                    />
                  </div>
                </div>
              )}
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

function financeTableLabel(tableName: string) {
  const labels: Record<string, string> = {
    vihem_companies: 'Bolag',
    vihem_company_user_permissions: 'Bolagsbehörighet',
    vihem_finance_customers: 'Kund',
    vihem_finance_suppliers: 'Leverantör',
    vihem_invoice_number_series: 'Nummerserie',
    vihem_invoices: 'Faktura',
    vihem_invoice_lines: 'Fakturarad',
    vihem_payments: 'Betalning',
    vihem_accounting_integrations: 'Bokföringskoppling',
    vihem_accounting_sync_queue: 'Bokföringskö',
    vihem_supplier_invoices: 'Leverantörsfaktura',
    vihem_supplier_invoice_lines: 'Leverantörsfakturarad',
    vihem_rent_billing_runs: 'Hyreskörning',
    vihem_rent_billing_items: 'Hyresrad',
    vihem_rent_adjustments: 'Hyresjustering',
    vihem_direct_debit_mandates: 'Autogiromandat',
    vihem_finance_automation_settings: 'Automationsinställning',
    vihem_finance_reminder_settings: 'Påminnelseregel',
  };
  return labels[tableName] || tableName.replace(/^vihem_/, '').replaceAll('_', ' ');
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
