// Fredagsmöte-ombygget -- all Supabase-åtkomst för den nya mötesserien
// samlad här, samma mönster som meetings-v2/api.ts. AI-godkännande och
// skärmparkoppling går ALDRIG via ett direkt client-side UPDATE/INSERT --
// se apply_meeting_ai_suggestion / vihem-meeting-screen-pair.
import { supabase } from '../../lib/supabase';
import type {
  MeetingSeries, SegmentMeeting, SegmentAgendaItem, SegmentParticipant,
  MeetingHandoff, IncomingHandoff, MeetingAiRun, MeetingAiSuggestion,
  WeekPlanItem, MissingDocument, SegmentKey, ParticipantRole, NoteTag,
} from './types';

export async function getOrCreateFridaySeries(weekDate?: string) {
  const { data, error } = await supabase.rpc('create_or_get_friday_series', { p_week_date: weekDate || null });
  if (error) throw error;
  return data as string;
}

export async function listFridaySeries(): Promise<MeetingSeries[]> {
  const { data, error } = await supabase
    .from('vihem_meeting_series')
    .select('*')
    .eq('template_group_key', 'friday_meeting')
    .order('series_week_date', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data || []) as MeetingSeries[];
}

export async function getSeriesSegments(seriesId: string): Promise<SegmentMeeting[]> {
  const { data, error } = await supabase
    .from('vihem_meetings')
    .select('*')
    .eq('series_id', seriesId)
    .order('segment_order');
  if (error) throw error;
  return (data || []) as SegmentMeeting[];
}

export async function getSegmentMeeting(meetingId: string): Promise<SegmentMeeting | null> {
  const { data, error } = await supabase.from('vihem_meetings').select('*').eq('id', meetingId).maybeSingle();
  if (error) throw error;
  return data as SegmentMeeting | null;
}

export async function updateSegmentStatus(meetingId: string, status: string) {
  const { error } = await supabase.from('vihem_meetings').update({ status }).eq('id', meetingId);
  if (error) throw error;
}

export async function listAgendaItems(meetingId: string): Promise<SegmentAgendaItem[]> {
  const { data, error } = await supabase
    .from('vihem_meeting_agenda_items')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('sort_order');
  if (error) throw error;
  return (data || []) as SegmentAgendaItem[];
}

export async function updateAgendaItemNote(id: string, notes: string, noteTags: NoteTag[], sensitivity: 'normal' | 'sensitive') {
  const { error } = await supabase
    .from('vihem_meeting_agenda_items')
    .update({ notes, note_tags: noteTags, sensitivity })
    .eq('id', id);
  if (error) throw error;
}

export async function listSegmentParticipants(meetingId: string): Promise<SegmentParticipant[]> {
  const { data, error } = await supabase
    .from('vihem_meeting_segment_participants')
    .select('*, profile:vihem_profiles(id, name, email)')
    .eq('meeting_id', meetingId);
  if (error) throw error;
  return (data || []) as unknown as SegmentParticipant[];
}

export async function addSegmentParticipant(meetingId: string, userId: string, role: ParticipantRole) {
  const { error } = await supabase
    .from('vihem_meeting_segment_participants')
    .upsert({ meeting_id: meetingId, user_id: userId, role }, { onConflict: 'meeting_id,user_id' });
  if (error) throw error;
}

export async function removeSegmentParticipant(id: string) {
  const { error } = await supabase.from('vihem_meeting_segment_participants').delete().eq('id', id);
  if (error) throw error;
}

export async function createDecision(meetingId: string, organisationId: string, title: string, description: string, responsibleUserId: string | null, dueDate: string | null) {
  const { error } = await supabase.from('vihem_meeting_decisions').insert({
    organisation_id: organisationId, meeting_id: meetingId, title, description,
    responsible_user_id: responsibleUserId, due_date: dueDate,
  });
  if (error) throw error;
}

export async function createActionItem(meetingId: string, organisationId: string, title: string, description: string, responsibleUserId: string | null, dueDate: string | null) {
  const { error } = await supabase.from('vihem_meeting_action_items').insert({
    organisation_id: organisationId, meeting_id: meetingId, title, description,
    responsible_user_id: responsibleUserId, due_date: dueDate,
  });
  if (error) throw error;
}

