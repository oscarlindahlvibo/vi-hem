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
  SearchInput,
} from '../components/ui';
import {
  formatDate,
  formatDateTime,
  formatMinutes,
  TIME_CATEGORY_LABELS,
  getTimeStatusColor,
} from '../lib/utils';
import type { TimeEntry, TimeCategory, WorkOrder, Profile, CustomerProject, StaffAbsenceRequest, StaffAbsenceType, StaffAbsenceStatus } from '../types';
import {
  Play,
  Square,
  Clock,
  Plus,
  CheckCircle,
  BarChart3,
  Users,
  Timer,
  Edit2,
  Calendar,
  List,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Send,
  Coffee,
  Repeat2,
  Briefcase,
  MessageSquare,
  Trash2,
  UserCheck,
  ClipboardList,
} from 'lucide-react';

type TimeStatus = 'draft' | 'submitted' | 'change_requested' | 'approved' | 'rejected';
type TimeEntryKind = 'work' | 'break';

interface DailyWorkSummary {
  id: string;
  user_id: string;
  work_date: string;
  comment: string;
}

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

function localDateKey(value: string | Date) {
  const d = typeof value === 'string' ? new Date(value) : value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const STATUS_LABEL: Record<TimeStatus, string> = {
  draft: 'Utkast',
  submitted: 'Inskickad',
  change_requested: 'Ändring inväntar godkännande',
  approved: 'Godkänd',
  rejected: 'Avvisad',
};

const ABSENCE_TYPE_LABEL: Record<StaffAbsenceType, string> = {
  sick: 'Sjuk',
  vab: 'VAB',
  vacation: 'Semester',
  leave: 'Ledighet',
};

const ABSENCE_STATUS_LABEL: Record<StaffAbsenceStatus, string> = {
  submitted: 'Inväntar godkännande',
  approved: 'Godkänd',
  rejected: 'Avvisad',
  cancelled: 'Avbruten',
};

// ─── Main page ────────────────────────────────────────────────────────────────

export function TimeTrackingPage({ onNavigate: _onNavigate }: { onNavigate: (page: string) => void }) {
  const { user, loading: authLoading } = useAuth();
  if (authLoading || !user) return <LoadingPage />;
  if (user.role === 'admin' || user.role === 'superadmin') return <AdminCombinedTimeView user={user} />;
  return <StaffTimeView user={user} />;
}

type AdminMainTimeTab = 'own' | 'staff';

function AdminCombinedTimeView({ user }: { user: Profile }) {
  const [tab, setTab] = useState<AdminMainTimeTab>('own');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-1">
        <button
          type="button"
          onClick={() => setTab('own')}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            tab === 'own' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Clock className="w-4 h-4" />
          Min tid
        </button>
        <button
          type="button"
          onClick={() => setTab('staff')}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            tab === 'staff' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Users className="w-4 h-4" />
          Personalens tid
        </button>
      </div>

      {tab === 'own' ? <StaffTimeView user={user} /> : <AdminTimeView user={user} />}
    </div>
  );
}

// ─── Staff view ───────────────────────────────────────────────────────────────

type StaffTab = 'list' | 'calendar';
type WorkOrderSummary = Pick<WorkOrder, 'id' | 'title' | 'status'>;
type CustomerProjectSummary = Pick<CustomerProject, 'id' | 'title' | 'name' | 'customer_name' | 'status'>;

