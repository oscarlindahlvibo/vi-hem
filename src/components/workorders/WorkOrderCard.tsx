import React, { useEffect, useRef, useState } from 'react';
import { Calendar, Check, ChevronRight, MoreHorizontal } from 'lucide-react';
import { Avatar, StatusBadge } from '../ui';
import type { StatusTone } from '../ui';
import { formatDate, WO_PRIORITY_LABELS, WO_STATUS_LABELS } from '../../lib/utils';
import type { WOPriority, WOStatus } from '../../types';

export interface WorkOrderCardProps {
  id: string;
  title: string;
  subtitle: string;
  status: WOStatus;
  priority: WOPriority;
  category: string;
  dueDate: string | null;
  overdue: boolean;
  assignees: string[];
  assigneeIds?: string[];
  /** Markeringsläge: kryssruta visas, svep/långtryck avstängt. */
  selectMode: boolean;
  selected: boolean;
  /** Svepåtgärder + snabbmeny (kräver personalbehörighet och aktiv arbetsorder). */
  canAct: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
  onComplete: () => void;
  onChangeDueDate: () => void;
  onMenu: () => void;
}

const THRESHOLD = 96;
const MAX_PULL = 150;
const LONG_PRESS_MS = 480;

function statusBadge(status: WOStatus, overdue: boolean): { tone: StatusTone; label: string } | null {
  if (overdue) return { tone: 'danger', label: 'Försenad' };
  if (status === 'completed') return { tone: 'success', label: 'Klar' };
  if (status === 'cancelled') return { tone: 'neutral', label: WO_STATUS_LABELS[status] };
  if (status === 'new') return { tone: 'neutral', label: 'Ny' };
  if (status === 'assigned') return { tone: 'neutral', label: 'Tilldelad' };
  return { tone: 'warning', label: WO_STATUS_LABELS[status] };
}

