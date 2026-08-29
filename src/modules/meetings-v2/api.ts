// Möten V2 -- datalager. Enda stället i frontend som pratar direkt med
// vihem_meeting_*-tabellerna, vihem_meeting_object_links (aktiveras här för
// första gången) och vihem_ai_suggestions för V2-vyn. Legacy
// (src/pages/MeetingsPage.tsx) har sin egen inline-logik och rörs inte --
// dubbleringen är avsiktlig, se planen för varför.
import { supabase } from '../../lib/supabase';
import type {
  MaintenanceRequest, MeetingActionItem, MeetingAgendaItem, MeetingDecision, MeetingTemplate, Profile, WorkOrder,
} from '../../types';
import type {
  MeetingAiAnalysis, MeetingAiSuggestionRow, MeetingObjectLink, MeetingObjectLinkEntityType, MeetingV2, QuickPurchaseForm, SystemLinkOption,
} from './types';

function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return 'Något gick fel.';
}

// ── Möten ──────────────────────────────────────────────────────────────

export async function fetchMeetingsV2(organisationId: string, includeLegacy: boolean): Promise<MeetingV2[]> {
  let query = supabase.from('vihem_meetings').select('*').eq('organisation_id', organisationId).order('starts_at', { ascending: false });
  if (!includeLegacy) query = query.eq('metadata->>v2', 'true');
  const { data, error } = await query;
  if (error) throw new Error(describeError(error));
  return (data || []) as MeetingV2[];
}

export async function createMeetingV2(params: {
  organisationId: string; userId: string; title: string; description: string; meetingType: string; templateId: string | null;
  startsAt: string; participantIds: string[]; previousMeetingId: string | null;
}): Promise<MeetingV2> {
  const { data, error } = await supabase.from('vihem_meetings').insert({
    organisation_id: params.organisationId,
    title: params.title,
    description: params.description,
    meeting_type: params.meetingType,
    template_id: params.templateId,
    starts_at: params.startsAt,
    status: 'draft',
    created_by: params.userId,
    participant_ids: params.participantIds,
    previous_meeting_id: params.previousMeetingId,
    metadata: { v2: true },
  }).select('*').single();
  if (error) throw new Error(describeError(error));
  return data as MeetingV2;
}

export async function updateMeetingStatus(meetingId: string, status: string): Promise<void> {
  const payload: Record<string, unknown> = { status };
  if (status === 'completed' || status === 'cancelled') payload.ends_at = new Date().toISOString();
  const { error } = await supabase.from('vihem_meetings').update(payload).eq('id', meetingId);
  if (error) throw new Error(describeError(error));
}

export async function lockMeeting(meetingId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('vihem_meetings').update({ status: 'locked', locked_at: new Date().toISOString(), locked_by: userId }).eq('id', meetingId);
  if (error) throw new Error(describeError(error));
}

// ── Stödlistor (personal, mallar, systemobjekt för dagordning/länkning) ──

export async function fetchStaff(organisationId: string): Promise<Profile[]> {
  const { data, error } = await supabase.from('vihem_profiles').select('*').eq('organisation_id', organisationId).in('role', ['staff', 'admin']).eq('active', true).order('name');
  if (error) throw new Error(describeError(error));
  return (data || []) as Profile[];
}

export async function fetchTemplates(organisationId: string): Promise<MeetingTemplate[]> {
  const { data, error } = await supabase.from('vihem_meeting_templates').select('*').eq('organisation_id', organisationId).order('name');
  if (error) throw new Error(describeError(error));
  return (data || []) as MeetingTemplate[];
}

type CustomerProjectLite = { id: string; title?: string; name?: string; customer_name?: string; status?: string; updated_at?: string };

export async function fetchSystemEntities(organisationId: string): Promise<{ workOrders: WorkOrder[]; maintenanceRequests: MaintenanceRequest[]; customerProjects: CustomerProjectLite[] }> {
  const [woRes, mrRes, projectsRes] = await Promise.all([
    supabase.from('vihem_work_orders').select('*').eq('organisation_id', organisationId).not('status', 'in', '(completed,cancelled)').order('due_date', { ascending: true, nullsFirst: true }).limit(60),
    supabase.from('vihem_maintenance_requests').select('*').eq('organisation_id', organisationId).not('status', 'in', '(done,closed)').order('created_at', { ascending: false }).limit(60),
    supabase.from('vihem_customer_projects').select('id,title,name,customer_name,status,updated_at').eq('organisation_id', organisationId).not('status', 'in', '(archived,completed,cancelled)').order('updated_at', { ascending: false }).limit(60),
  ]);
  if (woRes.error) throw new Error(describeError(woRes.error));
  if (mrRes.error) throw new Error(describeError(mrRes.error));
  if (projectsRes.error) throw new Error(describeError(projectsRes.error));
  return {
    workOrders: (woRes.data || []) as WorkOrder[],
    maintenanceRequests: (mrRes.data || []) as MaintenanceRequest[],
    customerProjects: (projectsRes.data || []) as CustomerProjectLite[],
  };
}

