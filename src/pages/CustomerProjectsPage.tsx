import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  CalendarDays,
  CheckCircle,
  ClipboardList,
  Coins,
  FileText,
  FolderOpen,
  Hammer,
  History,
  Image,
  Package,
  Plus,
  Receipt,
  Send,
  Timer,
  Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingPage,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Textarea,
} from '../components/ui';
import { formatDate } from '../lib/utils';
import type {
  CustomerProject,
  CustomerProjectStatus,
  Profile,
  ProjectActivityLog,
  ProjectAssignment,
  ProjectChangeOrder,
  ProjectCustomer,
  ProjectDeviation,
  ProjectInspection,
  ProjectInvoiceBasis,
  ProjectMaterialEntry,
  ProjectQuoteVersion,
  ProjectSelfCheck,
  ProjectSelfCheckTemplate,
  TimeEntry,
} from '../types';

interface CustomerProjectsPageProps { onNavigate: (page: string) => void; }

const STATUS_LABELS: Record<CustomerProjectStatus, string> = {
  draft: 'Utkast',
  quote_created: 'Offert skapad',
  quote_sent: 'Offert skickad',
  quote_accepted: 'Offert accepterad',
  planned: 'Planerat',
  in_progress: 'Pågående',
  paused: 'Pausat',
  waiting_customer: 'Väntar på kund',
  waiting_material: 'Väntar på material',
  ready_for_inspection: 'Klart för besiktning',
  inspected_with_remarks: 'Besiktigat med anmärkningar',
  approved: 'Godkänt',
  invoiced: 'Fakturerat',
  completed: 'Avslutat',
  archived: 'Arkiverat',
  cancelled: 'Avbrutet',
};

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  quote_sent: 'bg-blue-100 text-blue-700',
  quote_accepted: 'bg-green-100 text-green-700',
  planned: 'bg-indigo-100 text-indigo-700',
  in_progress: 'bg-teal-100 text-teal-700',
  paused: 'bg-amber-100 text-amber-700',
  waiting_customer: 'bg-amber-100 text-amber-700',
  waiting_material: 'bg-amber-100 text-amber-700',
  ready_for_inspection: 'bg-violet-100 text-violet-700',
  inspected_with_remarks: 'bg-orange-100 text-orange-700',
  approved: 'bg-green-100 text-green-700',
  invoiced: 'bg-slate-900 text-white',
  completed: 'bg-slate-100 text-slate-700',
  archived: 'bg-slate-100 text-slate-500',
  cancelled: 'bg-red-100 text-red-700',
};

const PROJECT_TYPES = [
  'Renovering',
  'Byggservice',
  'Felanmälan som blivit projekt',
  'Lägenhetsrenovering',
  'Lokalanpassning',
  'Markarbete',
  'El',
  'VVS',
  'Målning',
  'Snickeri',
  'Tak',
  'Fasad',
  'Event/uthyrning',
  'Annat',
];

const currency = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 });
const hours = (minutes: number) => `${(minutes / 60).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} h`;
const money = (value?: number | null) => currency.format(Number(value || 0));

const defaultProjectForm = {
  title: '',
  customer_id: '',
  project_address: '',
  description: '',
  project_type: 'Renovering',
  priority: 'normal',
  project_manager_id: '',
  assigned_user_ids: [] as string[],
  start_date: '',
  planned_end_date: '',
  budget_amount: '0',
  hourly_rate: '650',
  billing_type: 'hourly',
  internal_reference: '',
  external_reference: '',
};

const defaultCustomerForm = {
  customer_type: 'company',
  name: '',
  identity_number: '',
  contact_person: '',
  phone: '',
  email: '',
  invoice_address: '',
  project_address: '',
  reference: '',
  notes: '',
};

