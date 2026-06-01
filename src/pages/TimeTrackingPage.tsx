import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Card,
  Badge,
  Button,
  Modal,
  Input,
  Textarea,
  Select,
  PageHeader,
  EmptyState,
  LoadingPage,
  StatCard,
} from '../components/ui';
import {
  formatDate,
  formatDateTime,
  formatMinutes,
  TIME_CATEGORY_LABELS,
  getTimeStatusColor,
} from '../lib/utils';
import type { TimeEntry, TimeCategory, WorkOrder, Profile } from '../types';
import {
  Play,
  Square,
  Clock,
  Plus,
  CheckCircle,
  BarChart3,
  Timer,
  Edit2,
  Calendar,
  List,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Send,
} from 'lucide-react';

type TimeStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

// ─── helpers ─────────────────────────────────────────────────────────────────

function toLocalDatetimeValue(iso: string) {
  // Convert ISO → "YYYY-MM-DDTHH:mm" for <input type="datetime-local">
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function calcMinutes(start: string, end: string, breakMins: number) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(Math.floor(ms / 60000) - breakMins, 0);
}

const STATUS_LABEL: Record<TimeStatus, string> = {
  draft: 'Utkast',
  submitted: 'Inskickad',
  approved: 'Godkänd',
  rejected: 'Avvisad',
};

// ─── Main page ────────────────────────────────────────────────────────────────

export function TimeTrackingPage({ onNavigate: _onNavigate }: { onNavigate: (page: string) => void }) {
  const { user, loading: authLoading } = useAuth();
  if (authLoading || !user) return <LoadingPage />;
  if (user.role === 'admin' || user.role === 'superadmin') return <AdminTimeView user={user} />;
  return <StaffTimeView user={user} />;
}

// ─── Staff view ───────────────────────────────────────────────────────────────

type StaffTab = 'list' | 'calendar';

