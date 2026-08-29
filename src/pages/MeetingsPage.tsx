import React, { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  Link as LinkIcon,
  ListChecks,
  Lock,
  MessageSquareText,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select, Textarea } from '../components/ui';
import { formatDate, formatDateTime } from '../lib/utils';
import type { MaintenanceRequest, Meeting, MeetingActionItem, MeetingAgendaItem, MeetingDecision, MeetingTemplate, Profile, WorkOrder } from '../types';

type MeetingTab = 'dashboard' | 'meetings' | 'templates' | 'ai';
type MeetingStatus = 'draft' | 'planned' | 'in_progress' | 'completed' | 'locked' | 'cancelled';
type ProtocolRowType = 'information' | 'decision' | 'task' | 'change' | 'risk' | 'parked' | 'follow_up' | 'deviation' | 'customer_message' | 'internal_note';

type MeetingForm = {
  title: string;
  starts_at: string;
  meeting_type: string;
  template_id: string;
  participant_ids: string[];
  description: string;
  generate_agenda: boolean;
};

type TemplateForm = {
  name: string;
  description: string;
  agendaText: string;
};

type ProtocolForm = {
  row_type: ProtocolRowType;
  content: string;
  linked_entity_type: string;
  linked_entity_id: string;
};

type DecisionForm = {
  title: string;
  description: string;
  responsible_user_id: string;
  due_date: string;
  linked_entity_type: string;
  linked_entity_id: string;
};

type ActionForm = {
  title: string;
  description: string;
  responsible_user_id: string;
  due_date: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  linked_entity_type: string;
  linked_entity_id: string;
};

type ProtocolRow = {
  id: string;
  organisation_id: string;
  meeting_id: string;
  agenda_item_id: string | null;
  row_type: ProtocolRowType;
  content: string;
  linked_entity_type: string;
  linked_entity_id: string | null;
  created_by: string | null;
  created_at: string;
};

type SystemLink = {
  id: string;
  type: 'work_order' | 'maintenance_request' | 'customer_project' | 'decision' | 'action_item';
  title: string;
  subtitle: string;
  status?: string;
  priority?: string;
  due_date?: string | null;
};

type AgendaDraft = {
  title: string;
  notes: string;
  item_type: string;
  source_type?: string;
  source_id?: string;
  linked_entity_type?: string;
  linked_entity_id?: string;
};

type MeetingAgendaItemMvp = MeetingAgendaItem & {
  item_type?: string;
  status?: string;
  source_type?: string;
  source_id?: string | null;
  linked_entity_type?: string;
  linked_entity_id?: string | null;
};

type CustomerProjectLite = {
  id: string;
  title?: string;
  name?: string;
  customer_name?: string;
  status?: string;
  updated_at?: string;
};

type MeetingAiTaskToCreate = { title: string; description: string; priority: 'low' | 'normal' | 'high' | 'urgent'; due_date: string | null; reason: string; confidence: number };
type MeetingAiTaskToUpdate = { action_item_id: string | null; action_item_title_hint: string; new_status: 'open' | 'in_progress' | 'done' | 'cancelled' | null; new_priority: 'low' | 'normal' | 'high' | 'urgent' | null; reason: string; confidence: number };
type MeetingAiPurchaseItem = { item_name: string; quantity: string | null; store_name: string | null; notes: string | null; reason: string; confidence: number };
type MeetingAiWorkOrder = { title: string; description: string; priority: 'low' | 'normal' | 'high' | 'urgent'; reason: string; confidence: number };
type MeetingAiReviewFlag = { title: string; detail: string; reason: string };

type MeetingAiAnalysis = {
  summary?: string;
  warnings?: string[];
  tasks_to_create?: MeetingAiTaskToCreate[];
  tasks_to_update?: MeetingAiTaskToUpdate[];
  purchase_items?: MeetingAiPurchaseItem[];
  work_orders_to_create?: MeetingAiWorkOrder[];
  review_flags?: MeetingAiReviewFlag[];
  model?: string;
  estimated_cost_sek?: number;
  suggestion_id?: string;
};

function formatConfidence(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const percent = value <= 1 ? Math.round(value * 100) : Math.round(value);
  return `${percent}%`;
}

const meetingTypeOptions = [
  { value: 'weekly_operations', label: 'Veckomöte drift' },
  { value: 'management', label: 'Ledningsmöte' },
  { value: 'project', label: 'Projektmöte' },
  { value: 'property', label: 'Fastighetsmöte' },
  { value: 'customer_project', label: 'Kundprojektmöte' },
  { value: 'staff', label: 'Personalmöte' },
  { value: 'finance', label: 'Ekonomimöte' },
  { value: 'urgent', label: 'Akutmöte' },
];

const meetingTypeLabels = Object.fromEntries(meetingTypeOptions.map(option => [option.value, option.label])) as Record<string, string>;

const statusLabels: Record<MeetingStatus, string> = {
  draft: 'Utkast',
  planned: 'Planerat',
  in_progress: 'Pågående',
  completed: 'Avslutat',
  locked: 'Låst',
  cancelled: 'Avbrutet',
};

const statusClasses: Record<MeetingStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  planned: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  locked: 'bg-slate-900 text-white',
  cancelled: 'bg-slate-200 text-slate-500',
};

