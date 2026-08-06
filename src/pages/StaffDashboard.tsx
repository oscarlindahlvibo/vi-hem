import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Card, Badge, StatCard, LoadingPage } from '../components/ui';
import { formatDate, formatDateTime, WO_STATUS_LABELS, getWOStatusColor, getWOPriorityColor, WO_PRIORITY_LABELS, TIME_CATEGORY_LABELS } from '../lib/utils';
import type { MaintenanceRequest, WorkOrder, TimeEntry, StaffAbsenceRequest, StaffAbsenceType, StaffAbsenceStatus, News } from '../types';
import { Wrench, ClipboardList, Clock, AlertCircle, Timer, Plus, ArrowRight, CalendarX, Newspaper, MessageCircle, Users, Square, Repeat2, Coffee } from 'lucide-react';

interface StaffDashboardProps {
  onNavigate: (page: string) => void;
}

const ABSENCE_TYPE_LABEL: Record<StaffAbsenceType, string> = {
  sick: 'Sjuk',
  vab: 'VAB',
  vacation: 'Semester',
  leave: 'Ledig',
  unpaid_leave: 'Tjänstledig',
};

const ABSENCE_STATUS_LABEL: Record<StaffAbsenceStatus, string> = {
  submitted: 'Inväntar godkännande',
  approved: 'Godkänd',
  rejected: 'Avvisad',
  cancelled: 'Avbruten',
};

function customerProjectLabel(project: any) {
  return project?.title || project?.name || project?.customer_name || '';
}

function timeEntryLabel(entry: TimeEntry) {
  if (entry.entry_type === 'break') return 'Rast';
  return TIME_CATEGORY_LABELS[entry.category] || 'Arbete';
}

function absenceStatusColor(status: StaffAbsenceStatus) {
  return {
    submitted: 'text-amber-700 bg-amber-100',
    approved: 'text-green-700 bg-green-100',
    rejected: 'text-red-600 bg-red-100',
    cancelled: 'text-slate-600 bg-slate-100',
  }[status];
}

function isUnassignedWorkOrder(order: Pick<WorkOrder, 'assigned_to' | 'assigned_to_ids'>) {
  return !order.assigned_to && (!order.assigned_to_ids || order.assigned_to_ids.length === 0);
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'God natt';
  if (hour < 11) return 'God morgon';
  if (hour < 17) return 'God dag';
  if (hour < 23) return 'God kväll';
  return 'God natt';
}

