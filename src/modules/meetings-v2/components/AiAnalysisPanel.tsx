// Beständig AI-analyspanel: hämtar senaste sparade analysen för mötet från
// vihem_ai_suggestions vid val av möte (ingen ny körning krävs), och
// skriver tillbaka vilka förslag som applicerats i samma rads payload så
// det överlever både flikbyte och omladdning -- inte bara sidans state.
import { useMemo, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { Badge, Button, Card } from '../../../components/ui';
import type { MeetingActionItem } from '../../../types';
import type { MeetingAiAnalysis, MeetingAiPurchaseItem, MeetingAiTaskToCreate, MeetingAiTaskToUpdate, MeetingAiWorkOrder } from '../types';

const priorityLabels: Record<string, string> = { low: 'Låg', normal: 'Normal', high: 'Hög', urgent: 'Akut' };
const statusLabels: Record<string, string> = { open: 'Öppen', in_progress: 'Pågår', done: 'Klar', cancelled: 'Avbruten' };

function formatConfidence(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const percent = value <= 1 ? Math.round(value * 100) : Math.round(value);
  return `${percent}%`;
}

export function AiAnalysisPanel({
  analysis, loading, error, actionItems, applied, applying, onRunAnalysis,
  onCreateTask, onUpdateTask, onAddPurchaseItem, onCreateWorkOrder,
}: {
  analysis: MeetingAiAnalysis | null; loading: boolean; error: string; actionItems: MeetingActionItem[];
  applied: Set<string>; applying: Set<string>; onRunAnalysis: () => void;
  onCreateTask: (item: MeetingAiTaskToCreate, key: string) => void;
  onUpdateTask: (item: MeetingAiTaskToUpdate, key: string) => void;
  onAddPurchaseItem: (item: MeetingAiPurchaseItem, key: string) => void;
  onCreateWorkOrder: (item: MeetingAiWorkOrder, key: string) => void;
}) {
  const knownActionIds = useMemo(() => new Set(actionItems.map((item) => item.id)), [actionItems]);
  const hasContent = !!analysis && (
    (analysis.tasks_to_create?.length ?? 0) + (analysis.tasks_to_update?.length ?? 0) + (analysis.purchase_items?.length ?? 0)
    + (analysis.work_orders_to_create?.length ?? 0) + (analysis.review_flags?.length ?? 0) > 0
  );

  return (
    <Card className="border-blue-100 bg-blue-50/60 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-1 rounded-xl bg-blue-600 p-2 text-white"><Sparkles className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-slate-900">AI-sammanfattning</h3>
              <p className="text-xs text-slate-500">Förslag skapas för granskning -- inget skapas eller ändras förrän du klickar. Finns kvar här även om du byter flik eller möte.</p>
            </div>
            <Button size="sm" variant="secondary" onClick={onRunAnalysis} disabled={loading}>
              {loading ? 'Analyserar...' : analysis ? 'Analysera igen' : 'Analysera med AI'}
            </Button>
          </div>

          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {!analysis && !loading && !error && <p className="text-sm text-slate-500">Ingen analys ännu för det här mötet.</p>}
          {analysis && !hasContent && !loading && <p className="text-sm text-slate-500">AI:n hittade inga förslag i protokollet.</p>}

          {analysis?.summary && <p className="text-sm leading-6 text-slate-700">{analysis.summary}</p>}
          {analysis?.warnings?.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-bold uppercase text-amber-700">Kontrollera</p>
              <ul className="mt-1 space-y-1 text-sm text-amber-800">{analysis.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          ) : null}

          {(analysis?.tasks_to_create?.length ?? 0) > 0 && (
            <Section title="Nya uppgifter">
              {analysis!.tasks_to_create!.map((item, index) => {
                const key = `task-create-${index}`;
                return (
                  <SuggestionRow key={key} applied={applied.has(key)} applying={applying.has(key)} onApply={() => onCreateTask(item, key)} applyLabel="Skapa uppgift" appliedLabel="Skapad">
                    <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                    {item.description && <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>}
                    <p className="mt-1 text-xs text-slate-400">{item.reason}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge className="bg-slate-100 text-slate-600">{priorityLabels[item.priority] || item.priority}</Badge>
                      {item.due_date && <Badge className="bg-slate-100 text-slate-600">{item.due_date}</Badge>}
                      {formatConfidence(item.confidence) && <Badge className="bg-blue-100 text-blue-700">{formatConfidence(item.confidence)}</Badge>}
                    </div>
                  </SuggestionRow>
                );
              })}
            </Section>
          )}

          {(analysis?.tasks_to_update?.length ?? 0) > 0 && (
            <Section title="Ändra befintliga uppgifter">
              {analysis!.tasks_to_update!.map((item, index) => {
                const key = `task-update-${index}`;
                const targetKnown = !!item.action_item_id && knownActionIds.has(item.action_item_id);
                const canApply = targetKnown && !!(item.new_status || item.new_priority);
                return (
                  <SuggestionRow key={key} applied={applied.has(key)} applying={applying.has(key)} onApply={() => onUpdateTask(item, key)} applyLabel="Applicera" appliedLabel="Uppdaterad" disabled={!canApply}>
                    <p className="text-sm font-semibold text-slate-800">{item.action_item_title_hint}</p>
                    <p className="mt-1 text-xs text-slate-400">{item.reason}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.new_status && <Badge className="bg-slate-100 text-slate-600">Ny status: {statusLabels[item.new_status] || item.new_status}</Badge>}
                      {item.new_priority && <Badge className="bg-slate-100 text-slate-600">Ny prioritet: {priorityLabels[item.new_priority] || item.new_priority}</Badge>}
                      {formatConfidence(item.confidence) && <Badge className="bg-blue-100 text-blue-700">{formatConfidence(item.confidence)}</Badge>}
                    </div>
                    {!targetKnown && <p className="mt-1 text-xs text-amber-600">Kunde inte matcha till en befintlig uppgift -- justera manuellt.</p>}
                  </SuggestionRow>
                );
              })}
            </Section>
          )}

          {(analysis?.purchase_items?.length ?? 0) > 0 && (
            <Section title="Inköpslista">
              {analysis!.purchase_items!.map((item, index) => {
                const key = `purchase-${index}`;
                return (
                  <SuggestionRow key={key} applied={applied.has(key)} applying={applying.has(key)} onApply={() => onAddPurchaseItem(item, key)} applyLabel="Lägg till" appliedLabel="Tillagd">
                    <p className="text-sm font-semibold text-slate-800">{item.item_name}{item.quantity ? ` (${item.quantity})` : ''}</p>
                    {item.notes && <p className="mt-0.5 text-xs text-slate-500">{item.notes}</p>}
                    <p className="mt-1 text-xs text-slate-400">{item.reason}</p>
                  </SuggestionRow>
                );
              })}
            </Section>
          )}

          {(analysis?.work_orders_to_create?.length ?? 0) > 0 && (
            <Section title="Nya arbetsordrar">
              {analysis!.work_orders_to_create!.map((item, index) => {
                const key = `wo-create-${index}`;
                return (
                  <SuggestionRow key={key} applied={applied.has(key)} applying={applying.has(key)} onApply={() => onCreateWorkOrder(item, key)} applyLabel="Skapa arbetsorder" appliedLabel="Skapad">
                    <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                    {item.description && <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>}
                    <p className="mt-1 text-xs text-slate-400">{item.reason}</p>
                    <Badge className="mt-1 bg-slate-100 text-slate-600">{priorityLabels[item.priority] || item.priority}</Badge>
                  </SuggestionRow>
                );
              })}
            </Section>
          )}

          {(analysis?.review_flags?.length ?? 0) > 0 && (
            <Section title="Övrigt att titta på">
              {analysis!.review_flags!.map((item, index) => (
                <div key={index} className="rounded-lg bg-slate-50 p-2">
                  <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{item.detail}</p>
                  <p className="mt-1 text-xs text-slate-400">{item.reason}</p>
                </div>
              ))}
            </Section>
          )}

          {analysis?.model && (
            <p className="text-xs text-slate-400">Modell: {analysis.model}{typeof analysis.estimated_cost_sek === 'number' ? ` · ca ${analysis.estimated_cost_sek.toFixed(4)} kr` : ''}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white bg-white p-3 shadow-sm">
      <p className="text-sm font-bold text-slate-800">{title}</p>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

function SuggestionRow({ children, applied, applying, disabled, onApply, applyLabel, appliedLabel }: {
  children: ReactNode; applied: boolean; applying: boolean; disabled?: boolean; onApply: () => void; applyLabel: string; appliedLabel: string;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">{children}</div>
        <Button size="sm" variant={applied ? 'secondary' : 'primary'} disabled={applied || applying || disabled} onClick={onApply}>
          {applied ? appliedLabel : applying ? '...' : applyLabel}
        </Button>
      </div>
    </div>
  );
}
