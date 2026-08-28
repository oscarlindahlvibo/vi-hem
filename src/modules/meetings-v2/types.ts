// Möten V2 -- delar datamodell med legacy (src/pages/MeetingsPage.tsx) men
// lägger till fält den globala Meeting/MeetingDecision-typen i
// src/types/index.ts saknar (de finns i databasen, legacy läser dem via
// `as any`). Se planen (composed-kindling-lemur.md) för det fulla
// resonemanget: V2 skriver till vihem_meeting_agenda_items.notes (fritext
// per punkt) och vihem_meeting_object_links (flera länkade objekt per
// punkt) istället för legacys vihem_meeting_protocol_rows/enkel-kolumn-
// länkning -- ingen skrivkrock, samma vihem_meetings-rader.
import type { Meeting, MeetingActionItem, MeetingAgendaItem, MeetingDecision, MeetingTemplate, Profile } from '../../types';

export type MeetingV2 = Meeting & {
  participant_ids: string[];
  previous_meeting_id: string | null;
  locked_at: string | null;
  locked_by: string | null;
  metadata: Record<string, unknown>;
};

export type { MeetingActionItem, MeetingAgendaItem, MeetingDecision, MeetingTemplate, Profile };

// vihem_meeting_object_links -- fanns sedan tidigare men användes aldrig av
// något gränssnitt förrän nu. Ett objekt kan länkas till en dagordningspunkt,
// protokollrad, beslut eller uppgift (bara agenda_item_id används av V2).
export type MeetingObjectLinkEntityType = 'work_order' | 'maintenance_request' | 'customer_project';

export interface MeetingObjectLink {
  id: string;
  organisation_id: string;
  meeting_id: string;
  agenda_item_id: string | null;
  protocol_row_id: string | null;
  decision_id: string | null;
  action_item_id: string | null;
  entity_type: MeetingObjectLinkEntityType;
  entity_id: string;
  label: string;
  created_by: string | null;
  created_at: string;
}

export type SystemLinkOption = {
  id: string;
  type: MeetingObjectLinkEntityType;
  title: string;
  subtitle: string;
  status?: string;
  priority?: string;
  due_date?: string | null;
};

// AI-analysens strukturerade svarsformat -- identiskt med
// supabase/functions/vihem-meeting-ai/index.ts:s JSON-schema. Rörs inte.
export type MeetingAiTaskToCreate = { title: string; description: string; priority: 'low' | 'normal' | 'high' | 'urgent'; due_date: string | null; reason: string; confidence: number };
export type MeetingAiTaskToUpdate = { action_item_id: string | null; action_item_title_hint: string; new_status: 'open' | 'in_progress' | 'done' | 'cancelled' | null; new_priority: 'low' | 'normal' | 'high' | 'urgent' | null; reason: string; confidence: number };
export type MeetingAiPurchaseItem = { item_name: string; quantity: string | null; store_name: string | null; notes: string | null; reason: string; confidence: number };
export type MeetingAiWorkOrder = { title: string; description: string; priority: 'low' | 'normal' | 'high' | 'urgent'; reason: string; confidence: number };
export type MeetingAiReviewFlag = { title: string; detail: string; reason: string };

export type MeetingAiAnalysis = {
  summary?: string;
  warnings?: string[];
  tasks_to_create?: MeetingAiTaskToCreate[];
  tasks_to_update?: MeetingAiTaskToUpdate[];
  purchase_items?: MeetingAiPurchaseItem[];
  work_orders_to_create?: MeetingAiWorkOrder[];
  review_flags?: MeetingAiReviewFlag[];
  model?: string;
  estimated_cost_sek?: number;
  applied_keys?: string[];
};

// En rad i vihem_ai_suggestions för ett möte -- payload är MeetingAiAnalysis.
export interface MeetingAiSuggestionRow {
  id: string;
  organisation_id: string;
  meeting_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'cancelled';
  payload: MeetingAiAnalysis;
  created_at: string;
}

export type MeetingV2Form = {
  title: string;
  starts_at: string;
  meeting_type: string;
  template_id: string;
  participant_ids: string[];
  description: string;
  generate_agenda: boolean;
};

export type QuickPurchaseForm = {
  item_name: string;
  quantity: string;
  store_name: string;
  notes: string;
};