export function StaffDashboard({ onNavigate }: StaffDashboardProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [newMRCount, setNewMRCount] = useState(0);
  const [urgentMRCount, setUrgentMRCount] = useState(0);
  const [myWorkOrdersCount, setMyWorkOrdersCount] = useState(0);
  const [newWorkOrdersCount, setNewWorkOrdersCount] = useState(0);
  const [attentionWorkOrdersCount, setAttentionWorkOrdersCount] = useState(0);
  const [activeTimeEntry, setActiveTimeEntry] = useState<TimeEntry | null>(null);
  const [myWorkOrders, setMyWorkOrders] = useState<WorkOrder[]>([]);
  const [newWorkOrders, setNewWorkOrders] = useState<WorkOrder[]>([]);
  const [todayAbsences, setTodayAbsences] = useState<StaffAbsenceRequest[]>([]);
  const [clockedInEntries, setClockedInEntries] = useState<TimeEntry[]>([]);
  const [dashboardNews, setDashboardNews] = useState<News[]>([]);

  useEffect(() => {
    if (!user?.id) return;

    const fetchDashboardData = async () => {
      try {
        setLoading(true);

        const [
          newMRResult,
          urgentMRResult,
          myWOResult,
          newWOResult,
          activeTimeResult,
          myWODetailsResult,
          newWODetailsResult,
          todayAbsencesResult,
          clockedInResult,
          newsResult,
        ] = await Promise.all([
          // Count new maintenance requests (status='received')
          supabase
            .from('vihem_maintenance_requests')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'received'),

          // Count urgent maintenance requests (priority='urgent' and status not in 'done','closed')
          supabase
            .from('vihem_maintenance_requests')
            .select('id', { count: 'exact', head: true })
            .eq('priority', 'urgent')
            .not('status', 'in', '(done,closed)'),

          // Count my assigned work orders, including multi-assignee rows.
          supabase
            .from('vihem_work_orders')
            .select('id')
            .or(`assigned_to.eq.${user.id},assigned_to_ids.cs.{${user.id}}`)
            .not('status', 'in', '(completed,cancelled)'),

          // Count new unassigned work orders that staff can pick up.
          supabase
            .from('vihem_work_orders')
            .select('id, assigned_to, assigned_to_ids')
            .eq('status', 'new'),

          // Fetch active time entry, regardless of when it started.
          supabase
            .from('vihem_time_entries')
            .select('*')
            .eq('user_id', user.id)
            .is('end_time', null)
            .order('start_time', { ascending: false })
            .limit(1),

          // Fetch my assigned work orders (limit 5)
          supabase
            .from('vihem_work_orders')
            .select('*')
            .or(`assigned_to.eq.${user.id},assigned_to_ids.cs.{${user.id}}`)
            .not('status', 'in', '(completed,cancelled)')
            .order('due_date', { ascending: true, nullsFirst: true })
            .limit(5),

          // Fetch new work orders (limit 5)
          supabase
            .from('vihem_work_orders')
            .select('*')
            .eq('status', 'new')
            .order('created_at', { ascending: false })
            .limit(5),

          user.role === 'admin'
            ? supabase
                .from('vihem_staff_absence_requests')
                .select('*, user:vihem_profiles(id, name, email)')
                .lte('start_date', new Date().toISOString().slice(0, 10))
                .gte('end_date', new Date().toISOString().slice(0, 10))
                .in('status', ['submitted', 'approved'])
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: [], error: null }),

          user.role === 'admin'
            ? supabase
                .from('vihem_time_entries')
                .select('*, user:vihem_profiles(id, name, email), work_order:vihem_work_orders(id, title), customer_project:vihem_customer_projects(id, title, name, customer_name)')
                .is('end_time', null)
                .eq('organisation_id', user.organisation_id)
                .order('start_time', { ascending: false })
            : Promise.resolve({ data: [], error: null }),

          supabase
            .from('vihem_news')
            .select('*')
            .eq('status', 'published')
            .order('published_at', { ascending: false })
            .limit(4),
        ]);

        setNewMRCount(newMRResult.count || 0);
        setUrgentMRCount(urgentMRResult.count || 0);
        const myWorkOrderIds = (myWOResult.data || []).map((order) => order.id);
        const unassignedNewWorkOrderIds = ((newWOResult.data || []) as Pick<WorkOrder, 'id' | 'assigned_to' | 'assigned_to_ids'>[])
          .filter(isUnassignedWorkOrder)
          .map((order) => order.id);
        setMyWorkOrdersCount(myWorkOrderIds.length);
        setNewWorkOrdersCount(unassignedNewWorkOrderIds.length);
        setAttentionWorkOrdersCount(new Set([...myWorkOrderIds, ...unassignedNewWorkOrderIds]).size);

        setActiveTimeEntry(activeTimeResult.data && activeTimeResult.data.length > 0 ? activeTimeResult.data[0] : null);

        if (myWODetailsResult.data) {
          setMyWorkOrders(myWODetailsResult.data);
        }

        if (newWODetailsResult.data) {
          setNewWorkOrders((newWODetailsResult.data as WorkOrder[]).filter(isUnassignedWorkOrder));
        }

        if (todayAbsencesResult.data) {
          setTodayAbsences(todayAbsencesResult.data as StaffAbsenceRequest[]);
        }

        if (clockedInResult.data) {
          const latestEntryByUser = new Map<string, TimeEntry>();
          (clockedInResult.data as TimeEntry[]).forEach((entry) => {
            if (!latestEntryByUser.has(entry.user_id)) latestEntryByUser.set(entry.user_id, entry);
          });
          setClockedInEntries(Array.from(latestEntryByUser.values()));
        } else {
          setClockedInEntries([]);
        }

        if (newsResult.data) {
          setDashboardNews((newsResult.data as News[]).filter(item => ['staff', 'all'].includes(item.audience || 'staff')));
        }
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();

    const channel = supabase
      .channel(`staff-dashboard-${user.organisation_id || user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vihem_staff_absence_requests' }, () => fetchDashboardData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vihem_time_entries' }, () => fetchDashboardData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, user?.organisation_id]);

  if (loading) {
    return <LoadingPage />;
  }

  const firstName = user?.name?.split(' ')[0] || 'där';
  const attentionCount = newMRCount + urgentMRCount + attentionWorkOrdersCount + todayAbsences.length;
  const quickTiles = [
    {
      label: 'Nyheter',
      count: null,
      icon: <Newspaper className="h-6 w-6" />,
      className: 'bg-blue-50 text-blue-600',
      page: 'news',
    },
    {
      label: 'Arbetsordrar',
      count: attentionWorkOrdersCount,
      icon: <ClipboardList className="h-6 w-6" />,
      className: 'bg-orange-50 text-orange-500',
      page: 'workorders',
    },
    {
      label: 'Stämpelklocka',
      count: null,
      icon: <Timer className="h-6 w-6" />,
      className: 'bg-sky-50 text-sky-600',
      page: 'timetracking',
    },
    {
      label: 'Chatt',
      count: null,
      icon: <MessageCircle className="h-6 w-6" />,
      className: 'bg-rose-50 text-rose-500',
      page: 'chat',
    },
    {
      label: 'Personal',
      count: user?.role === 'admin' ? clockedInEntries.length : null,
      icon: <Users className="h-6 w-6" />,
      className: 'bg-violet-50 text-violet-500',
      page: user?.role === 'admin' ? 'admin-staff' : 'timetracking',
    },
  ];

  return (
    <div className="min-w-0 max-w-full space-y-3 overflow-hidden sm:space-y-6">
      <section className="rounded-2xl bg-white px-4 pb-4 pt-5 shadow-sm ring-1 ring-slate-200/70 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-base font-black text-white shadow-sm sm:h-12 sm:w-12">
              {user?.name?.charAt(0) || 'V'}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black text-slate-950 sm:text-2xl">
                {getGreeting()}, {firstName}
              </h1>
              <p className="mt-0.5 truncate text-sm font-medium text-slate-500">
                {user?.role === 'admin' ? 'Överblick över dagens drift' : 'Din arbetsdag i VI-HEM'}
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('notifications')}
            className="relative rounded-2xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            aria-label="Notiser"
          >
            <AlertCircle className="h-6 w-6" />
            {attentionCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-500 px-1 text-xs font-bold text-white">
                {attentionCount > 99 ? '99+' : attentionCount}
              </span>
            )}
          </button>
        </div>

        <div className="mt-5 grid min-w-0 grid-cols-3 gap-3 sm:flex sm:overflow-x-auto sm:pb-1 sm:[-ms-overflow-style:none] sm:[scrollbar-width:none] sm:[&::-webkit-scrollbar]:hidden">
          {quickTiles.map((tile) => (
            <button
              key={tile.label}
              onClick={() => onNavigate(tile.page)}
              className="relative flex min-w-0 flex-col items-center gap-2 rounded-2xl px-1 py-2 text-center transition-transform active:scale-[0.98] sm:min-w-[8.5rem] sm:px-3 sm:py-3"
            >
              <span className={`flex h-14 w-full items-center justify-center rounded-2xl sm:h-16 ${tile.className}`}>
                {tile.icon}
              </span>
              <span className="max-w-full truncate text-xs font-semibold text-slate-700 sm:text-sm">{tile.label}</span>
              {tile.count !== null && tile.count > 0 && (
                <span className="absolute right-0 top-0 flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-500 px-1 text-xs font-bold text-white shadow-sm sm:right-2 sm:top-1 sm:h-7 sm:min-w-7 sm:text-sm">
                  {tile.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-white px-4 py-5 shadow-sm ring-1 ring-slate-200/70 sm:px-6">
        <button
          onClick={() => onNavigate('timetracking')}
          className="mb-4 flex w-full min-w-0 items-center justify-between gap-3 text-left"
        >
          <h2 className="min-w-0 text-xl font-black text-slate-950">Stämpelklocka</h2>
          <ArrowRight className="h-5 w-5 shrink-0 text-slate-300" />
        </button>
        {activeTimeEntry ? (
          <div className="space-y-3">
            <div className={`rounded-2xl px-4 py-3 ${
              activeTimeEntry.entry_type === 'break' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'
            }`}>
              <p className="text-xs font-bold uppercase tracking-wide">
                {activeTimeEntry.entry_type === 'break' ? 'Aktiv rast' : 'Instämplad just nu'}
              </p>
              <p className="mt-1 text-sm font-semibold">
                {timeEntryLabel(activeTimeEntry)}
                {(customerProjectLabel(activeTimeEntry.customer_project) || activeTimeEntry.work_order?.title) && (
                  <> · {customerProjectLabel(activeTimeEntry.customer_project) || activeTimeEntry.work_order?.title}</>
                )}
              </p>
              <p className="mt-1 text-xs font-medium opacity-80">Startad {formatDateTime(activeTimeEntry.start_time)}</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                onClick={() => onNavigate('timetracking/clockout')}
                className="inline-flex min-w-0 items-center justify-center gap-2 rounded-full bg-rose-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-rose-500/20 transition-transform hover:bg-rose-600 active:scale-[0.99]"
              >
                <Square className="h-4 w-4 shrink-0" />
                <span className="truncate">Stämpla ut</span>
              </button>
              <button
                onClick={() => onNavigate('timetracking/switch')}
                className="inline-flex min-w-0 items-center justify-center gap-2 rounded-full bg-blue-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition-transform hover:bg-blue-600 active:scale-[0.99]"
              >
                <Repeat2 className="h-4 w-4 shrink-0" />
                <span className="truncate">Byt jobb</span>
              </button>
              {activeTimeEntry.entry_type === 'break' ? (
                <button
                  onClick={() => onNavigate('timetracking/switch')}
                  className="inline-flex min-w-0 items-center justify-center gap-2 rounded-full bg-emerald-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition-transform hover:bg-emerald-600 active:scale-[0.99]"
                >
                  <Timer className="h-4 w-4 shrink-0" />
                  <span className="truncate">Börja jobba</span>
                </button>
              ) : (
                <button
                  onClick={() => onNavigate('timetracking/break')}
                  className="inline-flex min-w-0 items-center justify-center gap-2 rounded-full bg-amber-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-amber-500/20 transition-transform hover:bg-amber-600 active:scale-[0.99]"
                >
                  <Coffee className="h-4 w-4 shrink-0" />
                  <span className="truncate">Gå på rast</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            onClick={() => onNavigate('timetracking')}
            className="flex w-full min-w-0 items-center justify-center gap-3 rounded-full bg-[#2d9cff] px-4 py-4 text-base font-bold text-white shadow-lg shadow-blue-500/25 transition-transform hover:bg-blue-600 active:scale-[0.99]"
          >
            <Timer className="h-6 w-6 shrink-0" />
            <span className="truncate">Stämpla in</span>
          </button>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <button
          onClick={() => onNavigate(user?.role === 'admin' ? 'timetracking' : 'workorders')}
          className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-5 text-left sm:px-6"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 min-w-11 items-center justify-center rounded-full bg-orange-400 text-lg font-black text-white">
              {attentionCount}
            </span>
            <h2 className="min-w-0 text-lg font-black leading-tight text-slate-950 sm:text-xl">Behöver din uppmärksamhet</h2>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-slate-300" />
        </button>
        <div className="border-t border-slate-100 px-4 py-4 sm:px-6">
          <button
            onClick={() => onNavigate(myWorkOrdersCount > 0 ? 'workorders' : 'maintenance')}
            className="flex w-full min-w-0 items-center justify-between gap-3 rounded-2xl bg-white text-left"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 shadow-sm sm:h-16 sm:w-16">
                <ClipboardList className="h-7 w-7 sm:h-8 sm:w-8" />
              </span>
              <p className="min-w-0 text-sm font-semibold leading-5 text-slate-950 sm:text-base">
                <span className="font-black">{attentionWorkOrdersCount}</span> uppgifter väntar på dig i <span className="font-black">Arbetsordrar</span>
              </p>
            </div>
            <span className="hidden shrink-0 rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-blue-500 sm:inline-flex">Öppna</span>
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <button
          onClick={() => onNavigate('news')}
          className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-5 text-left sm:px-6"
        >
          <div className="min-w-0">
            <h2 className="truncate text-xl font-black text-slate-950">Nyheter</h2>
            <p className="mt-1 truncate text-sm font-medium text-slate-500">Information till din organisation</p>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-slate-300" />
        </button>
        <div className="border-t border-slate-100">
          {dashboardNews.length === 0 ? (
            <div className="px-4 py-6 text-sm font-medium text-slate-500 sm:px-6">
              Inga publicerade nyheter just nu.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {dashboardNews.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onNavigate('news')}
                  className="flex w-full min-w-0 items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-slate-50 sm:gap-4 sm:px-6"
                >
                  <span className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                    item.priority === 'urgent' ? 'bg-red-50 text-red-600' : item.priority === 'important' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'
                  }`}>
                    <Newspaper className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-slate-950">{item.title}</span>
                    <span className="mt-1 line-clamp-2 text-sm leading-5 text-slate-500">{item.content}</span>
                    {item.published_at && (
                      <span className="mt-2 block text-xs font-semibold text-slate-400">{formatDate(item.published_at)}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="hidden grid-cols-1 gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Nya felanmälningar" value={newMRCount} icon={<AlertCircle className="w-6 h-6" />} color="text-red-600 bg-red-50" onClick={() => onNavigate('maintenance')} />
        <StatCard label="Akuta ärenden" value={urgentMRCount} icon={<Wrench className="w-6 h-6" />} color="text-orange-600 bg-orange-50" />
        <StatCard label="Mina arbetsordrar" value={myWorkOrdersCount} icon={<ClipboardList className="w-6 h-6" />} color="text-blue-600 bg-blue-50" onClick={() => onNavigate('workorders')} />
        <StatCard label="Nya arbetsordrar" value={newWorkOrdersCount} icon={<Plus className="w-6 h-6" />} color="text-green-600 bg-green-50" />
      </div>

      {user?.role === 'admin' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="overflow-hidden border-emerald-200 bg-emerald-50">
            <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex min-w-0 items-start gap-3">
                <div className="shrink-0 rounded-xl bg-emerald-100 p-2.5 text-emerald-700">
                  <Timer className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-800">Instämplade just nu</h2>
                  <p className="text-sm leading-5 text-slate-600">
                    {clockedInEntries.length} person{clockedInEntries.length === 1 ? '' : 'er'} är instämplad{clockedInEntries.length === 1 ? '' : 'e'}.
                  </p>
                </div>
              </div>
              <button
                onClick={() => onNavigate('timetracking')}
                className="inline-flex w-full min-w-0 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-emerald-800 shadow-sm ring-1 ring-emerald-200 hover:bg-emerald-100 sm:w-auto"
              >
                <span className="truncate">Se tidrapportering</span>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </button>
            </div>
            <div className="divide-y divide-emerald-100 border-t border-emerald-100 bg-white/60">
              {clockedInEntries.length === 0 ? (
                <div className="px-6 py-4 text-sm text-slate-500">Ingen är instämplad just nu.</div>
              ) : (
                clockedInEntries.slice(0, 5).map((entry) => (
                  <div key={entry.id} className="flex flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{entry.user?.name || 'Personal'}</p>
                      <p className="text-xs text-slate-500">
                        Sedan {formatDateTime(entry.start_time)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className={entry.entry_type === 'break' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}>
                        {timeEntryLabel(entry)}
                      </Badge>
                      {(customerProjectLabel(entry.customer_project) || entry.work_order?.title) && (
                        <Badge className="bg-slate-100 text-slate-700">
                          {customerProjectLabel(entry.customer_project) || entry.work_order?.title}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="overflow-hidden border-amber-200 bg-amber-50">
            <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex min-w-0 items-start gap-3">
                <div className="shrink-0 rounded-xl bg-amber-100 p-2.5 text-amber-700">
                  <CalendarX className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-800">Frånvaro idag</h2>
                  <p className="text-sm leading-5 text-slate-600">
                    {todayAbsences.length} person{todayAbsences.length === 1 ? '' : 'er'} är sjukanmäld, ledig eller har väntande frånvaro idag.
                  </p>
                </div>
              </div>
              <button
                onClick={() => onNavigate('timetracking')}
                className="inline-flex w-full min-w-0 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-amber-800 shadow-sm ring-1 ring-amber-200 hover:bg-amber-100 sm:w-auto"
              >
                <span className="truncate">Öppna tidrapportering</span>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </button>
            </div>
            <div className="divide-y divide-amber-100 border-t border-amber-100 bg-white/60">
              {todayAbsences.length === 0 ? (
                <div className="px-6 py-4 text-sm text-slate-500">Ingen registrerad frånvaro idag.</div>
              ) : (
                todayAbsences.slice(0, 5).map((absence) => (
                  <div key={absence.id} className="flex flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{absence.user?.name || 'Personal'}</p>
                      <p className="text-xs text-slate-500">
                        {formatDate(absence.start_date)}{absence.end_date !== absence.start_date ? ` - ${formatDate(absence.end_date)}` : ''}
                        {absence.start_time && absence.end_time ? `, ${absence.start_time.slice(0, 5)}-${absence.end_time.slice(0, 5)}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className={absence.absence_type === 'sick' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}>
                        {ABSENCE_TYPE_LABEL[absence.absence_type]}
                      </Badge>
                      <Badge className={absenceStatusColor(absence.status)}>
                        {ABSENCE_STATUS_LABEL[absence.status]}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {/* My Assigned Work Orders */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Mina tilldelade arbetsordrar</h2>
        </div>
        <div className="divide-y divide-slate-200">
          {myWorkOrders.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-slate-500">Inga tilldelade arbetsordrar</p>
            </div>
          ) : (
            myWorkOrders.map((wo) => (
              <div
                key={wo.id}
                className="px-6 py-4 hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => onNavigate(`workorder/${wo.id}`)}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-slate-800 truncate">{wo.title}</h3>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge className={getWOPriorityColor(wo.priority)}>
                        {WO_PRIORITY_LABELS[wo.priority]}
                      </Badge>
                      <Badge className={getWOStatusColor(wo.status)}>
                        {WO_STATUS_LABELS[wo.status]}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right text-sm text-slate-600">
                    {wo.due_date ? (
                      <div>
                        <p className="font-medium text-slate-700">{formatDate(wo.due_date)}</p>
                        <p className="text-xs text-slate-500">Förfallet</p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">Inget datum</p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* New Work Orders */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Nya arbetsordrar</h2>
        </div>
        <div className="divide-y divide-slate-200">
          {newWorkOrders.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-slate-500">Inga nya arbetsordrar</p>
            </div>
          ) : (
            newWorkOrders.map((wo) => (
              <div
                key={wo.id}
                className="px-6 py-4 hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => onNavigate(`workorder/${wo.id}`)}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-slate-800 truncate">{wo.title}</h3>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge className={getWOPriorityColor(wo.priority)}>
                        {WO_PRIORITY_LABELS[wo.priority]}
                      </Badge>
                      <Badge className={getWOStatusColor(wo.status)}>
                        {WO_STATUS_LABELS[wo.status]}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right text-sm text-slate-600">
                    {wo.due_date ? (
                      <div>
                        <p className="font-medium text-slate-700">{formatDate(wo.due_date)}</p>
                        <p className="text-xs text-slate-500">Förfallet</p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">Inget datum</p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          onClick={() => onNavigate('workorders')}
          className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-blue-100 text-blue-600">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-medium text-slate-800">Ny arbetsorder</h4>
              <p className="text-xs text-slate-500">Skapa en ny</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => onNavigate('maintenance')}
          className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-red-100 text-red-600">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-medium text-slate-800">Felanmälningar</h4>
              <p className="text-xs text-slate-500">Se alla ärenden</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => onNavigate('timetracking')}
          className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-green-100 text-green-600">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-medium text-slate-800">Tidrapportering</h4>
              <p className="text-xs text-slate-500">Rapportera tid</p>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
