import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Briefcase, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Plus, StickyNote, Trash2, UserX, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Button, EmptyState, Input, LoadingPage, Modal, PageHeader, Select, Textarea } from '../components/ui';
import type { Profile, ScheduleEntry, ScheduleEntryType } from '../types';

interface StaffSchedulePageProps {
  onNavigate: (page: string) => void;
}

const WEEKDAY_LABELS = ['Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör', 'Sön'];

const ENTRY_TYPE_META: Record<ScheduleEntryType, { label: string; icon: typeof ClipboardList; className: string }> = {
  work_order: { label: 'Arbetsorder', icon: ClipboardList, className: 'bg-blue-500/90 text-white' },
  maintenance_request: { label: 'Felanmälan', icon: AlertTriangle, className: 'bg-amber-500/90 text-white' },
  customer_project: { label: 'Kundprojekt', icon: Briefcase, className: 'bg-violet-500/90 text-white' },
  note: { label: 'Fritt block', icon: StickyNote, className: 'bg-slate-500/90 text-white' },
};

const ABSENCE_CLASS = 'bg-rose-400/80 text-white';

/** Full, chunky filled blocks (à la Timetjek's schedule grid) rather than
 * thin pills -- each lane gets enough height for a small caps type/time
 * line plus a bold title line. */
const LANE_HEIGHT = 50;
const CHIP_HEIGHT = 42;
const LABEL_WIDTH = 200;
/** A plain click has to still open the edit modal, so a drag only
 * "counts" once the pointer has actually moved past a small threshold --
 * same click-vs-drag distinction SwipeableCleaningCard uses (ShortStayPage.tsx). */
const DRAG_THRESHOLD_PX = 4;