const priorityOptions = [
  { value: 'low', label: 'Låg' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Hög' },
  { value: 'urgent', label: 'Akut' },
];

const protocolTypeOptions: { value: ProtocolRowType; label: string }[] = [
  { value: 'information', label: 'Information' },
  { value: 'decision', label: 'Beslut' },
  { value: 'task', label: 'Uppgift' },
  { value: 'change', label: 'Ändring' },
  { value: 'risk', label: 'Risk/problem' },
  { value: 'parked', label: 'Parkerad fråga' },
  { value: 'follow_up', label: 'Uppföljning' },
  { value: 'deviation', label: 'Avvikelse' },
  { value: 'customer_message', label: 'Kundbesked' },
  { value: 'internal_note', label: 'Intern notering' },
];

const protocolTypeLabels = Object.fromEntries(protocolTypeOptions.map(option => [option.value, option.label])) as Record<ProtocolRowType, string>;

const defaultMeetingForm: MeetingForm = {
  title: '',
  starts_at: new Date().toISOString().slice(0, 16),
  meeting_type: 'weekly_operations',
  template_id: '',
  participant_ids: [],
  description: '',
  generate_agenda: true,
};

const defaultTemplateForm: TemplateForm = {
  name: '',
  description: '',
  agendaText: [
    'Uppföljning från föregående möte',
    'Akuta ärenden',
    'Pågående kundprojekt',
    'Aktiva arbetsorder',
    'Öppna felanmälningar',
    'Försenade uppgifter',
    'Ärenden utan ansvarig',
    'Ärenden utan deadline',
    'Personal och resurser',
    'Ekonomi/fakturering',
    'Beslut som behöver tas',
    'Att göra till nästa möte',
    'Parkerade frågor',
  ].join('\n'),
};

const defaultProtocolForm: ProtocolForm = {
  row_type: 'information',
  content: '',
  linked_entity_type: '',
  linked_entity_id: '',
};

const defaultDecisionForm: DecisionForm = {
  title: '',
  description: '',
  responsible_user_id: '',
  due_date: '',
  linked_entity_type: '',
  linked_entity_id: '',
};

const defaultActionForm: ActionForm = {
  title: '',
  description: '',
  responsible_user_id: '',
  due_date: '',
  priority: 'normal',
  linked_entity_type: '',
  linked_entity_id: '',
};

function agendaFromTemplate(template?: MeetingTemplate | null) {
  const agenda = Array.isArray(template?.agenda) ? template?.agenda : [];
  return agenda
    .map((item: any) => typeof item === 'string' ? item : item?.title)
    .filter(Boolean);
}

function projectTitle(project: CustomerProjectLite) {
  return project.title || project.name || project.customer_name || 'Kundprojekt';
}

function entityOptions(links: SystemLink[]) {
  return [
    { value: '', label: 'Ingen koppling' },
    ...links.map(link => ({ value: `${link.type}:${link.id}`, label: `${link.title} (${link.subtitle})` })),
  ];
}

function splitEntity(value: string) {
  const [type, id] = value.split(':');
  return { type: type || '', id: id || '' };
}

function isSchemaCacheMiss(error: any) {
  const message = String(error?.message || '');
  return error?.code === 'PGRST204' || error?.code === 'PGRST205' || message.includes('schema cache');
}

export function MeetingsPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<MeetingTab>('dashboard');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [templates, setTemplates] = useState<MeetingTemplate[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [agendaItems, setAgendaItems] = useState<MeetingAgendaItem[]>([]);
  const [protocolRows, setProtocolRows] = useState<ProtocolRow[]>([]);
  const [decisions, setDecisions] = useState<MeetingDecision[]>([]);
  const [actionItems, setActionItems] = useState<MeetingActionItem[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([]);
  const [customerProjects, setCustomerProjects] = useState<CustomerProjectLite[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<any[]>([]);
  const [meetingAiAnalysis, setMeetingAiAnalysis] = useState<MeetingAiAnalysis | null>(null);
  const [meetingAiLoading, setMeetingAiLoading] = useState(false);
  const [meetingAiError, setMeetingAiError] = useState('');
  const [meetingAiApplied, setMeetingAiApplied] = useState<Set<string>>(new Set());
  const [meetingAiApplying, setMeetingAiApplying] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [selectedAgendaId, setSelectedAgendaId] = useState<string | null>(null);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [meetingForm, setMeetingForm] = useState<MeetingForm>(defaultMeetingForm);
  const [templateForm, setTemplateForm] = useState<TemplateForm>(defaultTemplateForm);
  const [editingTemplate, setEditingTemplate] = useState<MeetingTemplate | null>(null);
  const [protocolForm, setProtocolForm] = useState<ProtocolForm>(defaultProtocolForm);
  const [decisionForm, setDecisionForm] = useState<DecisionForm>(defaultDecisionForm);
  const [actionForm, setActionForm] = useState<ActionForm>(defaultActionForm);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const canManage = user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => {
    fetchData();
  }, [user?.organisation_id]);

  useEffect(() => {
    if (selectedMeeting) {
      setMeetingAiAnalysis(null);
      setMeetingAiError('');
      setMeetingAiApplied(new Set());
      loadMeetingDetails(selectedMeeting.id);
    }
  }, [selectedMeeting?.id]);

  async function fetchData() {
    if (!user?.organisation_id) return;
    setLoading(true);
    try {
      const [meetingsRes, templatesRes, staffRes, woRes, mrRes, projectsRes, aiRes] = await Promise.all([
        supabase.from('vihem_meetings').select('*').eq('organisation_id', user.organisation_id).order('starts_at', { ascending: false }),
        supabase.from('vihem_meeting_templates').select('*').eq('organisation_id', user.organisation_id).order('name'),
        supabase.from('vihem_profiles').select('*').eq('organisation_id', user.organisation_id).in('role', ['staff', 'admin']).eq('active', true).order('name'),
        supabase.from('vihem_work_orders').select('*').eq('organisation_id', user.organisation_id).not('status', 'in', '(completed,cancelled)').order('due_date', { ascending: true, nullsFirst: true }).limit(40),
        supabase.from('vihem_maintenance_requests').select('*').eq('organisation_id', user.organisation_id).not('status', 'in', '(done,closed)').order('created_at', { ascending: false }).limit(40),
        supabase.from('vihem_customer_projects').select('id,title,name,customer_name,status,updated_at').eq('organisation_id', user.organisation_id).not('status', 'in', '(archived,completed,cancelled)').order('updated_at', { ascending: false }).limit(40),
        supabase.from('vihem_ai_suggestions').select('*').eq('organisation_id', user.organisation_id).eq('source_type', 'meeting').eq('status', 'pending').order('created_at', { ascending: false }).limit(20),
      ]);

      setMeetings((meetingsRes.data || []) as Meeting[]);
      setTemplates((templatesRes.data || []) as MeetingTemplate[]);
      setStaff((staffRes.data || []) as Profile[]);
      setWorkOrders((woRes.data || []) as WorkOrder[]);
      setMaintenanceRequests((mrRes.data || []) as MaintenanceRequest[]);
      setCustomerProjects((projectsRes.data || []) as CustomerProjectLite[]);
      setAiSuggestions(aiRes.data || []);
    } finally {
      setLoading(false);
    }
  }

  async function loadMeetingDetails(meetingId: string) {
    if (!user?.organisation_id) return;
    const [agendaRes, protocolRes, decisionsRes, actionsRes] = await Promise.all([
      supabase.from('vihem_meeting_agenda_items').select('*').eq('meeting_id', meetingId).order('sort_order'),
      supabase.from('vihem_meeting_protocol_rows').select('*').eq('meeting_id', meetingId).order('created_at'),
      supabase.from('vihem_meeting_decisions').select('*').eq('meeting_id', meetingId).order('created_at'),
      supabase.from('vihem_meeting_action_items').select('*').eq('meeting_id', meetingId).order('due_date', { ascending: true, nullsFirst: false }),
    ]);
    const loadedAgenda = (agendaRes.data || []) as MeetingAgendaItemMvp[];
    setAgendaItems(loadedAgenda as MeetingAgendaItem[]);
    setProtocolRows((protocolRes.data || []) as ProtocolRow[]);
    setDecisions((decisionsRes.data || []) as MeetingDecision[]);
    setActionItems((actionsRes.data || []) as MeetingActionItem[]);
    const selectedLoadedAgenda = selectedAgendaId ? loadedAgenda.find(item => item.id === selectedAgendaId) : null;
    if (!selectedLoadedAgenda || selectedLoadedAgenda.status === 'done') {
      const nextAgenda = loadedAgenda.find(item => item.status !== 'done') || loadedAgenda[0] || null;
      setSelectedAgendaId(nextAgenda?.id || null);
    }
  }

  function openMeetingModal() {
    setMeetingForm({
      ...defaultMeetingForm,
      starts_at: new Date().toISOString().slice(0, 16),
      template_id: templates[0]?.id || '',
    });
    setSaveError('');
    setShowMeetingModal(true);
  }

  function openTemplateModal(template?: MeetingTemplate) {
    setEditingTemplate(template || null);
    setTemplateForm(template ? {
      name: template.name,
      description: template.description,
      agendaText: agendaFromTemplate(template).join('\n'),
    } : defaultTemplateForm);
    setSaveError('');
    setShowTemplateModal(true);
  }

  function buildAutoAgenda(previousMeeting?: Meeting | null): AgendaDraft[] {
    const rows: AgendaDraft[] = [];
    const template = templates.find(row => row.id === meetingForm.template_id);
    agendaFromTemplate(template).forEach(title => rows.push({ title, notes: '', item_type: 'template' }));

    if (previousMeeting) {
      rows.unshift({ title: `Uppföljning från ${formatDate(previousMeeting.starts_at || previousMeeting.created_at)}`, notes: 'Beslut, uppgifter och parkerade frågor från föregående möte.', item_type: 'follow_up', source_type: 'meeting', source_id: previousMeeting.id });
    }

    workOrders.slice(0, 8).forEach(order => rows.push({
      title: `Arbetsorder: ${order.title}`,
      notes: `${order.status}${order.due_date ? ` · deadline ${formatDate(order.due_date)}` : ''}`,
      item_type: 'system',
      source_type: 'work_order',
      source_id: order.id,
      linked_entity_type: 'work_order',
      linked_entity_id: order.id,
    }));

    maintenanceRequests.slice(0, 8).forEach(request => rows.push({
      title: `Felanmälan: ${request.title}`,
      notes: `${request.status} · ${request.priority}`,
      item_type: 'system',
      source_type: 'maintenance_request',
      source_id: request.id,
      linked_entity_type: 'maintenance_request',
      linked_entity_id: request.id,
    }));

    customerProjects.slice(0, 8).forEach(project => rows.push({
      title: `Kundprojekt: ${projectTitle(project)}`,
      notes: project.status || '',
      item_type: 'system',
      source_type: 'customer_project',
      source_id: project.id,
      linked_entity_type: 'customer_project',
      linked_entity_id: project.id,
    }));

    return rows;
  }

  async function handleCreateMeeting() {
    if (!user?.organisation_id) return;
    setSaveError('');
    if (!meetingForm.title.trim()) {
      setSaveError('Ange mötestitel.');
      return;
    }

    setSaving(true);
    try {
      const previousMeeting = meetings.find(meeting => meeting.meeting_type === meetingForm.meeting_type && ['completed', 'locked'].includes(meeting.status)) || null;
      const baseMeetingPayload = {
        organisation_id: user.organisation_id,
        title: meetingForm.title.trim(),
        description: meetingForm.description.trim(),
        meeting_type: meetingForm.meeting_type,
        template_id: meetingForm.template_id || null,
        starts_at: new Date(meetingForm.starts_at).toISOString(),
        status: 'draft',
        created_by: user.id,
      };
      const fullMeetingPayload = {
        ...baseMeetingPayload,
        participant_ids: meetingForm.participant_ids,
        previous_meeting_id: previousMeeting?.id || null,
      };

      let meetingResult = await supabase
        .from('vihem_meetings')
        .insert(fullMeetingPayload)
        .select('*')
        .single();

      if (meetingResult.error && isSchemaCacheMiss(meetingResult.error)) {
        meetingResult = await supabase
          .from('vihem_meetings')
          .insert(baseMeetingPayload)
          .select('*')
          .single();
      }

      if (meetingResult.error) throw meetingResult.error;
      const meeting = meetingResult.data;

      const agendaRows: AgendaDraft[] = meetingForm.generate_agenda
        ? buildAutoAgenda(previousMeeting)
        : agendaFromTemplate(templates.find(row => row.id === meetingForm.template_id)).map(title => ({ title, notes: '', item_type: 'template' }));
      if (agendaRows.length > 0) {
        const fullAgendaPayload = agendaRows.map((row, index) => ({
          organisation_id: user.organisation_id,
          meeting_id: meeting.id,
          title: row.title,
          notes: row.notes,
          item_type: row.item_type,
          source_type: row.source_type || '',
          source_id: row.source_id || null,
          linked_entity_type: row.linked_entity_type || '',
          linked_entity_id: row.linked_entity_id || null,
          sort_order: index + 1,
        }));
        const baseAgendaPayload = agendaRows.map((row, index) => ({
          organisation_id: user.organisation_id,
          meeting_id: meeting.id,
          title: row.title,
          notes: row.notes,
          sort_order: index + 1,
        }));
        let agendaResult = await supabase.from('vihem_meeting_agenda_items').insert(fullAgendaPayload);
        if (agendaResult.error && isSchemaCacheMiss(agendaResult.error)) {
          agendaResult = await supabase.from('vihem_meeting_agenda_items').insert(baseAgendaPayload);
        }
        if (agendaResult.error) throw agendaResult.error;
      }

      setShowMeetingModal(false);
      setSelectedMeeting(meeting as Meeting);
      setTab('meetings');
      await fetchData();
    } catch (error: any) {
      setSaveError(error.message || 'Kunde inte skapa mötet.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveTemplate() {
    if (!user?.organisation_id) return;
    setSaveError('');
    if (!templateForm.name.trim()) {
      setSaveError('Ange namn på mallen.');
      return;
    }
    const payload = {
      organisation_id: user.organisation_id,
      name: templateForm.name.trim(),
      description: templateForm.description.trim(),
      agenda: templateForm.agendaText.split('\n').map(line => line.trim()).filter(Boolean).map((title, index) => ({ title, sort_order: index + 1 })),
      active: true,
      created_by: user.id,
    };
    const result = editingTemplate
      ? await supabase.from('vihem_meeting_templates').update(payload).eq('id', editingTemplate.id)
      : await supabase.from('vihem_meeting_templates').insert(payload);
    if (result.error) {
      setSaveError(result.error.message);
      return;
    }
    setShowTemplateModal(false);
    setEditingTemplate(null);
    await fetchData();
  }

  async function handleDeleteTemplate(template: MeetingTemplate) {
    if (!window.confirm(`Ta bort mallen "${template.name}"?`)) return;
    const { error } = await supabase.from('vihem_meeting_templates').delete().eq('id', template.id);
    if (error) alert('Kunde inte ta bort mallen.');
    await fetchData();
  }

  async function updateMeetingStatus(status: MeetingStatus) {
    if (!selectedMeeting || !user) return;
    const payload: Record<string, any> = {
      status,
      ends_at: status === 'completed' ? new Date().toISOString() : selectedMeeting.ends_at,
    };
    if (status === 'cancelled') payload.ends_at = new Date().toISOString();
    const { error } = await supabase.from('vihem_meetings').update(payload).eq('id', selectedMeeting.id);
    if (error) {
      alert('Kunde inte uppdatera mötet.');
      return;
    }
    const next = { ...selectedMeeting, ...payload } as Meeting;
    setSelectedMeeting(next);
    setMeetings(current => current.map(meeting => meeting.id === next.id ? next : meeting));
  }

  async function lockMeeting() {
    if (!selectedMeeting || !user) return;
    const { error } = await supabase.from('vihem_meetings').update({
      status: 'locked',
      locked_at: new Date().toISOString(),
      locked_by: user.id,
    }).eq('id', selectedMeeting.id);
    if (error) {
      alert('Kunde inte låsa mötet.');
      return;
    }
    await fetchData();
    setSelectedMeeting({ ...selectedMeeting, status: 'locked', locked_at: new Date().toISOString() } as any);
  }

  async function addProtocolRow() {
    if (!selectedMeeting || !user?.organisation_id || !protocolForm.content.trim()) return;
    const entity = splitEntity(`${protocolForm.linked_entity_type}:${protocolForm.linked_entity_id}`);
    const { error } = await supabase.from('vihem_meeting_protocol_rows').insert({
      organisation_id: user.organisation_id,
      meeting_id: selectedMeeting.id,
      agenda_item_id: selectedAgendaId,
      row_type: protocolForm.row_type,
      content: protocolForm.content.trim(),
      linked_entity_type: entity.type,
      linked_entity_id: entity.id || null,
      created_by: user.id,
    });
    if (error) {
      alert('Kunde inte lägga till protokollrad.');
      return;
    }
    setProtocolForm(defaultProtocolForm);
    await loadMeetingDetails(selectedMeeting.id);
  }

  async function addDecision() {
    if (!selectedMeeting || !user?.organisation_id || !decisionForm.title.trim()) return;
    const entity = splitEntity(`${decisionForm.linked_entity_type}:${decisionForm.linked_entity_id}`);
    const { error } = await supabase.from('vihem_meeting_decisions').insert({
      organisation_id: user.organisation_id,
      meeting_id: selectedMeeting.id,
      title: decisionForm.title.trim(),
      description: decisionForm.description.trim(),
      responsible_user_id: decisionForm.responsible_user_id || null,
      due_date: decisionForm.due_date || null,
      linked_entity_type: entity.type,
      linked_entity_id: entity.id || null,
      status: 'open',
    });
    if (error) {
      alert('Kunde inte skapa beslut.');
      return;
    }
    setDecisionForm(defaultDecisionForm);
    await loadMeetingDetails(selectedMeeting.id);
  }

  async function addActionItem() {
    if (!selectedMeeting || !user?.organisation_id || !actionForm.title.trim()) return;
    const entity = splitEntity(`${actionForm.linked_entity_type}:${actionForm.linked_entity_id}`);
    const { error } = await supabase.from('vihem_meeting_action_items').insert({
      organisation_id: user.organisation_id,
      meeting_id: selectedMeeting.id,
      title: actionForm.title.trim(),
      description: actionForm.description.trim(),
      responsible_user_id: actionForm.responsible_user_id || null,
      due_date: actionForm.due_date || null,
      linked_entity_type: entity.type,
      linked_entity_id: entity.id || null,
      priority: actionForm.priority,
      status: 'open',
    });
    if (error) {
      alert('Kunde inte skapa uppgift.');
      return;
    }
    setActionForm(defaultActionForm);
    await loadMeetingDetails(selectedMeeting.id);
  }

  async function markActionDone(action: MeetingActionItem) {
    if (!selectedMeeting) return;
    const { error } = await supabase.from('vihem_meeting_action_items').update({ status: 'done' }).eq('id', action.id);
    if (error) alert('Kunde inte markera uppgiften klar.');
    await loadMeetingDetails(selectedMeeting.id);
  }

  async function updateAgendaStatus(item: MeetingAgendaItemMvp, status: 'open' | 'done') {
    if (!selectedMeeting) return;
    const { error } = await supabase
      .from('vihem_meeting_agenda_items')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', item.id);

    if (error) {
      alert(error.message || 'Kunde inte uppdatera dagordningspunkten.');
      return;
    }

    if (status === 'done' && selectedAgendaId === item.id) {
      const nextAgenda = agendaItems
        .filter(row => row.id !== item.id)
        .find(row => (row as MeetingAgendaItemMvp).status !== 'done') || null;
      setSelectedAgendaId(nextAgenda?.id || null);
    }
    await loadMeetingDetails(selectedMeeting.id);
  }

  async function runMeetingAiAnalysis() {
    if (!selectedMeeting || !user?.organisation_id) return;
    setMeetingAiLoading(true);
    setMeetingAiError('');
    setMeetingAiApplied(new Set());
    try {
      const { data, error } = await supabase.functions.invoke('vihem-meeting-ai', {
        body: { meeting_id: selectedMeeting.id },
      });
      if (error) {
        // Non-2xx responses leave `data` null and `error` a generic
        // FunctionsHttpError -- the real {error: "..."} body the function
        // sent is only reachable via error.context, the raw Response.
        const context = (error as { context?: Response }).context;
        const parsed = context ? await context.clone().json().catch(() => null) : null;
        throw new Error(parsed?.error || error.message);
      }
      if (data?.error) throw new Error(data.error);
      setMeetingAiAnalysis(data?.analysis || data || null);
      await fetchData();
    } catch (error: any) {
      setMeetingAiError(error?.message || 'Kunde inte analysera mötet med AI.');
    } finally {
      setMeetingAiLoading(false);
    }
  }

  function markAiApplying(key: string, applying: boolean) {
    setMeetingAiApplying(prev => {
      const next = new Set(prev);
      if (applying) next.add(key); else next.delete(key);
      return next;
    });
  }

  async function applyAiCreateTask(item: MeetingAiTaskToCreate, key: string) {
    if (!selectedMeeting || !user?.organisation_id) return;
    markAiApplying(key, true);
    const { error } = await supabase.from('vihem_meeting_action_items').insert({
      organisation_id: user.organisation_id,
      meeting_id: selectedMeeting.id,
      title: item.title,
      description: item.description,
      responsible_user_id: null,
      due_date: item.due_date || null,
      linked_entity_type: '',
      linked_entity_id: null,
      priority: item.priority,
      status: 'open',
    });
    markAiApplying(key, false);
    if (error) { alert('Kunde inte skapa uppgiften.'); return; }
    setMeetingAiApplied(prev => new Set(prev).add(key));
    await loadMeetingDetails(selectedMeeting.id);
  }

  async function applyAiUpdateTask(item: MeetingAiTaskToUpdate, key: string) {
    if (!selectedMeeting || !item.action_item_id) return;
    const patch: Record<string, string> = {};
    if (item.new_status) patch.status = item.new_status;
    if (item.new_priority) patch.priority = item.new_priority;
    if (!Object.keys(patch).length) return;
    markAiApplying(key, true);
    const { error } = await supabase.from('vihem_meeting_action_items').update(patch).eq('id', item.action_item_id);
    markAiApplying(key, false);
    if (error) { alert('Kunde inte uppdatera uppgiften.'); return; }
    setMeetingAiApplied(prev => new Set(prev).add(key));
    await loadMeetingDetails(selectedMeeting.id);
  }

  async function applyAiPurchaseItem(item: MeetingAiPurchaseItem, key: string) {
    if (!user?.organisation_id) return;
    markAiApplying(key, true);
    const { error } = await supabase.from('vihem_purchase_items').insert({
      organisation_id: user.organisation_id,
      store_name: item.store_name || 'Övrigt',
      item_name: item.item_name,
      quantity: item.quantity || '1',
      notes: item.notes || '',
      priority: 'normal',
      created_by: user.id,
    });
    markAiApplying(key, false);
    if (error) { alert('Kunde inte lägga till i inköpslistan.'); return; }
    setMeetingAiApplied(prev => new Set(prev).add(key));
  }

  async function applyAiCreateWorkOrder(item: MeetingAiWorkOrder, key: string) {
    if (!user?.organisation_id) return;
    markAiApplying(key, true);
    const { data, error } = await supabase.from('vihem_work_orders').insert({
      organisation_id: user.organisation_id,
      title: item.title,
      description: item.description,
      category: 'Möte',
      priority: item.priority,
      status: 'new',
      assigned_to_ids: [],
      checklist: [],
      materials: [],
      attachments: [],
      created_by: user.id,
    }).select('id').single();
    markAiApplying(key, false);
    if (error) { alert('Kunde inte skapa arbetsordern.'); return; }
    setMeetingAiApplied(prev => new Set(prev).add(key));
    if (data?.id) onNavigate(`workorder/${data.id}`);
  }

  const systemLinks: SystemLink[] = useMemo(() => [
    ...workOrders.map(order => ({
      id: order.id,
      type: 'work_order' as const,
      title: order.title,
      subtitle: 'Arbetsorder',
      status: order.status,
      priority: order.priority,
      due_date: order.due_date,
    })),
    ...maintenanceRequests.map(request => ({
      id: request.id,
      type: 'maintenance_request' as const,
      title: request.title,
      subtitle: 'Felanmälan',
      status: request.status,
      priority: request.priority,
      due_date: null,
    })),
    ...customerProjects.map(project => ({
      id: project.id,
      type: 'customer_project' as const,
      title: projectTitle(project),
      subtitle: 'Kundprojekt',
      status: project.status,
      due_date: null,
    })),
    ...decisions.map(decision => ({
      id: decision.id,
      type: 'decision' as const,
      title: decision.title,
      subtitle: 'Beslut',
      status: decision.status,
      due_date: decision.due_date,
    })),
    ...actionItems.map(action => ({
      id: action.id,
      type: 'action_item' as const,
      title: action.title,
      subtitle: 'Mötesuppgift',
      status: action.status,
      due_date: action.due_date,
    })),
  ], [workOrders, maintenanceRequests, customerProjects, decisions, actionItems]);

  const selectedAgenda = agendaItems.find(item => item.id === selectedAgendaId) || agendaItems[0] || null;
  const openDecisions = decisions.filter(decision => decision.status === 'open');
  const myActions = actionItems.filter(action => action.responsible_user_id === user?.id && action.status !== 'done');
  const overdueActions = actionItems.filter(action => action.due_date && new Date(`${action.due_date}T23:59:59`).getTime() < Date.now() && action.status !== 'done');
  const upcomingMeetings = meetings.filter(meeting => meeting.starts_at && new Date(meeting.starts_at).getTime() >= Date.now()).slice(0, 5);
  const parkedRows = protocolRows.filter(row => row.row_type === 'parked');

  if (loading) return <LoadingPage />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Möten & Uppföljning"
        subtitle="Skapa dagordningar, skriv protokoll, fatta beslut och följ upp uppgifter från möten."
        icon={MessageSquareText}
        action={canManage && (
          <Button onClick={openMeetingModal} className="w-full sm:w-auto">
            <Plus className="w-4 h-4" /> Nytt möte
          </Button>
        )}
      />

      <div className="flex flex-wrap gap-2">
        {[
          { id: 'dashboard', label: 'Översikt', icon: ClipboardList },
          { id: 'meetings', label: 'Möten', icon: CalendarDays },
          { id: 'templates', label: 'Mallar', icon: FileText },
          { id: 'ai', label: 'AI-granskning', icon: Bot },
        ].map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id as MeetingTab)}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                tab === item.id ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" /> {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'dashboard' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard label="Kommande möten" value={upcomingMeetings.length} />
            <MetricCard label="Öppna beslut" value={openDecisions.length} />
            <MetricCard label="Mina uppgifter" value={myActions.length} />
            <MetricCard label="AI-förslag" value={aiSuggestions.length} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4">
              <h2 className="font-bold text-slate-800 mb-3">Kommande möten</h2>
              {upcomingMeetings.length === 0 ? <EmptyMini text="Inga kommande möten" /> : upcomingMeetings.map(meeting => (
                <MeetingListItem key={meeting.id} meeting={meeting} onClick={() => { setSelectedMeeting(meeting); setTab('meetings'); }} />
              ))}
            </Card>
            <Card className="p-4">
              <h2 className="font-bold text-slate-800 mb-3">Försenade mötesuppgifter</h2>
              {overdueActions.length === 0 ? <EmptyMini text="Inga försenade uppgifter" /> : overdueActions.map(action => (
                <div key={action.id} className="border-b border-slate-100 py-2 last:border-0">
                  <p className="text-sm font-semibold text-slate-800">{action.title}</p>
                  <p className="text-xs text-red-600">Deadline {formatDate(action.due_date)}</p>
                </div>
              ))}
            </Card>
            <Card className="p-4">
              <h2 className="font-bold text-slate-800 mb-3">Parkerade frågor</h2>
              {parkedRows.length === 0 ? <EmptyMini text="Inga parkerade frågor i valt möte" /> : parkedRows.map(row => (
                <p key={row.id} className="border-b border-slate-100 py-2 text-sm text-slate-700 last:border-0">{row.content}</p>
              ))}
            </Card>
            <Card className="p-4">
              <h2 className="font-bold text-slate-800 mb-3">AI-förslag som väntar</h2>
              {aiSuggestions.length === 0 ? <EmptyMini text="Inga AI-förslag väntar på godkännande" /> : aiSuggestions.map(suggestion => (
                <div key={suggestion.id} className="border-b border-slate-100 py-2 last:border-0">
                  <p className="text-sm font-semibold text-slate-800">{suggestion.payload?.title || suggestion.suggestion_type}</p>
                  <p className="text-xs text-slate-500">{suggestion.payload?.reason || 'Väntar på granskning'}</p>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}

      {tab === 'meetings' && (
        <div className="grid grid-cols-1 xl:grid-cols-[20rem_minmax(0,1fr)] gap-4">
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">Möten</h2>
            </div>
            <div className="divide-y divide-slate-100 max-h-[42rem] overflow-y-auto">
              {meetings.length === 0 ? <EmptyState icon={<CalendarDays className="w-10 h-10" />} title="Inga möten" /> : meetings.map(meeting => (
                <button
                  key={meeting.id}
                  onClick={() => setSelectedMeeting(meeting)}
                  className={`w-full text-left p-4 hover:bg-slate-50 ${selectedMeeting?.id === meeting.id ? 'bg-blue-50' : ''}`}
                >
                  <p className="text-sm font-bold text-slate-800">{meeting.title}</p>
                  <p className="text-xs text-slate-500 mt-1">{meeting.starts_at ? formatDateTime(meeting.starts_at) : 'Inget datum'}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge className={statusClasses[(meeting.status as MeetingStatus) || 'draft']}>{statusLabels[(meeting.status as MeetingStatus) || 'draft']}</Badge>
                    <Badge className="bg-slate-100 text-slate-600">{meetingTypeLabels[meeting.meeting_type] || meeting.meeting_type}</Badge>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {selectedMeeting ? (
            <MeetingDetail
              meeting={selectedMeeting}
              agendaItems={agendaItems}
              selectedAgenda={selectedAgenda}
              setSelectedAgendaId={setSelectedAgendaId}
              protocolRows={protocolRows}
              decisions={decisions}
              actionItems={actionItems}
              staff={staff}
              systemLinks={systemLinks}
              protocolForm={protocolForm}
              setProtocolForm={setProtocolForm}
              decisionForm={decisionForm}
              setDecisionForm={setDecisionForm}
              actionForm={actionForm}
              setActionForm={setActionForm}
              canManage={canManage}
              onAddProtocol={addProtocolRow}
              onAddDecision={addDecision}
              onAddAction={addActionItem}
              onStatus={updateMeetingStatus}
              onLock={lockMeeting}
              onAi={runMeetingAiAnalysis}
              aiAnalysis={meetingAiAnalysis}
              aiLoading={meetingAiLoading}
              aiError={meetingAiError}
              aiApplied={meetingAiApplied}
              aiApplying={meetingAiApplying}
              onAiCreateTask={applyAiCreateTask}
              onAiUpdateTask={applyAiUpdateTask}
              onAiAddPurchaseItem={applyAiPurchaseItem}
              onAiCreateWorkOrder={applyAiCreateWorkOrder}
              onActionDone={markActionDone}
              onAgendaStatus={updateAgendaStatus}
            />
          ) : (
            <Card>
              <EmptyState icon={<MessageSquareText className="w-12 h-12" />} title="Välj ett möte" description="Öppna ett möte för att se dagordning, protokoll och uppföljning." />
            </Card>
          )}
        </div>
      )}

      {tab === 'templates' && (
        <div className="space-y-4">
          {canManage && <Button onClick={() => openTemplateModal()}><Plus className="w-4 h-4" /> Ny mall</Button>}
          {templates.length === 0 ? (
            <Card><EmptyState icon={<FileText className="w-12 h-12" />} title="Inga mötesmallar" /></Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {templates.map(template => (
                <Card key={template.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-bold text-slate-800">{template.name}</h2>
                      <p className="text-sm text-slate-500 mt-1">{template.description}</p>
                    </div>
                    {canManage && (
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openTemplateModal(template)}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteTemplate(template)} className="text-red-600"><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 space-y-1">
                    {agendaFromTemplate(template).map((title, index) => (
                      <p key={`${template.id}-${index}`} className="text-sm text-slate-600">{index + 1}. {title}</p>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'ai' && (
        <Card className="p-4">
          <h2 className="text-lg font-bold text-slate-800">AI-granskning</h2>
          <p className="text-sm text-slate-500 mt-1">AI-förslag visas här och måste granskas innan de kan ändra systemdata.</p>
          <div className="mt-4 space-y-3">
            {aiSuggestions.length === 0 ? <EmptyMini text="Inga väntande AI-förslag" /> : aiSuggestions.map(suggestion => (
              <div key={suggestion.id} className="rounded-lg border border-slate-200 p-3">
                <Badge className="bg-amber-100 text-amber-700">Väntar</Badge>
                <h3 className="mt-2 font-semibold text-slate-800">{suggestion.payload?.title || suggestion.suggestion_type}</h3>
                <p className="text-sm text-slate-500">{suggestion.payload?.reason || 'Förslag från mötesanalys.'}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal open={showMeetingModal} onClose={() => setShowMeetingModal(false)} title="Nytt möte" size="lg">
        <div className="space-y-4">
          {saveError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</div>}
          <Input label="Titel" value={meetingForm.title} onChange={event => setMeetingForm({ ...meetingForm, title: event.target.value })} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Datum och tid" type="datetime-local" value={meetingForm.starts_at} onChange={event => setMeetingForm({ ...meetingForm, starts_at: event.target.value })} />
            <Select label="Mötestyp" value={meetingForm.meeting_type} onChange={event => setMeetingForm({ ...meetingForm, meeting_type: event.target.value })} options={meetingTypeOptions} />
          </div>
          <Select label="Mall" value={meetingForm.template_id} onChange={event => setMeetingForm({ ...meetingForm, template_id: event.target.value })} options={[{ value: '', label: 'Ingen mall' }, ...templates.map(template => ({ value: template.id, label: template.name }))]} />
          <Textarea label="Syfte/beskrivning" rows={3} value={meetingForm.description} onChange={event => setMeetingForm({ ...meetingForm, description: event.target.value })} />
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Deltagare</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {staff.map(profile => (
                <label key={profile.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={meetingForm.participant_ids.includes(profile.id)}
                    onChange={event => setMeetingForm(current => ({
                      ...current,
                      participant_ids: event.target.checked
                        ? [...current.participant_ids, profile.id]
                        : current.participant_ids.filter(id => id !== profile.id),
                    }))}
                  />
                  {profile.name}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={meetingForm.generate_agenda} onChange={event => setMeetingForm({ ...meetingForm, generate_agenda: event.target.checked })} />
            Generera dagordning från öppna arbetsorder, felanmälningar, kundprojekt och tidigare möten
          </label>
          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowMeetingModal(false)} className="flex-1">Avbryt</Button>
            <Button onClick={handleCreateMeeting} loading={saving} className="flex-1">Skapa möte</Button>
          </div>
        </div>
      </Modal>

      <Modal open={showTemplateModal} onClose={() => setShowTemplateModal(false)} title={editingTemplate ? 'Redigera mall' : 'Ny mötesmall'} size="lg">
        <div className="space-y-4">
          {saveError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</div>}
          <Input label="Namn" value={templateForm.name} onChange={event => setTemplateForm({ ...templateForm, name: event.target.value })} />
          <Textarea label="Beskrivning" rows={2} value={templateForm.description} onChange={event => setTemplateForm({ ...templateForm, description: event.target.value })} />
          <Textarea label="Dagordningspunkter, en per rad" rows={12} value={templateForm.agendaText} onChange={event => setTemplateForm({ ...templateForm, agendaText: event.target.value })} />
          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowTemplateModal(false)} className="flex-1">Avbryt</Button>
            <Button onClick={handleSaveTemplate} className="flex-1">Spara mall</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

const meetingAiPriorityLabels: Record<string, string> = { low: 'Låg', normal: 'Normal', high: 'Hög', urgent: 'Akut' };
const meetingAiStatusLabels: Record<string, string> = { open: 'Öppen', in_progress: 'Pågår', done: 'Klar', cancelled: 'Avbruten' };

function MeetingAiAnalysisPanel({
  analysis, loading, error, actionItems, applied, applying,
  onCreateTask, onUpdateTask, onAddPurchaseItem, onCreateWorkOrder,
}: {
  analysis: MeetingAiAnalysis | null; loading: boolean; error: string; actionItems: MeetingActionItem[];
  applied: Set<string>; applying: Set<string>;
  onCreateTask: (item: MeetingAiTaskToCreate, key: string) => void;
  onUpdateTask: (item: MeetingAiTaskToUpdate, key: string) => void;
  onAddPurchaseItem: (item: MeetingAiPurchaseItem, key: string) => void;
  onCreateWorkOrder: (item: MeetingAiWorkOrder, key: string) => void;
}) {
  const knownActionIds = useMemo(() => new Set(actionItems.map(item => item.id)), [actionItems]);

  return (
    <Card className="p-4 border-blue-100 bg-blue-50/60">
      <div className="flex items-start gap-3">
        <div className="mt-1 rounded-xl bg-blue-600 p-2 text-white">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h3 className="font-bold text-slate-900">AI-sammanfattning</h3>
            <p className="text-xs text-slate-500">Förslag skapas för granskning -- inget skapas eller ändras förrän du klickar.</p>
          </div>
          {loading && <p className="text-sm text-slate-600">Analyserar protokoll, dagordning och kopplade objekt...</p>}
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {analysis?.summary && <p className="text-sm leading-6 text-slate-700">{analysis.summary}</p>}
          {analysis?.warnings?.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-bold uppercase text-amber-700">Kontrollera</p>
              <ul className="mt-1 space-y-1 text-sm text-amber-800">
                {analysis.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
              </ul>
            </div>
          ) : null}

          {(analysis?.tasks_to_create?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-white bg-white p-3 shadow-sm">
              <p className="text-sm font-bold text-slate-800">Nya uppgifter</p>
              <div className="mt-2 space-y-2">
                {analysis!.tasks_to_create!.map((item, index) => {
                  const key = `task-create-${index}`;
                  const isApplied = applied.has(key);
                  const isApplying = applying.has(key);
                  return (
                    <div key={key} className="rounded-lg bg-slate-50 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                          {item.description && <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>}
                          <p className="mt-1 text-xs text-slate-400">{item.reason}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge className="bg-slate-100 text-slate-600">{meetingAiPriorityLabels[item.priority] || item.priority}</Badge>
                            {item.due_date && <Badge className="bg-slate-100 text-slate-600">{item.due_date}</Badge>}
                            {formatConfidence(item.confidence) && <Badge className="bg-blue-100 text-blue-700">{formatConfidence(item.confidence)}</Badge>}
                          </div>
                        </div>
                        <Button size="sm" variant={isApplied ? 'secondary' : 'primary'} disabled={isApplied || isApplying} onClick={() => onCreateTask(item, key)}>
                          {isApplied ? 'Skapad' : isApplying ? 'Skapar...' : 'Skapa uppgift'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(analysis?.tasks_to_update?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-white bg-white p-3 shadow-sm">
              <p className="text-sm font-bold text-slate-800">Ändra befintliga uppgifter</p>
              <div className="mt-2 space-y-2">
                {analysis!.tasks_to_update!.map((item, index) => {
                  const key = `task-update-${index}`;
                  const isApplied = applied.has(key);
                  const isApplying = applying.has(key);
                  const targetKnown = !!item.action_item_id && knownActionIds.has(item.action_item_id);
                  const hasChange = !!(item.new_status || item.new_priority);
                  const canApply = targetKnown && hasChange;
                  return (
                    <div key={key} className="rounded-lg bg-slate-50 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{item.action_item_title_hint}</p>
                          <p className="mt-1 text-xs text-slate-400">{item.reason}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {item.new_status && <Badge className="bg-slate-100 text-slate-600">Ny status: {meetingAiStatusLabels[item.new_status] || item.new_status}</Badge>}
                            {item.new_priority && <Badge className="bg-slate-100 text-slate-600">Ny prioritet: {meetingAiPriorityLabels[item.new_priority] || item.new_priority}</Badge>}
                            {formatConfidence(item.confidence) && <Badge className="bg-blue-100 text-blue-700">{formatConfidence(item.confidence)}</Badge>}
                          </div>
                          {!targetKnown && <p className="mt-1 text-xs text-amber-600">Kunde inte matcha till en befintlig uppgift -- justera manuellt.</p>}
                        </div>
                        <Button size="sm" variant={isApplied ? 'secondary' : 'primary'} disabled={!canApply || isApplied || isApplying} onClick={() => onUpdateTask(item, key)}>
                          {isApplied ? 'Uppdaterad' : isApplying ? 'Sparar...' : 'Applicera'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(analysis?.purchase_items?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-white bg-white p-3 shadow-sm">
              <p className="text-sm font-bold text-slate-800">Inköpslista</p>
              <div className="mt-2 space-y-2">
                {analysis!.purchase_items!.map((item, index) => {
                  const key = `purchase-${index}`;
                  const isApplied = applied.has(key);
                  const isApplying = applying.has(key);
                  return (
                    <div key={key} className="rounded-lg bg-slate-50 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{item.item_name}{item.quantity ? ` (${item.quantity})` : ''}</p>
                          {item.notes && <p className="mt-0.5 text-xs text-slate-500">{item.notes}</p>}
                          <p className="mt-1 text-xs text-slate-400">{item.reason}</p>
                        </div>
                        <Button size="sm" variant={isApplied ? 'secondary' : 'primary'} disabled={isApplied || isApplying} onClick={() => onAddPurchaseItem(item, key)}>
                          {isApplied ? 'Tillagd' : isApplying ? 'Lägger till...' : 'Lägg till'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(analysis?.work_orders_to_create?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-white bg-white p-3 shadow-sm">
              <p className="text-sm font-bold text-slate-800">Nya arbetsordrar</p>
              <div className="mt-2 space-y-2">
                {analysis!.work_orders_to_create!.map((item, index) => {
                  const key = `wo-create-${index}`;
                  const isApplied = applied.has(key);
                  const isApplying = applying.has(key);
                  return (
                    <div key={key} className="rounded-lg bg-slate-50 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                          {item.description && <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>}
                          <p className="mt-1 text-xs text-slate-400">{item.reason}</p>
                          <Badge className="mt-1 bg-slate-100 text-slate-600">{meetingAiPriorityLabels[item.priority] || item.priority}</Badge>
                        </div>
                        <Button size="sm" variant={isApplied ? 'secondary' : 'primary'} disabled={isApplied || isApplying} onClick={() => onCreateWorkOrder(item, key)}>
                          {isApplied ? 'Skapad' : isApplying ? 'Skapar...' : 'Skapa arbetsorder'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(analysis?.review_flags?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-white bg-white p-3 shadow-sm">
              <p className="text-sm font-bold text-slate-800">Övrigt att titta på</p>
              <div className="mt-2 space-y-2">
                {analysis!.review_flags!.map((item, index) => (
                  <div key={index} className="rounded-lg bg-slate-50 p-2">
                    <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{item.detail}</p>
                    <p className="mt-1 text-xs text-slate-400">{item.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {analysis?.model && (
            <p className="text-xs text-slate-400">
              Modell: {analysis.model}
              {typeof analysis.estimated_cost_sek === 'number' ? ` · ca ${analysis.estimated_cost_sek.toFixed(4)} kr` : ''}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function MeetingDetail(props: {
  meeting: Meeting;
  agendaItems: MeetingAgendaItemMvp[];
  selectedAgenda: MeetingAgendaItemMvp | null;
  setSelectedAgendaId: (id: string) => void;
  protocolRows: ProtocolRow[];
  decisions: MeetingDecision[];
  actionItems: MeetingActionItem[];
  staff: Profile[];
  systemLinks: SystemLink[];
  protocolForm: ProtocolForm;
  setProtocolForm: (form: ProtocolForm) => void;
  decisionForm: DecisionForm;
  setDecisionForm: (form: DecisionForm) => void;
  actionForm: ActionForm;
  setActionForm: (form: ActionForm) => void;
  canManage: boolean;
  onAddProtocol: () => void;
  onAddDecision: () => void;
  onAddAction: () => void;
  onStatus: (status: MeetingStatus) => void;
  onLock: () => void;
  onAi: () => void | Promise<void>;
  aiAnalysis: MeetingAiAnalysis | null;
  aiLoading: boolean;
  aiError: string;
  aiApplied: Set<string>;
  aiApplying: Set<string>;
  onAiCreateTask: (item: MeetingAiTaskToCreate, key: string) => void;
  onAiUpdateTask: (item: MeetingAiTaskToUpdate, key: string) => void;
  onAiAddPurchaseItem: (item: MeetingAiPurchaseItem, key: string) => void;
  onAiCreateWorkOrder: (item: MeetingAiWorkOrder, key: string) => void;
  onActionDone: (action: MeetingActionItem) => void;
  onAgendaStatus: (item: MeetingAgendaItemMvp, status: 'open' | 'done') => void;
}) {
  const { meeting, selectedAgenda } = props;
  const participantCount = ((meeting as any).participant_ids || []).length;
  const selectedSystemLinks = props.systemLinks.filter(link => {
    if (!selectedAgenda?.linked_entity_type || !selectedAgenda.linked_entity_id) return true;
    return link.type === selectedAgenda.linked_entity_type && link.id === selectedAgenda.linked_entity_id;
  }).slice(0, 12);
  const entityOpts = entityOptions(props.systemLinks);

  const setProtocolEntity = (value: string) => {
    const entity = splitEntity(value);
    props.setProtocolForm({ ...props.protocolForm, linked_entity_type: entity.type, linked_entity_id: entity.id });
  };
  const setDecisionEntity = (value: string) => {
    const entity = splitEntity(value);
    props.setDecisionForm({ ...props.decisionForm, linked_entity_type: entity.type, linked_entity_id: entity.id });
  };
  const setActionEntity = (value: string) => {
    const entity = splitEntity(value);
    props.setActionForm({ ...props.actionForm, linked_entity_type: entity.type, linked_entity_id: entity.id });
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">{meeting.title}</h2>
              <Badge className={statusClasses[(meeting.status as MeetingStatus) || 'draft']}>{statusLabels[(meeting.status as MeetingStatus) || 'draft']}</Badge>
              {(meeting as any).locked_at && meeting.status !== 'locked' && <Badge className="bg-slate-900 text-white"><Lock className="w-3 h-3" /> Låst</Badge>}
            </div>
            <p className="text-sm text-slate-500 mt-1">{meeting.starts_at ? formatDateTime(meeting.starts_at) : 'Inget datum'} · {meetingTypeLabels[meeting.meeting_type] || meeting.meeting_type} · {participantCount} deltagare</p>
          </div>
          {props.canManage && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => props.onStatus('in_progress')}>Starta</Button>
              <Button size="sm" variant="outline" onClick={() => props.onStatus('completed')}>Avsluta</Button>
              <Button size="sm" variant="secondary" onClick={props.onLock}><Lock className="w-4 h-4" /> Lås</Button>
              <Button size="sm" variant="secondary" onClick={props.onAi} disabled={props.aiLoading}>
                <Sparkles className="w-4 h-4" /> {props.aiLoading ? 'Analyserar...' : 'Analysera med AI'}
              </Button>
            </div>
          )}
        </div>
      </Card>

      {(props.aiAnalysis || props.aiError || props.aiLoading) && (
        <MeetingAiAnalysisPanel
          analysis={props.aiAnalysis}
          loading={props.aiLoading}
          error={props.aiError}
          actionItems={props.actionItems}
          applied={props.aiApplied}
          applying={props.aiApplying}
          onCreateTask={props.onAiCreateTask}
          onUpdateTask={props.onAiUpdateTask}
          onAddPurchaseItem={props.onAiAddPurchaseItem}
          onCreateWorkOrder={props.onAiCreateWorkOrder}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[17rem_minmax(0,1fr)_18rem] gap-4">
        <Card className="overflow-hidden">
          <div className="p-3 border-b border-slate-100 bg-slate-50">
            <h3 className="font-bold text-slate-800">Dagordning</h3>
          </div>
          <div className="divide-y divide-slate-100 max-h-[44rem] overflow-y-auto">
            {props.agendaItems.map((item, index) => {
              const isDone = item.status === 'done';
              return (
                <div key={item.id} className={`grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 p-2 ${selectedAgenda?.id === item.id ? 'bg-blue-50' : ''} ${isDone ? 'opacity-60' : ''}`}>
                  {props.canManage ? (
                    <button
                      type="button"
                      onClick={() => props.onAgendaStatus(item, isDone ? 'open' : 'done')}
                      className={`mt-1 flex h-7 w-7 items-center justify-center rounded-full border ${isDone ? 'border-emerald-200 bg-emerald-100 text-emerald-700' : 'border-slate-200 bg-white text-slate-400 hover:text-emerald-600'}`}
                      aria-label={isDone ? 'Markera punkten som öppen' : 'Markera punkten som klar'}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                  ) : (
                    <span className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-400">{index + 1}</span>
                  )}
                  <button type="button" onClick={() => props.setSelectedAgendaId(item.id)} className="min-w-0 rounded-lg px-2 py-1 text-left hover:bg-slate-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-slate-400">{index + 1}</p>
                        <p className={`text-sm font-semibold ${isDone ? 'text-slate-500 line-through' : 'text-slate-800'}`}>{item.title}</p>
                      </div>
                      {isDone && <Badge className="bg-emerald-100 text-emerald-700">Klar</Badge>}
                    </div>
                    {item.notes && <p className="mt-1 text-xs text-slate-500">{item.notes}</p>}
                    {item.linked_entity_type && <Badge className="mt-2 bg-slate-100 text-slate-600"><LinkIcon className="w-3 h-3" /> Kopplad</Badge>}
                  </button>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="font-bold text-slate-800">Protokoll</h3>
            <p className="text-sm text-slate-500">{selectedAgenda?.title || 'Välj dagordningspunkt'}</p>
            <div className="mt-4 space-y-3">
              {props.protocolRows.filter(row => !selectedAgenda || row.agenda_item_id === selectedAgenda.id).map(row => (
                <div key={row.id} className="rounded-lg border border-slate-200 p-3">
                  <Badge className="bg-slate-100 text-slate-700">{protocolTypeLabels[row.row_type]}</Badge>
                  <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{row.content}</p>
                  <p className="mt-2 text-xs text-slate-400">{formatDateTime(row.created_at)}</p>
                </div>
              ))}
            </div>
            {props.canManage && (
              <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Select label="Typ" value={props.protocolForm.row_type} onChange={event => props.setProtocolForm({ ...props.protocolForm, row_type: event.target.value as ProtocolRowType })} options={protocolTypeOptions} />
                  <Select label="Koppla till" value={props.protocolForm.linked_entity_type ? `${props.protocolForm.linked_entity_type}:${props.protocolForm.linked_entity_id}` : ''} onChange={event => setProtocolEntity(event.target.value)} options={entityOpts} />
                </div>
                <Textarea label="Protokollrad" rows={3} value={props.protocolForm.content} onChange={event => props.setProtocolForm({ ...props.protocolForm, content: event.target.value })} />
                <Button size="sm" onClick={props.onAddProtocol}><Save className="w-4 h-4" /> Lägg till rad</Button>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4">
              <h3 className="font-bold text-slate-800">Beslut</h3>
              <div className="mt-3 space-y-2">
                {props.decisions.map(decision => <FollowUpRow key={decision.id} title={decision.title} status={decision.status} due={decision.due_date} />)}
              </div>
              {props.canManage && (
                <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                  <Input label="Beslut" value={props.decisionForm.title} onChange={event => props.setDecisionForm({ ...props.decisionForm, title: event.target.value })} />
                  <Textarea label="Beskrivning" rows={2} value={props.decisionForm.description} onChange={event => props.setDecisionForm({ ...props.decisionForm, description: event.target.value })} />
                  <Select label="Ansvarig" value={props.decisionForm.responsible_user_id} onChange={event => props.setDecisionForm({ ...props.decisionForm, responsible_user_id: event.target.value })} options={[{ value: '', label: 'Ingen' }, ...props.staff.map(profile => ({ value: profile.id, label: profile.name }))]} />
                  <Input label="Deadline" type="date" value={props.decisionForm.due_date} onChange={event => props.setDecisionForm({ ...props.decisionForm, due_date: event.target.value })} />
                  <Select label="Koppla till" value={props.decisionForm.linked_entity_type ? `${props.decisionForm.linked_entity_type}:${props.decisionForm.linked_entity_id}` : ''} onChange={event => setDecisionEntity(event.target.value)} options={entityOpts} />
                  <Button size="sm" onClick={props.onAddDecision}>Skapa beslut</Button>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="font-bold text-slate-800">Att göra</h3>
              <div className="mt-3 space-y-2">
                {props.actionItems.map(action => (
                  <div key={action.id} className="rounded-lg border border-slate-200 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <FollowUpRow title={action.title} status={action.status} due={action.due_date} />
                      {action.status !== 'done' && <Button size="sm" variant="ghost" onClick={() => props.onActionDone(action)}><CheckCircle2 className="w-4 h-4" /></Button>}
                    </div>
                  </div>
                ))}
              </div>
              {props.canManage && (
                <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                  <Input label="Uppgift" value={props.actionForm.title} onChange={event => props.setActionForm({ ...props.actionForm, title: event.target.value })} />
                  <Textarea label="Beskrivning" rows={2} value={props.actionForm.description} onChange={event => props.setActionForm({ ...props.actionForm, description: event.target.value })} />
                  <Select label="Ansvarig" value={props.actionForm.responsible_user_id} onChange={event => props.setActionForm({ ...props.actionForm, responsible_user_id: event.target.value })} options={[{ value: '', label: 'Ingen' }, ...props.staff.map(profile => ({ value: profile.id, label: profile.name }))]} />
                  <Select label="Prioritet" value={props.actionForm.priority} onChange={event => props.setActionForm({ ...props.actionForm, priority: event.target.value as ActionForm['priority'] })} options={priorityOptions} />
                  <Input label="Deadline" type="date" value={props.actionForm.due_date} onChange={event => props.setActionForm({ ...props.actionForm, due_date: event.target.value })} />
                  <Select label="Koppla till" value={props.actionForm.linked_entity_type ? `${props.actionForm.linked_entity_type}:${props.actionForm.linked_entity_id}` : ''} onChange={event => setActionEntity(event.target.value)} options={entityOpts} />
                  <Button size="sm" onClick={props.onAddAction}>Skapa uppgift</Button>
                </div>
              )}
            </Card>
          </div>
        </div>

        <Card className="overflow-hidden">
          <div className="p-3 border-b border-slate-100 bg-slate-50">
            <h3 className="font-bold text-slate-800">Systemdata</h3>
            <p className="text-xs text-slate-500">Relevanta kopplingar till vald punkt</p>
          </div>
          <div className="p-3 space-y-2 max-h-[44rem] overflow-y-auto">
            {selectedSystemLinks.map(link => (
              <div key={`${link.type}-${link.id}`} className="rounded-lg border border-slate-200 p-3">
                <Badge className="bg-blue-100 text-blue-700">{link.subtitle}</Badge>
                <p className="mt-2 text-sm font-semibold text-slate-800">{link.title}</p>
                <p className="text-xs text-slate-500">{link.status}{link.due_date ? ` · ${formatDate(link.due_date)}` : ''}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </Card>
  );
}

function EmptyMini({ text }: { text: string }) {
  return <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">{text}</p>;
}

function MeetingListItem({ meeting, onClick }: { meeting: Meeting; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full border-b border-slate-100 py-3 text-left last:border-0">
      <p className="text-sm font-semibold text-slate-800">{meeting.title}</p>
      <p className="text-xs text-slate-500">{meeting.starts_at ? formatDateTime(meeting.starts_at) : 'Inget datum'}</p>
    </button>
  );
}

function FollowUpRow({ title, status, due }: { title: string; status: string; due?: string | null }) {
  const overdue = due && new Date(`${due}T23:59:59`).getTime() < Date.now() && status !== 'done';
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-800 break-words">{title}</p>
      <p className={`text-xs ${overdue ? 'text-red-600' : 'text-slate-500'}`}>{status}{due ? ` · ${formatDate(due)}` : ''}</p>
    </div>
  );
}