function StaffTimeView({ user }: { user: Profile }) {
  const [tab, setTab] = useState<StaffTab>('list');
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [currentEntry, setCurrentEntry] = useState<TimeEntry | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[]>([]);
  const [customerProjects, setCustomerProjects] = useState<CustomerProjectSummary[]>([]);
  const [dailySummaries, setDailySummaries] = useState<Record<string, DailyWorkSummary>>({});
  const [absenceRequests, setAbsenceRequests] = useState<StaffAbsenceRequest[]>([]);

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
  const [stampMode, setStampMode] = useState<'start' | 'switch'>('start');
  const [showManualModal, setShowManualModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEndDayModal, setShowEndDayModal] = useState(false);
  const [showDayCommentModal, setShowDayCommentModal] = useState(false);
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);
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
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: current } = await supabase
        .from('time_entries')
        .select('*, customer_project:customer_project_id(id, title, name, customer_name)')
        .eq('user_id', user.id).eq('status', 'draft')
        .gte('start_time', todayStart.toISOString()).is('end_time', null)
        .order('start_time', { ascending: false })
        .limit(1);
      setCurrentEntry(current?.[0] || null);

      // Load entries for the displayed month
      const year = tab === 'calendar' ? calYear : parseInt(listMonth.split('-')[0]);
      const month = tab === 'calendar' ? calMonth : parseInt(listMonth.split('-')[1]) - 1;
      const startDate = new Date(year, month, 1).toISOString();
      const endDate = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

      const { data: entriesData } = await supabase
        .from('time_entries')
        .select('*, work_order:work_order_id(id, title), customer_project:customer_project_id(id, title, name, customer_name)')
        .eq('user_id', user.id)
        .gte('start_time', startDate).lte('start_time', endDate)
        .order('start_time', { ascending: false });
      setEntries(entriesData || []);

      const { data: summariesData } = await supabase
        .from('daily_work_summaries')
        .select('*')
        .eq('user_id', user.id)
        .gte('work_date', localDateKey(new Date(year, month, 1)))
        .lte('work_date', localDateKey(new Date(year, month + 1, 0)));
      setDailySummaries((summariesData || []).reduce((acc, summary) => {
        acc[summary.work_date] = summary as DailyWorkSummary;
        return acc;
      }, {} as Record<string, DailyWorkSummary>));

      const { data: wos } = await supabase
        .from('work_orders').select('id, title, status')
        .in('status', ['new', 'assigned', 'started', 'paused']);
      setWorkOrders(wos || []);

      const { data: projectsData } = await supabase
        .from('customer_projects')
        .select('id, title, name, customer_name, status')
        .not('status', 'in', '(archived,completed,cancelled)')
        .order('updated_at', { ascending: false });
      setCustomerProjects(projectsData || []);

      const { data: absencesData } = await supabase
        .from('staff_absence_requests')
        .select('*')
        .eq('user_id', user.id)
        .gte('end_date', localDateKey(new Date(year, month, 1)))
        .lte('start_date', localDateKey(new Date(year, month + 1, 0)))
        .order('start_date', { ascending: false });
      setAbsenceRequests(absencesData || []);
    } finally {
      setLoading(false);
    }
  }

  async function finishOpenEntries() {
    const end = new Date().toISOString();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: openEntries, error } = await supabase
      .from('time_entries')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'draft')
      .gte('start_time', todayStart.toISOString())
      .is('end_time', null)
      .order('start_time', { ascending: true });

    if (error) throw error;

    await Promise.all((openEntries || []).map(async entry => {
      const breakMinutes = entry.entry_type === 'break' ? 0 : entry.break_minutes;
      const total = calcMinutes(entry.start_time, end, breakMinutes);
      const { error: updateError } = await supabase.from('time_entries').update({
        end_time: end,
        total_minutes: total,
        status: 'submitted',
      }).eq('id', entry.id);
      if (updateError) throw updateError;
    }));
  }

  async function saveDayComment(workDate: string, comment: string) {
    await supabase.from('daily_work_summaries').upsert({
      user_id: user.id,
      work_date: workDate,
      comment,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,work_date' });
  }

  function getCustomerProject(projectId?: string | null) {
    return customerProjects.find(project => project.id === projectId);
  }

  async function handleStampIn(category: TimeCategory, workOrderId?: string, comment?: string, customerName?: string, customerProjectId?: string) {
    const project = getCustomerProject(customerProjectId);
    await supabase.from('time_entries').insert({
      user_id: user.id, work_order_id: workOrderId || null, category,
      organisation_id: user.organisation_id || null,
      entry_type: 'work',
      customer_project_id: category === 'customer_project' ? customerProjectId || null : null,
      customer_name: category === 'customer_project' ? project?.customer_name || customerName || null : customerName || null,
      start_time: new Date().toISOString(), end_time: null,
      break_minutes: 0, total_minutes: 0, comment: comment || '', status: 'draft',
    });
    setShowStampModal(false);
    fetchData();
  }

  async function handleSwitchJob(category: TimeCategory, workOrderId?: string, comment?: string, customerName?: string, customerProjectId?: string) {
    if (!currentEntry) return;
    const project = getCustomerProject(customerProjectId);
    await finishOpenEntries();
    await supabase.from('time_entries').insert({
      user_id: user.id,
      organisation_id: user.organisation_id || null,
      work_order_id: workOrderId || null,
      category,
      entry_type: 'work',
      customer_project_id: category === 'customer_project' ? customerProjectId || null : null,
      customer_name: category === 'customer_project' ? project?.customer_name || customerName || null : customerName || null,
      start_time: new Date().toISOString(),
      end_time: null,
      break_minutes: 0,
      total_minutes: 0,
      comment: comment || '',
      status: 'draft',
    });
    setShowStampModal(false);
    fetchData();
  }

  async function handleStartBreak() {
    if (!currentEntry) return;
    await finishOpenEntries();
    await supabase.from('time_entries').insert({
      user_id: user.id,
      organisation_id: user.organisation_id || null,
      category: 'general',
      entry_type: 'break',
      start_time: new Date().toISOString(),
      end_time: null,
      break_minutes: 0,
      total_minutes: 0,
      comment: 'Rast',
      status: 'draft',
    });
    fetchData();
  }

  async function handleStampOut(dayComment?: string) {
    if (!currentEntry) return;
    await finishOpenEntries();
    const comment = dayComment?.trim();
    if (comment) await saveDayComment(localDateKey(new Date()), comment);
    setCurrentEntry(null);
    setShowEndDayModal(false);
    fetchData();
  }

  async function handleSaveEntry(payload: Partial<TimeEntry> & { submitNow?: boolean }, entryId?: string) {
    const isNew = !entryId;
    const previousStatus = entryId ? entries.find(e => e.id === entryId)?.status : null;
    const status = previousStatus === 'approved' ? 'change_requested' : (payload.submitNow ? 'submitted' : 'draft');
    const data: any = {
      user_id: user.id,
      organisation_id: user.organisation_id || null,
      category: payload.category,
      start_time: payload.start_time,
      end_time: payload.end_time || null,
      break_minutes: payload.break_minutes || 0,
      total_minutes: payload.end_time
        ? calcMinutes(payload.start_time!, payload.end_time, payload.break_minutes || 0)
        : 0,
      comment: payload.comment || '',
      work_order_id: payload.work_order_id || null,
      customer_project_id: payload.category === 'customer_project' ? payload.customer_project_id || null : null,
      entry_type: payload.entry_type || 'work',
      customer_name: payload.customer_name || null,
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

  async function handleAbsenceSubmit(payload: {
    absence_type: StaffAbsenceType;
    start_date: string;
    end_date: string;
    comment: string;
  }) {
    await supabase.from('staff_absence_requests').insert({
      ...payload,
      user_id: user.id,
      organisation_id: user.organisation_id || null,
      status: 'submitted',
    });
    setShowAbsenceModal(false);
    fetchData();
  }

  // ── Calendar helpers ────────────────────────────────────────────────────────
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDayOfWeek = (new Date(calYear, calMonth, 1).getDay() + 6) % 7; // Mon=0

  const STANDARD_DAY_MINUTES = 8 * 60; // 8h = 480 min

  const entriesByDay = entries.reduce((acc, e) => {
    const day = localDateKey(e.start_time);
    if (!acc[day]) acc[day] = [];
    acc[day].push(e);
    return acc;
  }, {} as Record<string, TimeEntry[]>);

  function dayTotals(dayEntries: TimeEntry[]) {
    const work = dayEntries
      .filter(e => e.end_time && e.entry_type !== 'break')
      .reduce((s, e) => s + (e.total_minutes || 0), 0);
    const breaks = dayEntries.reduce((s, e) => {
      if (e.entry_type === 'break') return s + (e.total_minutes || 0);
      return s + (e.break_minutes || 0);
    }, 0);
    return { work, breaks };
  }

  // ── Month-level totals ──────────────────────────────────────────────────────
  const completedEntries = entries.filter(e => e.end_time && e.entry_type !== 'break');
  const totalWork = completedEntries.reduce((s, e) => s + (e.total_minutes || 0), 0);
  const totalBreaks = entries.reduce((s, e) => {
    if (e.entry_type === 'break') return s + (e.total_minutes || 0);
    return s + (e.break_minutes || 0);
  }, 0);
  const workDays = Object.values(entriesByDay).filter(d => d.some(e => e.end_time)).length;
  const expectedMinutes = workDays * STANDARD_DAY_MINUTES;
  const overtime = Math.max(totalWork - expectedMinutes, 0);
  const deficit = Math.max(expectedMinutes - totalWork, 0);

  const monthName = new Date(calYear, calMonth, 1)
    .toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });

  const calYM = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
  const [listYear, listMonthNumber] = listMonth.split('-').map(Number);
  const monthDayKeys = Array.from(
    { length: new Date(listYear, listMonthNumber, 0).getDate() },
    (_, i) => localDateKey(new Date(listYear, listMonthNumber - 1, i + 1))
  ).reverse();

  return (
    <div className="space-y-6 min-h-screen bg-slate-50 -m-4 lg:-m-6 p-4 lg:p-6">
      <PageHeader
        title="Tidrapportering"
        subtitle="Stämpla in, rapportera tid och se din månadsöversikt"
        action={
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => setShowManualModal(true)} variant="secondary" className="gap-2 w-full sm:w-auto">
              <Plus className="w-4 h-4" /> Registrera tid
            </Button>
            <Button onClick={() => setShowAbsenceModal(true)} variant="secondary" className="gap-2 w-full sm:w-auto">
              <Calendar className="w-4 h-4" /> Frånvaro
            </Button>
            {!currentEntry && (
              <Button onClick={() => { setStampMode('start'); setShowStampModal(true); }} variant="primary" className="gap-2 w-full sm:w-auto">
                <Play className="w-4 h-4" /> Stämpla in
              </Button>
            )}
          </div>
        }
      />

      {/* Active clock */}
      {currentEntry ? (
        <Card className={`p-5 ${currentEntry.entry_type === 'break' ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-xl ${currentEntry.entry_type === 'break' ? 'bg-amber-100' : 'bg-emerald-100'}`}>
                {currentEntry.entry_type === 'break'
                  ? <Coffee className="w-6 h-6 text-amber-700" />
                  : <Clock className="w-6 h-6 text-emerald-700" />}
              </div>
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wide ${currentEntry.entry_type === 'break' ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {currentEntry.entry_type === 'break' ? 'Aktiv rast' : 'Aktiv tidrapportering'}
                </p>
                <p className={`text-3xl font-bold font-mono ${currentEntry.entry_type === 'break' ? 'text-amber-950' : 'text-emerald-950'}`}>
                  {String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0')}:
                  {String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0')}:
                  {String(elapsedSeconds % 60).padStart(2, '0')}
                </p>
                <p className={`text-xs mt-0.5 ${currentEntry.entry_type === 'break' ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {TIME_CATEGORY_LABELS[currentEntry.category]} · Startade {new Date(currentEntry.start_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                  {timeEntryProjectLabel(currentEntry) && ` · ${timeEntryProjectLabel(currentEntry)}`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { setStampMode('switch'); setShowStampModal(true); }} variant="secondary" className="gap-2">
                <Repeat2 className="w-4 h-4" /> Byt jobb
              </Button>
              {currentEntry.entry_type !== 'break' && (
                <Button onClick={handleStartBreak} variant="secondary" className="gap-2">
                  <Coffee className="w-4 h-4" /> Byt till rast
                </Button>
              )}
              <Button onClick={() => setShowEndDayModal(true)} variant="danger" className="gap-2">
                <Square className="w-4 h-4" /> Stämpla ut
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-5 border-dashed border-slate-300 bg-slate-50">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between min-w-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-3 bg-slate-100 rounded-xl">
                <Timer className="w-6 h-6 text-slate-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-600">Ingen aktiv stämpling</p>
                <p className="text-xs text-slate-400">Tryck Stämpla in för att börja</p>
              </div>
            </div>
            <Button onClick={() => { setStampMode('start'); setShowStampModal(true); }} variant="primary" className="gap-2 w-full sm:w-auto">
              <Play className="w-4 h-4" /> Stämpla in
            </Button>
          </div>
        </Card>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-full sm:w-fit">
        <button
          onClick={() => setTab('list')}
          className={`flex flex-1 sm:flex-none items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'list' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <List className="w-4 h-4" /> Lista
        </button>
        <button
          onClick={() => setTab('calendar')}
          className={`flex flex-1 sm:flex-none items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'calendar' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
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

          {loading ? <LoadingPage /> : (
            <div className="space-y-3">
              {monthDayKeys.map(dayKey => (
                <DayWorkCard
                  key={dayKey}
                  dayKey={dayKey}
                  entries={entriesByDay[dayKey] || []}
                  summary={dailySummaries[dayKey]}
                  onEditEntry={(entry) => { setEditingEntry(entry); setShowEditModal(true); }}
                  onAddEntry={() => { setSelectedDay(dayKey); setShowManualModal(true); }}
                  onEditComment={() => { setSelectedDay(dayKey); setShowDayCommentModal(true); }}
                />
              ))}
              <AbsenceRequestList requests={absenceRequests} />
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
                const isToday = dateStr === localDateKey(new Date());
                const isWeekend = ((new Date(calYear, calMonth, day).getDay() + 6) % 7) >= 5;
                const hasActive = dayEntries.some(e => !e.end_time);
                const hasPending = dayEntries.some(e => e.status === 'submitted' || e.status === 'change_requested');
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
                showEdit
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
        onSubmit={stampMode === 'switch' ? handleSwitchJob : handleStampIn}
        workOrders={workOrders}
        customerProjects={customerProjects}
        title={stampMode === 'switch' ? 'Byt jobb' : 'Stämpla in'}
        submitLabel={stampMode === 'switch' ? 'Byt jobb' : 'Stämpla in'}
      />

      <EndDayModal
        open={showEndDayModal}
        onClose={() => setShowEndDayModal(false)}
        defaultComment={dailySummaries[localDateKey(new Date())]?.comment || ''}
        onSubmit={(comment) => handleStampOut(comment)}
      />

      <DayCommentModal
        open={showDayCommentModal}
        dayKey={selectedDay}
        defaultComment={dailySummaries[selectedDay]?.comment || ''}
        onClose={() => setShowDayCommentModal(false)}
        onSubmit={async (comment) => {
          await saveDayComment(selectedDay, comment);
          setShowDayCommentModal(false);
          fetchData();
        }}
      />

      {/* ── Manual entry modal ── */}
      <EntryFormModal
        open={showManualModal}
        onClose={() => setShowManualModal(false)}
        onSubmit={(payload) => handleSaveEntry(payload)}
        workOrders={workOrders}
        customerProjects={customerProjects}
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
          customerProjects={customerProjects}
          entry={editingEntry}
          title="Redigera tidpost"
        />
      )}

      <AbsenceRequestModal
        open={showAbsenceModal}
        onClose={() => setShowAbsenceModal(false)}
        onSubmit={handleAbsenceSubmit}
      />
    </div>
  );
}

// ─── Month list day card ──────────────────────────────────────────────────────

function DayWorkCard({ dayKey, entries, summary, onEditEntry, onAddEntry, onEditComment }: {
  dayKey: string;
  entries: TimeEntry[];
  summary?: DailyWorkSummary;
  onEditEntry: (entry: TimeEntry) => void;
  onAddEntry: () => void;
  onEditComment: () => void;
}) {
  const sortedEntries = [...entries].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const workMinutes = sortedEntries
    .filter(entry => entry.entry_type !== 'break' && entry.end_time)
    .reduce((sum, entry) => sum + (entry.total_minutes || 0), 0);
  const breakMinutes = sortedEntries.reduce((sum, entry) => {
    if (entry.entry_type === 'break') return sum + (entry.total_minutes || 0);
    return sum + (entry.break_minutes || 0);
  }, 0);
  const weekday = new Date(`${dayKey}T12:00:00`).toLocaleDateString('sv-SE', { weekday: 'long' });
  const dayLabel = new Date(`${dayKey}T12:00:00`).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  const isToday = dayKey === localDateKey(new Date());

  return (
    <Card className={`p-4 ${isToday ? 'border-blue-200 bg-blue-50/40' : ''}`}>
      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        <div className="lg:w-36 flex-shrink-0">
          <p className="text-sm font-bold text-slate-800 capitalize">{weekday}</p>
          <p className="text-xs text-slate-500">{dayLabel}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {workMinutes > 0 && <Badge className="bg-emerald-100 text-emerald-700">{formatMinutes(workMinutes)}</Badge>}
            {breakMinutes > 0 && <Badge className="bg-amber-100 text-amber-700">Rast {formatMinutes(breakMinutes)}</Badge>}
            {entries.some(entry => !entry.end_time) && <Badge className="bg-blue-100 text-blue-700">Pågående</Badge>}
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          {sortedEntries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-400">
              Ingen registrerad tid
            </div>
          ) : (
            <div className="space-y-2">
              {sortedEntries.map(entry => {
                const projectLabel = timeEntryProjectLabel(entry);
                return (
                <div key={entry.id} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <div className={`mt-0.5 p-1.5 rounded-lg ${entry.entry_type === 'break' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {entry.entry_type === 'break' ? <Coffee className="w-3.5 h-3.5" /> : <Briefcase className="w-3.5 h-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">
                        {new Date(entry.start_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                        {entry.end_time ? `-${new Date(entry.end_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}` : '-pågår'}
                      </span>
                      <span className="text-xs text-slate-500">{entry.entry_type === 'break' ? 'Rast' : TIME_CATEGORY_LABELS[entry.category as TimeCategory]}</span>
                      {entry.work_order?.title && <span className="text-xs text-slate-500 truncate">· {entry.work_order.title}</span>}
                      {projectLabel && <span className="text-xs text-slate-500 truncate">· Projekt: {projectLabel}</span>}
                    </div>
                    {entry.comment && <p className="text-xs text-slate-500 mt-0.5">{entry.comment}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-slate-800">{formatMinutes(entry.total_minutes || 0)}</p>
                    <button onClick={() => onEditEntry(entry)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Redigera</button>
                  </div>
                </div>
                );
              })}
            </div>
          )}

          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Dagens kommentar</p>
                <p className={`text-sm mt-1 ${summary?.comment ? 'text-slate-700' : 'text-slate-400'}`}>
                  {summary?.comment || 'Ingen kommentar ännu'}
                </p>
              </div>
              <button onClick={onEditComment} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 flex-shrink-0">
                <MessageSquare className="w-3.5 h-3.5" /> Kommentar
              </button>
            </div>
          </div>

          <Button variant="ghost" size="sm" onClick={onAddEntry} className="gap-2">
            <Plus className="w-4 h-4" /> Lägg till tid
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ─── Entry card ────────────────────────────────────────────────────────────────

function EntryCard({ entry, onEdit, showEdit }: { entry: any; onEdit: () => void; showEdit: boolean }) {
  const projectLabel = timeEntryProjectLabel(entry);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge className={getTimeStatusColor(entry.status)}>
              {STATUS_LABEL[entry.status as TimeStatus] || entry.status}
            </Badge>
            <span className="text-xs text-slate-500">{entry.entry_type === 'break' ? 'Rast' : TIME_CATEGORY_LABELS[entry.category as TimeCategory]}</span>
            {entry.work_order?.title && (
              <span className="text-xs text-slate-500 truncate">· {entry.work_order.title}</span>
            )}
            {projectLabel && (
              <span className="text-xs text-slate-500 truncate">· Projekt: {projectLabel}</span>
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

function projectOptionLabel(project: CustomerProjectSummary) {
  return [project.title || project.name || 'Namnlöst projekt', project.customer_name].filter(Boolean).join(' · ');
}

function timeEntryProjectLabel(entry: Pick<TimeEntry, 'customer_name'> & { customer_project?: CustomerProjectSummary | null }) {
  if (entry.customer_project) return projectOptionLabel(entry.customer_project);
  return entry.customer_name || '';
}

function StampInModal({ open, onClose, onSubmit, workOrders, customerProjects, title = 'Stämpla in', submitLabel = 'Stämpla in' }: {
  open: boolean; onClose: () => void;
  onSubmit: (cat: TimeCategory, woId?: string, comment?: string, customerName?: string, customerProjectId?: string) => void;
  workOrders: WorkOrderSummary[];
  customerProjects: CustomerProjectSummary[];
  title?: string;
  submitLabel?: string;
}) {
  const [category, setCategory] = useState<TimeCategory>('general');
  const [workOrderId, setWorkOrderId] = useState('');
  const [customerProjectId, setCustomerProjectId] = useState('');
  const [comment, setComment] = useState('');

  function reset() { setCategory('general'); setWorkOrderId(''); setCustomerProjectId(''); setComment(''); }

  const selectedProject = customerProjects.find(project => project.id === customerProjectId);
  const requiresProject = category === 'customer_project';

  return (
    <Modal open={open} onClose={() => { onClose(); reset(); }} title={title}>
      <div className="space-y-4">
        <Select label="Kategori" value={category} onChange={e => setCategory(e.target.value as TimeCategory)}
          options={Object.entries(TIME_CATEGORY_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
        <Select label="Arbetsorder (valfritt)" value={workOrderId} onChange={e => setWorkOrderId(e.target.value)}
          options={[{ value: '', label: 'Ingen' }, ...workOrders.map(wo => ({ value: wo.id, label: wo.title }))]} />
        {category === 'customer_project' && (
          <Select
            label="Kundprojekt"
            value={customerProjectId}
            onChange={e => setCustomerProjectId(e.target.value)}
            options={[
              { value: '', label: customerProjects.length === 0 ? 'Inga tillgängliga kundprojekt' : 'Välj kundprojekt' },
              ...customerProjects.map(project => ({ value: project.id, label: projectOptionLabel(project) })),
            ]}
          />
        )}
        <Textarea label="Kommentar (valfritt)" value={comment} onChange={e => setComment(e.target.value)} rows={2} />
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={() => { onClose(); reset(); }} className="flex-1">Avbryt</Button>
          <Button
            variant="primary"
            onClick={() => { onSubmit(category, workOrderId || undefined, comment, selectedProject?.customer_name || '', customerProjectId || undefined); reset(); }}
            disabled={requiresProject && !customerProjectId}
            className="flex-1 gap-2"
          >
            <Play className="w-4 h-4" /> {submitLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Entry form modal (manual add + edit) ─────────────────────────────────────

interface EntryFormPayload extends Partial<TimeEntry> { submitNow?: boolean; }

function EntryFormModal({ open, onClose, onSubmit, workOrders, customerProjects, entry, title, defaultDate, approvedEditMode = 'request' }: {
  open: boolean; onClose: () => void;
  onSubmit: (payload: EntryFormPayload) => void;
  workOrders: WorkOrderSummary[];
  customerProjects: CustomerProjectSummary[];
  entry?: TimeEntry;
  title: string;
  defaultDate?: string;
  approvedEditMode?: 'request' | 'admin';
}) {
  const now = new Date();
  const defaultStart = defaultDate
    ? `${defaultDate}T09:00`
    : toLocalDatetimeValue(entry?.start_time || now.toISOString());
  const defaultEnd = defaultDate
    ? `${defaultDate}T17:00`
    : (entry?.end_time ? toLocalDatetimeValue(entry.end_time) : '');

  const [category, setCategory] = useState<TimeCategory>(entry?.category || 'general');
  const [entryType, setEntryType] = useState<TimeEntryKind>(entry?.entry_type || 'work');
  const [workOrderId, setWorkOrderId] = useState(entry?.work_order_id || '');
  const [customerProjectId, setCustomerProjectId] = useState(entry?.customer_project_id || '');
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(defaultEnd);
  const [breakMins, setBreakMins] = useState(entry?.break_minutes ?? 30);
  const [comment, setComment] = useState(entry?.comment || '');

  // Reset when modal opens with new entry
  useEffect(() => {
    if (open) {
      setCategory(entry?.category || 'general');
      setEntryType(entry?.entry_type || 'work');
      setWorkOrderId(entry?.work_order_id || '');
      setCustomerProjectId(entry?.customer_project_id || '');
      setStartTime(defaultStart);
      setEndTime(defaultEnd);
      setBreakMins(entry?.break_minutes ?? 30);
      setComment(entry?.comment || '');
    }
  }, [open, entry?.id]);

  const previewMins = startTime && endTime
    ? calcMinutes(new Date(startTime).toISOString(), new Date(endTime).toISOString(), entryType === 'break' ? 0 : breakMins)
    : null;

  const isValid = !!startTime;
  const isRejected = entry?.status === 'rejected';
  const isApproved = entry?.status === 'approved';
  const isDraft = !entry || entry.status === 'draft';
  const selectedProject = customerProjects.find(project => project.id === customerProjectId);
  const requiresProject = category === 'customer_project';

  function buildPayload(submitNow: boolean): EntryFormPayload {
    return {
      category,
      entry_type: entryType,
      start_time: new Date(startTime).toISOString(),
      end_time: endTime ? new Date(endTime).toISOString() : undefined,
      break_minutes: entryType === 'break' ? 0 : breakMins,
      work_order_id: workOrderId || null,
      customer_project_id: category === 'customer_project' ? customerProjectId || null : null,
      customer_name: category === 'customer_project' ? selectedProject?.customer_name || null : null,
      comment,
      submitNow,
    };
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select label="Typ" value={entryType} onChange={e => setEntryType(e.target.value as TimeEntryKind)}
            options={[
              { value: 'work', label: 'Arbete' },
              { value: 'break', label: 'Rast' },
            ]} />
          <Select label="Kategori" value={category} onChange={e => setCategory(e.target.value as TimeCategory)}
            options={Object.entries(TIME_CATEGORY_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select label="Arbetsorder (valfritt)" value={workOrderId} onChange={e => setWorkOrderId(e.target.value)}
            options={[{ value: '', label: 'Ingen' }, ...workOrders.map(wo => ({ value: wo.id, label: wo.title }))]} />
          {category === 'customer_project' ? (
            <Select
              label="Kundprojekt"
              value={customerProjectId}
              onChange={e => setCustomerProjectId(e.target.value)}
              options={[
                { value: '', label: customerProjects.length === 0 ? 'Inga tillgängliga kundprojekt' : 'Välj kundprojekt' },
                ...customerProjects.map(project => ({ value: project.id, label: projectOptionLabel(project) })),
              ]}
            />
          ) : (
            <div />
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Start" type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} />
          <Input label="Slut (valfritt om pågående)" type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} />
        </div>

        {entryType === 'work' && (
          <Input label="Rast (minuter)" type="number" min={0} max={480} value={breakMins}
            onChange={e => setBreakMins(Math.max(0, parseInt(e.target.value) || 0))} />
        )}

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

        {isApproved && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {approvedEditMode === 'admin'
              ? 'Denna post är redan godkänd. Ändringar du sparar som admin behåller posten som godkänd.'
              : 'Denna post är redan godkänd. Dina ändringar skickas till admin för redigeringsgodkännande.'}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Avbryt</Button>
          {(isDraft || isRejected) && (
            <Button variant="secondary" onClick={() => onSubmit(buildPayload(false))} disabled={!isValid || (requiresProject && !customerProjectId)} className="flex-1">
              Spara utkast
            </Button>
          )}
          <Button variant="primary" onClick={() => onSubmit(buildPayload(true))} disabled={!isValid || !endTime || (requiresProject && !customerProjectId)} className="flex-1 gap-2">
            <Send className="w-4 h-4" />
            {isApproved && approvedEditMode === 'admin' ? 'Spara som godkänd' : isApproved ? 'Skicka ändring' : isRejected ? 'Skicka in igen' : 'Skicka för godkännande'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EndDayModal({ open, onClose, onSubmit, defaultComment }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (comment: string) => void;
  defaultComment: string;
}) {
  const [comment, setComment] = useState(defaultComment);

  useEffect(() => {
    if (open) setComment(defaultComment);
  }, [open, defaultComment]);

  return (
    <Modal open={open} onClose={onClose} title="Stämpla ut för dagen">
      <div className="space-y-4">
        <Textarea
          label="Vad har utförts idag?"
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={4}
          placeholder="Sammanfatta dagens arbete..."
        />
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Avbryt</Button>
          <Button variant="danger" onClick={() => onSubmit(comment)} className="flex-1 gap-2">
            <Square className="w-4 h-4" /> Stämpla ut
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DayCommentModal({ open, onClose, onSubmit, defaultComment, dayKey }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (comment: string) => void;
  defaultComment: string;
  dayKey: string;
}) {
  const [comment, setComment] = useState(defaultComment);

  useEffect(() => {
    if (open) setComment(defaultComment);
  }, [open, defaultComment]);

  return (
    <Modal open={open} onClose={onClose} title={dayKey ? `Dagens kommentar ${formatDate(dayKey)}` : 'Dagens kommentar'}>
      <div className="space-y-4">
        <Textarea
          label="Vad utfördes den här dagen?"
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={4}
          placeholder="Sammanfatta arbete, avvikelser eller annat viktigt..."
        />
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Avbryt</Button>
          <Button variant="primary" onClick={() => onSubmit(comment)} className="flex-1">Spara kommentar</Button>
        </div>
      </div>
    </Modal>
  );
}

function absenceStatusColor(status: StaffAbsenceStatus) {
  return {
    submitted: 'text-amber-700 bg-amber-100',
    approved: 'text-green-700 bg-green-100',
    rejected: 'text-red-600 bg-red-100',
    cancelled: 'text-slate-600 bg-slate-100',
  }[status];
}

function AbsenceRequestList({ requests }: { requests: StaffAbsenceRequest[] }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Frånvaro och ledighet</h3>
          <p className="text-xs text-slate-500">Dina anmälningar och ansökningar för vald månad</p>
        </div>
      </div>
      {requests.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-400">
          Ingen frånvaro registrerad
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map(request => (
            <div key={request.id} className="flex flex-col gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{ABSENCE_TYPE_LABEL[request.absence_type]}</span>
                  <Badge className={absenceStatusColor(request.status)}>{ABSENCE_STATUS_LABEL[request.status]}</Badge>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatDate(request.start_date)}{request.end_date !== request.start_date && ` - ${formatDate(request.end_date)}`}
                </p>
                {request.comment && <p className="text-xs text-slate-500 mt-1">{request.comment}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AbsenceRequestModal({ open, onClose, onSubmit }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { absence_type: StaffAbsenceType; start_date: string; end_date: string; comment: string }) => void;
}) {
  const today = localDateKey(new Date());
  const [absenceType, setAbsenceType] = useState<StaffAbsenceType>('sick');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (open) {
      setAbsenceType('sick');
      setStartDate(today);
      setEndDate(today);
      setComment('');
    }
  }, [open, today]);

  const valid = !!startDate && !!endDate && endDate >= startDate;

  return (
    <Modal open={open} onClose={onClose} title="Anmäl frånvaro eller ansök om ledighet">
      <div className="space-y-4">
        <Select
          label="Typ"
          value={absenceType}
          onChange={e => setAbsenceType(e.target.value as StaffAbsenceType)}
          options={Object.entries(ABSENCE_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Från" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <Input label="Till" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <Textarea
          label="Kommentar (valfritt)"
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={3}
          placeholder="Exempel: sjuk idag, VAB, önskar ledigt..."
        />
        {!valid && (
          <p className="text-sm text-red-600">Slutdatum måste vara samma dag eller efter startdatum.</p>
        )}
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Avbryt</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => onSubmit({ absence_type: absenceType, start_date: startDate, end_date: endDate, comment })}
            className="flex-1 gap-2"
          >
            <Send className="w-4 h-4" /> Skicka
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Admin view ────────────────────────────────────────────────────────────────

function AdminTimeView({ user }: { user: Profile }) {
  const [viewTab, setViewTab] = useState<'today' | 'timesheets'>('today');
  const [monthFilter, setMonthFilter] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [todayFilter, setTodayFilter] = useState(() => localDateKey(new Date()));
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [staffMembers, setStaffMembers] = useState<Profile[]>([]);
  const [summary, setSummary] = useState<Record<string, { total: number; approved: number; pending: number; rejected: number }>>({});
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<Profile | null>(null);
  const [staffEntries, setStaffEntries] = useState<TimeEntry[]>([]);
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [adminTab, setAdminTab] = useState<'list' | 'calendar'>('list');
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[]>([]);
  const [customerProjects, setCustomerProjects] = useState<CustomerProjectSummary[]>([]);
  const [absenceRequests, setAbsenceRequests] = useState<StaffAbsenceRequest[]>([]);
  const [adminEditingEntry, setAdminEditingEntry] = useState<TimeEntry | null>(null);
  const [adminEditModalOpen, setAdminEditModalOpen] = useState(false);
  const [adminEntryModalTitle, setAdminEntryModalTitle] = useState('Redigera tidpost');

  // Calendar for admin staff view
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());

  useEffect(() => { fetchStaff(); fetchAdminOptions(); }, []);
  useEffect(() => { if (staffMembers.length > 0) { fetchSummary(); fetchTodayEntries(); } }, [monthFilter, todayFilter, staffMembers]);

  async function fetchStaff() {
    const { data } = await supabase.from('profiles').select('*')
      .in('role', ['staff', 'admin', 'superadmin']).eq('active', true).order('name');
    setStaffMembers(data || []);
  }

  async function fetchAdminOptions() {
    const [{ data: wos }, { data: projectsData }] = await Promise.all([
      supabase.from('work_orders').select('id, title, status').in('status', ['new', 'assigned', 'started', 'paused']),
      supabase.from('customer_projects').select('id, title, name, customer_name, status').not('status', 'in', '(archived,completed,cancelled)').order('updated_at', { ascending: false }),
    ]);
    setWorkOrders(wos || []);
    setCustomerProjects(projectsData || []);
  }

  async function fetchSummary() {
    setLoading(true);
    try {
      const { start, end } = monthRange(monthFilter);
      const { data } = await supabase.from('time_entries').select('user_id, total_minutes, status, entry_type')
        .gte('start_time', start).lt('start_time', end);

      const s: Record<string, { total: number; approved: number; pending: number; rejected: number }> = {};
      staffMembers.forEach(st => { s[st.id] = { total: 0, approved: 0, pending: 0, rejected: 0 }; });
      data?.forEach(e => {
        if (s[e.user_id] && e.entry_type !== 'break') {
          s[e.user_id].total += e.total_minutes || 0;
          if (e.status === 'approved') s[e.user_id].approved += e.total_minutes || 0;
          else if (e.status === 'submitted' || e.status === 'change_requested') s[e.user_id].pending += e.total_minutes || 0;
          else if (e.status === 'rejected') s[e.user_id].rejected += e.total_minutes || 0;
        }
      });
      setSummary(s);
    } finally {
      setLoading(false);
    }
  }

  async function fetchTodayEntries() {
    const start = new Date(`${todayFilter}T00:00:00`).toISOString();
    const end = new Date(`${todayFilter}T23:59:59`).toISOString();
    const { data } = await supabase
      .from('time_entries')
      .select('*, work_order:work_order_id(id, title), customer_project:customer_project_id(id, title, name, customer_name)')
      .gte('start_time', start)
      .lte('start_time', end)
      .order('start_time', { ascending: false });
    setTodayEntries(data || []);
  }

  async function openStaffModal(staff: Profile) {
    setSelectedStaff(staff);
    await loadStaffEntries(staff.id, monthFilter);
    await loadAbsenceRequests(staff.id, monthFilter);
    setAdminTab('list');
    setStaffModalOpen(true);
  }

  async function loadStaffEntries(staffId: string, month: string) {
    const { start, end } = monthRange(month);
    const { data } = await supabase
      .from('time_entries')
      .select('*, work_order:work_order_id(id, title), customer_project:customer_project_id(id, title, name, customer_name)')
      .eq('user_id', staffId)
      .gte('start_time', start).lt('start_time', end)
      .order('start_time', { ascending: false });
    setStaffEntries(data || []);
  }

  async function loadAbsenceRequests(staffId: string, month: string) {
    const [year, monthNumber] = month.split('-').map(Number);
    const startDate = localDateKey(new Date(year, monthNumber - 1, 1));
    const endDate = localDateKey(new Date(year, monthNumber, 0));
    const { data } = await supabase
      .from('staff_absence_requests')
      .select('*, user:user_id(id, name, email, role)')
      .eq('user_id', staffId)
      .gte('end_date', startDate)
      .lte('start_date', endDate)
      .order('start_date', { ascending: false });
    setAbsenceRequests(data || []);
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
      .eq('user_id', selectedStaff.id).in('status', ['submitted', 'change_requested'])
      .gte('start_time', start).lt('start_time', end);
    loadStaffEntries(selectedStaff.id, monthFilter);
    fetchSummary();
  }

  async function handleAdminSaveEntry(payload: EntryFormPayload, entryId?: string) {
    if (!selectedStaff) return;
    const data: any = {
      user_id: selectedStaff.id,
      organisation_id: selectedStaff.organisation_id || user.organisation_id || null,
      category: payload.category,
      start_time: payload.start_time,
      end_time: payload.end_time || null,
      break_minutes: payload.break_minutes || 0,
      total_minutes: payload.end_time
        ? calcMinutes(payload.start_time!, payload.end_time, payload.break_minutes || 0)
        : 0,
      comment: payload.comment || '',
      work_order_id: payload.work_order_id || null,
      customer_project_id: payload.category === 'customer_project' ? payload.customer_project_id || null : null,
      entry_type: payload.entry_type || 'work',
      customer_name: payload.customer_name || null,
      status: 'approved',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    };
    if (entryId) {
      await supabase.from('time_entries').update({ ...data, user_id: undefined, organisation_id: undefined }).eq('id', entryId);
    } else {
      await supabase.from('time_entries').insert(data);
    }
    setAdminEditingEntry(null);
    setAdminEditModalOpen(false);
    setAdminEntryModalTitle('Redigera tidpost');
    await loadStaffEntries(selectedStaff.id, monthFilter);
    await fetchTodayEntries();
    fetchSummary();
  }

  async function deleteAdminEntry(entry: TimeEntry) {
    if (!selectedStaff) return;
    if (!window.confirm('Ta bort denna tidrad?')) return;
    await supabase.from('time_entries').delete().eq('id', entry.id);
    await loadStaffEntries(selectedStaff.id, monthFilter);
    await fetchTodayEntries();
    fetchSummary();
  }

  async function reviewAbsenceRequest(id: string, status: 'approved' | 'rejected') {
    if (!selectedStaff) return;
    await supabase
      .from('staff_absence_requests')
      .update({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id);
    loadAbsenceRequests(selectedStaff.id, monthFilter);
  }

  // Calendar helpers for selected staff
  const daysInCalMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDayOfWeek = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;
  const calEntriesByDay = staffEntries.reduce((acc, e) => {
    const day = localDateKey(e.start_time);
    if (!acc[day]) acc[day] = [];
    acc[day].push(e);
    return acc;
  }, {} as Record<string, TimeEntry[]>);
  const calMonthName = new Date(calYear, calMonth, 1).toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });

  const modalTotalWork = staffEntries.filter(e => e.end_time && e.entry_type !== 'break').reduce((s, e) => s + (e.total_minutes || 0), 0);
  const modalTotalBreaks = staffEntries.reduce((s, e) => {
    if (e.entry_type === 'break') return s + (e.total_minutes || 0);
    return s + (e.break_minutes || 0);
  }, 0);
  const workDays = Object.values(calEntriesByDay).filter(d => d.some(e => e.end_time)).length;
  const modalOvertime = Math.max(modalTotalWork - workDays * 480, 0);

  const pendingCount = staffEntries.filter(e => e.status === 'submitted' || e.status === 'change_requested').length;
  const selectedStaffAbsences = absenceRequests.filter(request => request.user_id === selectedStaff?.id);
  const filteredStaffMembers = staffMembers.filter(staff => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return staff.name.toLowerCase().includes(query) || staff.email.toLowerCase().includes(query);
  });
  const todayEntriesByStaff = todayEntries.reduce((acc, entry) => {
    if (!acc[entry.user_id]) acc[entry.user_id] = [];
    acc[entry.user_id].push(entry);
    return acc;
  }, {} as Record<string, TimeEntry[]>);
  const clockedInNow = staffMembers.filter(staff => (todayEntriesByStaff[staff.id] || []).some(entry => !entry.end_time));
  const totalAttendance = staffMembers.filter(staff => (todayEntriesByStaff[staff.id] || []).length > 0);
  const todayPendingCount = todayEntries.filter(entry => entry.status === 'submitted' || entry.status === 'change_requested').length + absenceRequests.filter(request => request.status === 'submitted').length;

  return (
    <div className="space-y-6 min-h-screen bg-slate-50 -m-4 lg:-m-6 p-4 lg:p-6">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex border-b border-slate-100">
          <button
            type="button"
            onClick={() => setViewTab('today')}
            className={`px-5 py-4 text-sm font-semibold border-b-2 transition-colors ${
              viewTab === 'today' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Idag
          </button>
          <button
            type="button"
            onClick={() => setViewTab('timesheets')}
            className={`px-5 py-4 text-sm font-semibold border-b-2 transition-colors ${
              viewTab === 'timesheets' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Timesheets
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Sök personal..." className="sm:w-72" />
              {viewTab === 'today' ? (
                <Input type="date" value={todayFilter} onChange={e => setTodayFilter(e.target.value)} className="sm:w-44" />
              ) : (
                <Input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="sm:w-44" />
              )}
            </div>
            <Badge className={todayPendingCount > 0 ? 'bg-orange-100 text-orange-700 px-3 py-1.5' : 'bg-slate-100 text-slate-500 px-3 py-1.5'}>
              {todayPendingCount} väntande
            </Badge>
          </div>

          {viewTab === 'today' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Card className="p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-2xl font-bold text-slate-800">{clockedInNow.length}</p>
                    <p className="text-sm text-slate-600">Instämplade just nu</p>
                  </div>
                  <UserCheck className="w-5 h-5 text-slate-400" />
                </div>
              </Card>
              <Card className="p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-2xl font-bold text-slate-800">{totalAttendance.length}</p>
                    <p className="text-sm text-slate-600">Har tid registrerad idag</p>
                  </div>
                  <ClipboardList className="w-5 h-5 text-slate-400" />
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {loading ? <LoadingPage /> : (
        <Card>
          <div className="md:hidden divide-y divide-slate-100">
            {filteredStaffMembers.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-400">Ingen personal</div>
            ) : filteredStaffMembers.map(staff => {
              const d = summary[staff.id] || { total: 0, approved: 0, pending: 0, rejected: 0 };
              const staffTodayEntries = todayEntriesByStaff[staff.id] || [];
              const activeEntry = staffTodayEntries.find(entry => !entry.end_time);
              const todayTotal = staffTodayEntries.filter(entry => entry.entry_type !== 'break').reduce((sum, entry) => sum + (entry.total_minutes || 0), 0);
              return (
                <button
                  type="button"
                  key={staff.id}
                  onClick={() => openStaffModal(staff)}
                  className="block w-full p-4 text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 break-words">{staff.name}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {viewTab === 'today'
                          ? activeEntry ? `Instämplad som ${activeEntry.entry_type === 'break' ? 'Rast' : TIME_CATEGORY_LABELS[activeEntry.category as TimeCategory]}` : 'Inte instämplad'
                          : `Total ${formatMinutes(d.total)}`}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); openStaffModal(staff); }}>Granska</Button>
                  </div>
                  {viewTab === 'today' ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className={`rounded-lg px-2 py-2 text-center ${activeEntry ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'}`}>
                        <p className="font-semibold">{activeEntry?.start_time ? new Date(activeEntry.start_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '--'}</p>
                        <p>Start</p>
                      </div>
                      <div className="rounded-lg bg-blue-50 px-2 py-2 text-center text-blue-700">
                        <p className="font-semibold">{formatMinutes(todayTotal)}</p>
                        <p>Idag</p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg bg-green-50 px-2 py-2 text-center text-green-700">
                      <p className="font-semibold">{formatMinutes(d.approved)}</p>
                      <p>Godkänd</p>
                    </div>
                    <div className={`rounded-lg px-2 py-2 text-center ${d.pending > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-500'}`}>
                      <p className="font-semibold">{formatMinutes(d.pending)}</p>
                      <p>Väntande</p>
                    </div>
                    <div className={`rounded-lg px-2 py-2 text-center ${d.rejected > 0 ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-500'}`}>
                      <p className="font-semibold">{formatMinutes(d.rejected)}</p>
                      <p>Avvisad</p>
                    </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <div className="hidden md:block overflow-x-auto">
            {viewTab === 'today' ? (
              <table className="w-full text-sm min-w-[1120px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Personal</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Instämplad som</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Jobb/projekt</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Start</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Slut</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Dagstotal</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Kommentar</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filteredStaffMembers.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">Ingen personal</td></tr>
                  ) : filteredStaffMembers.map(staff => {
                    const staffTodayEntries = todayEntriesByStaff[staff.id] || [];
                    const activeEntry = staffTodayEntries.find(entry => !entry.end_time);
                    const latestEntry = activeEntry || staffTodayEntries[0];
                    const todayTotal = staffTodayEntries.filter(entry => entry.entry_type !== 'break').reduce((sum, entry) => sum + (entry.total_minutes || 0), 0);
                    return (
                      <tr key={staff.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => openStaffModal(staff)}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white ${activeEntry ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                              {staff.name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-800 truncate">{staff.name}</p>
                              <p className="text-xs text-slate-400 truncate">{staff.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={activeEntry ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}>
                            {activeEntry ? 'Instämplad' : 'Ej instämplad'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{latestEntry ? latestEntry.entry_type === 'break' ? 'Rast' : TIME_CATEGORY_LABELS[latestEntry.category as TimeCategory] : '--'}</td>
                        <td className="px-4 py-3 text-slate-600 max-w-[220px] truncate">{latestEntry ? timeEntryProjectLabel(latestEntry) || latestEntry.work_order?.title || '--' : '--'}</td>
                        <td className="px-4 py-3 text-slate-700">{latestEntry ? new Date(latestEntry.start_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '--'}</td>
                        <td className="px-4 py-3 text-slate-700">{latestEntry?.end_time ? new Date(latestEntry.end_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '--'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">{todayTotal > 0 ? formatMinutes(todayTotal) : '--'}</td>
                        <td className="px-4 py-3 text-slate-500 max-w-[260px] truncate">{latestEntry?.comment || '--'}</td>
                        <td className="px-4 py-3 text-right">
                          <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); openStaffModal(staff); }}>Timesheet</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
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
                {filteredStaffMembers.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Ingen personal</td></tr>
                ) : filteredStaffMembers.map(staff => {
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
            )}
          </div>
        </Card>
      )}

      {/* Staff detail modal */}
      <Modal open={staffModalOpen} onClose={() => setStaffModalOpen(false)} title={selectedStaff?.name || ''} size="xxl">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-800">Timesheet</p>
              <p className="text-xs text-slate-500">Ändra tider, byt jobb, lägg till kommentarer eller korrigera rader.</p>
            </div>
            <Button
              variant="primary"
              className="gap-2"
              onClick={() => {
                setAdminEditingEntry(null);
                setAdminEntryModalTitle(`Lägg till tidrad för ${selectedStaff?.name || 'personal'}`);
                setAdminEditModalOpen(true);
              }}
            >
              <Plus className="w-4 h-4" /> Lägg till rad
            </Button>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-full sm:w-fit">
            <button onClick={() => setAdminTab('list')} className={`flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${adminTab === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <List className="w-3.5 h-3.5" /> Lista
            </button>
            <button onClick={() => setAdminTab('calendar')} className={`flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${adminTab === 'calendar' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <Calendar className="w-3.5 h-3.5" /> Månadsvy
            </button>
          </div>

          {pendingCount > 0 && (
            <Button onClick={approveAll} variant="primary" className="w-full gap-2">
              <CheckCircle className="w-4 h-4" /> Godkänn alla {pendingCount} väntande poster
            </Button>
          )}

          <Card className="p-3 bg-slate-50 border-slate-100">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <p className="text-sm font-bold text-slate-800">Frånvaro och ledighet</p>
                <p className="text-xs text-slate-500">Sjuk, VAB och ledighetsansökningar för vald månad</p>
              </div>
            </div>
            {selectedStaffAbsences.length === 0 ? (
              <p className="text-sm text-slate-400">Inga frånvaroärenden för perioden.</p>
            ) : (
              <div className="space-y-2">
                {selectedStaffAbsences.map(request => (
                  <div key={request.id} className="flex flex-col gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{ABSENCE_TYPE_LABEL[request.absence_type]}</span>
                        <Badge className={absenceStatusColor(request.status)}>{ABSENCE_STATUS_LABEL[request.status]}</Badge>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {formatDate(request.start_date)}{request.end_date !== request.start_date && ` - ${formatDate(request.end_date)}`}
                      </p>
                      {request.comment && <p className="text-xs text-slate-500 mt-1">{request.comment}</p>}
                    </div>
                    {request.status === 'submitted' && (
                      <div className="flex gap-2">
                        <button onClick={() => reviewAbsenceRequest(request.id, 'approved')} className="text-xs text-green-600 hover:text-green-700 font-medium">Godkänn</button>
                        <span className="text-slate-300">|</span>
                        <button onClick={() => reviewAbsenceRequest(request.id, 'rejected')} className="text-xs text-red-500 hover:text-red-600 font-medium">Avvisa</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* List tab */}
          {adminTab === 'list' && (
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200">
              {staffEntries.length === 0 ? (
                <EmptyState icon={<Clock className="w-10 h-10" />} title="Inga poster" description="Inga tidsrapporter för vald period." />
              ) : (
                <table className="w-full min-w-[980px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Datum</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Typ</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Jobb</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Start</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Slut</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600">Total</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Kund/kommentar</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Status</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600">Åtgärd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...staffEntries].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()).map(entry => (
                      <tr key={entry.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{formatDate(localDateKey(entry.start_time))}</td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{entry.entry_type === 'break' ? 'Rast' : TIME_CATEGORY_LABELS[entry.category as TimeCategory]}</td>
                        <td className="px-3 py-2 text-slate-600 max-w-[180px] truncate">{timeEntryProjectLabel(entry) || entry.work_order?.title || '--'}</td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{new Date(entry.start_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{entry.end_time ? new Date(entry.end_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '--'}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800 whitespace-nowrap">{formatMinutes(entry.total_minutes || 0)}</td>
                        <td className="px-3 py-2 text-slate-500 max-w-[240px] truncate">{entry.comment || entry.customer_name || '--'}</td>
                        <td className="px-3 py-2 whitespace-nowrap"><Badge className={getTimeStatusColor(entry.status)}>{STATUS_LABEL[entry.status as TimeStatus] || entry.status}</Badge></td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              onClick={() => {
                                setAdminEditingEntry(entry);
                                setAdminEntryModalTitle(`Redigera tidpost för ${selectedStaff?.name || 'personal'}`);
                                setAdminEditModalOpen(true);
                              }}
                              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                            >
                              Redigera
                            </button>
                            <button onClick={() => deleteAdminEntry(entry)} className="text-xs text-red-500 hover:text-red-600 font-medium inline-flex items-center gap-1">
                              <Trash2 className="w-3 h-3" /> Ta bort
                            </button>
                            {(entry.status === 'submitted' || entry.status === 'change_requested') && (
                              <>
                                <button onClick={() => approveEntry(entry.id)} className="text-xs text-green-600 hover:text-green-700 font-medium">Godkänn</button>
                                <button onClick={() => rejectEntry(entry.id)} className="text-xs text-red-500 hover:text-red-600 font-medium">Avvisa</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
                  const work = dayEntries.filter(e => e.end_time && e.entry_type !== 'break').reduce((s, e) => s + (e.total_minutes || 0), 0);
                  const hasPending = dayEntries.some(e => e.status === 'submitted' || e.status === 'change_requested');
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
      {adminEditModalOpen && selectedStaff && (
        <EntryFormModal
          open={adminEditModalOpen}
          onClose={() => { setAdminEditModalOpen(false); setAdminEditingEntry(null); setAdminEntryModalTitle('Redigera tidpost'); }}
          onSubmit={(payload) => handleAdminSaveEntry(payload, adminEditingEntry?.id)}
          workOrders={workOrders}
          customerProjects={customerProjects}
          entry={adminEditingEntry || undefined}
          title={adminEntryModalTitle}
          defaultDate={`${monthFilter}-01`}
          approvedEditMode="admin"
        />
      )}
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