export function projectTitle(project: CustomerProjectLite): string {
  return project.title || project.name || project.customer_name || 'Kundprojekt';
}

export function buildSystemLinkOptions(workOrders: WorkOrder[], maintenanceRequests: MaintenanceRequest[], customerProjects: CustomerProjectLite[]): SystemLinkOption[] {
  return [
    ...workOrders.map((order) => ({ id: order.id, type: 'work_order' as const, title: order.title, subtitle: 'Arbetsorder', status: order.status, priority: order.priority, due_date: order.due_date })),
    ...maintenanceRequests.map((request) => ({ id: request.id, type: 'maintenance_request' as const, title: request.title, subtitle: 'Felanmälan', status: request.status, priority: request.priority, due_date: null })),
    ...customerProjects.map((project) => ({ id: project.id, type: 'customer_project' as const, title: projectTitle(project), subtitle: 'Kundprojekt', status: project.status, due_date: null })),
  ];
}

// ── Dagordning, beslut, uppgifter ──────────────────────────────────────

export async function fetchMeetingDetail(meetingId: string): Promise<{
  agendaItems: MeetingAgendaItem[]; decisions: MeetingDecision[]; actionItems: MeetingActionItem[]; objectLinks: MeetingObjectLink[];
}> {
  const [agendaRes, decisionsRes, actionsRes, linksRes] = await Promise.all([
    supabase.from('vihem_meeting_agenda_items').select('*').eq('meeting_id', meetingId).order('sort_order'),
    supabase.from('vihem_meeting_decisions').select('*').eq('meeting_id', meetingId).order('created_at'),
    supabase.from('vihem_meeting_action_items').select('*').eq('meeting_id', meetingId).order('due_date', { ascending: true, nullsFirst: false }),
    supabase.from('vihem_meeting_object_links').select('*').eq('meeting_id', meetingId).order('created_at'),
  ]);
  if (agendaRes.error) throw new Error(describeError(agendaRes.error));
  if (decisionsRes.error) throw new Error(describeError(decisionsRes.error));
  if (actionsRes.error) throw new Error(describeError(actionsRes.error));
  if (linksRes.error) throw new Error(describeError(linksRes.error));
  return {
    agendaItems: (agendaRes.data || []) as MeetingAgendaItem[],
    decisions: (decisionsRes.data || []) as MeetingDecision[],
    actionItems: (actionsRes.data || []) as MeetingActionItem[],
    objectLinks: (linksRes.data || []) as MeetingObjectLink[],
  };
}

