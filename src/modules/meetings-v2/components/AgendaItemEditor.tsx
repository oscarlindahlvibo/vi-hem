// En dagordningspunkt i Möten V2: en alltid synlig, stor, autosparande
// fritextruta (skriver till vihem_meeting_agenda_items.notes) plus
// klickbara chips för länkade objekt (vihem_meeting_object_links). Ersätter
// legacys välj-punkt-för-att-se-den-i-sidopanel-mönster.
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Link as LinkIcon, Plus, X } from 'lucide-react';
import { Textarea } from '../../../components/ui';
import type { MeetingAgendaItem } from '../../../types';
import type { MeetingObjectLink } from '../types';

const AUTOSAVE_DEBOUNCE_MS = 800;

export function AgendaItemEditor({ item, links, canManage, onNotesChange, onToggleStatus, onOpenLinkPicker, onOpenEntityPreview, onRemoveLink }: {
  item: MeetingAgendaItem;
  links: MeetingObjectLink[];
  canManage: boolean;
  onNotesChange: (notes: string) => void;
  onToggleStatus: () => void;
  onOpenLinkPicker: () => void;
  onOpenEntityPreview: (link: MeetingObjectLink) => void;
  onRemoveLink: (linkId: string) => void;
}) {
  const [notes, setNotes] = useState(item.notes || '');
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saved'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDone = (item as { status?: string }).status === 'done';

  useEffect(() => { setNotes(item.notes || ''); }, [item.id, item.notes]);

  const scheduleSave = (value: string) => {
    setSaveState('pending');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onNotesChange(value);
      setSaveState('saved');
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  const handleChange = (value: string) => {
    setNotes(value);
    if (canManage) scheduleSave(value);
  };

  const handleBlur = () => {
    if (!canManage) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    onNotesChange(notes);
    setSaveState('saved');
  };

  return (
    <div className={`rounded-xl border p-4 ${isDone ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={canManage ? onToggleStatus : undefined} className="flex min-w-0 items-start gap-2 text-left" disabled={!canManage}>
          {isDone ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />}
          <span className={`font-semibold ${isDone ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{item.title}</span>
        </button>
        {saveState !== 'idle' && (
          <span className="shrink-0 text-xs text-slate-400">{saveState === 'pending' ? 'Sparar...' : 'Sparat'}</span>
        )}
      </div>

      {links.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {links.map((link) => (
            <span key={link.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-1 pl-2 pr-1 text-xs font-medium text-blue-700 ring-1 ring-blue-100">
              <button type="button" onClick={() => onOpenEntityPreview(link)} className="inline-flex items-center gap-1 hover:underline">
                <LinkIcon className="h-3 w-3" /> {link.label}
              </button>
              {canManage && (
                <button type="button" onClick={() => onRemoveLink(link.id)} className="rounded-full p-0.5 hover:bg-blue-100"><X className="h-3 w-3" /></button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3">
        <Textarea
          value={notes}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          rows={4}
          placeholder="Skriv fritt vad som sägs om den här punkten..."
          disabled={!canManage}
          className="text-sm"
        />
      </div>

      {canManage && (
        <button type="button" onClick={onOpenLinkPicker} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800">
          <Plus className="h-3.5 w-3.5" /> Koppla arbetsorder/kundprojekt/felanmälan
        </button>
      )}
    </div>
  );
}