export function WorkOrderCard(props: WorkOrderCardProps) {
  const { title, subtitle, status, priority, category, dueDate, overdue, assignees, selectMode, selected, canAct } = props;
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ x: number; y: number; lock: 'h' | 'v' | null; pointerId: number } | null>(null);
  const suppressClick = useRef(false);
  const pressTimer = useRef<number | undefined>(undefined);
  const cardRef = useRef<HTMLDivElement>(null);
  const swipeEnabled = canAct && !selectMode;

  useEffect(() => () => window.clearTimeout(pressTimer.current), []);

  // iOS/Safari markerar annars text (och visar kopiera-menyn) vid långtryck. Stäng av det på kortet.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const block = (e: Event) => e.preventDefault();
    el.addEventListener('selectstart', block);
    return () => el.removeEventListener('selectstart', block);
  }, []);

  const clearPress = () => { window.clearTimeout(pressTimer.current); pressTimer.current = undefined; };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-no-gesture]')) return;
    gesture.current = { x: e.clientX, y: e.clientY, lock: null, pointerId: e.pointerId };
    suppressClick.current = false;
    if (canAct && !selectMode && e.pointerType !== 'mouse') {
      pressTimer.current = window.setTimeout(() => {
        suppressClick.current = true;
        gesture.current = null;
        setDx(0);
        setDragging(false);
        navigator.vibrate?.(12);
        window.getSelection()?.removeAllRanges();
        props.onMenu();
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const moveX = e.clientX - g.x;
    const moveY = e.clientY - g.y;
    if (Math.abs(moveX) > 8 || Math.abs(moveY) > 8) clearPress();
    if (!g.lock && (Math.abs(moveX) > 10 || Math.abs(moveY) > 10)) {
      g.lock = Math.abs(moveX) > Math.abs(moveY) * 1.4 ? 'h' : 'v';
      if (g.lock === 'h' && swipeEnabled) {
        try { e.currentTarget.setPointerCapture(g.pointerId); } catch { /* ignore */ }
        setDragging(true);
      }
    }
    if (g.lock === 'h' && swipeEnabled) {
      suppressClick.current = true;
      // Motstånd efter tröskeln så det känns som en fjäder.
      const sign = Math.sign(moveX);
      const abs = Math.abs(moveX);
      const eased = abs <= THRESHOLD ? abs : THRESHOLD + (abs - THRESHOLD) * 0.35;
      setDx(sign * Math.min(eased, MAX_PULL));
    }
  };

  const finish = (cancelled: boolean) => {
    clearPress();
    const g = gesture.current;
    gesture.current = null;
    if (g?.lock === 'h' && swipeEnabled && !cancelled) {
      if (dx >= THRESHOLD) props.onChangeDueDate();
      else if (dx <= -THRESHOLD) props.onComplete();
    }
    setDragging(false);
    setDx(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (selectMode) props.onToggleSelect(); else props.onOpen();
    }
  };

  const badge = statusBadge(status, overdue);
  const showPriority = priority === 'high' || priority === 'urgent';
  const leftProgress = Math.min(Math.max(dx, 0) / THRESHOLD, 1);
  const rightProgress = Math.min(Math.max(-dx, 0) / THRESHOLD, 1);
  const firstAssignee = assignees[0];

  return (
    <div className="relative overflow-hidden rounded-card">
      {swipeEnabled && (
        <>
          <div className="absolute inset-y-0 left-0 flex w-full items-center bg-vihem-blue pl-5 text-white" style={{ opacity: dx > 0 ? 0.35 + leftProgress * 0.65 : 0 }} aria-hidden>
            <span className="flex items-center gap-2 text-sm font-bold" style={{ transform: `scale(${0.85 + leftProgress * 0.2})` }}>
              <Calendar className="h-6 w-6" />{leftProgress >= 1 ? 'Släpp för att ändra datum' : 'Förfallodatum'}
            </span>
          </div>
          <div className="absolute inset-y-0 right-0 flex w-full items-center justify-end bg-vihem-success pr-5 text-white" style={{ opacity: dx < 0 ? 0.35 + rightProgress * 0.65 : 0 }} aria-hidden>
            <span className="flex items-center gap-2 text-sm font-bold" style={{ transform: `scale(${0.85 + rightProgress * 0.2})` }}>
              {rightProgress >= 1 ? 'Släpp för att klarmarkera' : 'Klar'}<Check className="h-6 w-6" />
            </span>
          </div>
        </>
      )}
      <div
        ref={cardRef}
        role="button"
        tabIndex={0}
        aria-label={`Öppna arbetsorder ${title}`}
        aria-pressed={selectMode ? selected : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => finish(false)}
        onPointerCancel={() => finish(true)}
        onContextMenu={(e) => { if (canAct && !selectMode) { e.preventDefault(); props.onMenu(); } }}
        onClick={() => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          if (selectMode) props.onToggleSelect(); else props.onOpen();
        }}
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: dragging ? 'none' : 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
          touchAction: 'pan-y',
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
        className={`relative flex cursor-pointer select-none items-stretch gap-3 rounded-card border bg-white px-3.5 py-3 shadow-card outline-none transition-colors focus-visible:ring-2 focus-visible:ring-vihem-blue ${
          selected ? 'border-vihem-blue bg-blue-50/60' : 'border-slate-200/70'
        }`}
      >
        {selectMode && (
          <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-full border-2 transition-colors ${selected ? 'border-vihem-blue bg-vihem-blue text-white' : 'border-slate-300 bg-white'}`}>
            {selected && <Check className="h-3.5 w-3.5" />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-vihem-ink">{title}</h3>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {badge && <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
              {showPriority && <StatusBadge tone="priority">{priority === 'urgent' ? 'Akut' : WO_PRIORITY_LABELS[priority]}</StatusBadge>}
            </div>
          </div>
          {subtitle&&<p className="mt-0.5 truncate text-[13px] text-vihem-muted">{subtitle}</p>}
          <div className="mt-2.5 flex items-center gap-x-3 gap-y-1 text-xs text-vihem-muted">
            <span className="flex min-w-0 items-center gap-1.5">
              {firstAssignee ? <Avatar name={firstAssignee} userId={props.assigneeIds?.[0]} size="sm" /> : <Avatar name="–" size="sm" className="bg-slate-100 text-slate-400" />}
              <span className="truncate font-medium text-slate-600">{firstAssignee ? `${firstAssignee.split(' ')[0]}${assignees.length > 1 ? ` +${assignees.length - 1}` : ''}` : 'Ej tilldelad'}</span>
            </span>
            {category && <span className="hidden max-w-[7rem] truncate rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 min-[380px]:inline">{category}</span>}
            <span className={`ml-auto flex shrink-0 items-center gap-1 font-medium ${overdue ? 'text-vihem-danger' : ''}`}>
              <Calendar className="h-3.5 w-3.5" />{dueDate ? formatDate(dueDate) : 'Inget datum'}
            </span>
          </div>
        </div>
        {!selectMode && (
          <div className="flex shrink-0 flex-col items-center justify-between">
            {canAct ? (
              <button
                type="button"
                data-no-gesture
                aria-label="Fler åtgärder"
                onClick={(e) => { e.stopPropagation(); props.onMenu(); }}
                className="-mr-1.5 -mt-1 flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              ><MoreHorizontal className="h-5 w-5" /></button>
            ) : <span className="h-9" />}
            <ChevronRight className="h-4 w-4 text-slate-300" />
          </div>
        )}
      </div>
    </div>
  );
}
