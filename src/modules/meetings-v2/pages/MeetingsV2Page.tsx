// Möten V2 -- ny mötestjänst vid sidan om legacy (src/pages/MeetingsPage.tsx,
// orörd). Se planen (composed-kindling-lemur.md) för hela resonemanget.
// Kärnidé: en stor autosparande fritextruta per dagordningspunkt istället
// för välj-punkt-för-att-se-den, klickbara popup-förhandsvisningar för
// länkade arbetsordrar/kundprojekt/felanmälningar, snabbtillägg till
// inköpslistan direkt i vyn, och en AI-analyspanel vars resultat
// (och vilka förslag som redan applicerats) är beständigt sparat --
// inget "kör analysen igen" bara för att man bytte flik.
import { useEffect, useState } from 'react';
import { CalendarDays, ClipboardList, Lock, Plus, Sparkles } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select, Textarea } from '../../../components/ui';
import { formatDate, formatDateTime } from '../../../lib/utils';
import type { MeetingAgendaItem, MeetingDecision, MeetingActionItem } from '../../../types';
import type { MeetingAiAnalysis, MeetingObjectLink, MeetingObjectLinkEntityType, MeetingV2, MeetingV2Form, SystemLinkOption } from '../types';
import * as api from '../api';
import { AgendaItemEditor } from '../components/AgendaItemEditor';
import { EntityPickerCombobox } from '../components/EntityPickerCombobox';
import { EntityPreviewModal } from '../components/EntityPreviewModal';
import { QuickPurchaseAdd } from '../components/QuickPurchaseAdd';
import { AiAnalysisPanel } from '../components/AiAnalysisPanel';

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
const meetingTypeLabels = Object.fromEntries(meetingTypeOptions.map((o) => [o.value, o.label])) as Record<string, string>;

const statusLabels: Record<string, string> = { draft: 'Utkast', planned: 'Planerat', in_progress: 'Pågående', completed: 'Avslutat', locked: 'Låst', cancelled: 'Avbrutet' };
const statusClasses: Record<string, string> = { draft: 'bg-slate-100 text-slate-700', planned: 'bg-blue-100 text-blue-700', in_progress: 'bg-amber-100 text-amber-700', completed: 'bg-green-100 text-green-700', locked: 'bg-slate-900 text-white', cancelled: 'bg-slate-200 text-slate-500' };
const priorityOptions = [{ value: 'low', label: 'Låg' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'Hög' }, { value: 'urgent', label: 'Akut' }];

// datetime-local visar/tar emot lokal tid utan tidszon. new Date().toISOString()
// ger UTC-siffror -- om de matas in här visas de som om de vore lokal tid, och
// blir sedan fel med precis UTC-offset (2h sommartid) när de tolkas tillbaka,
// vilket kan knuffa mötet till fel kalenderdag nära midnatt. Bygg strängen av
// lokala komponenter istället så tur och retur blir korrekt.
function toLocalDatetimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const EMPTY_MEETING_FORM: MeetingV2Form = { title: '', starts_at: toLocalDatetimeInputValue(new Date()), meeting_type: 'weekly_operations', template_id: '', participant_ids: [], description: '', generate_agenda: true };
const EMPTY_DECISION_FORM = { title: '', description: '', responsible_user_id: '', due_date: '' };
const EMPTY_ACTION_FORM = { title: '', description: '', responsible_user_id: '', due_date: '', priority: 'normal' };

