// Fredagsmöte-ombygget: huvudsidan. Listar/startar fredagsserier och
// innehåller mötesledarens kontrollvy för det valda segmentet (flikbytet
// mellan Ägarmöte/Ekonomi/Personal). TV-skärmar visas ALDRIG detta -- de
// pratar bara med vihem-meeting-screen-data, se ScreenPairPage/ScreenSegmentView.
import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { Card, Button, Badge, PageHeader, LoadingPage, EmptyState, Tabs, Modal, Input, Select, Textarea } from '../../../components/ui';
import { formatDate } from '../../../lib/utils';
import { HandoffComposer } from '../components/HandoffComposer';
import { ReviewQueuePanel } from '../components/ReviewQueuePanel';
import { WeekPlanBoard } from '../components/WeekPlanBoard';
import * as api from '../api';
import type {
  MeetingSeries, SegmentMeeting, SegmentAgendaItem, SegmentParticipant, IncomingHandoff,
  MeetingAiRun, MeetingAiSuggestion, WeekPlanItem, NoteTag, SegmentKey,
} from '../types';
import type { Profile } from '../../../types';
import { Calendar, Users, Sparkles, MonitorPlay, ClipboardCheck, ArrowRightCircle, Clock, Plus, ShieldCheck } from 'lucide-react';

const MEETING_PERMISSION_KEYS = [
  { key: 'meeting.series.manage', label: 'Skapa/schemalägga fredagsserien' },
  { key: 'meeting.segment.owner.view', label: 'Se Ägarmötet' },
  { key: 'meeting.segment.finance.view', label: 'Se Ekonomi/adminmötet' },
  { key: 'meeting.segment.staff.view', label: 'Se Personalmötet' },
  { key: 'meeting.ai.trigger', label: 'Starta AI-analys' },
  { key: 'meeting.ai.review', label: 'Se granskningskön (avvisa/skjut upp)' },
  { key: 'meeting.ai.apply', label: 'Godkänna och verkställa AI-förslag' },
  { key: 'meeting.screen.manage', label: 'Ansluta/koppla bort skärmar' },
  { key: 'meeting.handoff.approve', label: 'Godkänna överlämningar' },
];

const SEGMENT_LABEL: Record<SegmentKey, string> = { owner: 'Ägarmöte', finance: 'Ekonomi/admin', staff: 'Personalmöte' };
const NOTE_TAG_OPTIONS: { value: NoteTag; label: string }[] = [
  { value: 'private', label: 'Privat' }, { value: 'shared', label: 'Delad' }, { value: 'sensitive', label: 'Känslig' },
  { value: 'decision', label: 'Beslut' }, { value: 'action', label: 'Åtgärd' }, { value: 'information', label: 'Information' },
  { value: 'idea', label: 'Idé' }, { value: 'question', label: 'Fråga' }, { value: 'hinder', label: 'Hinder' },
];