function formatVisitTime(value: string | null) {
  return value ? value.slice(0, 5) : '';
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addDaysToKey(dateKey: string, days: number) {
  return toDateKey(addDays(new Date(`${dateKey}T12:00:00`), days));
}

function startOfWeekMonday(date: Date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

/** Clamped day index (0-6) within the visible week -- used to position a
 * band that may start before or end after the visible week (it's just
 * clipped at the edge, same as ShortStayPage's calendar bands). */
function dayIndexClamped(dateStr: string, weekStartKey: string) {
  const diff = Math.round((new Date(`${dateStr}T12:00:00`).getTime() - new Date(`${weekStartKey}T12:00:00`).getTime()) / 86400000);
  return Math.min(6, Math.max(0, diff));
}

type ReferenceOption = { id: string; title: string; subtitle: string };

type Band =
  | { kind: 'entry'; start_date: string; end_date: string; entry: ScheduleEntry }
  | { kind: 'absence'; start_date: string; end_date: string; userId: string };

/** Greedy interval packing: each item goes in the first lane whose last
 * item ends before this one starts, otherwise it opens a new lane -- so
 * overlapping items (e.g. a week-long project plus a one-day work order)
 * stack instead of colliding. */
function packLanes(items: Band[]): Band[][] {
  const sorted = [...items].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const lanes: Band[][] = [];
  for (const item of sorted) {
    const lane = lanes.find(l => l[l.length - 1].end_date < item.start_date);
    if (lane) lane.push(item); else lanes.push([item]);
  }
  return lanes;
}

interface ModalState {
  open: boolean;
  userId: string;
  userName: string;
  date: string;
  editing?: ScheduleEntry;
}

type DragKind = 'move' | 'resize-start' | 'resize-end';

interface DragState {
  kind: DragKind;
  entry: ScheduleEntry;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  /** Pointer position relative to the chip's own top-left at drag start --
   * needed so the floating ghost (see render) tracks the cursor without
   * snapping the chip's corner to it. Only meaningful for kind 'move'. */
  offsetX: number;
  offsetY: number;
  dayColumnWidth: number;
  originStartDate: string;
  originEndDate: string;
  originUserId: string;
  previewStartDate: string;
  previewEndDate: string;
  previewUserId: string;
  moved: boolean;
}

export function StaffSchedulePage({ onNavigate: _onNavigate }: StaffSchedulePageProps) {
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'superadmin';

  const [weekStart, setWeekStart] = useState(() => startOfWeekMonday(new Date()));
  const [staff, setStaff] = useState<Profile[]>([]);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [absences, setAbsences] = useState<{ user_id: string; start_date: string; end_date: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modal, setModal] = useState<ModalState>({ open: false, userId: '', userName: '', date: '' });
  const [entryType, setEntryType] = useState<ScheduleEntryType>('work_order');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ReferenceOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedRef, setSelectedRef] = useState<ReferenceOption | null>(null);
  const [freeTitle, setFreeTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [visitTime, setVisitTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [drag, setDrag] = useState<DragState | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const weekDayKeys = useMemo(() => Array.from({ length: 7 }, (_, i) => toDateKey(addDays(weekStart, i))), [weekStart]);
  const weekStartKey = weekDayKeys[0];
  const weekEndKey = weekDayKeys[6];
  const todayKeyValue = toDateKey(new Date());

  useEffect(() => {
    fetchWeek();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.organisation_id, weekStartKey]);

  async function fetchWeek() {
    if (!user?.organisation_id) return;
    setLoading(true);
    setError('');

    const [staffResult, entriesResult, absenceResult] = await Promise.all([
      supabase.from('vihem_profiles').select('id,name,role,active').eq('organisation_id', user.organisation_id).in('role', ['staff', 'admin', 'superadmin']).eq('active', true).order('name'),
      supabase.from('vihem_schedule_entries').select('*').eq('organisation_id', user.organisation_id).lte('start_date', weekEndKey).gte('end_date', weekStartKey),
      supabase.rpc('vihem_schedule_absence_overlaps', { p_from: weekStartKey, p_to: weekEndKey }),
    ]);

    if (staffResult.error) setError(staffResult.error.message);
    else if (entriesResult.error) setError(entriesResult.error.message);
    else if (absenceResult.error) setError(absenceResult.error.message);

    setStaff((staffResult.data || []) as Profile[]);
    setEntries((entriesResult.data || []) as ScheduleEntry[]);
    setAbsences((absenceResult.data || []) as { user_id: string; start_date: string; end_date: string }[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!modal.open || entryType === 'note' || !user?.organisation_id) { setSearchResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const timeout = window.setTimeout(async () => {
      const results = await searchReferences(entryType, user.organisation_id!, searchQuery);
      if (!cancelled) { setSearchResults(results); setSearching(false); }
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [modal.open, entryType, searchQuery, user?.organisation_id]);

  async function searchReferences(type: ScheduleEntryType, organisationId: string, query: string): Promise<ReferenceOption[]> {
    const q = query.trim();
    if (type === 'work_order') {
      let req = supabase.from('vihem_work_orders').select('id,title,property:vihem_properties(name),apartment:vihem_apartments(apartment_number)').eq('organisation_id', organisationId).not('status', 'in', '(completed,cancelled)').order('created_at', { ascending: false }).limit(15);
      if (q) req = req.ilike('title', `%${q}%`);
      const { data } = await req;
      return (data || []).map((row: any) => ({ id: row.id, title: row.title, subtitle: [row.property?.name, row.apartment?.apartment_number ? `Lgh ${row.apartment.apartment_number}` : ''].filter(Boolean).join(' · ') }));
    }
    if (type === 'maintenance_request') {
      let req = supabase.from('vihem_maintenance_requests').select('id,title,property:vihem_properties(name),apartment:vihem_apartments(apartment_number)').eq('organisation_id', organisationId).not('status', 'in', '(done,closed)').order('created_at', { ascending: false }).limit(15);
      if (q) req = req.ilike('title', `%${q}%`);
      const { data } = await req;
      return (data || []).map((row: any) => ({ id: row.id, title: row.title, subtitle: [row.property?.name, row.apartment?.apartment_number ? `Lgh ${row.apartment.apartment_number}` : ''].filter(Boolean).join(' · ') }));
    }
    // customer_project
    let req = supabase.from('vihem_customer_projects').select('id,title,name,customer_name').eq('organisation_id', organisationId).not('status', 'in', '(completed,archived,cancelled)').order('created_at', { ascending: false }).limit(15);
    if (q) req = req.or(`title.ilike.%${q}%,name.ilike.%${q}%,customer_name.ilike.%${q}%`);
    const { data } = await req;
    return (data || []).map((row: any) => ({ id: row.id, title: row.title || row.name, subtitle: row.customer_name || '' }));
  }

  function openCreateModal(staffMember: Profile, dateKeyValue: string) {
    setModal({ open: true, userId: staffMember.id, userName: staffMember.name, date: dateKeyValue });
    setEntryType('work_order');
    setSearchQuery('');
    setSearchResults([]);
    setSelectedRef(null);
    setFreeTitle('');
    setSubtitle('');
    setStartDate(dateKeyValue);
    setEndDate(dateKeyValue);
    setVisitTime('');
    setFormError('');
  }

  function openEditModal(entry: ScheduleEntry, staffMember: Profile) {
    setModal({ open: true, userId: entry.user_id, userName: staffMember.name, date: entry.start_date, editing: entry });
    setEntryType(entry.entry_type);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedRef(entry.entry_type === 'note' ? null : { id: entry.reference_id || '', title: entry.title, subtitle: entry.subtitle });
    setFreeTitle(entry.entry_type === 'note' ? entry.title : '');
    setSubtitle(entry.subtitle);
    setStartDate(entry.start_date);
    setEndDate(entry.end_date);
    setVisitTime(entry.visit_time ? entry.visit_time.slice(0, 5) : '');
    setFormError('');
  }

  function closeModal() {
    setModal({ open: false, userId: '', userName: '', date: '' });
  }

  function pickReference(option: ReferenceOption) {
    setSelectedRef(option);
    if (!subtitle) setSubtitle(option.subtitle);
  }

  async function saveEntry() {
    if (!user?.organisation_id) return;
    if (entryType === 'note' && !freeTitle.trim()) { setFormError('Skriv en text för blocket.'); return; }
    if (entryType !== 'note' && !selectedRef) { setFormError('Välj vad som ska schemaläggas.'); return; }
    if (!startDate || !endDate) { setFormError('Ange start- och slutdatum.'); return; }
    if (endDate < startDate) { setFormError('Slutdatum kan inte ligga före startdatum.'); return; }

    setSaving(true);
    setFormError('');

    const payload = {
      organisation_id: user.organisation_id,
      user_id: modal.userId,
      entry_type: entryType,
      reference_id: entryType === 'note' ? null : selectedRef!.id,
      title: entryType === 'note' ? freeTitle.trim() : selectedRef!.title,
      subtitle: subtitle.trim(),
      start_date: startDate,
      end_date: endDate,
      visit_time: visitTime || null,
      created_by: user.id,
    };

    const result = modal.editing
      ? await supabase.from('vihem_schedule_entries').update(payload).eq('id', modal.editing.id)
      : await supabase.from('vihem_schedule_entries').insert(payload);

    setSaving(false);
    if (result.error) { setFormError(result.error.message); return; }
    closeModal();
    await fetchWeek();
  }

  async function deleteEntry() {
    if (!modal.editing) return;
    const confirmed = window.confirm('Ta bort den här schemaraden?');
    if (!confirmed) return;
    setSaving(true);
    const { error: deleteError } = await supabase.from('vihem_schedule_entries').delete().eq('id', modal.editing.id);
    setSaving(false);
    if (deleteError) { setFormError(deleteError.message); return; }
    closeModal();
    await fetchWeek();
  }

  function measureDayColumnWidth() {
    const width = tableRef.current?.getBoundingClientRect().width;
    return width ? (width - LABEL_WIDTH) / 7 : 100;
  }

  /** Which staff row's vertical band currently contains this pointer Y --
   * used while dragging a whole entry so it can be dropped on a different
   * person, not just a different day. */
  function hitTestUserId(clientY: number, fallback: string) {
    for (const [userId, el] of rowRefs.current) {
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return userId;
    }
    return fallback;
  }

  /** A move in progress renders as a floating ghost instead of in the
   * grid (see render), so the dragged entry is simply absent from every
   * row's own bands/lane packing while it's being moved -- resizing still
   * repositions in place, it never changes which row it's in. */
  /** A resize repositions its chip in place as the preview updates. A move
   * deliberately does NOT -- the real chip stays mounted at its exact
   * original row/dates for the whole gesture (dimmed, see render) and a
   * separate floating ghost shows the live preview instead. Pulling the
   * chip out of the grid (e.g. to "show" it at the preview position/row)
   * would unmount that DOM node mid-drag, which silently releases the
   * pointer capture it's holding -- move/up events then start hitting
   * whatever else is under the cursor by ordinary hit-testing instead,
   * which is exactly what made the whole board feel like it was jumping
   * around. */
  function effectiveUserId(entry: ScheduleEntry) {
    if (!drag || drag.entry.id !== entry.id || drag.kind === 'move') return entry.user_id;
    return drag.previewUserId;
  }

  function effectiveDates(entry: ScheduleEntry) {
    if (!drag || drag.entry.id !== entry.id || drag.kind === 'move') return { start: entry.start_date, end: entry.end_date };
    return { start: drag.previewStartDate, end: drag.previewEndDate };
  }

  function beginDrag(event: React.PointerEvent<HTMLElement>, entry: ScheduleEntry, kind: DragKind) {
    if (!canManage) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      kind,
      entry,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      dayColumnWidth: measureDayColumnWidth(),
      originStartDate: entry.start_date,
      originEndDate: entry.end_date,
      originUserId: entry.user_id,
      previewStartDate: entry.start_date,
      previewEndDate: entry.end_date,
      previewUserId: entry.user_id,
      moved: false,
    });
  }

  function handleDragMove(event: React.PointerEvent<HTMLElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const dxClientX = event.clientX - drag.startClientX;
    const dxClientY = event.clientY - drag.startClientY;
    const moved = drag.moved || Math.abs(dxClientX) > DRAG_THRESHOLD_PX || Math.abs(dxClientY) > DRAG_THRESHOLD_PX;
    const dxDays = Math.round(dxClientX / drag.dayColumnWidth);

    if (drag.kind === 'move') {
      const targetUserId = hitTestUserId(event.clientY, drag.previewUserId);
      setDrag({
        ...drag,
        moved,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        previewStartDate: addDaysToKey(drag.originStartDate, dxDays),
        previewEndDate: addDaysToKey(drag.originEndDate, dxDays),
        previewUserId: targetUserId,
      });
    } else if (drag.kind === 'resize-end') {
      const nextEnd = addDaysToKey(drag.originEndDate, dxDays);
      setDrag({ ...drag, moved, previewEndDate: nextEnd < drag.originStartDate ? drag.originStartDate : nextEnd });
    } else {
      const nextStart = addDaysToKey(drag.originStartDate, dxDays);
      setDrag({ ...drag, moved, previewStartDate: nextStart > drag.originEndDate ? drag.originEndDate : nextStart });
    }
  }

  /** Self-contained (reads everything from `drag` + `staff`) so it can be
   * called both from the dragged element's own onPointerUp AND from the
   * window-level fallback below -- pointer capture should route pointerup
   * back to the element that called setPointerCapture regardless of where
   * the cursor ends up, but relying on that alone left the drag "stuck"
   * (a floating ghost forever) whenever it didn't for some reason, so
   * there's always a second, coarser way out. */
  async function endDrag() {
    if (!drag) return;
    const snapshot = drag;
    setDrag(null);

    if (!snapshot.moved) {
      const owner = staff.find(member => member.id === snapshot.originUserId);
      if (owner) openEditModal(snapshot.entry, owner);
      return;
    }

    const changed = snapshot.previewStartDate !== snapshot.originStartDate
      || snapshot.previewEndDate !== snapshot.originEndDate
      || snapshot.previewUserId !== snapshot.originUserId;
    if (!changed) return;

    const { error: updateError } = await supabase
      .from('vihem_schedule_entries')
      .update({ start_date: snapshot.previewStartDate, end_date: snapshot.previewEndDate, user_id: snapshot.previewUserId })
      .eq('id', snapshot.entry.id);
    if (updateError) { setError(updateError.message); return; }
    await fetchWeek();
  }

  function cancelDrag() {
    setDrag(null);
  }

  useEffect(() => {
    if (!drag) return;
    const onWindowPointerUp = () => { void endDrag(); };
    const onWindowPointerCancel = () => cancelDrag();
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerCancel);
    return () => {
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  if (loading) return <LoadingPage />;

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <PageHeader
        title="Schema"
        subtitle="Se vad var och en ska arbeta med under veckan."
        icon={CalendarDays}
        action={(
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Föregående vecka">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeekMonday(new Date()))}>
              Denna vecka
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Nästa vecka">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      />

      {error && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
      )}

      <div className="mb-4 text-sm font-bold text-slate-500">
        {new Date(`${weekStartKey}T12:00:00`).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' })} – {new Date(`${weekEndKey}T12:00:00`).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' })}
      </div>

      {staff.length === 0 ? (
        <EmptyState icon={CalendarDays} title="Ingen personal hittades" description="Lägg till personal under Personal-sidan först." />
      ) : (
        <div ref={tableRef} className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${drag ? 'select-none' : ''}`}>
          <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: `${LABEL_WIDTH}px repeat(7, 1fr)` }}>
            <div className="px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-500">Personal</div>
            {weekDayKeys.map((dayKey, index) => (
              <div key={dayKey} className={`border-l border-slate-200 px-2 py-3 text-center text-xs font-black uppercase tracking-wide ${dayKey === todayKeyValue ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}>
                {WEEKDAY_LABELS[index]}
                <div className="mt-0.5 font-semibold normal-case tracking-normal text-slate-400">{new Date(`${dayKey}T12:00:00`).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}</div>
              </div>
            ))}
          </div>

          {staff.map(staffMember => {
            const bands: Band[] = [
              ...entries.filter(e => effectiveUserId(e) === staffMember.id).map((entry): Band => {
                const eff = effectiveDates(entry);
                return { kind: 'entry', start_date: eff.start, end_date: eff.end, entry };
              }),
              ...absences.filter(a => a.user_id === staffMember.id).map((absence): Band => ({ kind: 'absence', start_date: absence.start_date, end_date: absence.end_date, userId: absence.user_id })),
            ];
            const lanes = packLanes(bands);
            const rowHeight = Math.max(1, lanes.length) * LANE_HEIGHT + 12;

            const isMoveTarget = drag?.kind === 'move' && drag.moved && drag.previewUserId === staffMember.id;

            return (
              <div key={staffMember.id} className="grid border-b border-slate-100 last:border-b-0" style={{ gridTemplateColumns: `${LABEL_WIDTH}px 1fr` }}>
                <div className="flex items-center px-4 py-2 text-sm font-black text-slate-900">{staffMember.name}</div>
                <div
                  ref={(el) => { if (el) rowRefs.current.set(staffMember.id, el); else rowRefs.current.delete(staffMember.id); }}
                  className={`relative transition-colors ${isMoveTarget ? 'bg-blue-50' : ''}`}
                  style={{ height: rowHeight }}
                >
                  <div className="absolute inset-0 grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
                    {weekDayKeys.map(dayKey => (
                      <button
                        key={dayKey}
                        type="button"
                        disabled={!canManage}
                        onClick={() => canManage && openCreateModal(staffMember, dayKey)}
                        className={`group h-full border-l border-slate-100 ${canManage ? 'hover:bg-blue-50/60' : ''}`}
                        aria-label={`Lägg till för ${staffMember.name} ${dayKey}`}
                      >
                        {canManage && <Plus className="mx-auto mt-1 h-3.5 w-3.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />}
                      </button>
                    ))}
                  </div>
                  <div className="pointer-events-none absolute inset-0">
                    {lanes.map((lane, laneIndex) => (
                      <div key={laneIndex}>
                        {lane.map((band, bandIndex) => {
                          const startIdx = dayIndexClamped(band.start_date, weekStartKey);
                          const endIdx = dayIndexClamped(band.end_date, weekStartKey);
                          const left = (startIdx / 7) * 100;
                          const width = ((endIdx - startIdx + 1) / 7) * 100;
                          if (band.kind === 'absence') {
                            return (
                              <div
                                key={`absence-${bandIndex}`}
                                className={`pointer-events-auto absolute flex flex-col justify-center gap-0.5 overflow-hidden rounded-xl px-2.5 py-1.5 shadow-sm ${ABSENCE_CLASS}`}
                                style={{ left: `${left}%`, width: `${width}%`, top: laneIndex * LANE_HEIGHT + 4, height: CHIP_HEIGHT }}
                              >
                                <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide opacity-90">
                                  <UserX className="h-3 w-3 shrink-0" />
                                  Frånvaro
                                </span>
                                <span className="truncate text-xs font-bold">Frånvarande</span>
                              </div>
                            );
                          }
                          const meta = ENTRY_TYPE_META[band.entry.entry_type];
                          const Icon = meta.icon;
                          const time = formatVisitTime(band.entry.visit_time);
                          const isDragging = drag?.entry.id === band.entry.id;
                          const isMoving = isDragging && drag?.kind === 'move' && drag.moved;
                          return (
                            <div
                              key={band.entry.id}
                              role="button"
                              tabIndex={canManage ? 0 : -1}
                              aria-label={`${meta.label}: ${band.entry.title}`}
                              className={`pointer-events-auto absolute flex select-none flex-col justify-center gap-0.5 overflow-hidden rounded-xl px-2.5 py-1.5 text-left shadow-sm ${meta.className} ${canManage ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${isMoving ? 'opacity-30' : isDragging ? 'z-10 opacity-90 ring-2 ring-white' : ''}`}
                              style={{ left: `${left}%`, width: `${width}%`, top: laneIndex * LANE_HEIGHT + 4, height: CHIP_HEIGHT, touchAction: 'none' }}
                              title={`${meta.label}${time ? ' · ' + time : ''}: ${band.entry.title}${band.entry.subtitle ? ' · ' + band.entry.subtitle : ''}`}
                              onPointerDown={(event) => beginDrag(event, band.entry, 'move')}
                              onPointerMove={handleDragMove}
                              onPointerUp={() => endDrag()}
                              onPointerCancel={cancelDrag}
                              onKeyDown={(event) => {
                                if (canManage && (event.key === 'Enter' || event.key === ' ')) openEditModal(band.entry, staffMember);
                              }}
                            >
                              <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide opacity-90">
                                <Icon className="h-3 w-3 shrink-0" />
                                {/* A single day-column is too narrow for icon + type label + time
                                    all at once -- the time is the more specific, useful detail
                                    when it's set (color/icon already carry the type), so it wins. */}
                                <span className="min-w-0 truncate">{time || meta.label}</span>
                              </span>
                              <span className="truncate text-xs font-bold">{band.entry.title}</span>
                              {canManage && (
                                <>
                                  <span
                                    className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize"
                                    style={{ touchAction: 'none' }}
                                    onPointerDown={(event) => beginDrag(event, band.entry, 'resize-start')}
                                    onPointerMove={handleDragMove}
                                    onPointerUp={() => endDrag()}
                                    onPointerCancel={cancelDrag}
                                  />
                                  <span
                                    className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize"
                                    style={{ touchAction: 'none' }}
                                    onPointerDown={(event) => beginDrag(event, band.entry, 'resize-end')}
                                    onPointerMove={handleDragMove}
                                    onPointerUp={() => endDrag()}
                                    onPointerCancel={cancelDrag}
                                  />
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {drag?.kind === 'move' && drag.moved && (() => {
        const meta = ENTRY_TYPE_META[drag.entry.entry_type];
        const Icon = meta.icon;
        const time = formatVisitTime(drag.entry.visit_time);
        const spanDays = dayIndexClamped(drag.previewEndDate, weekStartKey) - dayIndexClamped(drag.previewStartDate, weekStartKey) + 1;
        return (
          <div
            className={`pointer-events-none fixed z-50 flex flex-col justify-center gap-0.5 overflow-hidden rounded-xl px-2.5 py-1.5 text-left shadow-lg ${meta.className}`}
            style={{
              left: drag.currentClientX - drag.offsetX,
              top: drag.currentClientY - drag.offsetY,
              width: drag.dayColumnWidth * spanDays,
              height: CHIP_HEIGHT,
            }}
          >
            <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide opacity-90">
              <Icon className="h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate">{time || meta.label}</span>
            </span>
            <span className="truncate text-xs font-bold">{drag.entry.title}</span>
          </div>
        );
      })()}

      <Modal open={modal.open} onClose={closeModal} title={modal.editing ? 'Redigera schemarad' : `Lägg till för ${modal.userName}`} size="lg">
        <div className="grid gap-4">
          <Select
            label="Typ"
            value={entryType}
            onChange={(event) => { setEntryType(event.target.value as ScheduleEntryType); setSelectedRef(null); setSearchQuery(''); }}
            options={Object.entries(ENTRY_TYPE_META).map(([value, meta]) => ({ value, label: meta.label }))}
          />

          {entryType === 'note' ? (
            <Input label="Text" value={freeTitle} onChange={(event) => setFreeTitle(event.target.value)} placeholder="Ex. Administration, Semester, Utbildning" />
          ) : (
            <div>
              <label className="mb-1.5 block text-sm font-bold text-slate-700">{ENTRY_TYPE_META[entryType].label}</label>
              {selectedRef ? (
                <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">{selectedRef.title}</p>
                    {selectedRef.subtitle && <p className="truncate text-sm text-slate-500">{selectedRef.subtitle}</p>}
                  </div>
                  <button type="button" onClick={() => setSelectedRef(null)} className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-blue-100" aria-label="Ändra val">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Sök..." />
                  <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1.5">
                    {searching ? (
                      <p className="px-3 py-2 text-sm text-slate-500">Söker...</p>
                    ) : searchResults.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-slate-500">Inga träffar.</p>
                    ) : (
                      searchResults.map(option => (
                        <button key={option.id} type="button" onClick={() => pickReference(option)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50">
                          <p className="truncate text-sm font-bold text-slate-900">{option.title}</p>
                          {option.subtitle && <p className="truncate text-xs text-slate-500">{option.subtitle}</p>}
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Input type="date" label="Startdatum" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            <Input type="date" label="Slutdatum" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            <Input type="time" label="Klockslag (valfritt)" value={visitTime} onChange={(event) => setVisitTime(event.target.value)} hint="Ex. besök hos kund" />
          </div>

          <Textarea label="Notering (valfritt)" rows={2} value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder="Ex. fastighet, extra info..." />

          {formError && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{formError}</div>}

          <div className="flex items-center justify-between">
            {modal.editing ? (
              <Button type="button" variant="outline" onClick={deleteEntry} loading={saving}>
                <Trash2 className="h-4 w-4" />
                Ta bort
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={closeModal}>Avbryt</Button>
              <Button type="button" onClick={saveEntry} loading={saving}>Spara</Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
