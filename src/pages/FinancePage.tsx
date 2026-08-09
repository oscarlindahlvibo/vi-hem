import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, CircleDollarSign, CreditCard, FileText, Landmark, Link2, Plus, Printer, ReceiptText, Send, Truck, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { buildGeneratedDocument } from '../lib/generatedDocuments';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, Select, Textarea } from '../components/ui';
import type { AccountingIntegration, CustomerProject, FinanceCompany, FinanceCustomer, FinanceSupplier, Invoice, InvoiceLine, ProjectInvoiceBasis, SupplierInvoice } from '../types';

interface FinancePageProps {
  onNavigate: (page: string) => void;
}

type FinanceTab = 'overview' | 'companies' | 'customers' | 'invoices' | 'project-basis' | 'suppliers' | 'supplier-invoices' | 'integrations';

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

export function FinancePage({ onNavigate: _onNavigate }: FinancePageProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<FinanceTab>('overview');
  const [companies, setCompanies] = useState<FinanceCompany[]>([]);
  const [customers, setCustomers] = useState<FinanceCustomer[]>([]);
  const [suppliers, setSuppliers] = useState<FinanceSupplier[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [supplierInvoices, setSupplierInvoices] = useState<SupplierInvoice[]>([]);
  const [integrations, setIntegrations] = useState<AccountingIntegration[]>([]);
  const [projectBases, setProjectBases] = useState<Array<ProjectInvoiceBasis & { project?: CustomerProject | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [invoiceDetailOpen, setInvoiceDetailOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [supplierInvoiceModalOpen, setSupplierInvoiceModalOpen] = useState(false);
  const [projectInvoiceModalOpen, setProjectInvoiceModalOpen] = useState(false);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoiceForm);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [supplierInvoiceForm, setSupplierInvoiceForm] = useState(emptySupplierInvoiceForm);
  const [projectInvoiceForm, setProjectInvoiceForm] = useState(emptyProjectInvoiceForm);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [selectedInvoiceLines, setSelectedInvoiceLines] = useState<InvoiceLine[]>([]);

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

  const openAmount = useMemo(() => {
    return invoices
      .filter(invoice => !['paid', 'credited', 'cancelled'].includes(invoice.status))
      .reduce((sum, invoice) => sum + Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0), 0);
  }, [invoices]);

  const draftCount = invoices.filter(invoice => invoice.status === 'draft').length;

  const loadFinance = useCallback(async () => {
    if (!organisationId) return;
    setLoading(true);
    setError('');

    const [companyResult, customerResult, supplierResult, invoiceResult, supplierInvoiceResult, integrationResult, projectBasisResult] = await Promise.all([
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
        .from('vihem_project_invoice_basis')
        .select('*, lines:vihem_project_invoice_basis_lines(*), project:project_id(*)')
        .in('status', ['draft', 'ready_for_invoicing'])
        .order('created_at', { ascending: false }),
    ]);

    const firstError = companyResult.error ?? customerResult.error ?? supplierResult.error ?? invoiceResult.error ?? supplierInvoiceResult.error ?? integrationResult.error ?? projectBasisResult.error;
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
    setSupplierInvoices((supplierInvoiceResult.data ?? []) as SupplierInvoice[]);
    setIntegrations((integrationResult.data ?? []) as AccountingIntegration[]);
    setProjectBases((projectBasisResult.data ?? []) as Array<ProjectInvoiceBasis & { project?: CustomerProject | null }>);
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

    setSupplierInvoiceModalOpen(false);
    resetSupplierInvoiceForm();
    setSaving(false);
    await loadFinance();
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

  const openInvoiceDetail = async (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setSelectedInvoiceLines([]);
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

  const buildInvoiceText = (invoice: Invoice, lines: InvoiceLine[]) => {
    const company = invoice.company;
    const customer = invoice.customer;
    const lineText = lines.map(line => {
      return `${line.description}\n${line.quantity} ${line.unit} x ${formatCurrency(Number(line.unit_price), invoice.currency)} exkl. moms, moms ${line.vat_rate}% = ${formatCurrency(Number(line.line_total_incl_vat), invoice.currency)}`;
    }).join('\n\n');

    return [
      `${company?.legal_name || company?.name || 'Bolag saknas'}`,
      company?.organisation_number ? `Org.nr: ${company.organisation_number}` : '',
      company?.email ? `E-post: ${company.email}` : '',
      '',
      `Faktura: ${invoice.invoice_number || 'Utkast'}`,
      `Fakturadatum: ${invoice.invoice_date}`,
      `Förfallodatum: ${invoice.due_date}`,
      '',
      `Kund: ${customer?.name || 'Kund saknas'}`,
      customer?.organisation_number ? `Kundnr/org.nr: ${customer.organisation_number}` : '',
      customer?.invoice_email || customer?.email ? `E-post: ${customer.invoice_email || customer.email}` : '',
      '',
      lineText,
      '',
      `Summa exkl. moms: ${formatCurrency(Number(invoice.subtotal_amount), invoice.currency)}`,
      `Moms: ${formatCurrency(Number(invoice.vat_amount), invoice.currency)}`,
      `Att betala: ${formatCurrency(Number(invoice.total_amount), invoice.currency)}`,
      '',
      invoice.notes ? `Anteckning: ${invoice.notes}` : '',
    ].filter(Boolean).join('\n');
  };

  const saveInvoiceDocument = async (invoice: Invoice, lines: InvoiceLine[]) => {
    if (!organisationId) return;
    const invoiceTitle = `Faktura ${invoice.invoice_number || invoice.id.slice(0, 8)}`;
    const fileName = `${invoiceTitle.toLowerCase().replace(/\s+/g, '-')}.pdf`;
    const documentPayload = {
      ...buildGeneratedDocument({
        title: invoiceTitle,
        fileName,
        documentType: 'invoice',
        description: `Faktura till ${invoice.customer?.name || 'kund'}`,
        body: buildInvoiceText(invoice, lines),
        organisationId,
        createdBy: user?.id ?? null,
      }),
      company_id: invoice.company_id,
      document_category: 'invoice',
      visibility: 'admin',
    };

    const { data, error: documentError } = await supabase
      .from('vihem_documents')
      .insert(documentPayload)
      .select('id, file_url')
      .single();

    if (documentError) {
      setError(documentError.message);
      return;
    }

    await supabase
      .from('vihem_invoices')
      .update({ document_id: data.id })
      .eq('id', invoice.id);

    const link = document.createElement('a');
    link.href = data.file_url;
    link.download = fileName;
    link.click();
  };

  const approveInvoice = async () => {
    if (!selectedInvoice) return;
    setSaving(true);
    setError('');

    const { data, error: approveError } = await supabase.rpc('vihem_approve_invoice', {
      target_invoice_id: selectedInvoice.id,
    });

    if (approveError) {
      setError(approveError.message);
      setSaving(false);
      return;
    }

    const approvedInvoice = (Array.isArray(data) ? data[0] : data) as Invoice | null;
    const hydratedInvoice = approvedInvoice ? await refreshSelectedInvoice(approvedInvoice.id) : await refreshSelectedInvoice(selectedInvoice.id);
    if (hydratedInvoice) await saveInvoiceDocument(hydratedInvoice, selectedInvoiceLines);
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

  const tabs: { key: FinanceTab; label: string }[] = [
    { key: 'overview', label: 'Översikt' },
    { key: 'companies', label: 'Bolag' },
    { key: 'customers', label: 'Kunder' },
    { key: 'invoices', label: 'Fakturor' },
    { key: 'project-basis', label: 'Projektunderlag' },
    { key: 'suppliers', label: 'Leverantörer' },
    { key: 'supplier-invoices', label: 'Leverantörsfakturor' },
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
          <MetricCard icon={<Truck className="h-5 w-5" />} label="Leverantörsfakturor" value={supplierInvoices.length.toString()} />
          <MetricCard icon={<Link2 className="h-5 w-5" />} label="Projektunderlag" value={projectBases.length.toString()} />

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
          {supplierInvoices.length === 0 ? (
            <EmptyState title="Inga leverantörsfakturor ännu" description="Registrera inkommande fakturor manuellt nu, OCR och e-postimport kopplas på i nästa lager." />
          ) : (
            <div className="divide-y divide-slate-100">
              {supplierInvoices.map(invoice => (
                <div key={invoice.id} className="grid gap-3 p-4 lg:grid-cols-[1.1fr_1fr_0.7fr_0.8fr_auto_auto] lg:items-center">
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
                  {invoice.approval_status !== 'approved' && (
                    <Button variant="secondary" size="sm" loading={saving} onClick={() => approveSupplierInvoice(invoice.id)}>
                      Attestera
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'integrations' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {companies.length === 0 ? (
            <Card className="p-6 lg:col-span-2">
              <EmptyState title="Skapa ett bolag först" description="Bokföringskopplingar styrs per juridiskt bolag." />
            </Card>
          ) : companies.map(company => {
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

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={printInvoice}>
                <Printer className="h-4 w-4" />
                Skriv ut
              </Button>
              {selectedInvoice.status === 'draft' && (
                <Button onClick={approveInvoice} loading={saving}>
                  <CheckCircle2 className="h-4 w-4" />
                  Godkänn och skapa PDF
                </Button>
              )}
              {['approved', 'sent'].includes(selectedInvoice.status) && (
                <>
                  <Button variant="secondary" onClick={markInvoiceSent} loading={saving}>
                    <Send className="h-4 w-4" />
                    Markera skickad
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