export async function listDecisions(meetingId: string) {
  const { data, error } = await supabase.from('vihem_meeting_decisions').select('*').eq('meeting_id', meetingId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listActionItems(meetingId: string) {
  const { data, error } = await supabase.from('vihem_meeting_action_items').select('*').eq('meeting_id', meetingId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// --- Handoffs ---------------------------------------------------------

export async function createHandoff(input: {
  organisationId: string; sourceMeetingId: string; sourceAgendaItemId?: string | null;
  originalNote: string; internalExplanation: string; forwardedText: string;
  handoffTarget: MeetingHandoff['handoff_target']; targetMeetingId: string | null;
}) {
  const { error } = await supabase.from('vihem_meeting_handoffs').insert({
    organisation_id: input.organisationId,
    source_meeting_id: input.sourceMeetingId,
    source_agenda_item_id: input.sourceAgendaItemId || null,
    original_note: input.originalNote,
    internal_explanation: input.internalExplanation,
    forwarded_text: input.forwardedText,
    handoff_target: input.handoffTarget,
    target_meeting_id: input.targetMeetingId,
    status: input.targetMeetingId ? 'delivered' : 'pending',
  });
  if (error) throw error;
}

export async function listOutgoingHandoffs(sourceMeetingId: string): Promise<MeetingHandoff[]> {
  const { data, error } = await supabase.from('vihem_meeting_handoffs').select('*').eq('source_meeting_id', sourceMeetingId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as MeetingHandoff[];
}

export async function listIncomingHandoffs(meetingId: string): Promise<IncomingHandoff[]> {
  const { data, error } = await supabase.rpc('get_meeting_handoffs_for_segment', { p_meeting_id: meetingId });
  if (error) throw error;
  return (data || []) as IncomingHandoff[];
}

// --- AI ------------------------------------------------------------------

export async function triggerMeetingAi(meetingId: string) {
  const { data, error } = await supabase.functions.invoke('vihem-meeting-ai', { body: { meeting_id: meetingId } });
  if (error) throw error;
  return data as { run_id: string; meeting_summary: string; suggestion_count: number; follow_up_questions: unknown[]; unresolved_items: unknown[] };
}

export async function listAiRuns(meetingId: string): Promise<MeetingAiRun[]> {
  const { data, error } = await supabase.from('vihem_meeting_ai_runs').select('*').eq('meeting_id', meetingId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as MeetingAiRun[];
}

export async function listSuggestionsForMeeting(meetingId: string): Promise<MeetingAiSuggestion[]> {
  const { data, error } = await supabase
    .from('vihem_ai_suggestions')
    .select('*')
    .eq('source_type', 'meeting')
    .eq('source_id', meetingId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as MeetingAiSuggestion[];
}

export async function rejectSuggestion(id: string) {
  const { error } = await supabase.from('vihem_ai_suggestions').update({ status: 'rejected' }).eq('id', id);
  if (error) throw error;
}

export async function postponeSuggestion(id: string) {
  const { error } = await supabase.from('vihem_ai_suggestions').update({ status: 'postponed' }).eq('id', id);
  if (error) throw error;
}

// The only path that ever moves a suggestion to applied -- atomic,
// conflict-checked, server-side. Never a direct client UPDATE.
export async function applySuggestion(id: string) {
  const { data, error } = await supabase.rpc('apply_meeting_ai_suggestion', { p_suggestion_id: id });
  if (error) throw error;
  return data as { status: string; result_id?: string; reason?: string; current_updated_at?: string; snapshot_updated_at?: string };
}

// --- Week plan board (staff segment, screen 2) ---------------------------

export async function listWeekPlanItems(meetingId: string): Promise<WeekPlanItem[]> {
  const { data, error } = await supabase.from('vihem_meeting_week_plan_items').select('*').eq('meeting_id', meetingId).order('sort_order');
  if (error) throw error;
  return (data || []) as WeekPlanItem[];
}

export async function upsertWeekPlanItem(item: Partial<WeekPlanItem> & { organisation_id: string; meeting_id: string; title: string }) {
  const { error } = await supabase.from('vihem_meeting_week_plan_items').upsert(item);
  if (error) throw error;
}

export async function deleteWeekPlanItem(id: string) {
  const { error } = await supabase.from('vihem_meeting_week_plan_items').delete().eq('id', id);
  if (error) throw error;
}

export async function setWeekPlanHighlight(meetingId: string, id: string | null) {
  await supabase.from('vihem_meeting_week_plan_items').update({ highlighted: false }).eq('meeting_id', meetingId);
  if (id) await supabase.from('vihem_meeting_week_plan_items').update({ highlighted: true }).eq('id', id);
}

// --- Missing documents -----------------------------------------------------

export async function listMissingDocuments(meetingId: string): Promise<MissingDocument[]> {
  const { data, error } = await supabase.from('vihem_meeting_missing_documents').select('*').eq('meeting_id', meetingId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as MissingDocument[];
}

export async function createMissingDocument(input: { organisationId: string; meetingId: string; description: string; responsibleUserId: string | null; deadline: string | null }) {
  const { error } = await supabase.from('vihem_meeting_missing_documents').insert({
    organisation_id: input.organisationId, meeting_id: input.meetingId, description: input.description,
    responsible_user_id: input.responsibleUserId, deadline: input.deadline,
  });
  if (error) throw error;
}

// --- Screen switching --------------------------------------------------------
// Reuses VI-HEM's existing screen system (a physical screen is a logged-in
// role='screen' account picking a named screen_key, see ScreenDisplayPage.tsx)
// instead of a separate pairing/login layer. An override row is purely
// additive on top of a screen's normal configured view -- ScreenDisplayPage
// checks for one and shows the meeting segment instead when present.
// Deleting the row is the entire "return to normal display" action.

export async function listOrgScreens(organisationId: string) {
  const { data, error } = await supabase
    .from('vihem_screen_settings')
    .select('id, screen_key, screen_view')
    .eq('organisation_id', organisationId)
    .order('screen_key');
  if (error) throw error;
  return data || [];
}

export async function getScreenProfileId(organisationId: string) {
  const { data } = await supabase
    .from('vihem_profiles')
    .select('id')
    .eq('organisation_id', organisationId)
    .eq('role', 'screen')
    .eq('active', true)
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

export async function listScreenOverridesForMeeting(meetingId: string) {
  const { data, error } = await supabase.from('vihem_meeting_screen_overrides').select('*').eq('meeting_id', meetingId);
  if (error) throw error;
  return data || [];
}

export async function listScreenOverridesForOrg(organisationId: string) {
  const { data, error } = await supabase.from('vihem_meeting_screen_overrides').select('*').eq('organisation_id', organisationId);
  if (error) throw error;
  return data || [];
}

export async function setScreenOverride(input: {
  organisationId: string; screenKey: string; meetingId: string; segmentKey: SegmentKey;
  displayMode: 'meeting_main' | 'staff_week_plan'; createdBy: string;
}) {
  const { error } = await supabase.from('vihem_meeting_screen_overrides').upsert({
    organisation_id: input.organisationId, screen_key: input.screenKey, meeting_id: input.meetingId,
    segment_key: input.segmentKey, display_mode: input.displayMode, created_by: input.createdBy,
  }, { onConflict: 'organisation_id,screen_key' });
  if (error) throw error;
  // Grants the org's shared screen login RLS read access to this specific
  // segment's agenda/decisions/actions (see 20260902170000's segment RLS) --
  // without this the screen would see nothing for the toggled meeting.
  const screenProfileId = await getScreenProfileId(input.organisationId);
  if (screenProfileId) {
    await addSegmentParticipant(input.meetingId, screenProfileId, 'screen');
  }
}

export async function clearScreenOverride(organisationId: string, screenKey: string) {
  const { error } = await supabase.from('vihem_meeting_screen_overrides').delete().eq('organisation_id', organisationId).eq('screen_key', screenKey);
  if (error) throw error;
}

export async function clearScreenOverridesForMeeting(meetingId: string) {
  const { error } = await supabase.from('vihem_meeting_screen_overrides').delete().eq('meeting_id', meetingId);
  if (error) throw error;
}