export async function createAgendaItems(organisationId: string, meetingId: string, rows: { title: string; notes: string; item_type: string; sort_order: number }[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await supabase.from('vihem_meeting_agenda_items').insert(rows.map((row) => ({ ...row, organisation_id: organisationId, meeting_id: meetingId })));
  if (error) throw new Error(describeError(error));
}

export async function updateAgendaNotes(agendaItemId: string, notes: string): Promise<void> {
  const { error } = await supabase.from('vihem_meeting_agenda_items').update({ notes, updated_at: new Date().toISOString() }).eq('id', agendaItemId);
  if (error) throw new Error(describeError(error));
}

export async function updateAgendaStatus(agendaItemId: string, status: 'open' | 'done'): Promise<void> {
  const { error } = await supabase.from('vihem_meeting_agenda_items').update({ status, updated_at: new Date().toISOString() }).eq('id', agendaItemId);
  if (error) throw new Error(describeError(error));
}

export async function createDecision(params: { organisationId: string; meetingId: string; title: string; description: string; responsibleUserId: string | null; dueDate: string | null }): Promise<void> {
  const { error } = await supabase.from('vihem_meeting_decisions').insert({
    organisation_id: params.organisationId, meeting_id: params.meetingId, title: params.title, description: params.description,
    responsible_user_id: params.responsibleUserId, due_date: params.dueDate, status: 'open',
  });
  if (error) throw new Error(describeError(error));
}

export async function createActionItem(params: { organisationId: string; meetingId: string; title: string; description: string; responsibleUserId: string | null; dueDate: string | null; priority: string }): Promise<void> {
  const { error } = await supabase.from('vihem_meeting_action_items').insert({
    organisation_id: params.organisationId, meeting_id: params.meetingId, title: params.title, description: params.description,
    responsible_user_id: params.responsibleUserId, due_date: params.dueDate, priority: params.priority, status: 'open', linked_entity_type: '', linked_entity_id: null,
  });
  if (error) throw new Error(describeError(error));
}

export async function markActionDone(actionId: string): Promise<void> {
  const { error } = await supabase.from('vihem_meeting_action_items').update({ status: 'done' }).eq('id', actionId);
  if (error) throw new Error(describeError(error));
}

// ── Länkade objekt (vihem_meeting_object_links) ────────────────────────

export async function createObjectLink(params: { organisationId: string; meetingId: string; agendaItemId: string; entityType: MeetingObjectLinkEntityType; entityId: string; label: string; userId: string }): Promise<void> {
  const { error } = await supabase.from('vihem_meeting_object_links').insert({
    organisation_id: params.organisationId, meeting_id: params.meetingId, agenda_item_id: params.agendaItemId,
    entity_type: params.entityType, entity_id: params.entityId, label: params.label, created_by: params.userId,
  });
  if (error) throw new Error(describeError(error));
}

export async function deleteObjectLink(linkId: string): Promise<void> {
  const { error } = await supabase.from('vihem_meeting_object_links').delete().eq('id', linkId);
  if (error) throw new Error(describeError(error));
}

// ── Inköpslista (direkt från mötesvyn, oberoende av AI) ────────────────

export async function quickAddPurchaseItem(organisationId: string, userId: string, form: QuickPurchaseForm): Promise<void> {
  const { error } = await supabase.from('vihem_purchase_items').insert({
    organisation_id: organisationId, store_name: form.store_name.trim() || 'Övrigt', item_name: form.item_name.trim(),
    quantity: form.quantity.trim() || '1', notes: form.notes.trim(), priority: 'normal', created_by: userId,
  });
  if (error) throw new Error(describeError(error));
}

// ── AI-analys: köra, hämta senaste (beständighet), applicera förslag ───

export async function runMeetingAiAnalysis(meetingId: string): Promise<MeetingAiAnalysis> {
  const { data, error } = await supabase.functions.invoke('vihem-meeting-ai', { body: { meeting_id: meetingId } });
  if (error) {
    // Non-2xx lämnar `data` null och `error` ett generiskt FunctionsHttpError
    // -- det riktiga {error: "..."}-svaret nås bara via error.context.
    const context = (error as { context?: Response }).context;
    const parsed = context ? await context.clone().json().catch(() => null) : null;
    throw new Error(parsed?.error || describeError(error));
  }
  if (data?.error) throw new Error(data.error);
  return (data?.analysis || {}) as MeetingAiAnalysis;
}

export async function fetchLatestAiSuggestion(meetingId: string): Promise<MeetingAiSuggestionRow | null> {
  const { data, error } = await supabase
    .from('vihem_ai_suggestions')
    .select('id, organisation_id, source_id, status, payload, created_at')
    .eq('source_type', 'meeting')
    .eq('source_id', meetingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(describeError(error));
  if (!data) return null;
  return { id: data.id, organisation_id: data.organisation_id, meeting_id: data.source_id, status: data.status, payload: data.payload || {}, created_at: data.created_at };
}

export async function markSuggestionApplied(suggestionId: string, payload: MeetingAiAnalysis, key: string): Promise<void> {
  const appliedKeys = Array.from(new Set([...(payload.applied_keys || []), key]));
  const { error } = await supabase.from('vihem_ai_suggestions').update({ payload: { ...payload, applied_keys: appliedKeys } }).eq('id', suggestionId);
  if (error) throw new Error(describeError(error));
}

export async function applyAiCreateTask(organisationId: string, meetingId: string, item: { title: string; description: string; priority: string; due_date: string | null }): Promise<void> {
  const { error } = await supabase.from('vihem_meeting_action_items').insert({
    organisation_id: organisationId, meeting_id: meetingId, title: item.title, description: item.description,
    responsible_user_id: null, due_date: item.due_date || null, linked_entity_type: '', linked_entity_id: null, priority: item.priority, status: 'open',
  });
  if (error) throw new Error(describeError(error));
}

export async function applyAiUpdateTask(actionItemId: string, patch: { status?: string; priority?: string }): Promise<void> {
  if (!Object.keys(patch).length) return;
  const { error } = await supabase.from('vihem_meeting_action_items').update(patch).eq('id', actionItemId);
  if (error) throw new Error(describeError(error));
}

export async function applyAiPurchaseItem(organisationId: string, userId: string, item: { item_name: string; quantity: string | null; store_name: string | null; notes: string | null }): Promise<void> {
  const { error } = await supabase.from('vihem_purchase_items').insert({
    organisation_id: organisationId, store_name: item.store_name || 'Övrigt', item_name: item.item_name,
    quantity: item.quantity || '1', notes: item.notes || '', priority: 'normal', created_by: userId,
  });
  if (error) throw new Error(describeError(error));
}

export async function applyAiCreateWorkOrder(organisationId: string, userId: string, item: { title: string; description: string; priority: string }): Promise<string> {
  const { data, error } = await supabase.from('vihem_work_orders').insert({
    organisation_id: organisationId, title: item.title, description: item.description, category: 'Möte', priority: item.priority, status: 'new',
    assigned_to_ids: [], checklist: [], materials: [], attachments: [], created_by: userId,
  }).select('id').single();
  if (error) throw new Error(describeError(error));
  return data.id as string;
}
