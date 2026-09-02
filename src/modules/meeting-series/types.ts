// Fredagsmöte-ombygget -- egna typer, skiljda från meetings-v2:s (delar
// bara den underliggande vihem_meetings-raden, inte typerna, eftersom
// segmenterade möten har extra fält (series_id/segment_key/segment_order)
// och en helt annan modell för anteckningar (taggade) och överlämning.
import type { Meeting, MeetingDecision, MeetingActionItem, Profile } from '../../types';

export type SegmentKey = 'owner' | 'finance' | 'staff';
export type ParticipantRole = 'leader' | 'secretary' | 'owner' | 'finance' | 'foreman' | 'staff' | 'screen';
export type NoteTag = 'private' | 'shared' | 'sensitive' | 'decision' | 'action' | 'information' | 'idea' | 'question' | 'hinder' | 'ai_eligible' | 'ai_excluded';
export type DisplayRole = 'meeting_main' | 'staff_week_plan';

export interface MeetingSeries {
  id: string;
  organisation_id: string;
  template_group_key: string;
  title: string;
  recurrence_rule: string;
  series_week_date: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface SegmentMeeting extends Meeting {
  series_id: string | null;
  segment_key: SegmentKey | null;
  segment_order: number | null;
}

export interface SegmentAgendaItem {
  id: string;
  organisation_id: string;
  meeting_id: string;
  title: string;
  notes: string;
  note_tags: NoteTag[];
  sensitivity: 'normal' | 'sensitive';
  time_budget_minutes: number | null;
  sort_order: number;
  status: string;
  item_type: string;
  responsible_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SegmentParticipant {
  id: string;
  meeting_id: string;
  user_id: string;
  role: ParticipantRole;
  created_at: string;
  profile?: Pick<Profile, 'id' | 'name' | 'email'>;
}

export interface MeetingHandoff {
  id: string;
  organisation_id: string;
  source_meeting_id: string;
  source_agenda_item_id: string | null;
  source_ai_suggestion_id: string | null;
  original_note: string;
  internal_explanation: string;
  forwarded_text: string;
  handoff_target: 'next_segment' | 'later_meeting' | 'separate_meeting' | 'internal_follow_up_only' | 'no_handoff';
  target_meeting_id: string | null;
  status: 'pending' | 'delivered' | 'acknowledged';
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface IncomingHandoff {
  id: string;
  forwarded_text: string;
  handoff_target: string;
  status: string;
  source_meeting_id: string;
  created_at: string;
}

export type AiRunStatus = 'running' | 'completed' | 'failed';

export interface MeetingAiRun {
  id: string;
  organisation_id: string;
  meeting_id: string;
  triggered_by: string | null;
  status: AiRunStatus;
  model_used: string;
  error_message: string | null;
  suggestion_count: number;
  created_at: string;
  completed_at: string | null;
}

export type SuggestionType =
  | 'create_work_order'
  | 'update_work_order'
  | 'create_task'
  | 'update_customer_project'
  | 'add_purchase_item'
  | 'flag_missing_documentation'
  | 'create_handoff_next_segment'
  | 'create_handoff_next_friday'
  | 'create_followup_meeting';

export type SuggestionStatus =
  | 'pending' | 'needs_input' | 'approved' | 'applying' | 'applied'
  | 'rejected' | 'postponed' | 'conflict' | 'integration_unavailable' | 'failed' | 'cancelled';

export interface SuggestionPayload {
  title: string;
  explanation: string;
  sourceAgendaItemId: string | null;
  sourceNoteExcerpt: string;
  proposedValue: Record<string, unknown>;
  responsibleUserId: string | null;
  deadline: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  sensitivityClassification: 'normal' | 'sensitive';
  alternativeMatches: string[];
  missingInfo: string[];
}

export interface MeetingAiSuggestion {
  id: string;
  organisation_id: string;
  created_by: string | null;
  source_type: string;
  source_id: string | null;
  suggestion_type: SuggestionType;
  target_type: string;
  target_id: string | null;
  meeting_segment_run_id: string | null;
  payload: SuggestionPayload;
  target_snapshot: Record<string, unknown>;
  confidence: number;
  status: SuggestionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  applied_at: string | null;
  created_at: string;
}

export interface WeekPlanItem {
  id: string;
  organisation_id: string;
  series_id: string | null;
  meeting_id: string;
  work_order_id: string | null;
  customer_project_id: string | null;
  title: string;
  responsible_user_id: string | null;
  participant_user_ids: string[];
  planned_date: string | null;
  deadline: string | null;
  status: 'planned' | 'in_progress' | 'blocked' | 'done';
  material_needed: string;
  blockers: string;
  highlighted: boolean;
  sort_order: number;
  created_by: string | null;
  updated_at: string;
  created_at: string;
}

export interface MissingDocument {
  id: string;
  organisation_id: string;
  meeting_id: string;
  description: string;
  responsible_user_id: string | null;
  related_entity_type: string;
  related_entity_id: string | null;
  deadline: string | null;
  status: 'open' | 'submitted' | 'resolved' | 'cancelled';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type { MeetingDecision, MeetingActionItem };