function StaffTimeView({ user }: { user: Profile }) {
  const [tab, setTab] = useState<StaffTab>('list');
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [currentEntry, setCurrentEntry] = useState<TimeEntry | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);

  // Month navigation for calendar tab
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth()); // 0-indexed

  // List tab: simple period filter
  const [listMonth, setListMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // Modals
  const [showStampModal, setShowStampModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [selectedDayEntries, setSelectedDayEntries] = useState<TimeEntry[] | null>(null);
  const [selectedDay, setSelectedDay] = useState('');

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { fetchData(); }, [listMonth, calYear, calMonth]);

  useEffect(() => {
    if (currentEntry && !currentEntry.end_time) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - new Date(currentEntry.start_time).getTime()) / 1000));
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [currentEntry]);

  async function fetchData() {
    setLoading(true);
    try {
      // Always load current open draft
      const todayStr = new Date().toISOString().split('T')[0];
      const { data: current } = await supabase
        .from('time_entries').select('*')
        .eq('user_id', user.id).eq('status', 'draft')
        .gte('start_time', `${todayStr}T00:00:00`).is('end_time', null)
        .maybeSingle();
      setCurrentEntry(current || null);

      // Load entries for the displayed month
      const year = tab === 'calendar' ? calYear : parseInt(listMonth.split('-')[0]);
      const month = tab === 'calendar' ? calMonth : parseInt(listMonth.split('-')[1]) - 1;
      const startDate = new Date(year, month, 1).toISOString();
      const endDate = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

      const { data: entriesData } = await supabase
        .from('time_entries')
        .select('*, work_order:work_order_id(id, title)')
        .eq('user_id', user.id)
        .gte('start_time', startDate).lte('start_time', endDate)
        .order('start_time', { ascending: false });
      setEntries(entriesData || []);

      const { data: wos } = await supabase
        .from('work_orders').select('id, title, status')
        .in('status', ['new', 'assigned', 'started', 'paused']);
      setWorkOrders(wos || []);
    } finally {
      setLoading(false);
    }
  }

  async function handleStampIn(category: TimeCategory, workOrderId?: string, comment?: string) {
    await supabase.from('time_entries').insert({
      user_id: user.id, work_order_id: workOrderId || null, category,
      start_time: new Date().toISOString(), end_time: null,
      break_minutes: 0, total_minutes: 0, comment: comment || '', status: 'draft',
    });
    setShowStampModal(false);
    fetchData();
  }

  async function handleStampOut() {
    if (!currentEntry) return;
    const end = new Date().toISOString();
    const total = calcMinutes(currentEntry.start_time, end, currentEntry.break_minutes);
    await supabase.from('time_entries').update({
      end_time: end, total_minutes: total, status: 'submitted',
    }).eq('id', currentEntry.id);
    setCurrentEntry(null);
    fetchData();
  }

  async function handleSaveEntry(payload: Partial<TimeEntry> & { submitNow?: boolean }, entryId?: string) {
    const isNew = !entryId;
    const status = payload.submitNow ? 'submitted' : 'draft';
    const data: any = {
      user_id: user.id,
      category: payload.category,
      start_time: payload.start_time,
      end_time: payload.end_time || null,
      break_minutes: payload.break_minutes || 0,
      total_minutes: payload.end_time
        ? calcMinutes(payload.start_time!, payload.end_time, payload.break_minutes || 0)
        : 0,
      comment: payload.comment || '',
      work_order_id: payload.work_order_id || null,
      status,
    };
    if (isNew) {
      await supabase.from('time_entries').insert(data);
    } else {
      await supabase.from('time_entries').update({ ...data, user_id: undefined }).eq('id', entryId!);
    }
    setShowManualModal(false);
    setShowEditModal(false);
    setEditingEntry(null);
    fetchData();
  }

  // ── Calendar helpers ────────────────────────────────────────────────────────
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDayOfWeek = (new Date(calYear, calMonth, 1).getDay() + 6) % 7; // Mon=0

  const STANDARD_DAY_MINUTES = 8 * 60; // 8h = 480 min

  const entriesByDay = entries.reduce((acc, e) => {
    const day = new Date(e.start_time).toISOString().split('T')[0];
    if (!acc[day]) acc[day] = [];
    acc[day].push(e);
    return acc;
  }, {} as Record<string, TimeEntry[]>);

  function dayTotals(dayEntries: TimeEntry[]) {
    const work = dayEntries
      .filter(e => e.end_time)
      .reduce((s, e) => s + (e.total_minutes || 0), 0);
    const breaks = dayEntries.reduce((s, e) => s + (e.break_minutes || 0), 0);
    return { work, breaks };
  }

  // ── Month-level totals ──────────────────────────────────────────────────────
  const completedEntries = entries.filter(e => e.end_time);
  const totalWork = completedEntries.reduce((s, e) => s + (e.total_minutes || 0), 0);
  const totalBreaks = entries.reduce((s, e) => s + (e.break_minutes || 0), 0);
  const workDays = Object.values(entriesByDay).filter(d => d.some(e => e.end_time)).length;
  const expectedMinutes = workDays * STANDARD_DAY_MINUTES;
  const overtime = Math.max(totalWork - expectedMinutes, 0);
  const deficit = Math.max(expectedMinutes - totalWork, 0);

  const monthName = new Date(calYear, calMonth, 1)
    .toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });

  const calYM = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;

  return (
    <div className="space-y-6 min-h-screen bg-slate-50 -m-4 lg:-m-6 p-4 lg:p-6">
      <PageHeader
        title="Tidrapportering"
        subtitle="Stämpla in, rapportera tid och se din månadsöversikt"
        action={
          <div className="flex gap-2">
            <Button onClick={() => setShowManualModal(true)} variant="secondary" className="gap-2">
              <Plus className="w-4 h-4" /> Registrera tid
            </Button>
            <Button onClick={() => setShowStampModal(true)} variant="primary" className="gap-2">
              <Play className="w-4 h-4" /> Stämpla in
            </Button>
          </div>
        }
      />

      {/* Active clock */}
      {currentEntry ? (
        <Card className="p-5 bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-100 rounded-xl">
                <Clock className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-green-600 font-semibold uppercase tracking-wide">Aktiv tidrapportering</p>
                <p className="text-3xl font-bold text-green-900 font-mono">
                  {String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0')}:
                  {String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0')}:
                  {String(elapsedSeconds % 60).padStart(2, '0')}
                </p>
                <p className="text-xs text-green-700 mt-0.5">
                  {TIME_CATEGORY_LABELS[currentEntry.category]} · Startade {new Date(currentEntry.start_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
            <Button onClick={handleStampOut} variant="danger" className="gap-2">
              <Square className="w-4 h-4" /> Stämpla ut
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-5 border-dashed border-slate-300 bg-slate-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-slate-100 rounded-xl">
                <Timer className="w-6 h-6 text-slate-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-600">Ingen aktiv stämpling</p>
                <p className="text-xs text-slate-400">Tryck Stämpla in för att börja</p>
              </div>
            </div>
            <Button onClick={() => setShowStampModal(true)} variant="primary" className="gap-2">
              <Play className="w-4 h-4" /> Stämpla in
            </Button>
          </div>
        </Card>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab('list')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'list' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <List className="w-4 h-4" /> Lista
        </button>
        <button
          onClick={() => setTab('calendar')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'calendar' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <Calendar className="w-4 h-4" /> Månadsvy
        </button>
      </div>

      {/* ── LIST TAB ── */}
      {tab === 'list' && (
        <>
          <div className="flex items-center gap-3">
            <Input type="month" value={listMonth} onChange={e => setListMonth(e.target.value)} className="w-44" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <StatCard label="Total tid" value={formatMinutes(totalWork)} icon={<Clock className="w-5 h-5" />} color="text-blue-600 bg-blue-50" />
            <StatCard label="Poster" value={entries.length} icon={<BarChart3 className="w-5 h-5" />} color="text-teal-600 bg-teal-50" />
          </div>

          {loading ? <LoadingPage /> : entries.length === 0 ? (
            <EmptyState icon={<Clock className="w-12 h-12" />} title="Inga tidsposter" description="Inga registrerade tider för den valda månaden." />
          ) : (
            <div className="space-y-2">
              {entries.map(entry => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  onEdit={() => { setEditingEntry(entry); setShowEditModal(true); }}
                  showEdit={entry.status !== 'approved'}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── CALENDAR TAB ── */}
      {tab === 'calendar' && (
        <>
          {/* Month nav + stats */}
          <div className="flex items-center justify-between">
            <button onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); }} className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
              <ChevronLeft className="w-5 h-5 text-slate-600" />
            </button>
            <h2 className="text-lg font-bold text-slate-800 capitalize">{monthName}</h2>
            <button onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); }} className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
              <ChevronRight className="w-5 h-5 text-slate-600" />
            </button>
          </div>

          {/* Month summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Arbetstid" value={formatMinutes(totalWork)} icon={<Clock className="w-4 h-4" />} color="text-blue-600 bg-blue-50" />
            <StatCard label="Rastid" value={formatMinutes(totalBreaks)} icon={<Timer className="w-4 h-4" />} color="text-amber-600 bg-amber-50" />
            <StatCard label="Övertid" value={formatMinutes(overtime)} icon={<AlertCircle className="w-4 h-4" />} color={overtime > 0 ? 'text-orange-600 bg-orange-50' : 'text-slate-400 bg-slate-50'} />
            <StatCard label="Underskott" value={formatMinutes(deficit)} icon={<BarChart3 className="w-4 h-4" />} color={deficit > 0 ? 'text-red-600 bg-red-50' : 'text-slate-400 bg-slate-50'} />
          </div>

          {/* Calendar grid */}
          <Card className="p-4">
            {/* Day headers Mon–Sun */}
            <div className="grid grid-cols-7 mb-2">
              {['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'].map(d => (
                <div key={d} className="text-center text-xs font-semibold text-slate-400 py-1">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {/* Empty cells before first day */}
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} className="min-h-[72px]" />
              ))}

              {/* Day cells */}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dayEntries = entriesByDay[dateStr] || [];
                const { work, breaks } = dayTotals(dayEntries);
                const isToday = dateStr === new Date().toISOString().split('T')[0];
                const isWeekend = ((new Date(calYear, calMonth, day).getDay() + 6) % 7) >= 5;
                const hasActive = dayEntries.some(e => !e.end_time);
                const hasPending = dayEntries.some(e => e.status === 'submitted');
                const hasRejected = dayEntries.some(e => e.status === 'rejected');

                return (
                  <button
                    key={day}
                    onClick={() => { setSelectedDay(dateStr); setSelectedDayEntries(dayEntries); }}
                    className={`min-h-[72px] rounded-lg p-2 text-left transition-all border ${
                      isToday ? 'border-blue-400 bg-blue-50' :
                      isWeekend ? 'border-transparent bg-slate-50 hover:bg-slate-100' :
                      'border-transparent hover:bg-slate-50 hover:border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-semibold ${isToday ? 'text-blue-700' : isWeekend ? 'text-slate-400' : 'text-slate-700'}`}>
                        {day}
                      </span>
                      {hasActive && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
                      {hasPending && !hasActive && <span className="w-2 h-2 rounded-full bg-amber-400" />}
                      {hasRejected && <span className="w-2 h-2 rounded-full bg-red-400" />}
                    </div>
                    {work > 0 && (
                      <div>
                        <p className="text-xs font-bold text-slate-800">{formatMinutes(work)}</p>
                        {breaks > 0 && <p className="text-xs text-slate-400">rast {formatMinutes(breaks)}</p>}
                      </div>
                    )}
                    {dayEntries.length > 0 && work === 0 && (
                      <p className="text-xs text-green-600 font-medium">Pågående</p>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Aktiv</div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-amber-400" /> Inväntar godkännande</div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-red-400" /> Avvisad</div>
            </div>
          </Card>
        </>
      )}

      {/* ── Day detail modal (from calendar) ── */}
      <Modal
        open={!!selectedDayEntries}
        onClose={() => { setSelectedDayEntries(null); setSelectedDay(''); }}
        title={selectedDay ? formatDate(selectedDay) : ''}
        size="lg"
      >
        <div className="space-y-3">
          {selectedDayEntries?.length === 0 ? (
            <EmptyState icon={<Clock className="w-10 h-10" />} title="Inga poster" description="Inga tidsposter för denna dag." />
          ) : (
            selectedDayEntries?.map(entry => (
              <EntryCard
                key={entry.id}
                entry={entry}
                onEdit={() => {
                  setSelectedDayEntries(null);
                  setEditingEntry(entry);
                  setShowEditModal(true);
                }}
                showEdit={entry.status !== 'approved'}
              />
            ))
          )}
          <Button
            variant="secondary"
            className="w-full gap-2"
            onClick={() => {
              setSelectedDayEntries(null);
              setShowManualModal(true);
            }}
          >
            <Plus className="w-4 h-4" /> Lägg till tid för denna dag
          </Button>
        </div>
      </Modal>

      {/* ── Stamp in modal ── */}
      <StampInModal
        open={showStampModal}
        onClose={() => setShowStampModal(false)}
        onSubmit={handleStampIn}
        workOrders={workOrders}
      />

      {/* ── Manual entry modal ── */}
      <EntryFormModal
        open={showManualModal}
        onClose={() => setShowManualModal(false)}
        onSubmit={(payload) => handleSaveEntry(payload)}
        workOrders={workOrders}
        defaultDate={selectedDay}
        title="Registrera tid"
      />

      {/* ── Edit modal ── */}
      {editingEntry && (
        <EntryFormModal
          open={showEditModal}
          onClose={() => { setShowEditModal(false); setEditingEntry(null); }}
          onSubmit={(payload) => handleSaveEntry(payload, editingEntry.id)}
          workOrders={workOrders}
          entry={editingEntry}
          title="Redigera tidpost"
        />
      )}
    </div>
  );
}

// ─── Entry card ────────────────────────────────────────────────────────────────

function EntryCard({ entry, onEdit, showEdit }: { entry: any; onEdit: () => void; showEdit: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge className={getTimeStatusColor(entry.status)}>
              {STATUS_LABEL[entry.status as TimeStatus] || entry.status}
            </Badge>
            <span className="text-xs text-slate-500">{TIME_CATEGORY_LABELS[entry.category as TimeCategory]}</span>
            {entry.work_order?.title && (
              <span className="text-xs text-slate-500 truncate">· {entry.work_order.title}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>{new Date(entry.start_time).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</span>
            {entry.end_time && (
              <>
                <span>→</span>
                <span>{new Date(entry.end_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}</span>
              </>
            )}
            {entry.break_minutes > 0 && <span className="text-slate-400">· {entry.break_minutes}min rast</span>}
          </div>
          {entry.comment && <p className="text-xs text-slate-500 italic mt-1">"{entry.comment}"</p>}
          {entry.status === 'rejected' && (
            <p className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Avvisad — redigera och skicka in igen</p>
          )}
        </div>
        <div className="text-right ml-4 flex-shrink-0">
          <p className="text-base font-bold text-slate-800">{formatMinutes(entry.total_minutes || 0)}</p>
          {showEdit && (
            <button onClick={onEdit} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 mt-1 ml-auto">
              <Edit2 className="w-3 h-3" /> Redigera
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Stamp in modal ────────────────────────────────────────────────────────────

function StampInModal({ open, onClose, onSubmit, workOrders }: {
  open: boolean; onClose: () => void;
  onSubmit: (cat: TimeCategory, woId?: string, comment?: string) => void;
  workOrders: WorkOrder[];
}) {
  const [category, setCategory] = useState<TimeCategory>('general');
  const [workOrderId, setWorkOrderId] = useState('');
  const [comment, setComment] = useState('');

  function reset() { setCategory('general'); setWorkOrderId(''); setComment(''); }

  return (
    <Modal open={open} onClose={() => { onClose(); reset(); }} title="Stämpla in">
      <div className="space-y-4">
        <Select label="Kategori" value={category} onChange={e => setCategory(e.target.value as TimeCategory)}
          options={Object.entries(TIME_CATEGORY_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
        <Select label="Arbetsorder (valfritt)" value={workOrderId} onChange={e => setWorkOrderId(e.target.value)}
          options={[{ value: '', label: 'Ingen' }, ...workOrders.map(wo => ({ value: wo.id, label: wo.title }))]} />
        <Textarea label="Kommentar (valfritt)" value={comment} onChange={e => setComment(e.target.value)} rows={2} />
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={() => { onClose(); reset(); }} className="flex-1">Avbryt</Button>
          <Button variant="primary" onClick={() => { onSubmit(category, workOrderId || undefined, comment); reset(); }} className="flex-1 gap-2">
            <Play className="w-4 h-4" /> Stämpla in
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Entry form modal (manual add + edit) ─────────────────────────────────────

interface EntryFormPayload extends Partial<TimeEntry> { submitNow?: boolean; }

function EntryFormModal({ open, onClose, onSubmit, workOrders, entry, title, defaultDate }: {
  open: boolean; onClose: () => void;
  onSubmit: (payload: EntryFormPayload) => void;
  workOrders: WorkOrder[];
  entry?: TimeEntry;
  title: string;
  defaultDate?: string;
}) {
  const now = new Date();
  const defaultStart = defaultDate
    ? `${defaultDate}T09:00`
    : toLocalDatetimeValue(entry?.start_time || now.toISOString());
  const defaultEnd = defaultDate
    ? `${defaultDate}T17:00`
    : (entry?.end_time ? toLocalDatetimeValue(entry.end_time) : '');

  const [category, setCategory] = useState<TimeCategory>(entry?.category || 'general');
  const [workOrderId, setWorkOrderId] = useState(entry?.work_order_id || '');
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(defaultEnd);
  const [breakMins, setBreakMins] = useState(entry?.break_minutes ?? 30);
  const [comment, setComment] = useState(entry?.comment || '');

  // Reset when modal opens with new entry
  useEffect(() => {
    if (open) {
      setCategory(entry?.category || 'general');
      setWorkOrderId(entry?.work_order_id || '');
      setStartTime(defaultStart);
      setEndTime(defaultEnd);
      setBreakMins(entry?.break_minutes ?? 30);
      setComment(entry?.comment || '');
    }
  }, [open, entry?.id]);

  const previewMins = startTime && endTime
    ? calcMinutes(new Date(startTime).toISOString(), new Date(endTime).toISOString(), breakMins)
    : null;

  const isValid = !!startTime;
  const isRejected = entry?.status === 'rejected';
  const isDraft = !entry || entry.status === 'draft';

  function buildPayload(submitNow: boolean): EntryFormPayload {
    return {
      category,
      start_time: new Date(startTime).toISOString(),
      end_time: endTime ? new Date(endTime).toISOString() : undefined,
      break_minutes: breakMins,
      work_order_id: workOrderId || null,
      comment,
      submitNow,
    };
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select label="Kategori" value={category} onChange={e => setCategory(e.target.value as TimeCategory)}
            options={Object.entries(TIME_CATEGORY_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
          <Select label="Arbetsorder (valfritt)" value={workOrderId} onChange={e => setWorkOrderId(e.target.value)}
            options={[{ value: '', label: 'Ingen' }, ...workOrders.map(wo => ({ value: wo.id, label: wo.title }))]} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Start" type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} />
          <Input label="Slut (valfritt om pågående)" type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} />
        </div>

        <Input label="Rast (minuter)" type="number" min={0} max={480} value={breakMins}
          onChange={e => setBreakMins(Math.max(0, parseInt(e.target.value) || 0))} />

        {previewMins !== null && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-blue-700 font-medium">Beräknad arbetstid</span>
            <span className="text-lg font-bold text-blue-800">{formatMinutes(previewMins)}</span>
          </div>
        )}

        <Textarea label="Kommentar (valfritt)" value={comment} onChange={e => setComment(e.target.value)} rows={2} />

        {isRejected && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            Denna post var avvisad. Korrigera och skicka in igen för nytt godkännande.
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Avbryt</Button>
          {(isDraft || isRejected) && (
            <Button variant="secondary" onClick={() => onSubmit(buildPayload(false))} disabled={!isValid} className="flex-1">
              Spara utkast
            </Button>
          )}
          <Button variant="primary" onClick={() => onSubmit(buildPayload(true))} disabled={!isValid || !endTime} className="flex-1 gap-2">
            <Send className="w-4 h-4" />
            {isRejected ? 'Skicka in igen' : 'Skicka för godkännande'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Admin view ────────────────────────────────────────────────────────────────

function AdminTimeView({ user }: { user: Profile }) {
  const [monthFilter, setMonthFilter] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [loading, setLoading] = useState(false);
  const [staffMembers, setStaffMembers] = useState<Profile[]>([]);
  const [summary, setSummary] = useState<Record<string, { total: number; approved: number; pending: number; rejected: number }>>({});
  const [selectedStaff, setSelectedStaff] = useState<Profile | null>(null);
  const [staffEntries, setStaffEntries] = useState<TimeEntry[]>([]);
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [adminTab, setAdminTab] = useState<'list' | 'calendar'>('list');

  // Calendar for admin staff view
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());

  useEffect(() => { fetchStaff(); }, []);
  useEffect(() => { if (staffMembers.length > 0) fetchSummary(); }, [monthFilter, staffMembers]);

  async function fetchStaff() {
    const { data } = await supabase.from('profiles').select('*')
      .in('role', ['staff', 'admin', 'superadmin']).eq('active', true).order('name');
    setStaffMembers(data || []);
  }

  async function fetchSummary() {
    setLoading(true);
    try {
      const { start, end } = monthRange(monthFilter);
      const { data } = await supabase.from('time_entries').select('user_id, total_minutes, status')
        .gte('start_time', start).lt('start_time', end);

      const s: Record<string, { total: number; approved: number; pending: number; rejected: number }> = {};
      staffMembers.forEach(st => { s[st.id] = { total: 0, approved: 0, pending: 0, rejected: 0 }; });
      data?.forEach(e => {
        if (s[e.user_id]) {
          s[e.user_id].total += e.total_minutes || 0;
          if (e.status === 'approved') s[e.user_id].approved += e.total_minutes || 0;
          else if (e.status === 'submitted') s[e.user_id].pending += e.total_minutes || 0;
          else if (e.status === 'rejected') s[e.user_id].rejected += e.total_minutes || 0;
        }
      });
      setSummary(s);
    } finally {
      setLoading(false);
    }
  }

  async function openStaffModal(staff: Profile) {
    setSelectedStaff(staff);
    await loadStaffEntries(staff.id, monthFilter);
    setStaffModalOpen(true);
  }

  async function loadStaffEntries(staffId: string, month: string) {
    const { start, end } = monthRange(month);
    const { data } = await supabase
      .from('time_entries')
      .select('*, work_order:work_order_id(id, title)')
      .eq('user_id', staffId)
      .gte('start_time', start).lt('start_time', end)
      .order('start_time', { ascending: false });
    setStaffEntries(data || []);
  }

  async function approveEntry(id: string) {
    await supabase.from('time_entries').update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() }).eq('id', id);
    loadStaffEntries(selectedStaff!.id, monthFilter);
    fetchSummary();
  }

  async function rejectEntry(id: string) {
    await supabase.from('time_entries').update({ status: 'rejected' }).eq('id', id);
    loadStaffEntries(selectedStaff!.id, monthFilter);
    fetchSummary();
  }

  async function approveAll() {
    if (!selectedStaff) return;
    const { start, end } = monthRange(monthFilter);
    await supabase.from('time_entries').update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('user_id', selectedStaff.id).eq('status', 'submitted')
      .gte('start_time', start).lt('start_time', end);
    loadStaffEntries(selectedStaff.id, monthFilter);
    fetchSummary();
  }

  // Calendar helpers for selected staff
  const daysInCalMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDayOfWeek = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;
  const calEntriesByDay = staffEntries.reduce((acc, e) => {
    const day = new Date(e.start_time).toISOString().split('T')[0];
    if (!acc[day]) acc[day] = [];
    acc[day].push(e);
    return acc;
  }, {} as Record<string, TimeEntry[]>);
  const calMonthName = new Date(calYear, calMonth, 1).toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });

  const modalTotalWork = staffEntries.filter(e => e.end_time).reduce((s, e) => s + (e.total_minutes || 0), 0);
  const modalTotalBreaks = staffEntries.reduce((s, e) => s + (e.break_minutes || 0), 0);
  const workDays = Object.values(calEntriesByDay).filter(d => d.some(e => e.end_time)).length;
  const modalOvertime = Math.max(modalTotalWork - workDays * 480, 0);

  const pendingCount = staffEntries.filter(e => e.status === 'submitted').length;

  return (
    <div className="space-y-6 min-h-screen bg-slate-50 -m-4 lg:-m-6 p-4 lg:p-6">
      <PageHeader
        title="Tidrapportering — Översikt"
        subtitle="Granska och godkänn tidsrapporter"
      />

      <div className="flex items-center gap-3">
        <Input type="month" label="Månad" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="w-44" />
      </div>

      {loading ? <LoadingPage /> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Personal</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Total</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Godkänd</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Väntande</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Avvisad</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {staffMembers.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Ingen personal</td></tr>
                ) : staffMembers.map(staff => {
                  const d = summary[staff.id] || { total: 0, approved: 0, pending: 0, rejected: 0 };
                  return (
                    <tr key={staff.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => openStaffModal(staff)}>
                      <td className="px-4 py-3 font-medium text-slate-800">{staff.name}</td>
                      <td className="px-4 py-3 text-right text-slate-700 font-semibold">{formatMinutes(d.total)}</td>
                      <td className="px-4 py-3 text-right"><Badge className="bg-green-100 text-green-700">{formatMinutes(d.approved)}</Badge></td>
                      <td className="px-4 py-3 text-right"><Badge className={d.pending > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}>{formatMinutes(d.pending)}</Badge></td>
                      <td className="px-4 py-3 text-right"><Badge className={d.rejected > 0 ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}>{formatMinutes(d.rejected)}</Badge></td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); openStaffModal(staff); }}>Granska</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Staff detail modal */}
      <Modal open={staffModalOpen} onClose={() => setStaffModalOpen(false)} title={selectedStaff?.name || ''} size="xl">
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-slate-800">{formatMinutes(modalTotalWork)}</p>
              <p className="text-xs text-slate-500">Arbetstid</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-slate-800">{formatMinutes(modalTotalBreaks)}</p>
              <p className="text-xs text-slate-500">Rastid</p>
            </div>
            <div className={`rounded-lg p-3 text-center ${modalOvertime > 0 ? 'bg-orange-50' : 'bg-slate-50'}`}>
              <p className={`text-lg font-bold ${modalOvertime > 0 ? 'text-orange-700' : 'text-slate-800'}`}>{formatMinutes(modalOvertime)}</p>
              <p className="text-xs text-slate-500">Övertid</p>
            </div>
          </div>

          {/* Tab */}
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
            <button onClick={() => setAdminTab('list')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${adminTab === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <List className="w-3.5 h-3.5" /> Lista
            </button>
            <button onClick={() => setAdminTab('calendar')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${adminTab === 'calendar' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <Calendar className="w-3.5 h-3.5" /> Månadsvy
            </button>
          </div>

          {pendingCount > 0 && (
            <Button onClick={approveAll} variant="primary" className="w-full gap-2">
              <CheckCircle className="w-4 h-4" /> Godkänn alla {pendingCount} väntande poster
            </Button>
          )}

          {/* List tab */}
          {adminTab === 'list' && (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {staffEntries.length === 0 ? (
                <EmptyState icon={<Clock className="w-10 h-10" />} title="Inga poster" description="Inga tidsrapporter för vald period." />
              ) : staffEntries.map(entry => (
                <Card key={entry.id} className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge className={getTimeStatusColor(entry.status)}>{STATUS_LABEL[entry.status as TimeStatus] || entry.status}</Badge>
                        <span className="text-xs text-slate-500">{TIME_CATEGORY_LABELS[entry.category as TimeCategory]}</span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {new Date(entry.start_time).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}
                        {entry.end_time && ` → ${new Date(entry.end_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`}
                        {entry.break_minutes > 0 && ` · ${entry.break_minutes}min rast`}
                      </p>
                      {entry.comment && <p className="text-xs text-slate-400 italic mt-0.5">"{entry.comment}"</p>}
                    </div>
                    <div className="text-right ml-3 flex-shrink-0">
                      <p className="text-sm font-bold text-slate-800">{formatMinutes(entry.total_minutes || 0)}</p>
                      {entry.status === 'submitted' && (
                        <div className="flex gap-1 mt-1">
                          <button onClick={() => approveEntry(entry.id)} className="text-xs text-green-600 hover:text-green-700 font-medium">Godkänn</button>
                          <span className="text-slate-300">|</span>
                          <button onClick={() => rejectEntry(entry.id)} className="text-xs text-red-500 hover:text-red-600 font-medium">Avvisa</button>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Calendar tab for admin */}
          {adminTab === 'calendar' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <button onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); }} className="p-1.5 rounded-lg hover:bg-slate-100">
                  <ChevronLeft className="w-4 h-4 text-slate-600" />
                </button>
                <span className="text-sm font-semibold text-slate-700 capitalize">{calMonthName}</span>
                <button onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); }} className="p-1.5 rounded-lg hover:bg-slate-100">
                  <ChevronRight className="w-4 h-4 text-slate-600" />
                </button>
              </div>
              <div className="grid grid-cols-7 mb-1">
                {['M', 'T', 'O', 'T', 'F', 'L', 'S'].map((d, i) => (
                  <div key={i} className="text-center text-xs font-semibold text-slate-400 py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e${i}`} className="min-h-[52px]" />)}
                {Array.from({ length: daysInCalMonth }, (_, i) => i + 1).map(day => {
                  const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dayEntries = calEntriesByDay[dateStr] || [];
                  const work = dayEntries.filter(e => e.end_time).reduce((s, e) => s + (e.total_minutes || 0), 0);
                  const hasPending = dayEntries.some(e => e.status === 'submitted');
                  const isWeekend = ((new Date(calYear, calMonth, day).getDay() + 6) % 7) >= 5;
                  return (
                    <div key={day} className={`min-h-[52px] rounded p-1.5 ${isWeekend ? 'bg-slate-50' : 'bg-white border border-slate-100'}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-xs ${isWeekend ? 'text-slate-400' : 'text-slate-700'} font-medium`}>{day}</span>
                        {hasPending && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                      </div>
                      {work > 0 && <p className="text-xs font-bold text-slate-700 mt-0.5">{formatMinutes(work)}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return {
    start: new Date(y, m - 1, 1).toISOString(),
    end: new Date(y, m, 1).toISOString(),
  };
}
