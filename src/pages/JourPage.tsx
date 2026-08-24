// Jour: fastighetsjour och snöjour. En datamodell (duty_type-fält på
// varje pass) med fem vyer: ett Gantt-liknande dagbesked, en bytesmarknad
// (annonsera/plocka, helt eller delat pass), inloggad users eget schema,
// och två admin-vyer (behörighet per jourtyp, grundschema/rotation).
// All affärslogik som måste vara atomär (klaim, dubbelbokningsspärr) körs
// server-side i databasen (se supabase/migrations/20260826100000_jour_module.sql)
// -- detta är bara läsningar/skrivningar direkt via supabase-js + RLS,
// samma mönster som AdminStaffPage.tsx/listMyAgreements().
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select } from '../components/ui';
import type { JourDutyType, JourEligibility, JourRotationRule, JourShift, JourSwapOffer, Profile } from '../types';
import { ArrowLeft, ArrowRight, Plus, RefreshCw, ShieldAlert, ShieldCheck, Snowflake, Trash2, Users } from 'lucide-react';

const DUTY_TYPES: JourDutyType[] = ['fastighet', 'sno', 'stad'];
const DUTY_LABELS: Record<JourDutyType, string> = { fastighet: 'Fastighetsjour', sno: 'Snöjour', stad: 'Städjour' };
const DUTY_BAR_CLASS: Record<JourDutyType, string> = { fastighet: 'bg-blue-500 hover:bg-blue-600', sno: 'bg-orange-500 hover:bg-orange-600', stad: 'bg-emerald-500 hover:bg-emerald-600' };
const DUTY_BADGE_CLASS: Record<JourDutyType, string> = { fastighet: 'bg-blue-100 text-blue-700', sno: 'bg-orange-100 text-orange-700', stad: 'bg-emerald-100 text-emerald-700' };
const DUTY_DOT_CLASS: Record<JourDutyType, string> = { fastighet: 'bg-blue-500', sno: 'bg-orange-500', stad: 'bg-emerald-500' };
const DUTY_ORDER: Record<JourDutyType, number> = { fastighet: 0, sno: 1, stad: 2 };
const UNASSIGNED_LABEL = 'Obemannat';

type ViewMode = 'day' | 'week' | 'twoweeks' | 'month';
const VIEW_MODES: ViewMode[] = ['day', 'week', 'twoweeks', 'month'];
const VIEW_MODE_LABELS: Record<ViewMode, string> = { day: 'Dag', week: 'Vecka', twoweeks: '14 dagar', month: 'Månad' };
const VIEW_MODE_DAYS: Record<ViewMode, number> = { day: 1, week: 7, twoweeks: 14, month: 30 };
const VIEW_MODE_COL_MIN: Record<ViewMode, number> = { day: 220, week: 110, twoweeks: 64, month: 44 };
const HOUR_TICKS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

function dateKey(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }
function fmtTime(value: string) { return new Date(value).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }); }
function startOfWeek(value: Date) { const result = new Date(value); result.setHours(0, 0, 0, 0); const day = result.getDay() || 7; result.setDate(result.getDate() - day + 1); return result; }
function fmtDateTime(value: string) { return new Date(value).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }); }
function fmtDate(value: string) { return new Date(value).toLocaleDateString('sv-SE', { dateStyle: 'short' }); }
function toLocalInputValue(value: string) { const d = new Date(value); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }

function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return 'Något gick fel.';
}

export function JourPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [tab, setTab] = useState<'dagbesked' | 'byten' | 'schema' | 'behorighet' | 'grundschema'>('dagbesked');
  const [profiles, setProfiles] = useState<Pick<Profile, 'id' | 'name'>[]>([]);
  const [myEligibility, setMyEligibility] = useState<JourEligibility[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!user?.organisation_id) return;
    supabase.from('vihem_profiles').select('id, name').eq('organisation_id', user.organisation_id).in('role', ['staff', 'admin', 'superadmin']).eq('active', true).order('name')
      .then(({ data }) => setProfiles(data || []));
    supabase.from('vihem_jour_eligibility').select('*').eq('user_id', user.id)
      .then(({ data }) => setMyEligibility((data || []) as JourEligibility[]));
  }, [user?.organisation_id, user?.id, reloadKey]);

  const profilesById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const myDutyTypes = useMemo(() => myEligibility.filter((e) => e.active).map((e) => e.duty_type), [myEligibility]);

  if (!user?.organisation_id) return <LoadingPage />;

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'dagbesked', label: 'Dagbesked' },
    { key: 'byten', label: 'Byten' },
    { key: 'schema', label: 'Mitt schema' },
    ...(isAdmin ? [{ key: 'behorighet' as const, label: 'Behörighet' }, { key: 'grundschema' as const, label: 'Grundschema' }] : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <PageHeader title="Jour" subtitle="Fastighetsjour och snöjour -- schema, dagbesked och passbyten" icon={ShieldAlert} />
        <div className="mb-6 flex flex-wrap gap-1 border-b border-slate-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'dagbesked' && <DagbeskedTab organisationId={user.organisation_id} profilesById={profilesById} profiles={profiles} isAdmin={isAdmin} userId={user.id} />}
        {tab === 'byten' && <BytenTab userId={user.id} organisationId={user.organisation_id} profilesById={profilesById} isAdmin={isAdmin} onChanged={reload} />}
        {tab === 'schema' && <MittSchemaTab userId={user.id} myDutyTypes={myDutyTypes} onChanged={reload} />}
        {isAdmin && tab === 'behorighet' && <BehorighetTab organisationId={user.organisation_id} userId={user.id} profiles={profiles} />}
        {isAdmin && tab === 'grundschema' && <GrundschemaTab organisationId={user.organisation_id} userId={user.id} profiles={profiles} />}
      </div>
    </div>
  );
}

// ── Dagbesked: Gantt-liknande tidslinje ─────────────────────────────────

function anchorForMode(mode: ViewMode, base: Date) {
  if (mode === 'day') { const d = new Date(base); d.setHours(0, 0, 0, 0); return d; }
  return startOfWeek(base);
}