export function MeetingsV2Page({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'superadmin';
  const orgId = user?.organisation_id || '';

  const [loading, setLoading] = useState(true);
  const [meetings, setMeetings] = useState<MeetingV2[]>([]);
  const [includeLegacy, setIncludeLegacy] = useState(false);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; agenda: unknown }[]>([]);
  const [systemLinkOptions, setSystemLinkOptions] = useState<SystemLinkOption[]>([]);
  const [rawSystemEntities, setRawSystemEntities] = useState<Awaited<ReturnType<typeof api.fetchSystemEntities>> | null>(null);

  const [selectedMeeting, setSelectedMeeting] = useState<MeetingV2 | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [agendaItems, setAgendaItems] = useState<MeetingAgendaItem[]>([]);
  const [decisions, setDecisions] = useState<MeetingDecision[]>([]);
  const [actionItems, setActionItems] = useState<MeetingActionItem[]>([]);
  const [objectLinks, setObjectLinks] = useState<MeetingObjectLink[]>([]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<MeetingV2Form>(EMPTY_MEETING_FORM);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const [decisionForm, setDecisionForm] = useState(EMPTY_DECISION_FORM);
  const [actionForm, setActionForm] = useState(EMPTY_ACTION_FORM);

  const [linkPickerAgendaId, setLinkPickerAgendaId] = useState<string | null>(null);
  const [previewLink, setPreviewLink] = useState<{ type: MeetingObjectLinkEntityType; id: string } | null>(null);

  const [aiAnalysis, setAiAnalysis] = useState<MeetingAiAnalysis | null>(null);
  const [aiSuggestionId, setAiSuggestionId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiApplied, setAiApplied] = useState<Set<string>>(new Set());
  const [aiApplying, setAiApplying] = useState<Set<string>>(new Set());

  useEffect(() => { loadList(); }, [orgId, includeLegacy]);
  useEffect(() => { if (selectedMeeting) loadDetail(selectedMeeting.id); }, [selectedMeeting?.id]);

  async function loadList() {
    if (!orgId) return;
    setLoading(true);
    try {
      const [meetingsRows, staffRows, templateRows, entities] = await Promise.all([
        api.fetchMeetingsV2(orgId, includeLegacy),
        api.fetchStaff(orgId),
        api.fetchTemplates(orgId),
        api.fetchSystemEntities(orgId),
      ]);
      setMeetings(meetingsRows);
      setStaff(staffRows);
      setTemplates(templateRows);
      setRawSystemEntities(entities);
      setSystemLinkOptions(api.buildSystemLinkOptions(entities.workOrders, entities.maintenanceRequests, entities.customerProjects));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(meetingId: string) {
    setDetailLoading(true);
    setAiAnalysis(null);
    setAiSuggestionId(null);
    setAiError('');
    setAiApplied(new Set());
    try {
      const [detail, suggestion] = await Promise.all([api.fetchMeetingDetail(meetingId), api.fetchLatestAiSuggestion(meetingId)]);
      setAgendaItems(detail.agendaItems);
      setDecisions(detail.decisions);
      setActionItems(detail.actionItems);
      setObjectLinks(detail.objectLinks);
      if (suggestion) {
        setAiAnalysis(suggestion.payload);
        setAiSuggestionId(suggestion.id);
        setAiApplied(new Set(suggestion.payload.applied_keys || []));
      }
    } finally {
      setDetailLoading(false);
    }
  }

  function openCreateModal() {
    setCreateForm({ ...EMPTY_MEETING_FORM, starts_at: toLocalDatetimeInputValue(new Date()) });
    setCreateError('');
    setShowCreateModal(true);
  }

  async function handleCreateMeeting() {
    if (!orgId || !user) return;
    if (!createForm.title.trim()) { setCreateError('Ange mötestitel.'); return; }
    setCreating(true);
    setCreateError('');
    try {
      const previousMeeting = meetings.find((m) => m.meeting_type === createForm.meeting_type && ['completed', 'locked'].includes(m.status)) || null;
      const meeting = await api.createMeetingV2({
        organisationId: orgId, userId: user.id, title: createForm.title.trim(), description: createForm.description.trim(),
        meetingType: createForm.meeting_type, templateId: createForm.template_id || null, startsAt: new Date(createForm.starts_at).toISOString(),
        participantIds: createForm.participant_ids, previousMeetingId: previousMeeting?.id || null,
      });

      const rows: { title: string; notes: string; item_type: string }[] = [];
      const template = templates.find((t) => t.id === createForm.template_id);
      const templateAgenda = Array.isArray(template?.agenda) ? template!.agenda : [];
      templateAgenda.forEach((item: unknown) => {
        const title = typeof item === 'string' ? item : (item as { title?: string })?.title;
        if (title) rows.push({ title, notes: '', item_type: 'template' });
      });
      if (createForm.generate_agenda && rawSystemEntities) {
        if (previousMeeting) rows.unshift({ title: `Uppföljning från ${formatDate(previousMeeting.starts_at || previousMeeting.created_at)}`, notes: 'Beslut, uppgifter och parkerade frågor från föregående möte.', item_type: 'follow_up' });
        rawSystemEntities.workOrders.slice(0, 8).forEach((o) => rows.push({ title: `Arbetsorder: ${o.title}`, notes: '', item_type: 'system' }));
        rawSystemEntities.maintenanceRequests.slice(0, 8).forEach((r) => rows.push({ title: `Felanmälan: ${r.title}`, notes: '', item_type: 'system' }));
        rawSystemEntities.customerProjects.slice(0, 8).forEach((p) => rows.push({ title: `Kundprojekt: ${api.projectTitle(p)}`, notes: '', item_type: 'system' }));
      }
      await api.createAgendaItems(orgId, meeting.id, rows.map((row, index) => ({ ...row, sort_order: index + 1 })));

      setShowCreateModal(false);
      setSelectedMeeting(meeting);
      await loadList();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Kunde inte skapa mötet.');
    } finally {
      setCreating(false);
    }
  }

  async function handleAgendaNotesChange(item: MeetingAgendaItem, notes: string) {
    await api.updateAgendaNotes(item.id, notes);
    setAgendaItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, notes } : row)));
  }

  async function handleAgendaToggleStatus(item: MeetingAgendaItem) {
    const nextStatus = (item as { status?: string }).status === 'done' ? 'open' : 'done';
    await api.updateAgendaStatus(item.id, nextStatus);
    setAgendaItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, status: nextStatus } as MeetingAgendaItem : row)));
  }

  async function handleSelectLinkOption(agendaItemId: string, option: SystemLinkOption) {
    if (!orgId || !selectedMeeting || !user) return;
    await api.createObjectLink({ organisationId: orgId, meetingId: selectedMeeting.id, agendaItemId, entityType: option.type, entityId: option.id, label: option.title, userId: user.id });
    setLinkPickerAgendaId(null);
    await loadDetail(selectedMeeting.id);
  }

  async function handleRemoveLink(linkId: string) {
    if (!selectedMeeting) return;
    await api.deleteObjectLink(linkId);
    setObjectLinks((prev) => prev.filter((l) => l.id !== linkId));
  }

  async function handleAddDecision() {
    if (!orgId || !selectedMeeting || !decisionForm.title.trim()) return;
    await api.createDecision({ organisationId: orgId, meetingId: selectedMeeting.id, title: decisionForm.title.trim(), description: decisionForm.description.trim(), responsibleUserId: decisionForm.responsible_user_id || null, dueDate: decisionForm.due_date || null });
    setDecisionForm(EMPTY_DECISION_FORM);
    await loadDetail(selectedMeeting.id);
  }

  async function handleAddAction() {
    if (!orgId || !selectedMeeting || !actionForm.title.trim()) return;
    await api.createActionItem({ organisationId: orgId, meetingId: selectedMeeting.id, title: actionForm.title.trim(), description: actionForm.description.trim(), responsibleUserId: actionForm.responsible_user_id || null, dueDate: actionForm.due_date || null, priority: actionForm.priority });
    setActionForm(EMPTY_ACTION_FORM);
    await loadDetail(selectedMeeting.id);
  }

  async function handleMarkActionDone(action: MeetingActionItem) {
    await api.markActionDone(action.id);
    setActionItems((prev) => prev.map((a) => (a.id === action.id ? { ...a, status: 'done' } : a)));
  }

  async function handleStatusChange(status: string) {
    if (!selectedMeeting) return;
    await api.updateMeetingStatus(selectedMeeting.id, status);
    setSelectedMeeting({ ...selectedMeeting, status: status as MeetingV2['status'] });
    await loadList();
  }

  async function handleLock() {
    if (!selectedMeeting || !user) return;
    await api.lockMeeting(selectedMeeting.id, user.id);
    setSelectedMeeting({ ...selectedMeeting, status: 'locked', locked_at: new Date().toISOString() });
    await loadList();
  }

  async function handleRunAiAnalysis() {
    if (!selectedMeeting) return;
    setAiLoading(true);
    setAiError('');
    setAiApplied(new Set());
    try {
      const analysis = await api.runMeetingAiAnalysis(selectedMeeting.id);
      setAiAnalysis(analysis);
      const suggestion = await api.fetchLatestAiSuggestion(selectedMeeting.id);
      setAiSuggestionId(suggestion?.id || null);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Kunde inte analysera mötet med AI.');
    } finally {
      setAiLoading(false);
    }
  }

  function markApplying(key: string, applying: boolean) {
    setAiApplying((prev) => { const next = new Set(prev); if (applying) next.add(key); else next.delete(key); return next; });
  }

  async function afterApply(key: string) {
    setAiApplied((prev) => new Set(prev).add(key));
    if (aiSuggestionId && aiAnalysis) await api.markSuggestionApplied(aiSuggestionId, aiAnalysis, key);
  }

  async function handleAiCreateTask(item: Parameters<typeof api.applyAiCreateTask>[2], key: string) {
    if (!orgId || !selectedMeeting) return;
    markApplying(key, true);
    try {
      await api.applyAiCreateTask(orgId, selectedMeeting.id, item);
      await afterApply(key);
      await loadDetail(selectedMeeting.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Kunde inte skapa uppgiften.');
    } finally {
      markApplying(key, false);
    }
  }

  async function handleAiUpdateTask(item: { action_item_id: string | null; new_status: string | null; new_priority: string | null }, key: string) {
    if (!item.action_item_id) return;
    const patch: Record<string, string> = {};
    if (item.new_status) patch.status = item.new_status;
    if (item.new_priority) patch.priority = item.new_priority;
    markApplying(key, true);
    try {
      await api.applyAiUpdateTask(item.action_item_id, patch);
      await afterApply(key);
      if (selectedMeeting) await loadDetail(selectedMeeting.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Kunde inte uppdatera uppgiften.');
    } finally {
      markApplying(key, false);
    }
  }

  async function handleAiAddPurchaseItem(item: Parameters<typeof api.applyAiPurchaseItem>[2], key: string) {
    if (!orgId || !user) return;
    markApplying(key, true);
    try {
      await api.applyAiPurchaseItem(orgId, user.id, item);
      await afterApply(key);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Kunde inte lägga till i inköpslistan.');
    } finally {
      markApplying(key, false);
    }
  }

  async function handleAiCreateWorkOrder(item: Parameters<typeof api.applyAiCreateWorkOrder>[2], key: string) {
    if (!orgId || !user) return;
    markApplying(key, true);
    try {
      const workOrderId = await api.applyAiCreateWorkOrder(orgId, user.id, item);
      await afterApply(key);
      onNavigate(`workorder/${workOrderId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Kunde inte skapa arbetsordern.');
    } finally {
      markApplying(key, false);
    }
  }

  if (loading) return <LoadingPage />;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Möten V2 (beta)"
        subtitle="Skriv fritt under varje dagordningspunkt, koppla in arbetsordrar och kundprojekt direkt, och låt AI-analysen ligga kvar mellan flikbyten."
        icon={Sparkles}
        action={canManage ? <Button onClick={openCreateModal}><Plus className="h-4 w-4" /> Nytt möte</Button> : undefined}
      />

      {!selectedMeeting ? (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">Möten</h3>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <input type="checkbox" checked={includeLegacy} onChange={(e) => setIncludeLegacy(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Visa äldre möten också
            </label>
          </div>
          {meetings.length ? (
            <div className="divide-y divide-slate-100">
              {meetings.map((meeting) => (
                <button key={meeting.id} onClick={() => setSelectedMeeting(meeting)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-800">{meeting.title}</p>
                    <p className="text-xs text-slate-500">{meeting.starts_at ? formatDateTime(meeting.starts_at) : 'Inget datum'} · {meetingTypeLabels[meeting.meeting_type] || meeting.meeting_type}</p>
                  </div>
                  <Badge className={statusClasses[meeting.status] || 'bg-slate-100 text-slate-600'}>{statusLabels[meeting.status] || meeting.status}</Badge>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={<CalendarDays className="w-12 h-12" />} title="Inga möten ännu" description="Skapa ett nytt möte för att komma igång med Möten V2." />
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          <button onClick={() => setSelectedMeeting(null)} className="text-sm font-semibold text-slate-500 hover:text-slate-800">&larr; Tillbaka till möteslistan</button>

          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold text-slate-900">{selectedMeeting.title}</h2>
                  <Badge className={statusClasses[selectedMeeting.status] || 'bg-slate-100 text-slate-600'}>{statusLabels[selectedMeeting.status] || selectedMeeting.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">{selectedMeeting.starts_at ? formatDateTime(selectedMeeting.starts_at) : 'Inget datum'} · {meetingTypeLabels[selectedMeeting.meeting_type] || selectedMeeting.meeting_type}</p>
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleStatusChange('in_progress')}>Starta</Button>
                  <Button size="sm" variant="outline" onClick={() => handleStatusChange('completed')}>Avsluta</Button>
                  <Button size="sm" variant="secondary" onClick={handleLock}><Lock className="h-4 w-4" /> Lås</Button>
                </div>
              )}
            </div>
          </Card>

          {detailLoading ? <LoadingPage /> : (
            <>
              <AiAnalysisPanel
                analysis={aiAnalysis} loading={aiLoading} error={aiError} actionItems={actionItems}
                applied={aiApplied} applying={aiApplying} onRunAnalysis={handleRunAiAnalysis}
                onCreateTask={handleAiCreateTask} onUpdateTask={handleAiUpdateTask}
                onAddPurchaseItem={handleAiAddPurchaseItem} onCreateWorkOrder={handleAiCreateWorkOrder}
              />

              <Card className="p-4">
                <h3 className="mb-3 flex items-center gap-2 font-bold text-slate-900"><ClipboardList className="h-4 w-4" /> Dagordning</h3>
                {agendaItems.length ? (
                  <div className="space-y-3">
                    {agendaItems.map((item) => (
                      <AgendaItemEditor
                        key={item.id}
                        item={item}
                        canManage={canManage}
                        links={objectLinks.filter((l) => l.agenda_item_id === item.id)}
                        onNotesChange={(notes) => handleAgendaNotesChange(item, notes)}
                        onToggleStatus={() => handleAgendaToggleStatus(item)}
                        onOpenLinkPicker={() => setLinkPickerAgendaId(item.id)}
                        onOpenEntityPreview={(link) => setPreviewLink({ type: link.entity_type, id: link.entity_id })}
                        onRemoveLink={handleRemoveLink}
                      />
                    ))}
                  </div>
                ) : <p className="text-sm text-slate-500">Ingen dagordning ännu.</p>}
              </Card>

              {canManage && <QuickPurchaseAdd organisationId={orgId} userId={user!.id} />}

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="p-4">
                  <h3 className="mb-3 font-bold text-slate-900">Beslut</h3>
                  <div className="space-y-2">
                    {decisions.map((d) => (
                      <div key={d.id} className="rounded-lg bg-slate-50 p-2 text-sm">
                        <p className="font-semibold text-slate-800">{d.title}</p>
                        {d.description && <p className="text-xs text-slate-500">{d.description}</p>}
                        {d.due_date && <p className="mt-1 text-xs text-slate-400">Deadline {formatDate(d.due_date)}</p>}
                      </div>
                    ))}
                    {!decisions.length && <p className="text-sm text-slate-400">Inga beslut ännu.</p>}
                  </div>
                  {canManage && (
                    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                      <Input value={decisionForm.title} onChange={(e) => setDecisionForm({ ...decisionForm, title: e.target.value })} placeholder="Nytt beslut" />
                      <Textarea value={decisionForm.description} onChange={(e) => setDecisionForm({ ...decisionForm, description: e.target.value })} rows={2} placeholder="Beskrivning" />
                      <div className="grid grid-cols-2 gap-2">
                        <Select value={decisionForm.responsible_user_id} onChange={(e) => setDecisionForm({ ...decisionForm, responsible_user_id: e.target.value })} options={[{ value: '', label: 'Ingen ansvarig' }, ...staff.map((s) => ({ value: s.id, label: s.name }))]} />
                        <Input type="date" value={decisionForm.due_date} onChange={(e) => setDecisionForm({ ...decisionForm, due_date: e.target.value })} />
                      </div>
                      <Button size="sm" onClick={handleAddDecision}><Plus className="h-4 w-4" /> Lägg till beslut</Button>
                    </div>
                  )}
                </Card>

                <Card className="p-4">
                  <h3 className="mb-3 font-bold text-slate-900">Uppgifter</h3>
                  <div className="space-y-2">
                    {actionItems.map((a) => (
                      <div key={a.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 p-2 text-sm">
                        <div className="min-w-0">
                          <p className={`font-semibold ${a.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{a.title}</p>
                          {a.due_date && <p className="text-xs text-slate-400">Deadline {formatDate(a.due_date)}</p>}
                        </div>
                        {a.status !== 'done' && canManage && <Button size="sm" variant="secondary" onClick={() => handleMarkActionDone(a)}>Klar</Button>}
                      </div>
                    ))}
                    {!actionItems.length && <p className="text-sm text-slate-400">Inga uppgifter ännu.</p>}
                  </div>
                  {canManage && (
                    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                      <Input value={actionForm.title} onChange={(e) => setActionForm({ ...actionForm, title: e.target.value })} placeholder="Ny uppgift" />
                      <div className="grid grid-cols-2 gap-2">
                        <Select value={actionForm.responsible_user_id} onChange={(e) => setActionForm({ ...actionForm, responsible_user_id: e.target.value })} options={[{ value: '', label: 'Ingen ansvarig' }, ...staff.map((s) => ({ value: s.id, label: s.name }))]} />
                        <Select value={actionForm.priority} onChange={(e) => setActionForm({ ...actionForm, priority: e.target.value })} options={priorityOptions} />
                      </div>
                      <Input type="date" value={actionForm.due_date} onChange={(e) => setActionForm({ ...actionForm, due_date: e.target.value })} />
                      <Button size="sm" onClick={handleAddAction}><Plus className="h-4 w-4" /> Lägg till uppgift</Button>
                    </div>
                  )}
                </Card>
              </div>
            </>
          )}
        </div>
      )}

      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Nytt möte">
        <div className="space-y-4">
          <Input label="Titel" value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Datum och tid" type="datetime-local" value={createForm.starts_at} onChange={(e) => setCreateForm({ ...createForm, starts_at: e.target.value })} />
            <Select label="Mötestyp" value={createForm.meeting_type} onChange={(e) => setCreateForm({ ...createForm, meeting_type: e.target.value })} options={meetingTypeOptions} />
          </div>
          <Select label="Mall" value={createForm.template_id} onChange={(e) => setCreateForm({ ...createForm, template_id: e.target.value })} options={[{ value: '', label: 'Ingen mall' }, ...templates.map((t) => ({ value: t.id, label: t.name }))]} />
          <Textarea label="Syfte/beskrivning" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} rows={2} />
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={createForm.generate_agenda} onChange={(e) => setCreateForm({ ...createForm, generate_agenda: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
            Generera dagordning från öppna arbetsorder, felanmälningar, kundprojekt och tidigare möten
          </label>
          {createError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{createError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCreateModal(false)}>Avbryt</Button>
            <Button onClick={handleCreateMeeting} loading={creating}>Skapa möte</Button>
          </div>
        </div>
      </Modal>

      <EntityPickerCombobox open={!!linkPickerAgendaId} onClose={() => setLinkPickerAgendaId(null)} options={systemLinkOptions} onSelect={(option) => linkPickerAgendaId && handleSelectLinkOption(linkPickerAgendaId, option)} />
      <EntityPreviewModal open={!!previewLink} onClose={() => setPreviewLink(null)} entityType={previewLink?.type || null} entityId={previewLink?.id || null} onNavigate={onNavigate} />
    </div>
  );
}