export function CustomerProjectsPage({ onNavigate: _onNavigate }: CustomerProjectsPageProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<CustomerProject[]>([]);
  const [customers, setCustomers] = useState<ProjectCustomer[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [assignments, setAssignments] = useState<ProjectAssignment[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [materials, setMaterials] = useState<ProjectMaterialEntry[]>([]);
  const [changeOrders, setChangeOrders] = useState<ProjectChangeOrder[]>([]);
  const [quotes, setQuotes] = useState<ProjectQuoteVersion[]>([]);
  const [selfCheckTemplates, setSelfCheckTemplates] = useState<ProjectSelfCheckTemplate[]>([]);
  const [selfChecks, setSelfChecks] = useState<ProjectSelfCheck[]>([]);
  const [inspections, setInspections] = useState<ProjectInspection[]>([]);
  const [deviations, setDeviations] = useState<ProjectDeviation[]>([]);
  const [invoiceBases, setInvoiceBases] = useState<ProjectInvoiceBasis[]>([]);
  const [activity, setActivity] = useState<ProjectActivityLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'time' | 'materials' | 'change-orders' | 'quotes' | 'self-checks' | 'inspections' | 'deviations' | 'invoice' | 'documents' | 'activity'>('overview');
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [showSelfCheckTemplateModal, setShowSelfCheckTemplateModal] = useState(false);
  const [showSelfCheckModal, setShowSelfCheckModal] = useState(false);
  const [showInspectionModal, setShowInspectionModal] = useState(false);
  const [showDeviationModal, setShowDeviationModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [projectForm, setProjectForm] = useState(defaultProjectForm);
  const [customerForm, setCustomerForm] = useState(defaultCustomerForm);
  const [timeForm, setTimeForm] = useState({
    work_date: new Date().toISOString().slice(0, 10),
    user_id: user?.id || '',
    start_time: '08:00',
    end_time: '16:00',
    break_minutes: '30',
    work_type: '',
    comment: '',
    project_billable: true,
    project_billing_scope: 'outside_quote',
  });
  const [materialForm, setMaterialForm] = useState({
    name: '',
    description: '',
    quantity: '1',
    unit: 'st',
    purchase_price: '0',
    markup_percent: '0',
    sale_price: '0',
    supplier: '',
    invoice_separately: true,
    included_in_quote: false,
  });
  const [changeForm, setChangeForm] = useState({
    title: '',
    description: '',
    reason: '',
    requested_by: '',
    status: 'draft',
    billing_mode: 'separate',
    estimated_amount: '0',
    actual_amount: '0',
  });
  const [quoteForm, setQuoteForm] = useState({
    summary: '',
    terms: 'Offerten gäller enligt angivna villkor. Priser anges exklusive moms om inget annat anges.',
    payment_terms: 'Betalning 30 dagar netto.',
    valid_until: '',
    lines: [{ line_type: 'work', description: '', quantity: '1', unit: 'tim', unit_price: '650', vat_rate: '25' }],
  });
  const [documentForm, setDocumentForm] = useState({
    title: '',
    file_url: '',
    file_name: '',
    document_type: 'other',
    category: '',
    comment: '',
  });
  const [selfCheckTemplateForm, setSelfCheckTemplateForm] = useState({
    name: '',
    category: 'Allmän byggkontroll',
    description: '',
    checklist: [''],
    require_photo: false,
    require_comment: false,
    require_signature: true,
  });
  const [selfCheckForm, setSelfCheckForm] = useState({
    template_id: '',
    name: '',
    category: '',
    notes: '',
    signature_name: user?.name || '',
    items: [{ text: '', result: 'approved', comment: '', action_required: false }],
  });
  const [inspectionForm, setInspectionForm] = useState({
    inspection_type: 'internal',
    inspection_date: new Date().toISOString().slice(0, 10),
    inspector_id: user?.id || '',
    customer_present: false,
    result: 'requires_action',
    notes: '',
    signature_name: user?.name || '',
    remarks: [{ title: '', description: '', responsible_id: '', deadline: '', status: 'new' }],
  });
  const [deviationForm, setDeviationForm] = useState({
    title: '',
    description: '',
    severity: 'medium',
    proposed_action: '',
    responsible_id: '',
    image_url: '',
  });
  const [invoiceForm, setInvoiceForm] = useState({
    title: '',
    description: '',
    invoice_type: 'partial',
    include_time: true,
    include_materials: true,
    include_change_orders: true,
    fixed_price_amount: '0',
  });

  const selectedProject = projects.find(project => project.id === selectedProjectId) || projects[0] || null;

  useEffect(() => { fetchAll(); }, [user?.organisation_id]);

  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId]);

  const projectAssignments = useMemo(
    () => assignments.filter(assignment => assignment.project_id === selectedProject?.id),
    [assignments, selectedProject?.id]
  );
  const projectTimeEntries = useMemo(
    () => timeEntries.filter(entry => entry.customer_project_id === selectedProject?.id),
    [timeEntries, selectedProject?.id]
  );
  const projectMaterials = useMemo(
    () => materials.filter(entry => entry.project_id === selectedProject?.id),
    [materials, selectedProject?.id]
  );
  const projectChangeOrders = useMemo(
    () => changeOrders.filter(entry => entry.project_id === selectedProject?.id),
    [changeOrders, selectedProject?.id]
  );
  const projectQuotes = useMemo(
    () => quotes.filter(entry => entry.project_id === selectedProject?.id),
    [quotes, selectedProject?.id]
  );
  const projectSelfChecks = useMemo(
    () => selfChecks.filter(entry => entry.project_id === selectedProject?.id),
    [selfChecks, selectedProject?.id]
  );
  const projectInspections = useMemo(
    () => inspections.filter(entry => entry.project_id === selectedProject?.id),
    [inspections, selectedProject?.id]
  );
  const projectDeviations = useMemo(
    () => deviations.filter(entry => entry.project_id === selectedProject?.id),
    [deviations, selectedProject?.id]
  );
  const projectInvoiceBases = useMemo(
    () => invoiceBases.filter(entry => entry.project_id === selectedProject?.id),
    [invoiceBases, selectedProject?.id]
  );
  const projectActivity = useMemo(
    () => activity.filter(entry => entry.project_id === selectedProject?.id),
    [activity, selectedProject?.id]
  );

  const filteredProjects = projects.filter(project => {
    const customer = customers.find(c => c.id === project.customer_id);
    const q = searchQuery.toLowerCase();
    return (
      (project.title || project.name || '').toLowerCase().includes(q) ||
      (customer?.name || project.customer_name || '').toLowerCase().includes(q) ||
      (project.project_address || '').toLowerCase().includes(q) ||
      (project.internal_reference || '').toLowerCase().includes(q) ||
      (project.external_reference || '').toLowerCase().includes(q)
    );
  });

  async function fetchAll() {
    if (!user?.organisation_id) return;
    setLoading(true);
    try {
      const [projectRes, customerRes, staffRes] = await Promise.all([
        supabase.from('customer_projects').select('*').eq('organisation_id', user.organisation_id).order('updated_at', { ascending: false }),
        supabase.from('project_customers').select('*').eq('organisation_id', user.organisation_id).order('name'),
        supabase.from('profiles').select('*').eq('organisation_id', user.organisation_id).in('role', ['admin', 'staff']).eq('active', true).order('name'),
      ]);

      const projectData = (projectRes.data || []) as CustomerProject[];
      const projectIds = projectData.map(project => project.id);
      setProjects(projectData);
      setCustomers((customerRes.data || []) as ProjectCustomer[]);
      setStaff((staffRes.data || []) as Profile[]);

      if (projectIds.length === 0) {
        setAssignments([]);
        setTimeEntries([]);
        setMaterials([]);
        setChangeOrders([]);
        setQuotes([]);
        setSelfCheckTemplates([]);
        setSelfChecks([]);
        setInspections([]);
        setDeviations([]);
        setInvoiceBases([]);
        setActivity([]);
        return;
      }

      const [assignmentRes, timeRes, materialRes, changeRes, quoteRes, templateRes, selfCheckRes, inspectionRes, deviationRes, invoiceRes, activityRes] = await Promise.all([
        supabase.from('project_assignments').select('*').in('project_id', projectIds),
        supabase.from('time_entries').select('*').in('customer_project_id', projectIds).order('start_time', { ascending: false }),
        supabase.from('project_material_entries').select('*').in('project_id', projectIds).order('created_at', { ascending: false }),
        supabase.from('project_change_orders').select('*').in('project_id', projectIds).order('created_at', { ascending: false }),
        supabase.from('project_quote_versions').select('*, lines:project_quote_lines(*)').in('project_id', projectIds).order('created_at', { ascending: false }),
        supabase.from('project_self_check_templates').select('*').eq('organisation_id', user.organisation_id).eq('active', true).order('name'),
        supabase.from('project_self_checks').select('*').in('project_id', projectIds).order('created_at', { ascending: false }),
        supabase.from('project_inspections').select('*').in('project_id', projectIds).order('created_at', { ascending: false }),
        supabase.from('project_deviations').select('*').in('project_id', projectIds).order('created_at', { ascending: false }),
        supabase.from('project_invoice_basis').select('*, lines:project_invoice_basis_lines(*)').in('project_id', projectIds).order('created_at', { ascending: false }),
        supabase.from('project_activity_log').select('*').in('project_id', projectIds).order('created_at', { ascending: false }),
      ]);

      setAssignments((assignmentRes.data || []) as ProjectAssignment[]);
      setTimeEntries((timeRes.data || []) as TimeEntry[]);
      setMaterials((materialRes.data || []) as ProjectMaterialEntry[]);
      setChangeOrders((changeRes.data || []) as ProjectChangeOrder[]);
      setQuotes((quoteRes.data || []) as ProjectQuoteVersion[]);
      setSelfCheckTemplates((templateRes.data || []) as ProjectSelfCheckTemplate[]);
      setSelfChecks((selfCheckRes.data || []) as ProjectSelfCheck[]);
      setInspections((inspectionRes.data || []) as ProjectInspection[]);
      setDeviations((deviationRes.data || []) as ProjectDeviation[]);
      setInvoiceBases((invoiceRes.data || []) as ProjectInvoiceBasis[]);
      setActivity((activityRes.data || []) as ProjectActivityLog[]);
    } finally {
      setLoading(false);
    }
  }

  async function logActivity(projectId: string, eventType: string, description: string) {
    if (!user?.organisation_id) return;
    await supabase.from('project_activity_log').insert({
      project_id: projectId,
      organisation_id: user.organisation_id,
      user_id: user.id,
      event_type: eventType,
      description,
    });
  }

  async function refreshFinancials(projectId: string) {
    await supabase.rpc('refresh_customer_project_financials', { project_id: projectId });
  }

  function openNewProject() {
    setProjectForm(defaultProjectForm);
    setError('');
    setShowProjectModal(true);
  }

  function openNewCustomer() {
    setCustomerForm(defaultCustomerForm);
    setError('');
    setShowCustomerModal(true);
  }

  async function handleSaveCustomer() {
    if (!user?.organisation_id) return;
    setError('');
    setSaving(true);
    try {
      if (!customerForm.name.trim()) throw new Error('Ange kundnamn.');
      const { error: insertError } = await supabase.from('project_customers').insert({
        ...customerForm,
        organisation_id: user.organisation_id,
        created_by: user.id,
      });
      if (insertError) throw insertError;
      setShowCustomerModal(false);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Kunde inte spara kund.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveProject() {
    if (!user?.organisation_id) return;
    setError('');
    setSaving(true);
    try {
      if (!projectForm.title.trim()) throw new Error('Ange projektnamn.');
      if (!projectForm.customer_id) throw new Error('Välj kund.');
      const customer = customers.find(c => c.id === projectForm.customer_id);
      const { data, error: insertError } = await supabase.from('customer_projects').insert({
        organisation_id: user.organisation_id,
        customer_id: projectForm.customer_id,
        customer_name: customer?.name || '',
        name: projectForm.title,
        title: projectForm.title,
        description: projectForm.description,
        project_address: projectForm.project_address || customer?.project_address || '',
        project_type: projectForm.project_type,
        priority: projectForm.priority,
        billing_type: projectForm.billing_type,
        project_manager_id: projectForm.project_manager_id || null,
        start_date: projectForm.start_date || null,
        planned_end_date: projectForm.planned_end_date || null,
        budget_amount: Number(projectForm.budget_amount) || 0,
        hourly_rate: Number(projectForm.hourly_rate) || 0,
        internal_reference: projectForm.internal_reference,
        external_reference: projectForm.external_reference,
        status: 'draft',
        created_by: user.id,
      }).select('*').single();
      if (insertError) throw insertError;

      const selectedUsers = Array.from(new Set([
        projectForm.project_manager_id,
        ...projectForm.assigned_user_ids,
      ].filter(Boolean)));

      if (selectedUsers.length > 0) {
        await supabase.from('project_assignments').insert(selectedUsers.map(userId => ({
          project_id: data.id,
          user_id: userId,
          role: userId === projectForm.project_manager_id ? 'project_manager' : 'staff',
        })));
      }

      await logActivity(data.id, 'project_created', `Projektet "${projectForm.title}" skapades.`);
      setShowProjectModal(false);
      setSelectedProjectId(data.id);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Kunde inte skapa projekt.');
    } finally {
      setSaving(false);
    }
  }

  async function updateProjectStatus(status: CustomerProjectStatus) {
    if (!selectedProject) return;
    await supabase.from('customer_projects').update({ status }).eq('id', selectedProject.id);
    await logActivity(selectedProject.id, 'status_changed', `Status ändrades till ${STATUS_LABELS[status]}.`);
    await fetchAll();
  }

  async function handleSaveTime() {
    if (!selectedProject || !user?.organisation_id) return;
    setSaving(true);
    setError('');
    try {
      const start = new Date(`${timeForm.work_date}T${timeForm.start_time}`);
      const end = new Date(`${timeForm.work_date}T${timeForm.end_time}`);
      const totalMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000) - (Number(timeForm.break_minutes) || 0));
      if (totalMinutes <= 0) throw new Error('Kontrollera start- och sluttid.');
      const { error: insertError } = await supabase.from('time_entries').insert({
        organisation_id: user.organisation_id,
        user_id: timeForm.user_id || user.id,
        customer_project_id: selectedProject.id,
        category: 'customer_project',
        entry_type: 'work',
        customer_name: customers.find(c => c.id === selectedProject.customer_id)?.name || selectedProject.customer_name,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        break_minutes: Number(timeForm.break_minutes) || 0,
        total_minutes: totalMinutes,
        comment: `${timeForm.work_type ? `${timeForm.work_type}: ` : ''}${timeForm.comment}`,
        status: isAdmin ? 'approved' : 'submitted',
        approved_by: isAdmin ? user.id : null,
        approved_at: isAdmin ? new Date().toISOString() : null,
        project_billable: timeForm.project_billable,
        project_billing_scope: timeForm.project_billing_scope,
      });
      if (insertError) throw insertError;
      await refreshFinancials(selectedProject.id);
      await logActivity(selectedProject.id, 'time_reported', `${hours(totalMinutes)} tid rapporterades.`);
      setShowTimeModal(false);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Kunde inte spara tidrapport.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveMaterial() {
    if (!selectedProject) return;
    setSaving(true);
    setError('');
    try {
      if (!materialForm.name.trim()) throw new Error('Ange material.');
      const purchasePrice = Number(materialForm.purchase_price) || 0;
      const markup = Number(materialForm.markup_percent) || 0;
      const salePrice = Number(materialForm.sale_price) || purchasePrice * (1 + markup / 100);
      const { error: insertError } = await supabase.from('project_material_entries').insert({
        project_id: selectedProject.id,
        registered_by: user?.id,
        name: materialForm.name,
        description: materialForm.description,
        quantity: Number(materialForm.quantity) || 1,
        unit: materialForm.unit,
        purchase_price: purchasePrice,
        markup_percent: markup,
        sale_price: salePrice,
        supplier: materialForm.supplier,
        included_in_quote: materialForm.included_in_quote,
        invoice_separately: materialForm.invoice_separately,
      });
      if (insertError) throw insertError;
      await refreshFinancials(selectedProject.id);
      await logActivity(selectedProject.id, 'material_added', `Material lades till: ${materialForm.name}.`);
      setShowMaterialModal(false);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Kunde inte spara material.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveChangeOrder() {
    if (!selectedProject) return;
    setSaving(true);
    setError('');
    try {
      if (!changeForm.title.trim()) throw new Error('Ange rubrik.');
      const number = `ÄTA-${String(projectChangeOrders.length + 1).padStart(3, '0')}`;
      const { error: insertError } = await supabase.from('project_change_orders').insert({
        project_id: selectedProject.id,
        change_order_number: number,
        title: changeForm.title,
        description: changeForm.description,
        reason: changeForm.reason,
        requested_by: changeForm.requested_by,
        status: changeForm.status,
        billing_mode: changeForm.billing_mode,
        estimated_amount: Number(changeForm.estimated_amount) || 0,
        actual_amount: Number(changeForm.actual_amount) || 0,
        customer_approved_at: changeForm.status === 'approved_by_customer' ? new Date().toISOString() : null,
        created_by: user?.id,
      });
      if (insertError) throw insertError;
      await refreshFinancials(selectedProject.id);
      await logActivity(selectedProject.id, 'change_order_created', `ÄTA skapades: ${changeForm.title}.`);
      setShowChangeModal(false);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Kunde inte spara ÄTA.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveQuote() {
    if (!selectedProject) return;
    setSaving(true);
    setError('');
    try {
      const lines = quoteForm.lines.filter(line => line.description.trim());
      if (lines.length === 0) throw new Error('Lägg till minst en offertrad.');
      const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unit_price) || 0), 0);
      const vat = lines.reduce((sum, line) => sum + ((Number(line.quantity) || 0) * (Number(line.unit_price) || 0) * ((Number(line.vat_rate) || 0) / 100)), 0);
      const version = projectQuotes.length + 1;
      const { data, error: quoteError } = await supabase.from('project_quote_versions').insert({
        project_id: selectedProject.id,
        version_number: version,
        quote_number: `OFF-${new Date().getFullYear()}-${String(version).padStart(3, '0')}`,
        status: 'draft',
        valid_until: quoteForm.valid_until || null,
        summary: quoteForm.summary,
        terms: quoteForm.terms,
        payment_terms: quoteForm.payment_terms,
        total_amount: total,
        vat_amount: vat,
        created_by: user?.id,
      }).select('*').single();
      if (quoteError) throw quoteError;
      await supabase.from('project_quote_lines').insert(lines.map((line, index) => ({
        quote_version_id: data.id,
        line_type: line.line_type,
        description: line.description,
        quantity: Number(line.quantity) || 0,
        unit: line.unit,
        unit_price: Number(line.unit_price) || 0,
        vat_rate: Number(line.vat_rate) || 0,
        sort_order: index,
      })));
      await supabase.from('customer_projects').update({ quoted_amount: total, status: 'quote_created' }).eq('id', selectedProject.id);
      await logActivity(selectedProject.id, 'quote_created', `Offert ${data.quote_number} skapades (${money(total)}).`);
      setShowQuoteModal(false);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Kunde inte spara offert.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDocument() {
    if (!selectedProject) return;
    setSaving(true);
    setError('');
    try {
      if (!documentForm.title.trim() || !documentForm.file_url.trim()) throw new Error('Ange titel och länk.');
      const { error: insertError } = await supabase.from('project_documents').insert({
        project_id: selectedProject.id,
        uploaded_by: user?.id,
        ...documentForm,
      });
      if (insertError) throw insertError;
      await logActivity(selectedProject.id, 'document_added', `Dokument lades till: ${documentForm.title}.`);
      setShowDocumentModal(false);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Kunde inte spara dokument.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSelfCheckTemplate() {
    if (!user?.organisation_id) return;
    setSaving(true);
    setError('');
    try {
      if (!selfCheckTemplateForm.name.trim()) throw new Error('Ange namn på mallen.');
      const checklist = selfCheckTemplateForm.checklist
        .map(text => text.trim())
        .filter(Boolean)
        .map((text, index) => ({ id: `punkt-${index + 1}`, text }));
      if (checklist.length === 0) throw new Error('Lägg till minst en kontrollpunkt.');
      const { error: insertError } = await supabase.from('project_self_check_templates').insert({
        organisation_id: user.organisation_id,
        name: selfCheckTemplateForm.name,
        category: selfCheckTemplateForm.category,
        description: selfCheckTemplateForm.description,
        checklist,
        require_photo: selfCheckTemplateForm.require_photo,
        require_comment: selfCheckTemplateForm.require_comment,
        require_signature: selfCheckTemplateForm.require_signature,
        created_by: user.id,
      });
      if (insertError) throw insertError;
      setShowSelfCheckTemplateModal(false);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Kunde inte spara egenkontrollmall.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSelfCheck() {
    if (!selectedProject) return;
    setSaving(true);
    setError('');
    try {
      const template = selfCheckTemplates.find(item => item.id === selfCheckForm.template_id);
      const name = selfCheckForm.name || template?.name || 'Egenkontroll';
      const category = selfCheckForm.category || template?.category || '';
      const items = selfCheckForm.items
        .filter(item => item.text.trim())
        .map(item => ({
          text: item.text,
          result: item.result,
          comment: item.comment,
          action_required: item.action_required,
        }));
      if (items.length === 0) throw new Error('Lägg till minst en kontrollpunkt.');
      const requiresAction = items.some(item => item.result === 'not_approved' || item.action_required);
      const status = selfCheckForm.signature_name ? (requiresAction ? 'requires_action' : 'signed') : (requiresAction ? 'requires_action' : 'completed');
      const { error: insertError } = await supabase.from('project_self_checks').insert({
        project_id: selectedProject.id,
        template_id: template?.id || null,
        name,
        category,
        status,
        performed_by: user?.id,
        performed_at: new Date().toISOString(),
        items,
        notes: selfCheckForm.notes,
        signature_name: selfCheckForm.signature_name,
        signed_at: selfCheckForm.signature_name ? new Date().toISOString() : null,
        created_by: user?.id,
      });
      if (insertError) throw insertError;
      await logActivity(selectedProject.id, 'self_check_completed', `Egenkontroll sparades: ${name}.`);
      setShowSelfCheckModal(false);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Kunde inte spara egenkontroll.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveInspection() {
    if (!selectedProject) return;
    setSaving(true);
    setError('');
    try {
      const remarks = inspectionForm.remarks
        .filter(item => item.title.trim() || item.description.trim())
        .map(item => ({
          title: item.title,
          description: item.description,
          responsible_id: item.responsible_id || null,
          deadline: item.deadline || null,
          status: item.status,
        }));
      const { error: insertError } = await supabase.from('project_inspections').insert({
        project_id: selectedProject.id,
        inspection_type: inspectionForm.inspection_type,
        inspection_date: inspectionForm.inspection_date,
        inspector_id: inspectionForm.inspector_id || user?.id,
        customer_present: inspectionForm.customer_present,
        project_status: selectedProject.status,
        result: inspectionForm.result,
        remarks,
        notes: inspectionForm.notes,
        signature_name: inspectionForm.signature_name,
        signed_at: inspectionForm.signature_name ? new Date().toISOString() : null,
        created_by: user?.id,
      });
      if (insertError) throw insertError;
      if (inspectionForm.result === 'approved_without_remarks') {
        await supabase.from('customer_projects').update({ status: 'approved' }).eq('id', selectedProject.id);
      } else if (remarks.length > 0) {
        await supabase.from('customer_projects').update({ status: 'inspected_with_remarks' }).eq('id', selectedProject.id);
      }
      await logActivity(selectedProject.id, 'inspection_created', 'Projektbesiktning sparades.');
      setShowInspectionModal(false);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Kunde inte spara besiktning.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDeviation() {
    if (!selectedProject) return;
    setSaving(true);
    setError('');
    try {
      if (!deviationForm.title.trim()) throw new Error('Ange rubrik.');
      const { error: insertError } = await supabase.from('project_deviations').insert({
        project_id: selectedProject.id,
        title: deviationForm.title,
        description: deviationForm.description,
        reported_by: user?.id,
        severity: deviationForm.severity,
        image_url: deviationForm.image_url,
        proposed_action: deviationForm.proposed_action,
        responsible_id: deviationForm.responsible_id || null,
        status: deviationForm.responsible_id ? 'assigned' : 'new',
      });
      if (insertError) throw insertError;
      await logActivity(selectedProject.id, 'deviation_reported', `Avvikelse rapporterad: ${deviationForm.title}.`);
      setShowDeviationModal(false);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Kunde inte spara avvikelse.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveInvoiceBasis() {
    if (!selectedProject) return;
    setSaving(true);
    setError('');
    try {
      const lines: Array<{ source_type: string; source_id: string | null; description: string; quantity: number; unit: string; unit_price: number; vat_rate: number; billing_status: string }> = [];
      if (invoiceForm.include_time && billableMinutes > 0) {
        lines.push({
          source_type: 'time',
          source_id: null,
          description: 'Fakturerbar tid',
          quantity: Number((billableMinutes / 60).toFixed(2)),
          unit: 'tim',
          unit_price: Number(selectedProject.hourly_rate || 0),
          vat_rate: 25,
          billing_status: 'ready',
        });
      }
      if (invoiceForm.include_materials) {
        projectMaterials.filter(item => item.invoice_separately && item.status !== 'invoiced').forEach(item => {
          lines.push({
            source_type: 'material',
            source_id: item.id,
            description: item.name,
            quantity: Number(item.quantity || 0),
            unit: item.unit,
            unit_price: Number(item.sale_price || 0),
            vat_rate: Number(item.vat_rate || 25),
            billing_status: 'ready',
          });
        });
      }
      if (invoiceForm.include_change_orders) {
        projectChangeOrders.filter(item => ['approved_by_customer', 'completed'].includes(item.status)).forEach(item => {
          lines.push({
            source_type: 'change_order',
            source_id: item.id,
            description: `${item.change_order_number} ${item.title}`.trim(),
            quantity: 1,
            unit: 'st',
            unit_price: item.billing_mode === 'deduction' ? -Number(item.actual_amount || item.estimated_amount || 0) : Number(item.actual_amount || item.estimated_amount || 0),
            vat_rate: 25,
            billing_status: 'ready',
          });
        });
      }
      const fixedPrice = Number(invoiceForm.fixed_price_amount) || 0;
      if (fixedPrice > 0) {
        lines.push({
          source_type: 'fixed_price',
          source_id: null,
          description: 'Fastprisdel',
          quantity: 1,
          unit: 'st',
          unit_price: fixedPrice,
          vat_rate: 25,
          billing_status: 'ready',
        });
      }
      if (lines.length === 0) throw new Error('Det finns inga rader att fakturera.');
      const total = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
      const vat = lines.reduce((sum, line) => sum + line.quantity * line.unit_price * (line.vat_rate / 100), 0);
      const basisNumber = `FU-${new Date().getFullYear()}-${String(projectInvoiceBases.length + 1).padStart(3, '0')}`;
      const { data, error: basisError } = await supabase.from('project_invoice_basis').insert({
        project_id: selectedProject.id,
        basis_number: basisNumber,
        invoice_type: invoiceForm.invoice_type,
        status: 'ready_for_invoicing',
        title: invoiceForm.title || basisNumber,
        description: invoiceForm.description,
        total_amount: total,
        vat_amount: vat,
        created_by: user?.id,
      }).select('*').single();
      if (basisError) throw basisError;
      await supabase.from('project_invoice_basis_lines').insert(lines.map(line => ({ ...line, basis_id: data.id })));
      await logActivity(selectedProject.id, 'invoice_basis_created', `Faktureringsunderlag ${basisNumber} skapades (${money(total)}).`);
      setShowInvoiceModal(false);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Kunde inte skapa faktureringsunderlag.');
    } finally {
      setSaving(false);
    }
  }

  const totalMinutes = projectTimeEntries.reduce((sum, entry) => sum + (entry.total_minutes || 0), 0);
  const billableMinutes = projectTimeEntries.filter(entry => entry.project_billable !== false).reduce((sum, entry) => sum + (entry.total_minutes || 0), 0);
  const materialCost = projectMaterials.reduce((sum, item) => sum + Number(item.purchase_price || 0) * Number(item.quantity || 0), 0);
  const materialSale = projectMaterials.reduce((sum, item) => sum + Number(item.sale_price || 0) * Number(item.quantity || 0), 0);
  const changeOrderAmount = projectChangeOrders
    .filter(item => ['approved_by_customer', 'completed', 'invoiced'].includes(item.status))
    .reduce((sum, item) => sum + (item.billing_mode === 'deduction' ? -Number(item.actual_amount || 0) : Number(item.actual_amount || 0)), 0);
  const timeValue = (billableMinutes / 60) * Number(selectedProject?.hourly_rate || 0);
  const invoiceable = timeValue + materialSale + changeOrderAmount;
  const budgetDeviation = selectedProject ? invoiceable - Number(selectedProject.budget_amount || 0) : 0;

  if (loading) return <LoadingPage />;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Kundprojekt"
        subtitle="Hantera kundjobb, offerter, tid, material och ÄTA"
        action={isAdmin && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="secondary" onClick={openNewCustomer} className="gap-2">
              <Users className="w-4 h-4" /> Ny kund
            </Button>
            <Button variant="primary" onClick={openNewProject} className="gap-2">
              <Plus className="w-4 h-4" /> Nytt projekt
            </Button>
          </div>
        )}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <SearchInput placeholder="Sök projekt, kund, adress..." value={searchQuery} onChange={setSearchQuery} />
          {filteredProjects.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Briefcase className="w-12 h-12" />}
                title="Inga kundprojekt"
                description={isAdmin ? 'Skapa första projektet för att komma igång.' : 'Du har inga tilldelade kundprojekt.'}
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredProjects.map(project => {
                const customer = customers.find(c => c.id === project.customer_id);
                const projectStaff = assignments.filter(a => a.project_id === project.id);
                return (
                  <Card
                    key={project.id}
                    onClick={() => { setSelectedProjectId(project.id); setTab('overview'); }}
                    className={`p-4 ${selectedProject?.id === project.id ? 'border-blue-300 ring-2 ring-blue-100' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words text-sm font-bold text-slate-900">{project.title || project.name}</h3>
                        <p className="mt-1 break-words text-sm text-slate-600">{customer?.name || project.customer_name || 'Ingen kund'}</p>
                      </div>
                      <Badge className={STATUS_CLASS[project.status] || 'bg-slate-100 text-slate-600'}>
                        {STATUS_LABELS[project.status] || project.status}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                      {project.project_address && <span>{project.project_address}</span>}
                      {project.planned_end_date && <span>Klart {formatDate(project.planned_end_date)}</span>}
                      <span>{projectStaff.length} tilldelade</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {selectedProject ? (
          <div className="space-y-5">
            <Card className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="break-words text-xl font-bold text-slate-900">{selectedProject.title || selectedProject.name}</h2>
                    <Badge className={STATUS_CLASS[selectedProject.status] || 'bg-slate-100 text-slate-600'}>
                      {STATUS_LABELS[selectedProject.status] || selectedProject.status}
                    </Badge>
                    <Badge className="bg-slate-100 text-slate-600">{selectedProject.project_type}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{selectedProject.description || 'Ingen beskrivning ännu.'}</p>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500">
                    <span className="inline-flex items-center gap-1"><Users className="w-4 h-4" /> {customers.find(c => c.id === selectedProject.customer_id)?.name || selectedProject.customer_name}</span>
                    {selectedProject.project_address && <span>{selectedProject.project_address}</span>}
                    {selectedProject.planned_end_date && <span className="inline-flex items-center gap-1"><CalendarDays className="w-4 h-4" /> {formatDate(selectedProject.planned_end_date)}</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
                  <Select
                    value={selectedProject.status}
                    onChange={e => updateProjectStatus(e.target.value as CustomerProjectStatus)}
                    options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
                    className="min-w-[190px]"
                  />
                  <Button variant="secondary" onClick={() => setShowTimeModal(true)} className="gap-2">
                    <Timer className="w-4 h-4" /> Rapportera tid
                  </Button>
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="Totala timmar" value={hours(totalMinutes)} icon={<Timer className="w-5 h-5" />} />
              <Stat label="Fakturerbar tid" value={money(timeValue)} icon={<Coins className="w-5 h-5" />} />
              <Stat label="Materialvärde" value={money(materialSale)} icon={<Package className="w-5 h-5" />} />
              <Stat label="ÄTA-belopp" value={money(changeOrderAmount)} icon={<Receipt className="w-5 h-5" />} />
              <Stat label="Fakturerbart" value={money(invoiceable)} icon={<FileText className="w-5 h-5" />} />
            </div>

            {selectedProject.budget_amount > 0 && budgetDeviation > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                Projektet ligger {money(budgetDeviation)} över budget baserat på registrerat fakturerbart värde.
              </div>
            )}

            <Card>
              <div className="flex gap-1 overflow-x-auto border-b border-slate-200 p-2">
                {[
                  ['overview', 'Översikt', ClipboardList],
                  ['time', 'Tid', Timer],
                  ['materials', 'Material', Package],
                  ['change-orders', 'ÄTA', Receipt],
                  ['quotes', 'Offert', FileText],
                  ['self-checks', 'Egenkontroll', CheckCircle],
                  ['inspections', 'Besiktning', ClipboardList],
                  ['deviations', 'Avvikelser', AlertTriangle],
                  ['invoice', 'Fakturering', Coins],
                  ['documents', 'Dokument', FolderOpen],
                  ['activity', 'Aktivitet', History],
                ].map(([key, label, Icon]) => (
                  <button
                    key={key as string}
                    onClick={() => setTab(key as typeof tab)}
                    className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      tab === key ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-4 h-4" /> {label as string}
                  </button>
                ))}
              </div>
              <div className="p-5">
                {tab === 'overview' && (
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                    <InfoPanel title="Projektdata" rows={[
                      ['Debitering', selectedProject.billing_type === 'fixed_price' ? 'Fast pris' : selectedProject.billing_type === 'mixed' ? 'Blandat' : 'Löpande'],
                      ['Timpris', money(selectedProject.hourly_rate)],
                      ['Budget', money(selectedProject.budget_amount)],
                      ['Offertbelopp', money(selectedProject.quoted_amount)],
                      ['Intern referens', selectedProject.internal_reference || '—'],
                      ['Extern referens', selectedProject.external_reference || '—'],
                    ]} />
                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-slate-800">Tilldelad personal</h3>
                      <div className="flex flex-wrap gap-2">
                        {projectAssignments.length === 0 ? (
                          <span className="text-sm text-slate-400">Ingen tilldelad personal.</span>
                        ) : projectAssignments.map(assignment => (
                          <Badge key={assignment.id} className="bg-blue-50 text-blue-700">
                            {staff.find(s => s.id === assignment.user_id)?.name || 'Användare'} · {assignment.role === 'project_manager' ? 'Projektledare' : 'Personal'}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {tab === 'time' && (
                  <SectionList
                    title="Tidrapporter"
                    action={<Button size="sm" onClick={() => setShowTimeModal(true)}><Plus className="w-4 h-4" /> Lägg till tid</Button>}
                    empty="Ingen tid rapporterad."
                  >
                    {projectTimeEntries.map(entry => (
                      <ListRow key={entry.id} title={staff.find(s => s.id === entry.user_id)?.name || 'Användare'} meta={`${formatDate(entry.start_time)} · ${hours(entry.total_minutes || 0)} · ${entry.project_billable === false ? 'Ej fakturerbar' : 'Fakturerbar'}`} value={entry.comment || ''} />
                    ))}
                  </SectionList>
                )}

                {tab === 'materials' && (
                  <SectionList
                    title="Material"
                    action={<Button size="sm" onClick={() => setShowMaterialModal(true)}><Plus className="w-4 h-4" /> Lägg till material</Button>}
                    empty="Inget material registrerat."
                  >
                    {projectMaterials.map(item => (
                      <ListRow key={item.id} title={item.name} meta={`${item.quantity} ${item.unit} · ${item.supplier || 'Ingen leverantör'} · ${item.status}`} value={money(Number(item.sale_price || 0) * Number(item.quantity || 0))} />
                    ))}
                  </SectionList>
                )}

                {tab === 'change-orders' && (
                  <SectionList
                    title="ÄTA"
                    action={<Button size="sm" onClick={() => setShowChangeModal(true)}><Plus className="w-4 h-4" /> Ny ÄTA</Button>}
                    empty="Ingen ÄTA skapad."
                  >
                    {projectChangeOrders.map(item => (
                      <ListRow key={item.id} title={`${item.change_order_number} · ${item.title}`} meta={`${item.status} · ${item.billing_mode}`} value={money(item.actual_amount || item.estimated_amount)} />
                    ))}
                  </SectionList>
                )}

                {tab === 'quotes' && (
                  <SectionList
                    title="Offerter"
                    action={<Button size="sm" onClick={() => setShowQuoteModal(true)}><Plus className="w-4 h-4" /> Ny offert</Button>}
                    empty="Ingen offert skapad."
                  >
                    {projectQuotes.map(item => (
                      <ListRow key={item.id} title={`${item.quote_number} · version ${item.version_number}`} meta={`${item.status} · giltig till ${item.valid_until ? formatDate(item.valid_until) : '—'}`} value={`${money(item.total_amount)} + moms ${money(item.vat_amount)}`} />
                    ))}
                  </SectionList>
                )}

                {tab === 'self-checks' && (
                  <SectionList
                    title="Egenkontroller"
                    action={
                      <div className="flex flex-col gap-2 sm:flex-row">
                        {isAdmin && <Button size="sm" variant="secondary" onClick={() => setShowSelfCheckTemplateModal(true)}><Plus className="w-4 h-4" /> Mall</Button>}
                        <Button size="sm" onClick={() => setShowSelfCheckModal(true)}><Plus className="w-4 h-4" /> Ny kontroll</Button>
                      </div>
                    }
                    empty="Ingen egenkontroll utförd."
                  >
                    {projectSelfChecks.map(item => (
                      <ListRow key={item.id} title={item.name} meta={`${item.category || 'Egenkontroll'} · ${item.status} · ${item.performed_at ? formatDate(item.performed_at) : 'Ej daterad'}`} value={`${item.items.filter(i => i.result === 'approved').length}/${item.items.length} godkända`} />
                    ))}
                  </SectionList>
                )}

                {tab === 'inspections' && (
                  <SectionList
                    title="Besiktningar"
                    action={<Button size="sm" onClick={() => setShowInspectionModal(true)}><Plus className="w-4 h-4" /> Ny besiktning</Button>}
                    empty="Ingen projektbesiktning skapad."
                  >
                    {projectInspections.map(item => (
                      <ListRow key={item.id} title={item.inspection_type === 'final' ? 'Slutbesiktning' : item.inspection_type === 'customer' ? 'Kundbesiktning' : 'Intern besiktning'} meta={`${formatDate(item.inspection_date)} · ${item.result} · ${item.remarks.length} anmärkningar`} value={item.signed_at ? 'Signerad' : ''} />
                    ))}
                  </SectionList>
                )}

                {tab === 'deviations' && (
                  <SectionList
                    title="Avvikelser"
                    action={<Button size="sm" onClick={() => setShowDeviationModal(true)}><Plus className="w-4 h-4" /> Ny avvikelse</Button>}
                    empty="Ingen avvikelse rapporterad."
                  >
                    {projectDeviations.map(item => (
                      <ListRow key={item.id} title={item.title} meta={`${formatDate(item.deviation_date)} · ${item.severity} · ${item.status}`} value={staff.find(s => s.id === item.responsible_id)?.name || ''} />
                    ))}
                  </SectionList>
                )}

                {tab === 'invoice' && (
                  <SectionList
                    title="Faktureringsunderlag"
                    action={isAdmin && <Button size="sm" onClick={() => setShowInvoiceModal(true)}><Plus className="w-4 h-4" /> Skapa underlag</Button>}
                    empty="Inget faktureringsunderlag skapat."
                  >
                    {projectInvoiceBases.map(item => (
                      <ListRow key={item.id} title={`${item.basis_number} · ${item.title}`} meta={`${item.invoice_type} · ${item.status} · ${item.lines?.length || 0} rader`} value={`${money(item.total_amount)} + moms ${money(item.vat_amount)}`} />
                    ))}
                  </SectionList>
                )}

                {tab === 'documents' && (
                  <div>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-800">Dokument och bildlänkar</h3>
                      <Button size="sm" onClick={() => setShowDocumentModal(true)}><Image className="w-4 h-4" /> Lägg till länk</Button>
                    </div>
                    <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      Första versionen stödjer dokumentlänkar. Filuppladdning till projektets dokumentflik kan byggas ovanpå samma tabell när lagringsbucket och kategorier är klara.
                    </p>
                  </div>
                )}

                {tab === 'activity' && (
                  <SectionList title="Aktivitetslogg" empty="Ingen aktivitet loggad ännu.">
                    {projectActivity.map(item => (
                      <ListRow key={item.id} title={item.description} meta={`${formatDate(item.created_at)} · ${item.event_type}`} value="" />
                    ))}
                  </SectionList>
                )}
              </div>
            </Card>
          </div>
        ) : (
          <Card>
            <EmptyState icon={<Briefcase className="w-12 h-12" />} title="Välj ett projekt" />
          </Card>
        )}
      </div>

      <CustomerModal open={showCustomerModal} onClose={() => setShowCustomerModal(false)} form={customerForm} setForm={setCustomerForm} onSave={handleSaveCustomer} saving={saving} error={error} />
      <ProjectModal open={showProjectModal} onClose={() => setShowProjectModal(false)} form={projectForm} setForm={setProjectForm} customers={customers} staff={staff} onSave={handleSaveProject} saving={saving} error={error} />
      <TimeModal open={showTimeModal} onClose={() => setShowTimeModal(false)} form={timeForm} setForm={setTimeForm} staff={staff} isAdmin={isAdmin} onSave={handleSaveTime} saving={saving} error={error} />
      <MaterialModal open={showMaterialModal} onClose={() => setShowMaterialModal(false)} form={materialForm} setForm={setMaterialForm} onSave={handleSaveMaterial} saving={saving} error={error} />
      <ChangeOrderModal open={showChangeModal} onClose={() => setShowChangeModal(false)} form={changeForm} setForm={setChangeForm} onSave={handleSaveChangeOrder} saving={saving} error={error} />
      <QuoteModal open={showQuoteModal} onClose={() => setShowQuoteModal(false)} form={quoteForm} setForm={setQuoteForm} onSave={handleSaveQuote} saving={saving} error={error} />
      <DocumentModal open={showDocumentModal} onClose={() => setShowDocumentModal(false)} form={documentForm} setForm={setDocumentForm} onSave={handleSaveDocument} saving={saving} error={error} />
      <SelfCheckTemplateModal open={showSelfCheckTemplateModal} onClose={() => setShowSelfCheckTemplateModal(false)} form={selfCheckTemplateForm} setForm={setSelfCheckTemplateForm} onSave={handleSaveSelfCheckTemplate} saving={saving} error={error} />
      <SelfCheckModal open={showSelfCheckModal} onClose={() => setShowSelfCheckModal(false)} form={selfCheckForm} setForm={setSelfCheckForm} templates={selfCheckTemplates} onSave={handleSaveSelfCheck} saving={saving} error={error} />
      <InspectionModal open={showInspectionModal} onClose={() => setShowInspectionModal(false)} form={inspectionForm} setForm={setInspectionForm} staff={staff} onSave={handleSaveInspection} saving={saving} error={error} />
      <DeviationModal open={showDeviationModal} onClose={() => setShowDeviationModal(false)} form={deviationForm} setForm={setDeviationForm} staff={staff} onSave={handleSaveDeviation} saving={saving} error={error} />
      <InvoiceBasisModal open={showInvoiceModal} onClose={() => setShowInvoiceModal(false)} form={invoiceForm} setForm={setInvoiceForm} onSave={handleSaveInvoiceBasis} saving={saving} error={error} totals={{ timeValue, materialSale, changeOrderAmount }} />
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-2 text-blue-600">{icon}</div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-lg font-bold text-slate-900">{value}</p>
    </Card>
  );
}

function InfoPanel({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-slate-800">{title}</h3>
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-500">{label}</span>
            <span className="break-words text-right font-medium text-slate-800">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionList({ title, action, empty, children }: { title: string; action?: React.ReactNode; empty: string; children?: React.ReactNode }) {
  const hasChildren = React.Children.count(children) > 0;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {action}
      </div>
      {hasChildren ? <div className="space-y-2">{children}</div> : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">{empty}</p>}
    </div>
  );
}

function ListRow({ title, meta, value }: { title: string; meta: string; value: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="break-words text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-1 break-words text-xs text-slate-500">{meta}</p>
      </div>
      {value && <p className="break-words text-sm font-semibold text-slate-700">{value}</p>}
    </div>
  );
}

function CustomerModal({ open, onClose, form, setForm, onSave, saving, error }: any) {
  return (
    <Modal open={open} onClose={onClose} title="Ny kund" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Kundtyp" value={form.customer_type} onChange={(e) => setForm({ ...form, customer_type: e.target.value })} options={[
            { value: 'private', label: 'Privatperson' },
            { value: 'company', label: 'Företag' },
            { value: 'brf', label: 'Bostadsrättsförening' },
            { value: 'property_owner', label: 'Fastighetsägare' },
            { value: 'internal', label: 'Intern kund' },
          ]} />
          <Input label="Namn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Org/personnummer" value={form.identity_number} onChange={(e) => setForm({ ...form, identity_number: e.target.value })} />
          <Input label="Kontaktperson" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
          <Input label="Telefon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="E-post" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <Textarea label="Fakturaadress" value={form.invoice_address} onChange={(e) => setForm({ ...form, invoice_address: e.target.value })} rows={2} />
        <Input label="Projektadress" value={form.project_address} onChange={(e) => setForm({ ...form, project_address: e.target.value })} />
        <Input label="Märkning/referens" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
        <Textarea label="Anteckningar" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
        {error && <ErrorBox message={error} />}
        <ModalActions onClose={onClose} onSave={onSave} saving={saving} saveLabel="Skapa kund" />
      </div>
    </Modal>
  );
}

function ProjectModal({ open, onClose, form, setForm, customers, staff, onSave, saving, error }: any) {
  function toggleUser(userId: string) {
    const next = form.assigned_user_ids.includes(userId)
      ? form.assigned_user_ids.filter((id: string) => id !== userId)
      : [...form.assigned_user_ids, userId];
    setForm({ ...form, assigned_user_ids: next });
  }

  return (
    <Modal open={open} onClose={onClose} title="Nytt kundprojekt" size="xl">
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Projektnamn" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Select label="Kund" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} options={[{ value: '', label: 'Välj kund' }, ...customers.map((c: ProjectCustomer) => ({ value: c.id, label: c.name }))]} />
          <Input label="Projektadress" value={form.project_address} onChange={(e) => setForm({ ...form, project_address: e.target.value })} />
          <Select label="Projektkategori" value={form.project_type} onChange={(e) => setForm({ ...form, project_type: e.target.value })} options={PROJECT_TYPES.map(type => ({ value: type, label: type }))} />
          <Select label="Prioritet" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} options={[
            { value: 'low', label: 'Låg' },
            { value: 'normal', label: 'Normal' },
            { value: 'high', label: 'Hög' },
            { value: 'urgent', label: 'Akut' },
          ]} />
          <Select label="Debitering" value={form.billing_type} onChange={(e) => setForm({ ...form, billing_type: e.target.value })} options={[
            { value: 'hourly', label: 'Löpande' },
            { value: 'fixed_price', label: 'Fast pris' },
            { value: 'mixed', label: 'Blandat' },
          ]} />
          <Select label="Projektledare" value={form.project_manager_id} onChange={(e) => setForm({ ...form, project_manager_id: e.target.value })} options={[{ value: '', label: 'Välj projektledare' }, ...staff.map((p: Profile) => ({ value: p.id, label: p.name }))]} />
          <Input label="Timpris" type="number" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} />
          <Input label="Startdatum" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          <Input label="Planerat slutdatum" type="date" value={form.planned_end_date} onChange={(e) => setForm({ ...form, planned_end_date: e.target.value })} />
          <Input label="Budget" type="number" value={form.budget_amount} onChange={(e) => setForm({ ...form, budget_amount: e.target.value })} />
          <Input label="Intern referens" value={form.internal_reference} onChange={(e) => setForm({ ...form, internal_reference: e.target.value })} />
          <Input label="Extern referens" value={form.external_reference} onChange={(e) => setForm({ ...form, external_reference: e.target.value })} />
        </div>
        <Textarea label="Beskrivning" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Tilldelad personal</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {staff.map((person: Profile) => (
              <label key={person.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <input type="checkbox" checked={form.assigned_user_ids.includes(person.id)} onChange={() => toggleUser(person.id)} />
                {person.name}
              </label>
            ))}
          </div>
        </div>
        {error && <ErrorBox message={error} />}
        <ModalActions onClose={onClose} onSave={onSave} saving={saving} saveLabel="Skapa projekt" />
      </div>
    </Modal>
  );
}

function TimeModal({ open, onClose, form, setForm, staff, isAdmin, onSave, saving, error }: any) {
  return (
    <Modal open={open} onClose={onClose} title="Rapportera projekttid" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {isAdmin && <Select label="Användare" value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} options={staff.map((p: Profile) => ({ value: p.id, label: p.name }))} />}
          <Input label="Datum" type="date" value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })} />
          <Input label="Start" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          <Input label="Slut" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
          <Input label="Rast minuter" type="number" value={form.break_minutes} onChange={(e) => setForm({ ...form, break_minutes: e.target.value })} />
          <Input label="Typ av arbete" value={form.work_type} onChange={(e) => setForm({ ...form, work_type: e.target.value })} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.project_billable} onChange={(e) => setForm({ ...form, project_billable: e.target.checked })} /> Fakturerbar tid</label>
          <Select label="Debiteringsläge" value={form.project_billing_scope} onChange={(e) => setForm({ ...form, project_billing_scope: e.target.value })} options={[
            { value: 'included_in_quote', label: 'Ingår i offert' },
            { value: 'outside_quote', label: 'Utanför offert' },
            { value: 'internal', label: 'Intern tid' },
          ]} />
        </div>
        <Textarea label="Kommentar" value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} rows={2} />
        {error && <ErrorBox message={error} />}
        <ModalActions onClose={onClose} onSave={onSave} saving={saving} saveLabel="Spara tid" />
      </div>
    </Modal>
  );
}

function MaterialModal({ open, onClose, form, setForm, onSave, saving, error }: any) {
  return (
    <Modal open={open} onClose={onClose} title="Lägg till material" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Material" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Leverantör" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
          <Input label="Antal" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          <Input label="Enhet" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <Input label="Inköpspris" type="number" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} />
          <Input label="Påslag %" type="number" value={form.markup_percent} onChange={(e) => setForm({ ...form, markup_percent: e.target.value })} />
          <Input label="Försäljningspris" type="number" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} />
        </div>
        <Textarea label="Beskrivning" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.included_in_quote} onChange={(e) => setForm({ ...form, included_in_quote: e.target.checked })} /> Ingår i offert</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.invoice_separately} onChange={(e) => setForm({ ...form, invoice_separately: e.target.checked })} /> Faktureras separat</label>
        </div>
        {error && <ErrorBox message={error} />}
        <ModalActions onClose={onClose} onSave={onSave} saving={saving} saveLabel="Spara material" />
      </div>
    </Modal>
  );
}

function ChangeOrderModal({ open, onClose, form, setForm, onSave, saving, error }: any) {
  return (
    <Modal open={open} onClose={onClose} title="Ny ÄTA" size="lg">
      <div className="space-y-4">
        <Input label="Rubrik" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Textarea label="Beskrivning" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Orsak" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <Input label="Beställare" value={form.requested_by} onChange={(e) => setForm({ ...form, requested_by: e.target.value })} />
          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={[
            { value: 'draft', label: 'Utkast' },
            { value: 'sent_to_customer', label: 'Skickad till kund' },
            { value: 'approved_by_customer', label: 'Godkänd av kund' },
            { value: 'declined_by_customer', label: 'Nekad av kund' },
            { value: 'completed', label: 'Utförd' },
            { value: 'invoiced', label: 'Fakturerad' },
            { value: 'written_off', label: 'Avskriven' },
          ]} />
          <Select label="Debitering" value={form.billing_mode} onChange={(e) => setForm({ ...form, billing_mode: e.target.value })} options={[
            { value: 'separate', label: 'Faktureras separat' },
            { value: 'included', label: 'Ingår i projektet' },
            { value: 'internal_note', label: 'Endast intern notering' },
            { value: 'deduction', label: 'Avgående kostnad' },
          ]} />
          <Input label="Beräknad kostnad" type="number" value={form.estimated_amount} onChange={(e) => setForm({ ...form, estimated_amount: e.target.value })} />
          <Input label="Faktiskt utfall" type="number" value={form.actual_amount} onChange={(e) => setForm({ ...form, actual_amount: e.target.value })} />
        </div>
        {error && <ErrorBox message={error} />}
        <ModalActions onClose={onClose} onSave={onSave} saving={saving} saveLabel="Spara ÄTA" />
      </div>
    </Modal>
  );
}

function QuoteModal({ open, onClose, form, setForm, onSave, saving, error }: any) {
  const total = form.lines.reduce((sum: number, line: any) => sum + (Number(line.quantity) || 0) * (Number(line.unit_price) || 0), 0);
  return (
    <Modal open={open} onClose={onClose} title="Ny offert" size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Giltig till" type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} />
          <Input label="Betalningsvillkor" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} />
        </div>
        <Textarea label="Sammanfattning" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} rows={2} />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Offertrader</p>
            <Button size="sm" variant="secondary" onClick={() => setForm({ ...form, lines: [...form.lines, { line_type: 'work', description: '', quantity: '1', unit: 'st', unit_price: '0', vat_rate: '25' }] })}>
              <Plus className="w-4 h-4" /> Rad
            </Button>
          </div>
          {form.lines.map((line: any, index: number) => (
            <div key={index} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_90px_80px_120px]">
              <Input placeholder="Beskrivning" value={line.description} onChange={(e) => {
                const lines = [...form.lines]; lines[index] = { ...line, description: e.target.value }; setForm({ ...form, lines });
              }} />
              <Input type="number" placeholder="Antal" value={line.quantity} onChange={(e) => {
                const lines = [...form.lines]; lines[index] = { ...line, quantity: e.target.value }; setForm({ ...form, lines });
              }} />
              <Input placeholder="Enhet" value={line.unit} onChange={(e) => {
                const lines = [...form.lines]; lines[index] = { ...line, unit: e.target.value }; setForm({ ...form, lines });
              }} />
              <Input type="number" placeholder="Pris" value={line.unit_price} onChange={(e) => {
                const lines = [...form.lines]; lines[index] = { ...line, unit_price: e.target.value }; setForm({ ...form, lines });
              }} />
            </div>
          ))}
        </div>
        <Textarea label="Villkor/reservationer" value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} rows={3} />
        <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">Totalsumma: {money(total)}</div>
        {error && <ErrorBox message={error} />}
        <ModalActions onClose={onClose} onSave={onSave} saving={saving} saveLabel="Skapa offert" />
      </div>
    </Modal>
  );
}

function DocumentModal({ open, onClose, form, setForm, onSave, saving, error }: any) {
  return (
    <Modal open={open} onClose={onClose} title="Lägg till dokumentlänk">
      <div className="space-y-4">
        <Input label="Titel" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Input label="Länk" value={form.file_url} onChange={(e) => setForm({ ...form, file_url: e.target.value })} placeholder="https://..." />
        <Input label="Filnamn" value={form.file_name} onChange={(e) => setForm({ ...form, file_name: e.target.value })} />
        <Textarea label="Kommentar" value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} rows={2} />
        {error && <ErrorBox message={error} />}
        <ModalActions onClose={onClose} onSave={onSave} saving={saving} saveLabel="Spara länk" />
      </div>
    </Modal>
  );
}

function SelfCheckTemplateModal({ open, onClose, form, setForm, onSave, saving, error }: any) {
  return (
    <Modal open={open} onClose={onClose} title="Ny egenkontrollmall" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Namn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Kategori" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        </div>
        <Textarea label="Beskrivning" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Kontrollpunkter</p>
            <Button size="sm" variant="secondary" onClick={() => setForm({ ...form, checklist: [...form.checklist, ''] })}>
              <Plus className="w-4 h-4" /> Punkt
            </Button>
          </div>
          {form.checklist.map((item: string, index: number) => (
            <Input
              key={index}
              placeholder={`Kontrollpunkt ${index + 1}`}
              value={item}
              onChange={(e) => {
                const checklist = [...form.checklist];
                checklist[index] = e.target.value;
                setForm({ ...form, checklist });
              }}
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.require_photo} onChange={(e) => setForm({ ...form, require_photo: e.target.checked })} /> Kräv bild</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.require_comment} onChange={(e) => setForm({ ...form, require_comment: e.target.checked })} /> Kräv kommentar</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.require_signature} onChange={(e) => setForm({ ...form, require_signature: e.target.checked })} /> Kräv signatur</label>
        </div>
        {error && <ErrorBox message={error} />}
        <ModalActions onClose={onClose} onSave={onSave} saving={saving} saveLabel="Spara mall" />
      </div>
    </Modal>
  );
}

function SelfCheckModal({ open, onClose, form, setForm, templates, onSave, saving, error }: any) {
  function applyTemplate(templateId: string) {
    const template = templates.find((item: ProjectSelfCheckTemplate) => item.id === templateId);
    setForm({
      ...form,
      template_id: templateId,
      name: template?.name || form.name,
      category: template?.category || form.category,
      items: template?.checklist?.length
        ? template.checklist.map((item: any) => ({ text: item.text, result: 'approved', comment: '', action_required: false }))
        : form.items,
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Ny egenkontroll" size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Mall" value={form.template_id} onChange={(e) => applyTemplate(e.target.value)} options={[{ value: '', label: 'Utan mall' }, ...templates.map((t: ProjectSelfCheckTemplate) => ({ value: t.id, label: t.name }))]} />
          <Input label="Namn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Kategori" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <Input label="Signatur" value={form.signature_name} onChange={(e) => setForm({ ...form, signature_name: e.target.value })} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Kontrollpunkter</p>
            <Button size="sm" variant="secondary" onClick={() => setForm({ ...form, items: [...form.items, { text: '', result: 'approved', comment: '', action_required: false }] })}>
              <Plus className="w-4 h-4" /> Punkt
            </Button>
          </div>
          {form.items.map((item: any, index: number) => (
            <div key={index} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 lg:grid-cols-[1fr_160px_1fr]">
              <Input placeholder="Kontrollpunkt" value={item.text} onChange={(e) => {
                const items = [...form.items]; items[index] = { ...item, text: e.target.value }; setForm({ ...form, items });
              }} />
              <Select value={item.result} onChange={(e) => {
                const items = [...form.items]; items[index] = { ...item, result: e.target.value }; setForm({ ...form, items });
              }} options={[
                { value: 'approved', label: 'Godkänd' },
                { value: 'not_approved', label: 'Ej godkänd' },
                { value: 'not_applicable', label: 'Ej relevant' },
              ]} />
              <Input placeholder="Kommentar" value={item.comment} onChange={(e) => {
                const items = [...form.items]; items[index] = { ...item, comment: e.target.value }; setForm({ ...form, items });
              }} />
            </div>
          ))}
        </div>
        <Textarea label="Noteringar" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
        {error && <ErrorBox message={error} />}
        <ModalActions onClose={onClose} onSave={onSave} saving={saving} saveLabel="Spara egenkontroll" />
      </div>
    </Modal>
  );
}

function InspectionModal({ open, onClose, form, setForm, staff, onSave, saving, error }: any) {
  return (
    <Modal open={open} onClose={onClose} title="Ny projektbesiktning" size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Typ" value={form.inspection_type} onChange={(e) => setForm({ ...form, inspection_type: e.target.value })} options={[
            { value: 'internal', label: 'Intern slutkontroll' },
            { value: 'customer', label: 'Kundbesiktning' },
            { value: 'final', label: 'Slutbesiktning' },
          ]} />
          <Input label="Datum" type="date" value={form.inspection_date} onChange={(e) => setForm({ ...form, inspection_date: e.target.value })} />
          <Select label="Besiktningsperson" value={form.inspector_id} onChange={(e) => setForm({ ...form, inspector_id: e.target.value })} options={[{ value: '', label: 'Välj' }, ...staff.map((p: Profile) => ({ value: p.id, label: p.name }))]} />
          <Select label="Resultat" value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} options={[
            { value: 'approved_without_remarks', label: 'Godkänt utan anmärkning' },
            { value: 'approved_with_minor_remarks', label: 'Godkänt med mindre anmärkningar' },
            { value: 'not_approved', label: 'Ej godkänt' },
            { value: 'requires_action', label: 'Kräver åtgärd' },
          ]} />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.customer_present} onChange={(e) => setForm({ ...form, customer_present: e.target.checked })} /> Kund närvarande</label>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Anmärkningar</p>
            <Button size="sm" variant="secondary" onClick={() => setForm({ ...form, remarks: [...form.remarks, { title: '', description: '', responsible_id: '', deadline: '', status: 'new' }] })}>
              <Plus className="w-4 h-4" /> Anmärkning
            </Button>
          </div>
          {form.remarks.map((remark: any, index: number) => (
            <div key={index} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
              <Input placeholder="Rubrik" value={remark.title} onChange={(e) => {
                const remarks = [...form.remarks]; remarks[index] = { ...remark, title: e.target.value }; setForm({ ...form, remarks });
              }} />
              <Select value={remark.responsible_id} onChange={(e) => {
                const remarks = [...form.remarks]; remarks[index] = { ...remark, responsible_id: e.target.value }; setForm({ ...form, remarks });
              }} options={[{ value: '', label: 'Ansvarig' }, ...staff.map((p: Profile) => ({ value: p.id, label: p.name }))]} />
              <Textarea placeholder="Beskrivning" value={remark.description} onChange={(e) => {
                const remarks = [...form.remarks]; remarks[index] = { ...remark, description: e.target.value }; setForm({ ...form, remarks });
              }} rows={2} />
              <Input type="date" value={remark.deadline} onChange={(e) => {
                const remarks = [...form.remarks]; remarks[index] = { ...remark, deadline: e.target.value }; setForm({ ...form, remarks });
              }} />
            </div>
          ))}
        </div>
        <Textarea label="Noteringar" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
        <Input label="Signatur" value={form.signature_name} onChange={(e) => setForm({ ...form, signature_name: e.target.value })} />
        {error && <ErrorBox message={error} />}
        <ModalActions onClose={onClose} onSave={onSave} saving={saving} saveLabel="Spara besiktning" />
      </div>
    </Modal>
  );
}

function DeviationModal({ open, onClose, form, setForm, staff, onSave, saving, error }: any) {
  return (
    <Modal open={open} onClose={onClose} title="Ny avvikelse" size="lg">
      <div className="space-y-4">
        <Input label="Rubrik" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Textarea label="Beskrivning" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Allvarlighetsgrad" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} options={[
            { value: 'low', label: 'Låg' },
            { value: 'medium', label: 'Normal' },
            { value: 'high', label: 'Hög' },
            { value: 'critical', label: 'Kritisk' },
          ]} />
          <Select label="Ansvarig" value={form.responsible_id} onChange={(e) => setForm({ ...form, responsible_id: e.target.value })} options={[{ value: '', label: 'Ingen' }, ...staff.map((p: Profile) => ({ value: p.id, label: p.name }))]} />
        </div>
        <Input label="Bildlänk" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." />
        <Textarea label="Föreslagen åtgärd" value={form.proposed_action} onChange={(e) => setForm({ ...form, proposed_action: e.target.value })} rows={2} />
        {error && <ErrorBox message={error} />}
        <ModalActions onClose={onClose} onSave={onSave} saving={saving} saveLabel="Spara avvikelse" />
      </div>
    </Modal>
  );
}

function InvoiceBasisModal({ open, onClose, form, setForm, onSave, saving, error, totals }: any) {
  return (
    <Modal open={open} onClose={onClose} title="Skapa faktureringsunderlag" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Titel" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Select label="Typ" value={form.invoice_type} onChange={(e) => setForm({ ...form, invoice_type: e.target.value })} options={[
            { value: 'partial', label: 'Delfakturering' },
            { value: 'final', label: 'Slutfakturering' },
            { value: 'credit', label: 'Kredit' },
            { value: 'internal', label: 'Internt' },
          ]} />
        </div>
        <Textarea label="Beskrivning" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="rounded-lg border border-slate-200 p-3 text-sm"><input className="mr-2" type="checkbox" checked={form.include_time} onChange={(e) => setForm({ ...form, include_time: e.target.checked })} /> Tid {money(totals.timeValue)}</label>
          <label className="rounded-lg border border-slate-200 p-3 text-sm"><input className="mr-2" type="checkbox" checked={form.include_materials} onChange={(e) => setForm({ ...form, include_materials: e.target.checked })} /> Material {money(totals.materialSale)}</label>
          <label className="rounded-lg border border-slate-200 p-3 text-sm"><input className="mr-2" type="checkbox" checked={form.include_change_orders} onChange={(e) => setForm({ ...form, include_change_orders: e.target.checked })} /> ÄTA {money(totals.changeOrderAmount)}</label>
        </div>
        <Input label="Fastprisdel (valfritt)" type="number" value={form.fixed_price_amount} onChange={(e) => setForm({ ...form, fixed_price_amount: e.target.value })} />
        {error && <ErrorBox message={error} />}
        <ModalActions onClose={onClose} onSave={onSave} saving={saving} saveLabel="Skapa underlag" />
      </div>
    </Modal>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{message}</div>;
}

function ModalActions({ onClose, onSave, saving, saveLabel }: { onClose: () => void; onSave: () => void; saving: boolean; saveLabel: string }) {
  return (
    <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
      <Button variant="secondary" onClick={onClose} className="w-full sm:w-auto">Avbryt</Button>
      <Button variant="primary" onClick={onSave} loading={saving} className="w-full sm:w-auto">{saveLabel}</Button>
    </div>
  );
}