function DagbeskedTab({ organisationId, profilesById, profiles, isAdmin, userId }: { organisationId: string; profilesById: Map<string, Pick<Profile, 'id' | 'name'>>; profiles: Pick<Profile, 'id' | 'name'>[]; isAdmin: boolean; userId: string }) {
  const [viewMode, setViewMode] = useState<ViewMode>('twoweeks');
  const [anchor, setAnchor] = useState(() => anchorForMode('twoweeks', new Date()));
  const [shifts, setShifts] = useState<JourShift[]>([]);
  const [openOfferShiftIds, setOpenOfferShiftIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  const [managing, setManaging] = useState<JourShift | null>(null);
  const [manageMode, setManageMode] = useState<'menu' | 'offer' | 'split' | 'assign' | 'delete'>('menu');
  const [manageError, setManageError] = useState('');
  const [manageSaving, setManageSaving] = useState(false);
  const [offerScope, setOfferScope] = useState<'whole' | 'partial'>('whole');
  const [offerStart, setOfferStart] = useState('');
  const [offerEnd, setOfferEnd] = useState('');
  const [offerAllowPartial, setOfferAllowPartial] = useState(false);
  const [offerNote, setOfferNote] = useState('');
  const [splitAt, setSplitAt] = useState('');
  const [splitSecondOwner, setSplitSecondOwner] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const windowDays = VIEW_MODE_DAYS[viewMode];
  const days = useMemo(() => Array.from({ length: windowDays }, (_, i) => { const d = new Date(anchor); d.setDate(anchor.getDate() + i); return d; }), [anchor, windowDays]);

  const changeViewMode = (mode: ViewMode) => { setViewMode(mode); setAnchor(anchorForMode(mode, new Date())); };

  const load = useCallback(async () => {
    setLoading(true);
    const from = days[0].toISOString();
    const to = new Date(days[days.length - 1].getTime() + 86400000).toISOString();
    const [{ data: shiftRows }, { data: offerRows }] = await Promise.all([
      supabase.from('vihem_jour_shifts').select('*').eq('organisation_id', organisationId).lt('starts_at', to).gt('ends_at', from).order('starts_at'),
      supabase.from('vihem_jour_swap_offers').select('shift_id').eq('organisation_id', organisationId).eq('status', 'open'),
    ]);
    setShifts((shiftRows || []) as JourShift[]);
    setOpenOfferShiftIds(new Set((offerRows || []).map((o: any) => o.shift_id)));
    setLoading(false);
  }, [organisationId, days]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const todayIdx = days.findIndex((d) => dateKey(d) === dateKey(new Date()));
    setSelectedDayIdx(todayIdx >= 0 ? todayIdx : 0);
  }, [days]);

  const selectedDayShifts = useMemo(() => {
    const selectedDay = days[selectedDayIdx];
    if (!selectedDay) return [];
    const dayStart = new Date(selectedDay); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayStart.getDate() + 1);
    return shifts
      .filter((s) => new Date(s.starts_at) < dayEnd && new Date(s.ends_at) > dayStart)
      .sort((a, b) => {
        if (DUTY_ORDER[a.duty_type] !== DUTY_ORDER[b.duty_type]) return DUTY_ORDER[a.duty_type] - DUTY_ORDER[b.duty_type];
        if (a.user_id === null) return 1;
        if (b.user_id === null) return -1;
        return (profilesById.get(a.user_id)?.name || '').localeCompare(profilesById.get(b.user_id)?.name || '');
      })
      .map((s) => {
        const shiftStart = new Date(s.starts_at);
        const shiftEnd = new Date(s.ends_at);
        const clippedStart = shiftStart < dayStart ? dayStart : shiftStart;
        const clippedEnd = shiftEnd > dayEnd ? dayEnd : shiftEnd;
        const spansWholeDay = clippedStart <= dayStart && clippedEnd >= dayEnd;
        const spansMultipleDays = shiftStart < dayStart || shiftEnd > dayEnd;
        return { shift: s, clippedStart, clippedEnd, spansWholeDay, spansMultipleDays };
      });
  }, [shifts, selectedDayIdx, days, profilesById]);

  const position = (value: string) => Math.max(0, Math.min(windowDays - 1, Math.floor((new Date(value).getTime() - days[0].getTime()) / 86400000)));
  const span = (start: string, end: string) => Math.max(1, Math.min(windowDays - position(start), Math.ceil((new Date(end).getTime() - Math.max(new Date(start).getTime(), days[0].getTime())) / 86400000)));

  const isDayMode = viewMode === 'day';
  const dayStartMs = days[0]?.getTime() ?? 0;
  const hourPosition = (value: string) => Math.max(0, Math.min(1, (new Date(value).getTime() - dayStartMs) / 86400000));
  const hourSpan = (start: string, end: string) => {
    const s = Math.max(dayStartMs, new Date(start).getTime());
    const e = Math.min(dayStartMs + 86400000, new Date(end).getTime());
    return Math.max(0.01, (e - s) / 86400000);
  };
  const isTodayColumn = isDayMode && dateKey(days[0]) === dateKey(new Date());
  const nowPct = hourPosition(new Date().toISOString()) * 100;

  const rowKeys = useMemo(() => {
    const seen = new Map<string, { user_id: string | null; duty_type: JourDutyType }>();
    for (const s of shifts) seen.set(`${s.user_id ?? 'unassigned'}:${s.duty_type}`, { user_id: s.user_id, duty_type: s.duty_type });
    return Array.from(seen.values()).sort((a, b) => {
      if (a.user_id === null) return 1;
      if (b.user_id === null) return -1;
      return (profilesById.get(a.user_id)?.name || '').localeCompare(profilesById.get(b.user_id)?.name || '');
    });
  }, [shifts, profilesById]);

  const openManageModal = (shift: JourShift) => {
    if (!isAdmin) return;
    setManaging(shift);
    setManageMode('menu');
    setManageError('');
    setOfferScope('whole');
    setOfferStart(toLocalInputValue(shift.starts_at));
    setOfferEnd(toLocalInputValue(shift.ends_at));
    setOfferAllowPartial(false);
    setOfferNote('');
    setSplitAt('');
    setSplitSecondOwner(shift.user_id || '');
    setAssignTo(shift.user_id || '');
  };

  const handleOfferSubmit = async () => {
    if (!managing) return;
    if (offerScope === 'partial' && new Date(offerEnd) <= new Date(offerStart)) {
      setManageError('Ange ett giltigt intervall (slut måste vara efter start).');
      return;
    }
    setManageSaving(true);
    setManageError('');
    try {
      const { error } = await supabase.from('vihem_jour_swap_offers').insert({
        organisation_id: organisationId,
        shift_id: managing.id,
        offered_by: userId,
        allow_partial: offerAllowPartial,
        note: offerNote,
        offer_start_at: offerScope === 'partial' ? new Date(offerStart).toISOString() : null,
        offer_end_at: offerScope === 'partial' ? new Date(offerEnd).toISOString() : null,
      });
      if (error) throw error;
      setManaging(null);
      load();
    } catch (err) {
      setManageError(describeError(err));
    } finally {
      setManageSaving(false);
    }
  };

  const handleSplitSubmit = async () => {
    if (!managing || !splitAt) return;
    const splitDate = new Date(splitAt);
    if (splitDate <= new Date(managing.starts_at) || splitDate >= new Date(managing.ends_at)) {
      setManageError('Klyvpunkten måste ligga mellan passets start och slut.');
      return;
    }
    setManageSaving(true);
    setManageError('');
    try {
      const { error: shrinkErr } = await supabase.from('vihem_jour_shifts').update({ ends_at: splitDate.toISOString() }).eq('id', managing.id);
      if (shrinkErr) throw shrinkErr;
      const { error: insertErr } = await supabase.from('vihem_jour_shifts').insert({
        organisation_id: organisationId,
        duty_type: managing.duty_type,
        user_id: splitSecondOwner || null,
        starts_at: splitDate.toISOString(),
        ends_at: managing.ends_at,
        source: 'manual',
        notes: managing.notes,
        created_by: userId,
      });
      if (insertErr) throw insertErr;
      setManaging(null);
      load();
    } catch (err) {
      setManageError(describeError(err));
    } finally {
      setManageSaving(false);
    }
  };

  const handleAssignSubmit = async () => {
    if (!managing) return;
    setManageSaving(true);
    setManageError('');
    try {
      const { error } = await supabase.from('vihem_jour_shifts').update({ user_id: assignTo || null }).eq('id', managing.id);
      if (error) throw error;
      setManaging(null);
      load();
    } catch (err) {
      setManageError(describeError(err));
    } finally {
      setManageSaving(false);
    }
  };

  const handleDeleteSubmit = async () => {
    if (!managing) return;
    setManageSaving(true);
    setManageError('');
    try {
      const { error } = await supabase.from('vihem_jour_shifts').delete().eq('id', managing.id);
      if (error) throw error;
      setManaging(null);
      load();
    } catch (err) {
      setManageError(describeError(err));
    } finally {
      setManageSaving(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div>
          <h2 className="font-semibold text-slate-900">Dagbesked</h2>
          <p className="text-sm text-slate-500">Vem som har jour, {windowDays} {windowDays === 1 ? 'dag' : 'dagar'} framåt från valt datum.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {VIEW_MODES.map((mode) => (
              <button
                key={mode}
                onClick={() => changeViewMode(mode)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${viewMode === mode ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {VIEW_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => { const next = new Date(anchor); next.setDate(anchor.getDate() - windowDays); setAnchor(next); }}><ArrowLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="secondary" onClick={() => setAnchor(anchorForMode(viewMode, new Date()))}>Idag</Button>
            <Button size="sm" variant="secondary" onClick={() => { const next = new Date(anchor); next.setDate(anchor.getDate() + windowDays); setAnchor(next); }}><ArrowRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Fastighetsjour</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" /> Snöjour</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Städjour</span>
      </div>
      {loading ? (
        <div className="p-10 text-center text-sm text-slate-500">Laddar...</div>
      ) : (
        <>
          <div className="md:hidden">
            <div className="flex gap-2 overflow-x-auto border-b border-slate-100 p-3">
              {days.map((day, i) => {
                const isToday = dateKey(day) === dateKey(new Date());
                const isSelected = i === selectedDayIdx;
                return (
                  <button
                    key={dateKey(day)}
                    onClick={() => setSelectedDayIdx(i)}
                    className={`flex shrink-0 flex-col items-center rounded-lg border px-3 py-2 text-xs transition-colors ${isSelected ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold' : isToday ? 'border-blue-200 text-blue-600' : 'border-slate-200 text-slate-500'}`}
                  >
                    <span>{day.toLocaleDateString('sv-SE', { weekday: 'short' })}</span>
                    <strong>{day.getDate()} {day.toLocaleDateString('sv-SE', { month: 'short' })}</strong>
                  </button>
                );
              })}
            </div>
            {selectedDayShifts.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">Ingen jour {days[selectedDayIdx]?.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })}.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {selectedDayShifts.map(({ shift: s, clippedStart, clippedEnd, spansWholeDay, spansMultipleDays }) => (
                  <div key={s.id} onClick={() => openManageModal(s)} className={`flex items-center gap-3 p-4 ${isAdmin ? 'cursor-pointer transition-colors hover:bg-slate-50' : ''}`}>
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DUTY_DOT_CLASS[s.duty_type]}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-800">{s.user_id === null ? UNASSIGNED_LABEL : profilesById.get(s.user_id)?.name || 'Okänd'}</p>
                      <p className="text-xs text-slate-500">
                        {DUTY_LABELS[s.duty_type]} · {spansWholeDay ? 'Hela dagen' : `${fmtTime(clippedStart.toISOString())} - ${fmtTime(clippedEnd.toISOString())}`}
                      </p>
                      {spansMultipleDays && <p className="text-xs text-slate-400">Hela passet: {fmtDateTime(s.starts_at)} - {fmtDateTime(s.ends_at)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="hidden overflow-x-auto md:block">
          <div style={{ minWidth: `${200 + windowDays * VIEW_MODE_COL_MIN[viewMode]}px` }}>
            <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: `200px repeat(${windowDays}, minmax(${VIEW_MODE_COL_MIN[viewMode]}px, 1fr))` }}>
              <div className="p-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Person</div>
              {days.map((day) => (
                <div key={dateKey(day)} className={`border-l border-slate-200 p-2 text-center text-xs ${dateKey(day) === dateKey(new Date()) ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}>
                  {isDayMode ? (
                    <>
                      <div className="mb-1 font-semibold">{day.toLocaleDateString('sv-SE', { weekday: 'short' })} {day.getDate()} {day.toLocaleDateString('sv-SE', { month: 'short' })}</div>
                      <div className="flex items-center justify-between px-1 text-[10px] font-normal text-slate-400">
                        {HOUR_TICKS.map((h) => <span key={h}>{String(h).padStart(2, '0')}</span>)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div>{day.toLocaleDateString('sv-SE', { weekday: 'short' })}</div>
                      <strong>{day.getDate()} {day.toLocaleDateString('sv-SE', { month: 'short' })}</strong>
                    </>
                  )}
                </div>
              ))}
            </div>
            {rowKeys.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">Inga jourpass under den här perioden.</div>
            ) : (
              rowKeys.map((row) => {
                const rowShifts = shifts.filter((s) => s.user_id === row.user_id && s.duty_type === row.duty_type);
                return (
                  <div key={`${row.user_id ?? 'unassigned'}:${row.duty_type}`} className="grid min-h-[64px] border-b border-slate-200" style={{ gridTemplateColumns: `200px repeat(${windowDays}, minmax(${VIEW_MODE_COL_MIN[viewMode]}px, 1fr))` }}>
                    <div className="border-r border-slate-200 p-3">
                      <p className="truncate font-semibold text-slate-800">{row.user_id === null ? UNASSIGNED_LABEL : profilesById.get(row.user_id)?.name || 'Okänd'}</p>
                      <Badge className={DUTY_BADGE_CLASS[row.duty_type]}>{DUTY_LABELS[row.duty_type]}</Badge>
                    </div>
                    <div className="relative bg-white" style={{ gridColumn: `2 / span ${windowDays}` }}>
                      {isDayMode
                        ? HOUR_TICKS.map((h) => <div key={h} className="absolute top-0 h-full border-l border-slate-100" style={{ left: `${(h / 24) * 100}%` }} />)
                        : days.map((day) => <div key={dateKey(day)} className="absolute top-0 h-full border-l border-slate-100" style={{ left: `${(days.indexOf(day) / windowDays) * 100}%` }} />)}
                      {isTodayColumn && <div className="absolute top-0 z-20 h-full border-l-2 border-red-400" style={{ left: `${nowPct}%` }} />}
                      {rowShifts.map((s) => {
                        const sameDay = dateKey(new Date(s.starts_at)) === dateKey(new Date(s.ends_at));
                        const label = sameDay ? `${fmtTime(s.starts_at)}-${fmtTime(s.ends_at)}` : `${fmtDate(s.starts_at)} ${fmtTime(s.starts_at)} - ${fmtDate(s.ends_at)} ${fmtTime(s.ends_at)}`;
                        const leftPct = isDayMode ? hourPosition(s.starts_at) * 100 : (position(s.starts_at) / windowDays) * 100;
                        const widthPct = isDayMode ? hourSpan(s.starts_at, s.ends_at) * 100 : (span(s.starts_at, s.ends_at) / windowDays) * 100;
                        return (
                          <div
                            key={s.id}
                            title={`${fmtDateTime(s.starts_at)} - ${fmtDateTime(s.ends_at)}${isAdmin ? ' (klicka för att hantera)' : ''}`}
                            onClick={() => openManageModal(s)}
                            className={`absolute z-10 mx-0.5 mt-3 h-8 overflow-hidden rounded-lg px-2 py-1 text-xs font-semibold text-white shadow-sm ${DUTY_BAR_CLASS[s.duty_type]} ${isAdmin ? 'cursor-pointer' : ''}`}
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          >
                            {label}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          </div>
        </>
      )}

      {isAdmin && (
        <Modal open={!!managing} onClose={() => setManaging(null)} title="Hantera jourpass">
          {managing && (
            <div className="space-y-4">
              <div>
                <Badge className={DUTY_BADGE_CLASS[managing.duty_type]}>{DUTY_LABELS[managing.duty_type]}</Badge>
                <p className="mt-1 font-semibold text-slate-800">{managing.user_id === null ? UNASSIGNED_LABEL : profilesById.get(managing.user_id)?.name || 'Okänd'}</p>
                <p className="text-sm text-slate-500">{fmtDateTime(managing.starts_at)} - {fmtDateTime(managing.ends_at)}</p>
              </div>

              {manageMode === 'menu' && (
                <div className="space-y-2">
                  {openOfferShiftIds.has(managing.id) && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">Passet är redan ute för byte -- hantera annonsen i Byten-fliken.</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" disabled={openOfferShiftIds.has(managing.id)} onClick={() => setManageMode('offer')}>Annonsera för byte</Button>
                    <Button variant="secondary" onClick={() => setManageMode('split')}>Dela pass</Button>
                    <Button variant="secondary" onClick={() => setManageMode('assign')}>Tilldela till någon annan</Button>
                    <Button variant="danger" onClick={() => setManageMode('delete')}>Radera pass</Button>
                  </div>
                  <div className="flex justify-end"><Button variant="secondary" onClick={() => setManaging(null)}>Stäng</Button></div>
                </div>
              )}

              {manageMode === 'offer' && (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <button onClick={() => setOfferScope('whole')} className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-semibold ${offerScope === 'whole' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>Hela passet</button>
                    <button onClick={() => setOfferScope('partial')} className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-semibold ${offerScope === 'partial' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>En del av passet</button>
                  </div>
                  {offerScope === 'partial' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input label="Från" type="datetime-local" value={offerStart} onChange={(e) => setOfferStart(e.target.value)} min={toLocalInputValue(managing.starts_at)} max={toLocalInputValue(managing.ends_at)} />
                      <Input label="Till" type="datetime-local" value={offerEnd} onChange={(e) => setOfferEnd(e.target.value)} min={toLocalInputValue(managing.starts_at)} max={toLocalInputValue(managing.ends_at)} />
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={offerAllowPartial} onChange={(e) => setOfferAllowPartial(e.target.checked)} className="rounded border-slate-300" />
                    Tillåt att {offerScope === 'partial' ? 'den annonserade delen' : 'passet'} plockas i flera delar
                  </label>
                  <Input label="Anmärkning (valfritt)" value={offerNote} onChange={(e) => setOfferNote(e.target.value)} />
                  {manageError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{manageError}</p>}
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setManageMode('menu')}>Tillbaka</Button>
                    <Button onClick={handleOfferSubmit} loading={manageSaving}>Annonsera</Button>
                  </div>
                </div>
              )}

              {manageMode === 'split' && (
                <div className="space-y-4">
                  <Input label="Dela vid" type="datetime-local" value={splitAt} onChange={(e) => setSplitAt(e.target.value)} min={toLocalInputValue(managing.starts_at)} max={toLocalInputValue(managing.ends_at)} />
                  <Select label="Ägare för den senare delen" value={splitSecondOwner} onChange={(e) => setSplitSecondOwner(e.target.value)} options={[{ value: '', label: 'Obemannat' }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]} />
                  <p className="text-xs text-slate-500">Den första delen (fram till klyvpunkten) behåller nuvarande ägare. Klyvpunkten måste ligga inom passets tidsspann.</p>
                  {manageError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{manageError}</p>}
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setManageMode('menu')}>Tillbaka</Button>
                    <Button onClick={handleSplitSubmit} loading={manageSaving}>Dela</Button>
                  </div>
                </div>
              )}

              {manageMode === 'assign' && (
                <div className="space-y-4">
                  <Select label="Ny ägare" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} options={[{ value: '', label: 'Obemannat' }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]} />
                  {manageError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{manageError}</p>}
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setManageMode('menu')}>Tillbaka</Button>
                    <Button onClick={handleAssignSubmit} loading={manageSaving}>Tilldela</Button>
                  </div>
                </div>
              )}

              {manageMode === 'delete' && (
                <div className="space-y-4">
                  <p className="text-sm text-slate-600">Radera det här passet permanent? En eventuell öppen annons för passet raderas också.</p>
                  {manageError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{manageError}</p>}
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setManageMode('menu')}>Tillbaka</Button>
                    <Button variant="danger" onClick={handleDeleteSubmit} loading={manageSaving}>Radera</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </Card>
  );
}

// ── Byten: bytesmarknad ──────────────────────────────────────────────────

function BytenTab({ userId, organisationId, profilesById, isAdmin, onChanged }: { userId: string; organisationId: string; profilesById: Map<string, Pick<Profile, 'id' | 'name'>>; isAdmin: boolean; onChanged: () => void }) {
  const [offers, setOffers] = useState<JourSwapOffer[]>([]);
  const [shiftsById, setShiftsById] = useState<Map<string, JourShift>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [claiming, setClaiming] = useState<JourSwapOffer | null>(null);
  const [claimMode, setClaimMode] = useState<'whole' | 'partial'>('whole');
  const [claimStart, setClaimStart] = useState('');
  const [claimEnd, setClaimEnd] = useState('');
  const [claimError, setClaimError] = useState('');
  const [claimSaving, setClaimSaving] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createDutyType, setCreateDutyType] = useState<JourDutyType>('fastighet');
  const [createStart, setCreateStart] = useState('');
  const [createEnd, setCreateEnd] = useState('');
  const [createAllowPartial, setCreateAllowPartial] = useState(true);
  const [createNote, setCreateNote] = useState('');
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data: offerRows } = await supabase.from('vihem_jour_swap_offers').select('*').eq('organisation_id', organisationId).eq('status', 'open').order('created_at', { ascending: false });
    const offersList = (offerRows || []) as JourSwapOffer[];
    setOffers(offersList);
    const shiftIds = [...new Set(offersList.map((o) => o.shift_id))];
    if (shiftIds.length > 0) {
      const { data: shiftRows } = await supabase.from('vihem_jour_shifts').select('*').in('id', shiftIds);
      setShiftsById(new Map((shiftRows || []).map((s: any) => [s.id, s as JourShift])));
    } else {
      setShiftsById(new Map());
    }
    setLoading(false);
  }, [organisationId]);

  useEffect(() => { load(); }, [load]);

  const openClaimModal = (offer: JourSwapOffer) => {
    setClaiming(offer);
    setClaimMode('whole');
    const shift = shiftsById.get(offer.shift_id);
    const rangeStart = offer.offer_start_at || shift?.starts_at;
    const rangeEnd = offer.offer_end_at || shift?.ends_at;
    setClaimStart(rangeStart ? toLocalInputValue(rangeStart) : '');
    setClaimEnd(rangeEnd ? toLocalInputValue(rangeEnd) : '');
    setClaimError('');
  };

  const handleCreateOpenShift = async () => {
    setCreateError('');
    if (!createStart || !createEnd || new Date(createEnd) <= new Date(createStart)) {
      setCreateError('Ange ett giltigt intervall (slut måste vara efter start).');
      return;
    }
    setCreateSaving(true);
    try {
      const { data: shift, error: shiftErr } = await supabase.from('vihem_jour_shifts').insert({
        organisation_id: organisationId,
        duty_type: createDutyType,
        user_id: null,
        starts_at: new Date(createStart).toISOString(),
        ends_at: new Date(createEnd).toISOString(),
        source: 'manual',
        notes: 'Öppet pass',
        created_by: userId,
      }).select('id').single();
      if (shiftErr) throw shiftErr;
      const { error: offerErr } = await supabase.from('vihem_jour_swap_offers').insert({
        organisation_id: organisationId,
        shift_id: shift.id,
        offered_by: userId,
        allow_partial: createAllowPartial,
        note: createNote,
      });
      if (offerErr) throw offerErr;
      setShowCreateModal(false);
      setCreateStart('');
      setCreateEnd('');
      setCreateAllowPartial(true);
      setCreateNote('');
      onChanged();
      load();
    } catch (err) {
      setCreateError(describeError(err));
    } finally {
      setCreateSaving(false);
    }
  };

  const handleClaim = async () => {
    if (!claiming) return;
    setClaimSaving(true);
    setClaimError('');
    try {
      const patch: Record<string, unknown> = { status: 'claimed', claimed_by: userId };
      if (claimMode === 'partial') {
        patch.claim_start_at = new Date(claimStart).toISOString();
        patch.claim_end_at = new Date(claimEnd).toISOString();
      }
      const { data, error } = await supabase.from('vihem_jour_swap_offers').update(patch).eq('id', claiming.id).eq('status', 'open').select().maybeSingle();
      if (error) throw error;
      if (!data) { setClaimError('Passet hann bli taget av någon annan. Ladda om listan.'); return; }
      setClaiming(null);
      onChanged();
      load();
    } catch (err) {
      setClaimError(describeError(err));
    } finally {
      setClaimSaving(false);
    }
  };

  const handleCancel = async (offer: JourSwapOffer) => {
    if (!confirm('Avbryt annonsen? Passet stannar hos dig.')) return;
    const { error } = await supabase.from('vihem_jour_swap_offers').update({ status: 'cancelled' }).eq('id', offer.id).eq('status', 'open');
    if (error) { alert(describeError(error)); return; }
    load();
  };

  if (loading) return <LoadingPage />;

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {isAdmin && (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => { setCreateError(''); setShowCreateModal(true); }}><Plus className="h-4 w-4" /> Skapa öppet pass</Button>
        </div>
      )}
      {offers.length === 0 ? (
        <EmptyState icon={<Users className="w-12 h-12" />} title="Inga öppna byten" description="Det finns just nu inga jourpass ute för byte." />
      ) : (
        <div className="space-y-3">
          {offers.map((offer) => {
            const shift = shiftsById.get(offer.shift_id);
            if (!shift) return null;
            const isOwn = offer.offered_by === userId;
            const isUnassigned = shift.user_id === null;
            const rangeStart = offer.offer_start_at || shift.starts_at;
            const rangeEnd = offer.offer_end_at || shift.ends_at;
            return (
              <Card key={offer.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <Badge className={DUTY_BADGE_CLASS[shift.duty_type]}>{DUTY_LABELS[shift.duty_type]}</Badge>
                      {isUnassigned && <Badge className="bg-slate-100 text-slate-600">{UNASSIGNED_LABEL}</Badge>}
                      {offer.allow_partial && <Badge className="bg-slate-100 text-slate-600">Del av annonsen tillåts</Badge>}
                    </div>
                    <p className="text-sm font-semibold text-slate-800">{fmtDateTime(rangeStart)} - {fmtDateTime(rangeEnd)}</p>
                    {(offer.offer_start_at || offer.offer_end_at) && (
                      <p className="text-xs text-slate-400">Del av passet {fmtDateTime(shift.starts_at)} - {fmtDateTime(shift.ends_at)}</p>
                    )}
                    <p className="text-sm text-slate-500">{isUnassigned ? 'Skapat av' : 'Erbjuds av'} {profilesById.get(offer.offered_by)?.name || 'Okänd'}</p>
                    {offer.note && <p className="mt-1 text-sm text-slate-600">{offer.note}</p>}
                  </div>
                  {isOwn ? (
                    <Button size="sm" variant="secondary" onClick={() => handleCancel(offer)}>Avbryt annons</Button>
                  ) : (
                    <Button size="sm" onClick={() => openClaimModal(offer)}>Plocka pass</Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!claiming} onClose={() => setClaiming(null)} title="Plocka jourpass">
        {claiming && (() => {
          const shift = shiftsById.get(claiming.shift_id);
          if (!shift) return null;
          const rangeStart = claiming.offer_start_at || shift.starts_at;
          const rangeEnd = claiming.offer_end_at || shift.ends_at;
          return (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">Annonsen gäller {fmtDateTime(rangeStart)} - {fmtDateTime(rangeEnd)}.</p>
              {claiming.allow_partial && (
                <div className="flex gap-2">
                  <button onClick={() => setClaimMode('whole')} className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-semibold ${claimMode === 'whole' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>Ta hela annonsen</button>
                  <button onClick={() => setClaimMode('partial')} className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-semibold ${claimMode === 'partial' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>Ta del av annonsen</button>
                </div>
              )}
              {claimMode === 'partial' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="Från" type="datetime-local" value={claimStart} onChange={(e) => setClaimStart(e.target.value)} min={toLocalInputValue(rangeStart)} max={toLocalInputValue(rangeEnd)} />
                  <Input label="Till" type="datetime-local" value={claimEnd} onChange={(e) => setClaimEnd(e.target.value)} min={toLocalInputValue(rangeStart)} max={toLocalInputValue(rangeEnd)} />
                </div>
              )}
              {claimError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{claimError}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setClaiming(null)}>Avbryt</Button>
                <Button onClick={handleClaim} loading={claimSaving}>Bekräfta</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {isAdmin && (
        <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Skapa öppet pass">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Skapar ett obemannat jourpass som direkt läggs ut för byte -- vem som helst med rätt behörighet kan plocka det, helt eller delvis.</p>
            <Select label="Jourtyp" value={createDutyType} onChange={(e) => setCreateDutyType(e.target.value as JourDutyType)} options={DUTY_TYPES.map((dt) => ({ value: dt, label: DUTY_LABELS[dt] }))} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Från" type="datetime-local" value={createStart} onChange={(e) => setCreateStart(e.target.value)} />
              <Input label="Till" type="datetime-local" value={createEnd} onChange={(e) => setCreateEnd(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={createAllowPartial} onChange={(e) => setCreateAllowPartial(e.target.checked)} className="rounded border-slate-300" />
              Tillåt att passet plockas i delar
            </label>
            <Input label="Anmärkning (valfritt)" value={createNote} onChange={(e) => setCreateNote(e.target.value)} placeholder="T.ex. anledning till att passet är obemannat" />
            {createError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{createError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowCreateModal(false)}>Avbryt</Button>
              <Button onClick={handleCreateOpenShift} loading={createSaving}>Skapa och annonsera</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Mitt schema ───────────────────────────────────────────────────────────

function MittSchemaTab({ userId, myDutyTypes, onChanged }: { userId: string; myDutyTypes: JourDutyType[]; onChanged: () => void }) {
  const [shifts, setShifts] = useState<JourShift[]>([]);
  const [openOfferShiftIds, setOpenOfferShiftIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [offering, setOffering] = useState<JourShift | null>(null);
  const [offerScope, setOfferScope] = useState<'whole' | 'partial'>('whole');
  const [offerStart, setOfferStart] = useState('');
  const [offerEnd, setOfferEnd] = useState('');
  const [allowPartial, setAllowPartial] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const nowIso = new Date().toISOString();
    const [{ data: shiftRows }, { data: offerRows }] = await Promise.all([
      supabase.from('vihem_jour_shifts').select('*').eq('user_id', userId).gt('ends_at', nowIso).order('starts_at'),
      supabase.from('vihem_jour_swap_offers').select('shift_id').eq('offered_by', userId).eq('status', 'open'),
    ]);
    setShifts((shiftRows || []) as JourShift[]);
    setOpenOfferShiftIds(new Set((offerRows || []).map((o: any) => o.shift_id)));
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const openOfferModal = (shift: JourShift) => {
    setOffering(shift);
    setOfferScope('whole');
    setOfferStart(toLocalInputValue(shift.starts_at));
    setOfferEnd(toLocalInputValue(shift.ends_at));
    setAllowPartial(false);
    setNote('');
    setError('');
  };

  const handleOffer = async () => {
    if (!offering) return;
    if (offerScope === 'partial' && new Date(offerEnd) <= new Date(offerStart)) {
      setError('Ange ett giltigt intervall (slut måste vara efter start).');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { error } = await supabase.from('vihem_jour_swap_offers').insert({
        organisation_id: offering.organisation_id,
        shift_id: offering.id,
        offered_by: userId,
        allow_partial: allowPartial,
        note,
        offer_start_at: offerScope === 'partial' ? new Date(offerStart).toISOString() : null,
        offer_end_at: offerScope === 'partial' ? new Date(offerEnd).toISOString() : null,
      });
      if (error) throw error;
      setOffering(null);
      onChanged();
      load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingPage />;

  return (
    <div className="space-y-4">
      {myDutyTypes.length === 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Du är inte behörig för någon jourtyp än -- kontakta din admin om du ska ha jour.</div>
      )}
      {shifts.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="w-12 h-12" />} title="Inga kommande jourpass" description="Du har inga inbokade jourpass framöver." />
      ) : (
        <div className="space-y-3">
          {shifts.map((shift) => {
            const alreadyOffered = openOfferShiftIds.has(shift.id);
            return (
              <Card key={shift.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <Badge className={DUTY_BADGE_CLASS[shift.duty_type]}>{DUTY_LABELS[shift.duty_type]}</Badge>
                  <p className="mt-1 text-sm font-semibold text-slate-800">{fmtDateTime(shift.starts_at)} - {fmtDateTime(shift.ends_at)}</p>
                </div>
                {alreadyOffered ? (
                  <Badge className="bg-amber-100 text-amber-700">Ute för byte</Badge>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => openOfferModal(shift)}>Annonsera byte</Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!offering} onClose={() => setOffering(null)} title="Annonsera pass för byte">
        {offering && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Passet gäller {fmtDateTime(offering.starts_at)} - {fmtDateTime(offering.ends_at)}.</p>
            <div className="flex gap-2">
              <button onClick={() => setOfferScope('whole')} className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-semibold ${offerScope === 'whole' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>Hela passet</button>
              <button onClick={() => setOfferScope('partial')} className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-semibold ${offerScope === 'partial' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>En del av passet</button>
            </div>
            {offerScope === 'partial' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Från" type="datetime-local" value={offerStart} onChange={(e) => setOfferStart(e.target.value)} min={toLocalInputValue(offering.starts_at)} max={toLocalInputValue(offering.ends_at)} />
                <Input label="Till" type="datetime-local" value={offerEnd} onChange={(e) => setOfferEnd(e.target.value)} min={toLocalInputValue(offering.starts_at)} max={toLocalInputValue(offering.ends_at)} />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={allowPartial} onChange={(e) => setAllowPartial(e.target.checked)} className="rounded border-slate-300" />
              Tillåt att {offerScope === 'partial' ? 'den annonserade delen' : 'passet'} plockas i flera delar
            </label>
            <Input label="Anmärkning (valfritt)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="T.ex. anledning till bytet" />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOffering(null)}>Avbryt</Button>
              <Button onClick={handleOffer} loading={saving}>Annonsera</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Admin: Behörighet ────────────────────────────────────────────────────

function BehorighetTab({ organisationId, userId, profiles }: { organisationId: string; userId: string; profiles: Pick<Profile, 'id' | 'name'>[] }) {
  const [rows, setRows] = useState<JourEligibility[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('vihem_jour_eligibility').select('*').eq('organisation_id', organisationId);
    setRows((data || []) as JourEligibility[]);
    setLoading(false);
  }, [organisationId]);

  useEffect(() => { load(); }, [load]);

  const isChecked = (profileId: string, dutyType: JourDutyType) => rows.some((r) => r.user_id === profileId && r.duty_type === dutyType && r.active);

  const toggle = async (profileId: string, dutyType: JourDutyType, checked: boolean) => {
    setSaving(`${profileId}:${dutyType}`);
    try {
      const existing = rows.find((r) => r.user_id === profileId && r.duty_type === dutyType);
      if (existing) {
        const { error } = await supabase.from('vihem_jour_eligibility').update({ active: checked }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('vihem_jour_eligibility').insert({ organisation_id: organisationId, user_id: profileId, duty_type: dutyType, active: checked, created_by: userId });
        if (error) throw error;
      }
      load();
    } catch (err) {
      alert(describeError(err));
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <LoadingPage />;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <h2 className="font-semibold text-slate-900">Behörighet per jourtyp</h2>
        <p className="text-sm text-slate-500">Vem som får schemaläggas och plocka byten för respektive jourtyp.</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
            <th className="px-4 py-2">Personal</th>
            {DUTY_TYPES.map((dt) => <th key={dt} className="px-4 py-2">{DUTY_LABELS[dt]}</th>)}
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id} className="border-b border-slate-100">
              <td className="px-4 py-2.5 font-medium text-slate-800">{p.name}</td>
              {DUTY_TYPES.map((dt) => (
                <td key={dt} className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={isChecked(p.id, dt)}
                    disabled={saving === `${p.id}:${dt}`}
                    onChange={(e) => toggle(p.id, dt, e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ── Admin: Grundschema (rotationsregler) ─────────────────────────────────

type RuleDraft = { user_id: string; name: string; start_date: string; interval_weeks: string; duration_weeks: string; active: boolean };

const EMPTY_RULE_DRAFT: RuleDraft = { user_id: '', name: '', start_date: new Date().toISOString().slice(0, 10), interval_weeks: '1', duration_weeks: '1', active: true };

function GrundschemaTab({ organisationId, userId, profiles }: { organisationId: string; userId: string; profiles: Pick<Profile, 'id' | 'name'>[] }) {
  const [rules, setRules] = useState<JourRotationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<JourRotationRule | 'new' | null>(null);
  const [modalDutyType, setModalDutyType] = useState<JourDutyType>('fastighet');
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_RULE_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [generatingType, setGeneratingType] = useState<JourDutyType | null>(null);
  const [clearingType, setClearingType] = useState<JourDutyType | null>(null);
  const [untilDate, setUntilDate] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() + 3); return d.toISOString().slice(0, 10); });
  const [generateResult, setGenerateResult] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('vihem_jour_rotation_rules').select('*').eq('organisation_id', organisationId).order('start_date');
    setRules((data || []) as JourRotationRule[]);
    setLoading(false);
  }, [organisationId]);

  useEffect(() => { load(); }, [load]);

  const rulesByType = useMemo(() => {
    const map = new Map<JourDutyType, JourRotationRule[]>();
    for (const dt of DUTY_TYPES) map.set(dt, []);
    for (const r of rules) map.get(r.duty_type)?.push(r);
    return map;
  }, [rules]);

  const openNewModal = (dutyType: JourDutyType) => {
    setModalDutyType(dutyType);
    setDraft(EMPTY_RULE_DRAFT);
    setError('');
    setEditing('new');
  };

  const openEditModal = (rule: JourRotationRule) => {
    setModalDutyType(rule.duty_type);
    setDraft({ user_id: rule.user_id, name: rule.name, start_date: rule.start_date, interval_weeks: String(rule.interval_weeks), duration_weeks: String(rule.duration_weeks), active: rule.active });
    setError('');
    setEditing(rule);
  };

  const handleSave = async () => {
    if (!draft.user_id || !draft.start_date || Number(draft.interval_weeks) <= 0 || Number(draft.duration_weeks) <= 0) {
      setError('Ange person, startdatum, och positiva veckovärden.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        organisation_id: organisationId,
        duty_type: modalDutyType,
        user_id: draft.user_id,
        name: draft.name,
        start_date: draft.start_date,
        interval_weeks: Number(draft.interval_weeks),
        duration_weeks: Number(draft.duration_weeks),
        active: draft.active,
      };
      if (editing === 'new') {
        const { error } = await supabase.from('vihem_jour_rotation_rules').insert({ ...payload, created_by: userId });
        if (error) throw error;
      } else if (editing) {
        const { error } = await supabase.from('vihem_jour_rotation_rules').update(payload).eq('id', editing.id);
        if (error) throw error;
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rule: JourRotationRule) => {
    if (!confirm(`Radera regeln "${rule.name || DUTY_LABELS[rule.duty_type]}"? Redan genererade jourpass påverkas inte.`)) return;
    const { error } = await supabase.from('vihem_jour_rotation_rules').delete().eq('id', rule.id);
    if (error) { alert(describeError(error)); return; }
    load();
  };

  const handleGenerate = async (dutyType: JourDutyType) => {
    setGeneratingType(dutyType);
    setGenerateResult('');
    try {
      const { data, error } = await supabase.rpc('vihem_generate_jour_shifts_for_duty_type', { p_organisation_id: organisationId, p_duty_type: dutyType, p_until_date: untilDate });
      if (error) throw error;
      setGenerateResult(`${DUTY_LABELS[dutyType]}: ${data} nya jourpass skapade.`);
    } catch (err) {
      alert(describeError(err));
    } finally {
      setGeneratingType(null);
    }
  };

  const handleClear = async (dutyType: JourDutyType) => {
    if (!confirm(`Rensa alla kommande, auto-genererade ${DUTY_LABELS[dutyType].toLowerCase()}-pass som inte redan bytts eller ändrats manuellt? Redan påbörjade pass och manuellt skapade/omtilldelade pass påverkas inte.`)) return;
    setClearingType(dutyType);
    setGenerateResult('');
    try {
      const { error, count } = await supabase.from('vihem_jour_shifts').delete({ count: 'exact' })
        .eq('organisation_id', organisationId).eq('duty_type', dutyType).eq('source', 'template').gt('starts_at', new Date().toISOString());
      if (error) throw error;
      setGenerateResult(`${DUTY_LABELS[dutyType]}: ${count ?? 0} genererade pass rensade.`);
    } catch (err) {
      alert(describeError(err));
    } finally {
      setClearingType(null);
    }
  };

  if (loading) return <LoadingPage />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input label="Generera pass t.o.m." type="date" value={untilDate} onChange={(e) => setUntilDate(e.target.value)} />
      </div>
      {generateResult && <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{generateResult}</p>}

      {DUTY_TYPES.map((dt) => {
        const dtRules = rulesByType.get(dt) || [];
        return (
          <Card key={dt} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
              <div className="flex items-center gap-2">
                <Badge className={DUTY_BADGE_CLASS[dt]}>{DUTY_LABELS[dt]}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => handleClear(dt)} loading={clearingType === dt}><Trash2 className="h-3.5 w-3.5" /> Rensa genererade</Button>
                <Button size="sm" variant="secondary" onClick={() => handleGenerate(dt)} loading={generatingType === dt} disabled={dtRules.length === 0}><RefreshCw className="h-3.5 w-3.5" /> Generera jourpass</Button>
                <Button size="sm" onClick={() => openNewModal(dt)}><Plus className="h-3.5 w-3.5" /> Ny regel</Button>
              </div>
            </div>
            {dtRules.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">Inga rotationsregler för {DUTY_LABELS[dt].toLowerCase()} än.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {dtRules.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <p className="font-semibold text-slate-800">
                        {profiles.find((p) => p.id === r.user_id)?.name || 'Okänd'}
                        {!r.active && <Badge className="ml-2 bg-slate-100 text-slate-500">Inaktiv</Badge>}
                      </p>
                      <p className="text-sm text-slate-500">
                        {r.name ? `${r.name} -- ` : ''}Var {r.interval_weeks}:e vecka, {r.duration_weeks} {r.duration_weeks === 1 ? 'vecka' : 'veckor'} åt gången, från {fmtDate(r.start_date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => openEditModal(r)}>Ändra</Button>
                      <button onClick={() => handleDelete(r)} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? `Ny regel -- ${DUTY_LABELS[modalDutyType]}` : `Ändra regel -- ${DUTY_LABELS[modalDutyType]}`}>
        <div className="space-y-4">
          <Select label="Person" value={draft.user_id} onChange={(e) => setDraft({ ...draft, user_id: e.target.value })} options={[{ value: '', label: 'Välj person' }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]} />
          <Input label="Namn (valfritt)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="T.ex. Var tredje vecka" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Startdatum" type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} />
            <Input label="Var N:e vecka" type="number" min={1} value={draft.interval_weeks} onChange={(e) => setDraft({ ...draft, interval_weeks: e.target.value })} />
            <Input label="Antal veckor åt gången" type="number" min={1} value={draft.duration_weeks} onChange={(e) => setDraft({ ...draft, duration_weeks: e.target.value })} />
          </div>
          <p className="text-xs text-slate-500">Flera regler kan gälla samma person -- t.ex. "var 3:e vecka" och "var 6:e vecka" som två separata regler ger ibland två veckor i rad när de råkar hamna intill varandra.</p>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="rounded border-slate-300" />
            Aktiv (inkluderas vid generering av jourpass)
          </label>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>Avbryt</Button>
            <Button onClick={handleSave} loading={saving}>Spara</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