export function MeetingSeriesPage({ onNavigate: _onNavigate }: { onNavigate: (page: string) => void }) {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [seriesList, setSeriesList] = useState<MeetingSeries[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [segments, setSegments] = useState<SegmentMeeting[]>([]);
  const [activeSegment, setActiveSegment] = useState<SegmentKey>('owner');
  const [staff, setStaff] = useState<Pick<Profile, 'id' | 'name' | 'email'>[]>([]);
  const [starting, setStarting] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);

  const fetchStaff = useCallback(async () => {
    if (!user?.organisation_id) return;
    const { data } = await supabase.from('vihem_profiles').select('id, name, email').eq('organisation_id', user.organisation_id).in('role', ['admin', 'staff']).eq('active', true).order('name');
    setStaff(data || []);
  }, [user?.organisation_id]);

  const fetchSeriesList = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listFridaySeries();
      setSeriesList(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSeriesList(); fetchStaff(); }, [fetchSeriesList, fetchStaff]);

  const refreshSegments = useCallback(async () => {
    if (!selectedSeriesId) { setSegments([]); return; }
    const fresh = await api.getSeriesSegments(selectedSeriesId);
    setSegments(fresh);
  }, [selectedSeriesId]);

  useEffect(() => { refreshSegments(); }, [refreshSegments]);

  async function handleStartFriday() {
    setStarting(true);
    try {
      const seriesId = await api.getOrCreateFridaySeries();
      await fetchSeriesList();
      setSelectedSeriesId(seriesId);
      setActiveSegment('owner');
    } finally {
      setStarting(false);
    }
  }

  if (authLoading || !user) return <LoadingPage />;

  if (!selectedSeriesId) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Fredagsmöte"
          subtitle="Ägarmöte, Ekonomi/admin och Personalmöte i ett sammanhängande flöde -- separat från Möten/Möten V2."
          action={
            <div className="flex gap-2">
              {(user.role === 'admin' || user.role === 'superadmin') && (
                <Button variant="secondary" onClick={() => setShowPermissions(true)} className="gap-2"><ShieldCheck className="h-4 w-4" /> Mötesbehörigheter</Button>
              )}
              <Button variant="primary" onClick={handleStartFriday} loading={starting} className="gap-2"><Calendar className="h-4 w-4" /> Starta veckans fredagsmöte</Button>
            </div>
          }
        />
        {showPermissions && <MeetingPermissionsPanel organisationId={user.organisation_id} staff={staff} currentUserId={user.id} onClose={() => setShowPermissions(false)} />}
        {loading ? <LoadingPage /> : seriesList.length === 0 ? (
          <EmptyState icon={<Calendar className="h-10 w-10" />} title="Inga fredagsmöten ännu" description={'Klicka på "Starta veckans fredagsmöte" för att komma igång.'} />
        ) : (
          <div className="space-y-2">
            {seriesList.map(s => (
              <Card key={s.id} onClick={() => setSelectedSeriesId(s.id)} className="cursor-pointer p-4 hover:border-blue-300">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-800">{s.title}</p>
                    <p className="text-sm text-slate-500">{formatDate(s.series_week_date)}</p>
                  </div>
                  <Badge className={s.active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}>{s.active ? 'Aktiv' : 'Arkiverad'}</Badge>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  const activeMeeting = segments.find(s => s.segment_key === activeSegment);

  return (
    <div className="space-y-5">
      <PageHeader
        title={seriesList.find(s => s.id === selectedSeriesId)?.title || 'Fredagsmöte'}
        subtitle="Byt delmöte i flikarna nedan. Varje delmöte har egna deltagare, anteckningar och skärmar."
        backButton={() => setSelectedSeriesId(null)}
      />
      <Tabs
        tabs={(['owner', 'finance', 'staff'] as SegmentKey[]).map(k => ({ key: k, label: SEGMENT_LABEL[k] }))}
        active={activeSegment}
        onChange={k => setActiveSegment(k as SegmentKey)}
      />
      {activeMeeting ? (
        <SegmentControlView
          key={activeMeeting.id}
          meeting={activeMeeting}
          allSegments={segments}
          staff={staff}
          currentUserId={user.id}
          onMeetingChanged={refreshSegments}
        />
      ) : <LoadingPage />}
    </div>
  );
}

// ─── Segment control view ──────────────────────────────────────────────────

function SegmentControlView({ meeting, allSegments, staff, currentUserId, onMeetingChanged }: {
  meeting: SegmentMeeting; allSegments: SegmentMeeting[]; staff: Pick<Profile, 'id' | 'name' | 'email'>[]; currentUserId: string;
  onMeetingChanged: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [agendaItems, setAgendaItems] = useState<SegmentAgendaItem[]>([]);
  const [participants, setParticipants] = useState<SegmentParticipant[]>([]);
  const [incomingHandoffs, setIncomingHandoffs] = useState<IncomingHandoff[]>([]);
  const [decisions, setDecisions] = useState<any[]>([]);
  const [actionItems, setActionItems] = useState<any[]>([]);
  const [aiRuns, setAiRuns] = useState<MeetingAiRun[]>([]);
  const [suggestions, setSuggestions] = useState<MeetingAiSuggestion[]>([]);
  const [weekPlanItems, setWeekPlanItems] = useState<WeekPlanItem[]>([]);
  const [screenSessions, setScreenSessions] = useState<any[]>([]);
  const [triggeringAi, setTriggeringAi] = useState(false);
  const [aiError, setAiError] = useState('');
  const [handoffComposerItem, setHandoffComposerItem] = useState<SegmentAgendaItem | 'quick' | null>(null);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [pairingCode, setPairingCode] = useState<{ code: string; label: string } | null>(null);

  const isParticipant = participants.some(p => p.user_id === currentUserId);
  const myRole = participants.find(p => p.user_id === currentUserId)?.role;
  const canLead = myRole === 'leader' || myRole === 'secretary';

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [agenda, parts, handoffs, dec, actions, runs, sugg, weekPlan, screens] = await Promise.all([
        api.listAgendaItems(meeting.id),
        api.listSegmentParticipants(meeting.id),
        api.listIncomingHandoffs(meeting.id),
        api.listDecisions(meeting.id),
        api.listActionItems(meeting.id),
        api.listAiRuns(meeting.id),
        api.listSuggestionsForMeeting(meeting.id),
        meeting.segment_key === 'staff' ? api.listWeekPlanItems(meeting.id) : Promise.resolve([]),
        api.listScreenSessions(meeting.id),
      ]);
      setAgendaItems(agenda); setParticipants(parts); setIncomingHandoffs(handoffs);
      setDecisions(dec); setActionItems(actions); setAiRuns(runs); setSuggestions(sugg);
      setWeekPlanItems(weekPlan); setScreenSessions(screens);
    } finally {
      setLoading(false);
    }
  }, [meeting.id, meeting.segment_key]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleJoinAsLeader() {
    await api.addSegmentParticipant(meeting.id, currentUserId, 'leader');
    fetchAll();
  }

  async function handleStartSegment() {
    await api.updateSegmentStatus(meeting.id, 'in_progress');
    if (!isParticipant) await api.addSegmentParticipant(meeting.id, currentUserId, 'leader');
    await onMeetingChanged();
    fetchAll();
  }

  async function handleTriggerAi() {
    setTriggeringAi(true);
    setAiError('');
    try {
      await api.triggerMeetingAi(meeting.id);
      await fetchAll();
    } catch (err: any) {
      setAiError(err.message || 'AI-analysen misslyckades. Mötet fungerar ändå -- anteckningar/beslut/åtgärder är opåverkade.');
    } finally {
      setTriggeringAi(false);
    }
  }

  async function handleApplySuggestion(id: string) {
    const result = await api.applySuggestion(id);
    if (result.status === 'conflict') {
      setAiError('Målposten har ändrats sedan analysen -- kör om AI-analysen eller redigera förslaget manuellt.');
    }
    await fetchAll();
  }

  const latestRun = aiRuns[0];
  const nextSegmentOptions = allSegments
    .filter(s => s.segment_order && meeting.segment_order && s.segment_order > meeting.segment_order)
    .map(s => ({ meeting: s, label: `${SEGMENT_LABEL[s.segment_key as SegmentKey]} (denna vecka)` }));

  if (loading) return <LoadingPage />;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-800">{meeting.title}</p>
              <div className="mt-1 flex items-center gap-2">
                <Badge className="bg-blue-100 text-blue-700">{meeting.status}</Badge>
                {!isParticipant && <span className="text-xs text-slate-400">Du är inte deltagare i detta delmöte ännu.</span>}
              </div>
            </div>
            <div className="flex gap-2">
              {!isParticipant && <Button size="sm" variant="secondary" onClick={handleJoinAsLeader}>Gå med som ledare</Button>}
              {meeting.status !== 'in_progress' && meeting.status !== 'completed' && (
                <Button size="sm" variant="primary" onClick={handleStartSegment}>Starta delmöte</Button>
              )}
              {meeting.status === 'in_progress' && (
                <Button size="sm" variant="primary" onClick={() => setShowCloseModal(true)} className="gap-1"><ClipboardCheck className="h-4 w-4" /> Avsluta delmöte</Button>
              )}
            </div>
          </div>
        </Card>

        {incomingHandoffs.length > 0 && (
          <Card className="border-blue-200 bg-blue-50/50 p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-blue-800"><ArrowRightCircle className="h-4 w-4" /> Mottaget från tidigare delmöte</h4>
            <div className="space-y-1.5">
              {incomingHandoffs.map(h => <p key={h.id} className="text-sm text-slate-700">{h.forwarded_text}</p>)}
            </div>
          </Card>
        )}

        <Card className="p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Agenda</h4>
          <div className="space-y-3">
            {agendaItems.map(item => (
              <AgendaItemRow key={item.id} item={item} onSave={fetchAll} onHandoff={() => setHandoffComposerItem(item)} />
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-700">Beslut &amp; åtgärder</h4>
            <QuickAddButtons meetingId={meeting.id} organisationId={meeting.organisation_id} staff={staff} onSaved={fetchAll} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Beslut</p>
              {decisions.length === 0 && <p className="text-xs text-slate-400">Inga beslut ännu.</p>}
              {decisions.map(d => <p key={d.id} className="rounded-lg bg-slate-50 px-2 py-1.5 text-sm text-slate-700">{d.title}</p>)}
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Åtgärder</p>
              {actionItems.length === 0 && <p className="text-xs text-slate-400">Inga åtgärder ännu.</p>}
              {actionItems.map(a => <p key={a.id} className="rounded-lg bg-slate-50 px-2 py-1.5 text-sm text-slate-700">{a.title}</p>)}
            </div>
          </div>
        </Card>

        {meeting.segment_key === 'staff' && (
          <Card className="p-4">
            <WeekPlanBoard
              items={weekPlanItems}
              staff={staff}
              onAdd={async (item) => { await api.upsertWeekPlanItem({ organisation_id: meeting.organisation_id, meeting_id: meeting.id, series_id: meeting.series_id, ...item } as any); fetchAll(); }}
              onUpdate={async (id, patch) => { await api.upsertWeekPlanItem({ id, organisation_id: meeting.organisation_id, meeting_id: meeting.id, title: '', ...patch } as any); fetchAll(); }}
              onDelete={async (id) => { await api.deleteWeekPlanItem(id); fetchAll(); }}
              onHighlight={async (id) => { await api.setWeekPlanHighlight(meeting.id, id); fetchAll(); }}
            />
          </Card>
        )}
      </div>

      <div className="space-y-5">
        <Card className="p-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Sparkles className="h-4 w-4" /> AI-analys</h4>
          {latestRun && (
            <p className="mb-2 text-xs text-slate-500">
              Senaste körning: <Badge className={latestRun.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : latestRun.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}>{latestRun.status}</Badge>
              {latestRun.error_message && <span className="ml-1 text-red-600">{latestRun.error_message}</span>}
            </p>
          )}
          <Button size="sm" variant="primary" loading={triggeringAi} onClick={handleTriggerAi} className="w-full gap-1.5 mb-3">
            <Sparkles className="h-4 w-4" /> Kör AI-analys
          </Button>
          {aiError && <p className="mb-2 text-xs text-red-600">{aiError}</p>}
          <ReviewQueuePanel
            suggestions={suggestions}
            onApprove={handleApplySuggestion}
            onReject={async (id) => { await api.rejectSuggestion(id); fetchAll(); }}
            onPostpone={async (id) => { await api.postponeSuggestion(id); fetchAll(); }}
          />
        </Card>

        <Card className="p-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700"><MonitorPlay className="h-4 w-4" /> Skärmar</h4>
          <div className="space-y-2">
            {screenSessions.map(s => (
              <div key={s.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5">
                <div>
                  <p className="text-xs font-medium text-slate-700">{s.label || s.display_role}</p>
                  <Badge className={s.status === 'active' ? 'bg-emerald-100 text-emerald-700' : s.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-500'}>{s.status}</Badge>
                </div>
                {s.status !== 'revoked' && (
                  <Button size="sm" variant="ghost" onClick={async () => { await api.revokeScreenSession(s.id); fetchAll(); }}>Koppla bort</Button>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <Button size="sm" variant="secondary" onClick={async () => {
              const res = await api.createScreenPairingCode(meeting.id, meeting.segment_key as SegmentKey, 'meeting_main', 'Skärm 1');
              setPairingCode({ code: res.code, label: 'Skärm 1 (mötesvy)' });
              fetchAll();
            }}>+ Anslut mötesskärm</Button>
            {meeting.segment_key === 'staff' && (
              <Button size="sm" variant="secondary" onClick={async () => {
                const res = await api.createScreenPairingCode(meeting.id, meeting.segment_key as SegmentKey, 'staff_week_plan', 'Skärm 2');
                setPairingCode({ code: res.code, label: 'Skärm 2 (veckoplan)' });
                fetchAll();
              }}>+ Anslut veckoplan-skärm</Button>
            )}
          </div>
        </Card>
      </div>

      {handoffComposerItem && (
        <HandoffComposer
          open
          onClose={() => setHandoffComposerItem(null)}
          sourceAgendaTitle={handoffComposerItem !== 'quick' ? handoffComposerItem.title : undefined}
          targetOptions={nextSegmentOptions}
          onSave={async (input) => {
            await api.createHandoff({
              organisationId: meeting.organisation_id,
              sourceMeetingId: meeting.id,
              sourceAgendaItemId: handoffComposerItem !== 'quick' ? handoffComposerItem.id : null,
              ...input,
            });
            fetchAll();
          }}
        />
      )}

      {showCloseModal && (
        <CloseSegmentModal
          meeting={meeting}
          decisions={decisions}
          actionItems={actionItems}
          agendaItems={agendaItems}
          nextSegmentOptions={nextSegmentOptions}
          onClose={() => setShowCloseModal(false)}
          onDone={async () => { setShowCloseModal(false); await api.updateSegmentStatus(meeting.id, 'completed'); await onMeetingChanged(); fetchAll(); }}
        />
      )}

      {pairingCode && (
        <Modal open onClose={() => setPairingCode(null)} title={`Parkopplingskod — ${pairingCode.label}`}>
          <div className="space-y-3 text-center">
            <p className="text-sm text-slate-500">Ange denna kod på skärmen (/screen/pair). Koden gäller i 10 minuter och kan bara användas en gång.</p>
            <p className="text-4xl font-bold tracking-widest text-slate-800">{pairingCode.code}</p>
            <Button variant="secondary" onClick={() => setPairingCode(null)}>Stäng</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AgendaItemRow({ item, onSave, onHandoff }: { item: SegmentAgendaItem; onSave: () => void; onHandoff: () => void }) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(item.notes);
  const [tags, setTags] = useState<NoteTag[]>(item.note_tags || []);
  const [sensitivity, setSensitivity] = useState<'normal' | 'sensitive'>(item.sensitivity);
  const [saving, setSaving] = useState(false);

  function toggleTag(tag: NoteTag) {
    setTags(t => t.includes(tag) ? t.filter(x => x !== tag) : [...t, tag]);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateAgendaItemNote(item.id, notes, tags, sensitivity);
      setEditing(false);
      onSave();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">{item.title}</p>
        <div className="flex items-center gap-1.5">
          {item.time_budget_minutes && <span className="flex items-center gap-1 text-xs text-slate-400"><Clock className="h-3 w-3" /> {item.time_budget_minutes} min</span>}
          {item.sensitivity === 'sensitive' && <Badge className="bg-rose-100 text-rose-700">Känslig</Badge>}
          <Button size="sm" variant="ghost" onClick={() => setEditing(e => !e)}>{editing ? 'Stäng' : 'Anteckning'}</Button>
          <Button size="sm" variant="ghost" onClick={onHandoff} className="gap-1"><ArrowRightCircle className="h-3.5 w-3.5" /> Vidarebefordra</Button>
        </div>
      </div>
      {!editing && item.notes && <p className="mt-1 text-xs text-slate-500">{item.notes}</p>}
      {editing && (
        <div className="mt-2 space-y-2">
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Anteckning..." />
          <div className="flex flex-wrap gap-1.5">
            {NOTE_TAG_OPTIONS.map(opt => (
              <button key={opt.value} type="button" onClick={() => toggleTag(opt.value)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${tags.includes(opt.value) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={sensitivity === 'sensitive'} onChange={e => setSensitivity(e.target.checked ? 'sensitive' : 'normal')} />
              Känslig (döljs alltid på skärm)
            </label>
          </div>
          <Button size="sm" variant="primary" loading={saving} onClick={handleSave}>Spara anteckning</Button>
        </div>
      )}
    </div>
  );
}

function QuickAddButtons({ meetingId, organisationId, staff, onSaved }: { meetingId: string; organisationId: string; staff: Pick<Profile, 'id' | 'name'>[]; onSaved: () => void }) {
  const [modal, setModal] = useState<'decision' | 'action' | null>(null);
  const [form, setForm] = useState({ title: '', description: '', responsible_user_id: '', due_date: '' });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      if (modal === 'decision') await api.createDecision(meetingId, organisationId, form.title, form.description, form.responsible_user_id || null, form.due_date || null);
      if (modal === 'action') await api.createActionItem(meetingId, organisationId, form.title, form.description, form.responsible_user_id || null, form.due_date || null);
      setForm({ title: '', description: '', responsible_user_id: '', due_date: '' });
      setModal(null);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" variant="secondary" onClick={() => setModal('decision')} className="gap-1"><Plus className="h-3.5 w-3.5" /> Beslut</Button>
      <Button size="sm" variant="secondary" onClick={() => setModal('action')} className="gap-1"><Plus className="h-3.5 w-3.5" /> Åtgärd</Button>
      {modal && (
        <Modal open onClose={() => setModal(null)} title={modal === 'decision' ? 'Nytt beslut' : 'Ny åtgärd'}>
          <div className="space-y-3">
            <Input label="Titel" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            <Textarea label="Beskrivning" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} />
            <div className="grid grid-cols-2 gap-3">
              <Select label="Ansvarig" value={form.responsible_user_id} onChange={e => setForm({ ...form, responsible_user_id: e.target.value })}
                options={[{ value: '', label: 'Ingen' }, ...staff.map(s => ({ value: s.id, label: s.name }))]} />
              <Input label="Deadline" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
            </div>
            <Button variant="primary" loading={saving} onClick={handleSave} className="w-full">Spara</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CloseSegmentModal({ meeting, decisions, actionItems, agendaItems, nextSegmentOptions, onClose, onDone }: {
  meeting: SegmentMeeting; decisions: any[]; actionItems: any[]; agendaItems: SegmentAgendaItem[];
  nextSegmentOptions: { meeting: SegmentMeeting; label: string }[]; onClose: () => void; onDone: () => Promise<void>;
}) {
  const missingResponsible = [...decisions, ...actionItems].filter(d => !d.responsible_user_id);
  const missingDeadline = [...decisions, ...actionItems].filter(d => !d.due_date);
  const [confirming, setConfirming] = useState(false);

  return (
    <Modal open onClose={onClose} title="Avsluta delmöte" size="lg">
      <div className="space-y-4">
        <div>
          <p className="mb-1 text-sm font-semibold text-slate-700">Beslut ({decisions.length}) &amp; åtgärder ({actionItems.length})</p>
          {(missingResponsible.length > 0 || missingDeadline.length > 0) ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {missingResponsible.length > 0 && <p>{missingResponsible.length} punkt(er) saknar ansvarig.</p>}
              {missingDeadline.length > 0 && <p>{missingDeadline.length} punkt(er) saknar deadline.</p>}
              <p className="mt-1 text-xs">Mötet kan avslutas ändå, men kontrollera att detta är avsiktligt.</p>
            </div>
          ) : (
            <p className="text-sm text-emerald-700">Alla beslut och åtgärder har ansvarig och deadline.</p>
          )}
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold text-slate-700">Agendapunkter ({agendaItems.length})</p>
          <p className="text-xs text-slate-500">Använd "Vidarebefordra" på respektive punkt innan du avslutar om något ska föras vidare -- {nextSegmentOptions.length === 0 ? 'inget kvarvarande delmöte denna vecka.' : `nästa delmöte: ${nextSegmentOptions[0]?.label}.`}</p>
        </div>
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Avbryt</Button>
          <Button variant="primary" loading={confirming} onClick={async () => { setConfirming(true); await onDone(); }} className="flex-1">Avsluta delmöte</Button>
        </div>
      </div>
    </Modal>
  );
}

// Admin-only: beviljar/återkallar de meeting.*-behörighetsnycklarna per
// personal, samma vihem_permission_grants-tabell/mönster som redan
// används för modulåtkomst (AdminStaffPage.tsx) -- egen liten panel här
// istället för att bygga in i den generella modul-listan, eftersom det
// här är finkorniga rättigheter inom en enda modul, inte på/av-läge för
// hela moduler.
function MeetingPermissionsPanel({ organisationId, staff, currentUserId, onClose }: {
  organisationId: string | null; staff: Pick<Profile, 'id' | 'name' | 'email'>[]; currentUserId: string; onClose: () => void;
}) {
  const [selectedStaffId, setSelectedStaffId] = useState(staff[0]?.id || '');
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [initialGrants, setInitialGrants] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const fetchGrants = useCallback(async (staffId: string) => {
    if (!staffId) return;
    const { data } = await supabase.from('vihem_permission_grants').select('permission_key').eq('user_id', staffId);
    const keys = new Set((data || []).map((r: any) => r.permission_key));
    setGrants(keys);
    setInitialGrants(new Set(keys));
  }, []);

  useEffect(() => { if (selectedStaffId) fetchGrants(selectedStaffId); }, [selectedStaffId, fetchGrants]);

  function toggle(key: string) {
    setGrants(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    if (!organisationId || !selectedStaffId) return;
    setSaving(true);
    try {
      const toGrant = [...grants].filter(k => !initialGrants.has(k));
      const toRevoke = [...initialGrants].filter(k => !grants.has(k));
      if (toGrant.length) {
        await supabase.from('vihem_permission_grants').insert(
          toGrant.map(key => ({ organisation_id: organisationId, user_id: selectedStaffId, permission_key: key, granted_by: currentUserId }))
        );
      }
      if (toRevoke.length) {
        await supabase.from('vihem_permission_grants').delete().eq('user_id', selectedStaffId).in('permission_key', toRevoke);
      }
      await fetchGrants(selectedStaffId);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Mötesbehörigheter">
      <div className="space-y-4">
        <Select label="Personal" value={selectedStaffId} onChange={e => setSelectedStaffId(e.target.value)}
          options={staff.map(s => ({ value: s.id, label: s.name }))} />
        <p className="text-xs text-slate-500">Admin har alltid full åtkomst -- detta gäller bara personal. Deltagande i ett segment ger enbart läsrätt till just det segmentet, aldrig rätt att godkänna AI-förslag eller sköta skärmar.</p>
        <div className="space-y-1.5">
          {MEETING_PERMISSION_KEYS.map(opt => (
            <label key={opt.key} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input type="checkbox" checked={grants.has(opt.key)} onChange={() => toggle(opt.key)} />
              {opt.label}
            </label>
          ))}
        </div>
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Stäng</Button>
          <Button variant="primary" loading={saving} onClick={handleSave} className="flex-1">Spara</Button>
        </div>
      </div>
    </Modal>
  );
}
