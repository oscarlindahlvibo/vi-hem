// Fredagsmöte-ombygget: granskningskön. Godkänn går ALLTID via
// apply_meeting_ai_suggestion-RPC:n (atomär, konfliktkontrollerad på
// servern) -- den här komponenten anropar aldrig ett direkt UPDATE för
// status 'approved'/'applied'. Avvisa/skjut upp är enkla client-UPDATE:ar
// (RLS begränsar redan vilka statusvärden de får sätta, se
// 20260902170000_meeting_segment_rls.sql).
import React, { useState } from 'react';
import { Card, Badge, Button } from '../../../components/ui';
import type { MeetingAiSuggestion, SuggestionType } from '../types';

const TYPE_LABELS: Record<SuggestionType, string> = {
  create_work_order: 'Ny arbetsorder',
  update_work_order: 'Ändra arbetsorder',
  create_task: 'Mötesuppgift',
  update_customer_project: 'Ändra kundprojekt',
  add_purchase_item: 'Inköp',
  flag_missing_documentation: 'Saknat underlag',
  create_handoff_next_segment: 'Överlämning till nästa delmöte',
  create_handoff_next_friday: 'Överlämning till nästa fredag',
  create_followup_meeting: 'Separat uppföljningsmöte',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Väntar', needs_input: 'Behöver kompletteras', approved: 'Godkänd', applying: 'Verkställer...',
  applied: 'Genomförd', rejected: 'Avvisad', postponed: 'Uppskjuten', conflict: 'Konflikt',
  integration_unavailable: 'Ingen integration ännu', failed: 'Misslyckades', cancelled: 'Avbruten',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700', applied: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-slate-200 text-slate-600', conflict: 'bg-red-100 text-red-700',
  integration_unavailable: 'bg-slate-200 text-slate-600', failed: 'bg-red-100 text-red-700',
  postponed: 'bg-blue-100 text-blue-700', needs_input: 'bg-amber-100 text-amber-700',
  applying: 'bg-blue-100 text-blue-700', approved: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-slate-200 text-slate-600',
};

interface ReviewQueuePanelProps {
  suggestions: MeetingAiSuggestion[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onPostpone: (id: string) => Promise<void>;
}

export function ReviewQueuePanel({ suggestions, onApprove, onReject, onPostpone }: ReviewQueuePanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const grouped = suggestions.reduce<Record<string, MeetingAiSuggestion[]>>((acc, s) => {
    (acc[s.suggestion_type] = acc[s.suggestion_type] || []).push(s);
    return acc;
  }, {});

  async function run(id: string, fn: (id: string) => Promise<void>) {
    setBusyId(id);
    try { await fn(id); } finally { setBusyId(null); }
  }

  if (suggestions.length === 0) {
    return <p className="text-sm text-slate-400">Inga AI-förslag ännu för detta delmöte.</p>;
  }

  return (
    <div className="space-y-5">
      {Object.entries(grouped).map(([type, items]) => (
        <div key={type}>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">{TYPE_LABELS[type as SuggestionType] || type} ({items.length})</h4>
          <div className="space-y-2">
            {items.map(s => {
              const actionable = s.status === 'pending' || s.status === 'needs_input';
              const isConflict = s.status === 'conflict';
              return (
                <Card key={s.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-800">{s.payload.title}</p>
                        <Badge className={STATUS_COLOR[s.status] || 'bg-slate-100 text-slate-600'}>{STATUS_LABELS[s.status] || s.status}</Badge>
                        {s.payload.sensitivityClassification === 'sensitive' && <Badge className="bg-rose-100 text-rose-700">Känslig</Badge>}
                        <span className="text-xs text-slate-400">Säkerhet: {Math.round((s.confidence || 0) * 100)}%</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{s.payload.explanation}</p>
                      {s.payload.sourceNoteExcerpt && (
                        <p className="mt-1 text-xs italic text-slate-400">"{s.payload.sourceNoteExcerpt}"</p>
                      )}
                      {isConflict && (
                        <p className="mt-1 text-xs font-medium text-red-600">Målposten har ändrats sedan analysen -- kör om AI-analysen eller avvisa förslaget.</p>
                      )}
                      {s.payload.missingInfo?.length > 0 && (
                        <p className="mt-1 text-xs text-amber-600">Saknar: {s.payload.missingInfo.join(', ')}</p>
                      )}
                    </div>
                    {actionable && (
                      <div className="flex flex-shrink-0 gap-1.5">
                        <Button size="sm" variant="primary" loading={busyId === s.id} onClick={() => run(s.id, onApprove)}>Godkänn</Button>
                        <Button size="sm" variant="ghost" loading={busyId === s.id} onClick={() => run(s.id, onPostpone)}>Skjut upp</Button>
                        <Button size="sm" variant="danger" loading={busyId === s.id} onClick={() => run(s.id, onReject)}>Avvisa</Button>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
