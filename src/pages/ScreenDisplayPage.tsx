import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, ClipboardList, Monitor, Newspaper, RefreshCw, Timer, Users, Briefcase, CheckCircle2, UserRoundX } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { AppLogo } from '../components/AppLogo';
import { Button, LoadingPage } from '../components/ui';
import type { CalendarEvent, CustomerProject, LaundryBooking, LaundryRoom, LaundrySlot, MaintenanceRequest, Meeting, MeetingAgendaItem, News, Profile, ShortStayBooking, ShortStayUnit, StaffAbsenceRequest, TimeEntry, WorkOrder } from '../types';
import { formatDate, formatDateTime, MR_PRIORITY_LABELS, MR_STATUS_LABELS, TIME_CATEGORY_LABELS, WO_PRIORITY_LABELS, WO_STATUS_LABELS } from '../lib/utils';
import { getShortStayChannelMeta } from '../lib/shortStayChannels';
import {
  DEFAULT_SCREEN_KEY,
  defaultScreenConfig,
  isMissingScreenSettingsTable,
  mergeScreenConfigs,
  normalizePresentationSettings,
  normalizeScreenConfig,
  PRESENTATION_SETTINGS_STORAGE_KEY,
  readOrganisationScreenConfigs,
  readOrganisationScreenSettings,
  readStoredScreenKey,
  readStoredPresentationSettings,
  readStoredScreenView,
  screenViewLabel,
  SCREEN_KEY_STORAGE_KEY,
  SCREEN_VIEW_STORAGE_KEY,
  type PresentationSettings,
  type ScreenConfig,
  type ScreenView,
} from '../lib/screenSettings';

const SCREEN_REFRESH_INTERVAL_MS = 60_000;
const SCREEN_APP_VERSION = '2026-08-07-tv-layout-11';
const SCREEN_BUILD_QUERY_KEY = 'screenBuild';

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const today = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
};

function overlaps(booking: ShortStayBooking, day: string) {
  return booking.start_date <= day && booking.end_date > day;
}

function guestLabel(booking?: ShortStayBooking) {
  if (!booking) return '';
  return booking.guest_name || booking.title || booking.channel_name || 'Bokning';
}

function guestCountLabel(count?: number | null) {
  const value = Math.max(Number(count || 1), 1);
  return `${value} ${value === 1 ? 'person' : 'personer'}`;
}

function cleaningStatusLabel(booking: ShortStayBooking) {
  if (booking.cleaning_status === 'clean') return 'Städat';
  if (booking.cleaning_status === 'not_needed') return 'Arkiverad';
  return 'Ej städad';
}

function cleaningStatusClass(booking: ShortStayBooking) {
  if (booking.cleaning_status === 'clean') return 'bg-emerald-400/15 text-emerald-200';
  if (booking.cleaning_status === 'not_needed') return 'bg-slate-400/15 text-slate-300';
  return 'bg-rose-400/15 text-rose-200';
}

function screenBookingBandStyle(booking: ShortStayBooking, days: string[]) {
  if (days.length === 0) return null;
  const firstDay = days[0];
  const lastVisibleEnd = dateKey(addDays(new Date(`${days[days.length - 1]}T12:00:00`), 1));
  if (booking.end_date <= firstDay || booking.start_date >= lastVisibleEnd) return null;

  const visibleStart = booking.start_date <= firstDay ? firstDay : booking.start_date;
  const visibleEnd = booking.end_date >= lastVisibleEnd ? lastVisibleEnd : booking.end_date;
  const startIndex = days.findIndex(day => day >= visibleStart);
  const endIndex = days.findIndex(day => day >= visibleEnd);
  const normalizedStart = startIndex === -1 ? 0 : startIndex;
  const normalizedEnd = endIndex === -1 ? days.length : endIndex;
  const span = Math.max(normalizedEnd - normalizedStart, 1);

  return {
    left: `${(normalizedStart / days.length) * 100}%`,
    width: `${(span / days.length) * 100}%`,
  };
}

function nameInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}.${parts[parts.length - 1][0]}.`.toUpperCase();
}

function workOrderAssigneeLabel(order: WorkOrder, staffMembers: Pick<Profile, 'id' | 'name'>[], useInitials = false) {
  const ids = order.assigned_to_ids?.length ? order.assigned_to_ids : order.assigned_to ? [order.assigned_to] : [];
  if (ids.length === 0) return 'Ej tilldelad';

  const names = ids
    .map((id) => staffMembers.find((staff) => staff.id === id)?.name)
    .filter(Boolean);

  if (names.length > 0) return useInitials ? names.map(nameInitials).filter(Boolean).join(' ') : names.join(', ');
  if (order.assigned?.name) return useInitials ? nameInitials(order.assigned.name) : order.assigned.name;
  return `${ids.length} tilldelade`;
}

const ABSENCE_TYPE_LABELS: Record<string, string> = {
  sick: 'Sjuk',
  vab: 'VAB',
  vacation: 'Semester',
  leave: 'Ledig',
  unpaid_leave: 'Tjänstledig',
  parental_leave: 'Föräldraledig',
};

const PROJECT_STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast',
  quote_created: 'Offert skapad',
  quote_sent: 'Offert skickad',
  quote_accepted: 'Offert accepterad',
  planned: 'Planerad',
  in_progress: 'Pågår',
  paused: 'Pausad',
  waiting_customer: 'Väntar kund',
  waiting_material: 'Väntar material',
  ready_for_inspection: 'Redo kontroll',
  inspected_with_remarks: 'Anmärkningar',
  approved: 'Godkänd',
  invoiced: 'Fakturerad',
};

export function ScreenDisplayPage() {
  const { user, loading, signIn, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [selectedScreenKey, setSelectedScreenKey] = useState(readStoredScreenKey);
  const [screenConfigs, setScreenConfigs] = useState<ScreenConfig[]>(() => [defaultScreenConfig(1)]);
  const [view, setView] = useState<ScreenView>(readStoredScreenView);
  const [showViewChooser, setShowViewChooser] = useState(false);
  const [presentationSettings, setPresentationSettings] = useState<PresentationSettings>(readStoredPresentationSettings);
  const [units, setUnits] = useState<ShortStayUnit[]>([]);
  const [bookings, setBookings] = useState<ShortStayBooking[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [organisationName, setOrganisationName] = useState('VI-HEM');
  const [staffMembers, setStaffMembers] = useState<Pick<Profile, 'id' | 'name'>[]>([]);
  const [news, setNews] = useState<News[]>([]);
  const [clockedInEntries, setClockedInEntries] = useState<TimeEntry[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [meetingAgendaItems, setMeetingAgendaItems] = useState<MeetingAgendaItem[]>([]);
  const [customerProjects, setCustomerProjects] = useState<CustomerProject[]>([]);
  const [absenceRequests, setAbsenceRequests] = useState<StaffAbsenceRequest[]>([]);
  const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [laundryRooms, setLaundryRooms] = useState<LaundryRoom[]>([]);
  const [laundrySlots, setLaundrySlots] = useState<LaundrySlot[]>([]);
  const [laundryBookings, setLaundryBookings] = useState<LaundryBooking[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [screenSize, setScreenSize] = useState(() => ({
    width: window.innerWidth || 1920,
    height: window.innerHeight || 1080,
  }));

  const allowed = user && ['screen', 'admin', 'staff'].includes(user.role);
  const selectedScreenConfig = screenConfigs.find(screen => screen.screenKey === selectedScreenKey) || screenConfigs[0] || defaultScreenConfig(1);
  const dayCount = screenSize.width < 1400 ? 8 : screenSize.width < 1700 ? 9 : 10;
  const days = useMemo(() => Array.from({ length: dayCount }, (_, index) => dateKey(addDays(today(), index))), [dayCount]);

  useEffect(() => {
    localStorage.setItem(SCREEN_VIEW_STORAGE_KEY, view);
  }, [view]);

  useEffect(() => {
    localStorage.setItem(SCREEN_KEY_STORAGE_KEY, selectedScreenKey);
  }, [selectedScreenKey]);

  useEffect(() => {
    localStorage.setItem(PRESENTATION_SETTINGS_STORAGE_KEY, JSON.stringify(presentationSettings));
  }, [presentationSettings]);

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get(SCREEN_BUILD_QUERY_KEY) === SCREEN_APP_VERSION) return;

    currentUrl.searchParams.set(SCREEN_BUILD_QUERY_KEY, SCREEN_APP_VERSION);
    window.location.replace(currentUrl.toString());
  }, []);

  useEffect(() => {
    if (!allowed) return;

    async function checkScreenVersion() {
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json();
        if (payload?.version && payload.version !== SCREEN_APP_VERSION) {
          window.location.reload();
        }
      } catch {
        // The screen must keep running even if the version check is unavailable.
      }
    }

    const interval = window.setInterval(checkScreenVersion, SCREEN_REFRESH_INTERVAL_MS);
    checkScreenVersion();
    return () => window.clearInterval(interval);
  }, [allowed]);

  const chooseScreenConfig = (screen: ScreenConfig) => {
    setSelectedScreenKey(screen.screenKey);
    setView(screen.screenView);
    setPresentationSettings(screen.presentationSettings);
    setShowViewChooser(false);
  };

  useEffect(() => {
    const updateScreenSize = () => setScreenSize({
      width: window.innerWidth || 1920,
      height: window.innerHeight || 1080,
    });
    updateScreenSize();
    window.addEventListener('resize', updateScreenSize);
    return () => window.removeEventListener('resize', updateScreenSize);
  }, []);

  useEffect(() => {
    if (!allowed || !user?.organisation_id) return;
    fetchScreenData();
    const interval = window.setInterval(fetchScreenData, SCREEN_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [allowed, user?.organisation_id, days, selectedScreenKey]);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    const result = await signIn(email, password);
    setLoggingIn(false);
    if (result.error) {
      setLoginError(result.error);
      return;
    }
    setShowViewChooser(true);
  }

  async function fetchScreenData() {
    if (!user?.organisation_id) return;
    setDataLoading(true);
    setDataError('');

    const panelHistoryStart = dateKey(addDays(today(), -30));
    const end = dateKey(addDays(new Date(`${days[days.length - 1]}T12:00:00`), 1));

    const todayStart = dateKey(today());
    const meetingEnd = dateKey(addDays(today(), 7));
    const absenceEnd = dateKey(addDays(today(), 60));

    const calendarEnd = dateKey(addDays(today(), 14));

    const [organisationResult, screenSettingsResult, staffResult, unitsResult, bookingsResult, workOrdersResult, newsResult, clockedInResult, meetingsResult, customerProjectsResult, absenceRequestsResult, maintenanceRequestsResult, calendarEventsResult, laundryRoomsResult] = await Promise.all([
      supabase
        .from('vihem_organisations')
        .select('name, settings')
        .eq('id', user.organisation_id)
        .maybeSingle(),
      supabase
        .from('vihem_screen_settings')
        .select('screen_key, screen_view, presentation_settings')
        .eq('organisation_id', user.organisation_id)
        .order('screen_key'),
      supabase
        .from('vihem_profiles')
        .select('id, name')
        .eq('organisation_id', user.organisation_id)
        .in('role', ['staff', 'admin'])
        .eq('active', true)
        .order('name'),
      supabase
        .from('vihem_short_stay_units')
        .select('*, property:vihem_properties(*), apartment:vihem_apartments(*)')
        .eq('organisation_id', user.organisation_id)
        .eq('is_active', true)
        .order('sort_order')
        .order('name'),
      supabase
        .from('vihem_short_stay_bookings')
        .select('*')
        .eq('organisation_id', user.organisation_id)
        .lt('start_date', end)
        .gte('end_date', panelHistoryStart)
        .order('start_date'),
      supabase
        .from('vihem_work_orders')
        .select('*, property:vihem_properties(name), apartment:vihem_apartments(apartment_number), assigned:vihem_profiles!work_orders_assigned_to_fkey(name)')
        .eq('organisation_id', user.organisation_id)
        .not('status', 'in', '(completed,cancelled)')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('priority', { ascending: false }),
      supabase
        .from('vihem_news')
        .select('*')
        .eq('organisation_id', user.organisation_id)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(8),
      supabase
        .from('vihem_time_entries')
        .select('*, user:vihem_profiles!time_entries_user_id_fkey(id, name, email), work_order:vihem_work_orders(id, title), customer_project:vihem_customer_projects(id, title, name, customer_name), property:vihem_properties(id, name)')
        .eq('organisation_id', user.organisation_id)
        .is('end_time', null)
        .order('start_time', { ascending: false }),
      supabase
        .from('vihem_meetings')
        .select('*')
        .eq('organisation_id', user.organisation_id)
        .not('status', 'in', '(completed,locked,cancelled)')
        .gte('starts_at', `${todayStart}T00:00:00`)
        .lt('starts_at', `${meetingEnd}T23:59:59`)
        .order('starts_at', { ascending: true })
        .limit(8),
      supabase
        .from('vihem_customer_projects')
        .select('id, organisation_id, customer_id, name, title, customer_name, description, status, priority, project_manager_id, start_date, planned_end_date, project_address, project_type, created_at, updated_at')
        .eq('organisation_id', user.organisation_id)
        .not('status', 'in', '(completed,archived,cancelled)')
        .order('planned_end_date', { ascending: true, nullsFirst: false })
        .order('updated_at', { ascending: false })
        .limit(12),
      supabase
        .from('vihem_staff_absence_requests')
        .select('*, user:user_id(id, name)')
        .eq('organisation_id', user.organisation_id)
        .in('status', ['submitted', 'approved'])
        .lte('start_date', absenceEnd)
        .gte('end_date', todayStart)
        .order('start_date'),
      supabase
        .from('vihem_maintenance_requests')
        .select('*, property:vihem_properties(name), apartment:vihem_apartments(apartment_number), assigned:vihem_profiles!assigned_to(name)')
        .eq('organisation_id', user.organisation_id)
        .not('status', 'in', '(done,closed)')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('vihem_calendar_events')
        .select('*')
        .eq('organisation_id', user.organisation_id)
        .eq('visibility', 'organisation')
        .lt('starts_at', `${calendarEnd}T23:59:59`)
        .gt('ends_at', `${todayStart}T00:00:00`)
        .order('starts_at', { ascending: true })
        .limit(30),
      supabase
        .from('vihem_laundry_rooms')
        .select('*, property:vihem_properties(name)')
        .eq('organisation_id', user.organisation_id)
        .eq('active', true)
        .order('name'),
    ]);

    const screenSettingsUnavailable = isMissingScreenSettingsTable(screenSettingsResult.error);

    if (organisationResult.error || (screenSettingsResult.error && !screenSettingsUnavailable) || staffResult.error || unitsResult.error || bookingsResult.error || workOrdersResult.error || newsResult.error || clockedInResult.error || meetingsResult.error || maintenanceRequestsResult.error || calendarEventsResult.error || laundryRoomsResult.error) {
      setDataError(
        organisationResult.error?.message ||
        screenSettingsResult.error?.message ||
        staffResult.error?.message ||
        unitsResult.error?.message ||
        bookingsResult.error?.message ||
        workOrdersResult.error?.message ||
        newsResult.error?.message ||
        clockedInResult.error?.message ||
        meetingsResult.error?.message ||
        maintenanceRequestsResult.error?.message ||
        calendarEventsResult.error?.message ||
        laundryRoomsResult.error?.message ||
        'Kunde inte ladda skärmdata.'
      );
    } else {
      const loadedLaundryRooms = (laundryRoomsResult.data || []) as LaundryRoom[];
      let loadedLaundrySlots: LaundrySlot[] = [];
      let loadedLaundryBookings: LaundryBooking[] = [];
      const laundryRoomIds = loadedLaundryRooms.map(room => room.id);
      if (laundryRoomIds.length > 0) {
        const laundryEnd = dateKey(addDays(today(), 6));
        const slotsResult = await supabase
          .from('vihem_laundry_slots')
          .select('*')
          .in('laundry_room_id', laundryRoomIds)
          .gte('date', todayStart)
          .lte('date', laundryEnd)
          .order('date')
          .order('start_time');

        if (slotsResult.error) {
          setDataError(slotsResult.error.message);
          setDataLoading(false);
          return;
        }

        loadedLaundrySlots = (slotsResult.data || []) as LaundrySlot[];
        const slotIds = loadedLaundrySlots.map(slot => slot.id);
        if (slotIds.length > 0) {
          const laundryBookingsResult = await supabase
            .from('vihem_laundry_bookings')
            .select('*')
            .in('laundry_slot_id', slotIds)
            .eq('status', 'active');

          if (laundryBookingsResult.error) {
            setDataError(laundryBookingsResult.error.message);
            setDataLoading(false);
            return;
          }

          loadedLaundryBookings = (laundryBookingsResult.data || []) as LaundryBooking[];
        }
      }

      setOrganisationName(organisationResult.data?.name || 'VI-HEM');
      const dbScreenConfigs = Array.isArray(screenSettingsResult.data)
        ? screenSettingsResult.data.map((row: any, index: number) => normalizeScreenConfig(row, index + 1))
        : [];
      const fallbackScreenConfigs = readOrganisationScreenConfigs((organisationResult.data as any)?.settings);
      const nextScreenConfigs = fallbackScreenConfigs.length > 0
        ? mergeScreenConfigs(fallbackScreenConfigs, dbScreenConfigs)
        : dbScreenConfigs;
      const selectedConfig = nextScreenConfigs.find(screen => screen.screenKey === selectedScreenKey) || nextScreenConfigs[0];
      const fallbackScreenSettings = readOrganisationScreenSettings((organisationResult.data as any)?.settings, selectedScreenKey);
      const nextScreenView = selectedConfig?.screenView || fallbackScreenSettings.screenView;
      const nextPresentationSettings = selectedConfig?.presentationSettings || fallbackScreenSettings.presentationSettings;

      if (nextScreenConfigs.length > 0) {
        setScreenConfigs(nextScreenConfigs);
        if (!nextScreenConfigs.some(screen => screen.screenKey === selectedScreenKey)) {
          setSelectedScreenKey(nextScreenConfigs[0].screenKey);
        }
      }

      if (nextScreenView) {
        setView(nextScreenView as ScreenView);
      }
      if (nextPresentationSettings) {
        setPresentationSettings(nextPresentationSettings);
      }
      setStaffMembers((staffResult.data || []) as Pick<Profile, 'id' | 'name'>[]);
      setUnits((unitsResult.data || []) as ShortStayUnit[]);
      setBookings((bookingsResult.data || []) as ShortStayBooking[]);
      setWorkOrders((workOrdersResult.data || []) as WorkOrder[]);
      setNews((newsResult.data || []) as News[]);
      setCustomerProjects(customerProjectsResult.error ? [] : (customerProjectsResult.data || []) as CustomerProject[]);
      setAbsenceRequests(absenceRequestsResult.error ? [] : (absenceRequestsResult.data || []) as StaffAbsenceRequest[]);
      setMaintenanceRequests((maintenanceRequestsResult.data || []) as MaintenanceRequest[]);
      setCalendarEvents((calendarEventsResult.data || []) as CalendarEvent[]);
      setLaundryRooms(loadedLaundryRooms);
      setLaundrySlots(loadedLaundrySlots);
      setLaundryBookings(loadedLaundryBookings);
      const latestEntryByUser = new Map<string, TimeEntry>();
      (clockedInResult.data as TimeEntry[] || []).forEach((entry) => {
        if (!latestEntryByUser.has(entry.user_id)) latestEntryByUser.set(entry.user_id, entry);
      });
      setClockedInEntries(Array.from(latestEntryByUser.values()));
      const loadedMeetings = (meetingsResult.data || []) as Meeting[];
      setMeetings(loadedMeetings);
      const meetingIds = loadedMeetings.map(meeting => meeting.id);
      if (meetingIds.length > 0) {
        const agendaResult = await supabase
          .from('vihem_meeting_agenda_items')
          .select('*')
          .in('meeting_id', meetingIds)
          .order('sort_order');
        setMeetingAgendaItems(agendaResult.error ? [] : (agendaResult.data || []) as MeetingAgendaItem[]);
      } else {
        setMeetingAgendaItems([]);
      }
      setLastUpdated(new Date());
    }

    setDataLoading(false);
  }

  if (loading) return <LoadingPage />;

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <form onSubmit={handleLogin} className="w-full max-w-md rounded-3xl bg-white p-8 text-slate-950 shadow-2xl">
          <div className="mb-7 flex items-center gap-3">
            <div className="h-12 w-12 overflow-hidden rounded-2xl">
              <AppLogo className="h-full w-full" />
            </div>
            <div>
              <h1 className="text-2xl font-black">VI-HEM Skärm</h1>
              <p className="text-sm text-slate-500">Logga in med organisationens TV-konto.</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
              Efter inloggning väljer du om den här TV:n är Skärm 1, Skärm 2 osv. Admin styr sedan vad varje skärm visar.
            </div>
            <input
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="skarm@organisation.se"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-base outline-none ring-blue-500 focus:ring-2"
              required
            />
            <input
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="Lösenord"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-base outline-none ring-blue-500 focus:ring-2"
              required
            />
            {loginError && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{loginError}</div>}
            <Button type="submit" loading={loggingIn} className="w-full" size="lg">
              Logga in som skärm
            </Button>
          </div>
        </form>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-white">
        <div className="max-w-lg rounded-3xl bg-white p-8 text-center text-slate-950">
          <Monitor className="mx-auto mb-4 h-12 w-12 text-slate-400" />
          <h1 className="text-2xl font-black">Kontot saknar skärmbehörighet</h1>
          <p className="mt-2 text-slate-500">Logga in med ett TV-skärmskonto för organisationen.</p>
          <Button onClick={signOut} className="mt-6">Logga ut</Button>
        </div>
      </div>
    );
  }

  if (showViewChooser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <div className="w-full max-w-4xl rounded-3xl bg-white p-8 text-slate-950 shadow-2xl">
          <div className="mb-7 flex items-center gap-3">
            <div className="h-12 w-12 overflow-hidden rounded-2xl">
              <AppLogo className="h-full w-full" />
            </div>
            <div>
              <h1 className="text-2xl font-black">Välj TV-skärm</h1>
              <p className="text-sm text-slate-500">Välj vilken administrerad skärm den här TV:n ska vara.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {screenConfigs.map(screen => (
              <button
                key={screen.screenKey}
                type="button"
                onClick={() => chooseScreenConfig(screen)}
                className={`rounded-3xl border px-5 py-6 text-left transition ${
                  selectedScreenKey === screen.screenKey
                    ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Monitor className="mb-3 h-8 w-8" />
                <span className="block text-xl font-black">{screen.name}</span>
                <span className="mt-2 block text-sm text-slate-500">{screenViewLabel(screen.screenView)}</span>
                <span className="mt-3 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-500">{screen.screenKey}</span>
              </button>
            ))}
          </div>

          <div className="mt-6 flex justify-end">
            <Button variant="secondary" onClick={() => setShowViewChooser(false)}>
              Tillbaka
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-slate-950 p-2 text-white">
      <header className="mb-1 flex h-10 items-center justify-between gap-3 rounded-xl bg-white/10 px-3 ring-1 ring-white/10">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowViewChooser(true)}
            className="h-7 w-7 shrink-0 overflow-hidden rounded-lg outline-none ring-blue-300 transition-transform hover:scale-105 focus:ring-2"
            aria-label="Välj skärmläge"
          >
            <AppLogo className="h-full w-full" />
          </button>
          <h1 className="truncate text-sm font-black">VI-HEM</h1>
          <ScreenHeaderClock />
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs font-semibold text-slate-300">
          <RefreshCw className={`h-3.5 w-3.5 ${dataLoading ? 'animate-spin' : ''}`} />
          <span>{lastUpdated ? lastUpdated.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : 'Laddar'}</span>
        </div>
      </header>

      {dataError && <div className="mb-4 rounded-2xl bg-red-500/20 px-5 py-4 text-red-100 ring-1 ring-red-400/30">{dataError}</div>}

      {view === 'short-stay' ? (
        <ShortStayScreen units={units} bookings={bookings} days={days} screenHeight={screenSize.height} />
      ) : view === 'work-orders' ? (
        <WorkOrderScreen workOrders={workOrders} staffMembers={staffMembers} screenHeight={screenSize.height} />
      ) : view === 'meeting' ? (
        <MeetingScreen
          screen={selectedScreenConfig}
          organisationName={organisationName}
          meetings={meetings}
          agendaItems={meetingAgendaItems}
          workOrders={workOrders}
          customerProjects={customerProjects}
          absenceRequests={absenceRequests}
          maintenanceRequests={maintenanceRequests}
          calendarEvents={calendarEvents}
          staffMembers={staffMembers}
          screenHeight={screenSize.height}
          lastUpdated={lastUpdated}
        />
      ) : view === 'laundry' ? (
        <LaundryScreen
          screen={selectedScreenConfig}
          rooms={laundryRooms}
          slots={laundrySlots}
          bookings={laundryBookings}
          screenHeight={screenSize.height}
          lastUpdated={lastUpdated}
        />
      ) : (
        <PresentationScreen
          settings={presentationSettings}
          news={news}
          workOrders={workOrders}
          clockedInEntries={clockedInEntries}
          meetings={meetings}
          bookings={bookings}
          organisationName={organisationName}
          staffMembers={staffMembers}
          lastUpdated={lastUpdated}
          screenWidth={screenSize.width}
          screenHeight={screenSize.height}
        />
      )}
    </div>
  );
}

function ScreenHeaderClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="hidden items-baseline gap-2 text-xs font-black text-slate-200 sm:flex">
      <span>{now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}</span>
      <span className="text-slate-400">
        {now.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })}
      </span>
    </div>
  );
}

function MeetingScreen({
  screen,
  organisationName,
  meetings,
  agendaItems,
  workOrders,
  customerProjects,
  absenceRequests,
  maintenanceRequests,
  calendarEvents,
  staffMembers,
  screenHeight,
  lastUpdated,
}: {
  screen: ScreenConfig;
  organisationName: string;
  meetings: Meeting[];
  agendaItems: MeetingAgendaItem[];
  workOrders: WorkOrder[];
  customerProjects: CustomerProject[];
  absenceRequests: StaffAbsenceRequest[];
  maintenanceRequests: MaintenanceRequest[];
  calendarEvents: CalendarEvent[];
  staffMembers: Pick<Profile, 'id' | 'name'>[];
  screenHeight: number;
  lastUpdated: Date | null;
}) {
  const availableHeight = Math.max(screenHeight - 54, 520);
  const configuredMeeting = screen.meetingId ? meetings.find(meeting => meeting.id === screen.meetingId) : null;
  const currentMeeting = configuredMeeting || meetings.find(meeting => meeting.status === 'in_progress') || meetings[0];
  const meetingPart = screen.meetingPart || 'full';
  const partLabel = meetingPart === 'part-1' ? 'Del 1/2' : meetingPart === 'part-2' ? 'Del 2/2' : 'Hela mötet';
  const selectedAgenda = currentMeeting
    ? agendaItems.filter(item => item.meeting_id === currentMeeting.id).sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const visibleAgenda = selectedAgenda.filter(item => item.status !== 'done');
  const doneAgendaCount = selectedAgenda.length - visibleAgenda.length;
  const activeWorkOrders = workOrders.slice(0, meetingPart === 'part-1' ? 24 : 18);
  const activeProjects = customerProjects.slice(0, meetingPart === 'part-2' ? 24 : 16);
  const activeMaintenanceRequests = maintenanceRequests.slice(0, meetingPart === 'part-2' ? 24 : 14);
  const todayValue = dateKey(today());
  const upcomingAbsences = absenceRequests
    .filter(request => request.end_date >= todayValue)
    .slice(0, meetingPart === 'part-2' ? 24 : 8);
  const upcomingCalendarEvents = calendarEvents.slice(0, meetingPart === 'part-2' ? 24 : 10);
  const upcomingMeetings = meetings
    .filter(meeting => meeting.id !== currentMeeting?.id)
    .slice(0, meetingPart === 'part-2' ? 8 : 5);
  const agendaLimit = meetingPart === 'part-1' ? 26 : meetingPart === 'full' ? 22 : 14;

  const agendaPanel = (
    <section className="flex min-h-0 flex-col rounded-2xl bg-white/10 p-2.5 ring-1 ring-white/10">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-base font-black">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-200" />
          Dagordning
        </h3>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black">{visibleAgenda.length}/{selectedAgenda.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-hidden">
        {visibleAgenda.length === 0 ? (
          <p className="rounded-xl bg-white/5 px-4 py-5 text-sm font-bold text-slate-300">Ingen dagordning kopplad till valt möte.</p>
        ) : visibleAgenda.slice(0, agendaLimit).map((item, index) => (
          <div key={item.id} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2 rounded-lg bg-white/10 px-2 py-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-[10px] font-black">{index + 1}</span>
            <div className="min-w-0">
              <p className="truncate text-xs font-black">{item.title}</p>
              {item.notes && <p className="truncate text-[10px] font-semibold text-slate-300">{item.notes}</p>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  const workOrderPanel = (
    <section className="flex min-h-0 flex-col rounded-2xl bg-white/10 p-2.5 ring-1 ring-white/10">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-base font-black">
          <ClipboardList className="h-4 w-4 shrink-0 text-amber-200" />
          Arbetsordrar
        </h3>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black">{workOrders.length}</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-1.5 overflow-hidden">
        {activeWorkOrders.length === 0 ? (
          <p className="col-span-2 rounded-xl bg-white/5 px-4 py-4 text-sm font-bold text-slate-300">Inga aktiva arbetsordrar.</p>
        ) : activeWorkOrders.map(order => (
          <div key={order.id} className="min-w-0 rounded-lg bg-white/10 px-2 py-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="truncate text-[12px] font-black">{order.title}</p>
              <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-black text-slate-100">{order.status === 'new' ? 'Ny' : order.status}</span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] font-bold text-slate-300">
              <span className="truncate">{order.property?.name || 'Ingen fastighet'}</span>
              {order.due_date && <span className="shrink-0">{formatDate(order.due_date)}</span>}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1">
              <span className="truncate rounded-full bg-blue-400/20 px-1.5 py-0.5 text-[9px] font-black text-blue-100">{workOrderAssigneeLabel(order, staffMembers, true)}</span>
              <span className="shrink-0 rounded-full bg-amber-300/20 px-1.5 py-0.5 text-[9px] font-black text-amber-100">{WO_PRIORITY_LABELS[order.priority]}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  const projectPanel = (
    <section className="flex min-h-0 flex-col rounded-2xl bg-white/10 p-2.5 ring-1 ring-white/10">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-base font-black">
          <Briefcase className="h-4 w-4 shrink-0 text-violet-200" />
          Kundprojekt
        </h3>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black">{customerProjects.length}</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-1.5 overflow-hidden">
        {activeProjects.length === 0 ? (
          <p className="col-span-2 rounded-xl bg-white/5 px-4 py-4 text-sm font-bold text-slate-300">Inga pågående kundprojekt.</p>
        ) : activeProjects.map(project => (
          <div key={project.id} className="min-w-0 rounded-lg bg-white/10 px-2 py-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="truncate text-[12px] font-black">{project.title || project.name || project.customer_name || 'Kundprojekt'}</p>
              <span className="shrink-0 rounded-full bg-violet-400/20 px-1.5 py-0.5 text-[9px] font-black text-violet-100">
                {PROJECT_STATUS_LABELS[project.status] || project.status}
              </span>
            </div>
            <p className="mt-1 truncate text-[10px] font-bold text-slate-300">
              {project.customer_name || project.project_address || 'Ingen kund'}
              {project.planned_end_date ? ` · ${formatDate(project.planned_end_date)}` : ''}
            </p>
          </div>
        ))}
      </div>
    </section>
  );

  const meetingsPanel = (
    <section className="flex min-h-0 flex-col rounded-2xl bg-white/10 p-2.5 ring-1 ring-white/10">
      <h3 className="mb-2 flex items-center gap-2 text-base font-black">
        <CalendarDays className="h-4 w-4 text-blue-200" />
        Kommande möten
      </h3>
      <div className="min-h-0 flex-1 space-y-1 overflow-hidden">
        {upcomingMeetings.map(meeting => (
          <div key={meeting.id} className="rounded-lg bg-white/10 px-2 py-1.5">
            <p className="truncate text-xs font-black">{meeting.title}</p>
            <p className="truncate text-[10px] font-bold text-slate-300">{meeting.starts_at ? formatDateTime(meeting.starts_at) : 'Ingen tid'}</p>
          </div>
        ))}
        {meetings.length === 0 && <p className="rounded-xl bg-white/5 px-4 py-4 text-sm font-bold text-slate-300">Inga planerade möten.</p>}
      </div>
    </section>
  );

  const maintenancePanel = (
    <section className="flex min-h-0 flex-col rounded-2xl bg-orange-500/10 p-2.5 ring-1 ring-orange-300/20">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-base font-black">
          <AlertCircle className="h-4 w-4 shrink-0 text-orange-200" />
          Felanmälan
        </h3>
        <span className="rounded-full bg-orange-300/20 px-2.5 py-1 text-[11px] font-black text-orange-100">{maintenanceRequests.length}</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-1.5 overflow-hidden">
        {activeMaintenanceRequests.length === 0 ? (
          <p className="col-span-2 rounded-xl bg-white/5 px-4 py-4 text-sm font-bold text-slate-300">Inga aktiva felanmälningar.</p>
        ) : activeMaintenanceRequests.map(request => (
          <div key={request.id} className="min-w-0 rounded-lg bg-white/10 px-2 py-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="truncate text-[12px] font-black">{request.title}</p>
              <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-black text-orange-100">
                {MR_STATUS_LABELS[request.status] || request.status}
              </span>
            </div>
            <p className="mt-1 truncate text-[10px] font-bold text-slate-300">
              {[request.property?.name, request.apartment?.apartment_number].filter(Boolean).join(' · ') || 'Ingen plats'}
            </p>
            <div className="mt-1 flex min-w-0 items-center gap-1">
              <span className="truncate rounded-full bg-orange-300/20 px-1.5 py-0.5 text-[9px] font-black text-orange-100">{request.assigned?.name ? nameInitials(request.assigned.name) : 'Ej tilldelad'}</span>
              <span className="shrink-0 rounded-full bg-amber-300/20 px-1.5 py-0.5 text-[9px] font-black text-amber-100">{MR_PRIORITY_LABELS[request.priority] || request.priority}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  const absencePanel = (
    <section className="flex min-h-0 flex-col rounded-2xl bg-rose-500/10 p-2.5 ring-1 ring-rose-300/20">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-base font-black">
          <UserRoundX className="h-4 w-4 shrink-0 text-rose-200" />
          Ledighet/frånvaro
        </h3>
        <span className="rounded-full bg-rose-300/20 px-2.5 py-1 text-[11px] font-black text-rose-100">{upcomingAbsences.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-hidden">
        {upcomingAbsences.length === 0 ? (
          <p className="rounded-xl bg-white/5 px-4 py-4 text-sm font-bold text-slate-300">Ingen planerad frånvaro i närtid.</p>
        ) : upcomingAbsences.map(request => (
          <div key={request.id} className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-2 rounded-lg bg-white/10 px-2 py-1.5">
            <div className="min-w-0">
              <p className="truncate text-xs font-black">{request.user?.name || staffMembers.find(staff => staff.id === request.user_id)?.name || 'Personal'}</p>
              <p className="truncate text-[10px] font-bold text-rose-100">
                {ABSENCE_TYPE_LABELS[request.absence_type] || request.absence_type}
                {request.start_time && request.end_time ? ` · ${request.start_time.slice(0, 5)}-${request.end_time.slice(0, 5)}` : ''}
              </p>
            </div>
            <span className="justify-self-end truncate rounded-full bg-white/10 px-2 py-1 text-[9px] font-black text-white">
              {request.start_date === request.end_date ? formatDate(request.start_date) : `${formatDate(request.start_date)}-${formatDate(request.end_date)}`}
            </span>
          </div>
        ))}
      </div>
    </section>
  );

  const calendarPanel = (
    <section className="flex min-h-0 flex-col rounded-2xl bg-blue-500/10 p-2.5 ring-1 ring-blue-300/20">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-base font-black">
          <CalendarDays className="h-4 w-4 shrink-0 text-blue-200" />
          Kalender
        </h3>
        <span className="rounded-full bg-blue-300/20 px-2.5 py-1 text-[11px] font-black text-blue-100">{calendarEvents.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-hidden">
        {upcomingCalendarEvents.length === 0 ? (
          <p className="rounded-xl bg-white/5 px-4 py-4 text-sm font-bold text-slate-300">Inga organisationshändelser i närtid.</p>
        ) : upcomingCalendarEvents.map(event => (
          <div key={event.id} className="rounded-lg bg-white/10 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-black">{event.title}</p>
              <span className="shrink-0 rounded-full bg-blue-300/20 px-1.5 py-0.5 text-[9px] font-black text-blue-100">
                {event.all_day ? 'Heldag' : new Date(event.starts_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[10px] font-bold text-slate-300">
              {formatDate(event.starts_at)}
              {event.location ? ` · ${event.location}` : ''}
            </p>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <div
      className="grid gap-2 overflow-hidden rounded-xl bg-slate-950 text-white"
      style={{
        height: availableHeight,
        gridTemplateRows: '58px minmax(0, 1fr) 34px',
      }}
    >
      <div className="flex items-center justify-between rounded-xl bg-white/10 px-4 ring-1 ring-white/10">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-200">{organisationName}</p>
          <h2 className="truncate text-xl font-black">{currentMeeting?.title || 'Mötesvy'}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-right">
          <span className="rounded-full bg-blue-500/20 px-3 py-1 text-xs font-black text-blue-100">{partLabel}</span>
          <div>
          <p className="text-xs font-black text-slate-200">
            {currentMeeting?.starts_at ? formatDateTime(currentMeeting.starts_at) : 'Inget aktivt möte'}
          </p>
          <p className="text-[11px] font-bold text-slate-400">
            {currentMeeting?.location || 'Följ dagordning och aktuella ärenden'}
            {lastUpdated ? ` · uppdaterad ${lastUpdated.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
          </div>
        </div>
      </div>

      {meetingPart === 'part-1' ? (
        <div className="grid min-h-0 gap-2" style={{ gridTemplateColumns: '0.82fr 1fr 1fr' }}>
          {agendaPanel}
          {workOrderPanel}
          {projectPanel}
        </div>
      ) : meetingPart === 'part-2' ? (
        <div className="grid min-h-0 gap-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          {maintenancePanel}
          {absencePanel}
          {calendarPanel}
        </div>
      ) : (
        <div className="grid min-h-0 gap-2" style={{ gridTemplateColumns: '0.78fr 1fr 1fr 0.82fr' }}>
          {agendaPanel}
          {workOrderPanel}
          {projectPanel}
          <section className="grid min-h-0 gap-2" style={{ gridTemplateRows: '0.78fr 1fr' }}>
            {maintenancePanel}
            {calendarPanel}
          </section>
        </div>
      )}

      <div className="overflow-hidden rounded-xl bg-white/10 px-4 py-1 text-sm font-black text-slate-200 ring-1 ring-white/10">
        <div className="flex min-w-max gap-8">
          <span>{partLabel}</span>
          <span>{visibleAgenda.length} kvar på dagordningen</span>
          {doneAgendaCount > 0 && <span>{doneAgendaCount} avbockade</span>}
          <span>{workOrders.length} arbetsordrar</span>
          <span>{customerProjects.length} kundprojekt</span>
          <span>{maintenanceRequests.length} felanmälningar</span>
          <span>{upcomingAbsences.length} frånvaro/ledighet</span>
          <span>{calendarEvents.length} kalenderhändelser</span>
        </div>
      </div>
    </div>
  );
}

function PresentationScreen({
  settings,
  news,
  workOrders,
  clockedInEntries,
  meetings,
  bookings,
  organisationName,
  staffMembers,
  lastUpdated,
  screenWidth,
  screenHeight,
}: {
  settings: PresentationSettings;
  news: News[];
  workOrders: WorkOrder[];
  clockedInEntries: TimeEntry[];
  meetings: Meeting[];
  bookings: ShortStayBooking[];
  organisationName: string;
  staffMembers: Pick<Profile, 'id' | 'name'>[];
  lastUpdated: Date | null;
  screenWidth: number;
  screenHeight: number;
}) {
  const [weatherText, setWeatherText] = useState('Laddar väder...');
  const availableHeight = Math.max(screenHeight - 54, 480);
  const compact = true;

  useEffect(() => {
    let cancelled = false;
    async function fetchWeather() {
      const location = settings.weatherLocation.trim();
      if (!location) {
        setWeatherText('Ingen väderplats vald');
        return;
      }

      try {
        setWeatherText(`Hämtar väder för ${location}...`);
        const geocodeResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=sv&format=json`);
        const geocode = await geocodeResponse.json();
        const place = geocode.results?.[0];
        if (!place) {
          if (!cancelled) setWeatherText(`Hittar inget väder för ${location}`);
          return;
        }

        const weatherResponse = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,precipitation,wind_speed_10m&timezone=auto`);
        const weather = await weatherResponse.json();
        const current = weather.current;
        if (!cancelled && current) {
          setWeatherText(`${place.name}: ${Math.round(current.temperature_2m)}°C · vind ${Math.round(current.wind_speed_10m)} km/h · nederbörd ${Number(current.precipitation || 0).toLocaleString('sv-SE')} mm`);
        }
      } catch {
        if (!cancelled) setWeatherText(`Väder kunde inte hämtas för ${location}`);
      }
    }

    fetchWeather();
    const interval = window.setInterval(fetchWeather, 15 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [settings.weatherLocation]);

  const todayValue = dateKey(today());
  const checkIns = bookings.filter(booking => booking.booking_type === 'booking' && booking.start_date === todayValue);
  const checkOuts = bookings.filter(booking => booking.booking_type === 'booking' && booking.end_date === todayValue);
  const activeNews = news.slice(0, 8);
  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
  const activeWorkOrders = [...workOrders]
    .sort((a, b) => {
      const aDue = a.due_date ? new Date(`${a.due_date}T12:00:00`).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.due_date ? new Date(`${b.due_date}T12:00:00`).getTime() : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      return (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
    })
    .slice(0, 12);
  const activeMeetings = meetings.slice(0, 4);
  const customTickerItems = [
    ...(settings.customTickerItems || []),
    ...(settings.customTickerItems?.length ? [] : settings.customTickerText ? [settings.customTickerText] : []),
  ].map(item => item.trim()).filter(Boolean);
  const tickerParts = [
    ...customTickerItems,
    settings.showTickerWeather && settings.weatherLocation ? `Väder · ${weatherText}` : '',
    settings.showTickerCheckIns ? (checkIns.length > 0 ? `${checkIns.length} incheckning${checkIns.length === 1 ? '' : 'ar'} idag` : 'Inga incheckningar idag') : '',
    settings.showTickerCheckOuts ? (checkOuts.length > 0 ? `${checkOuts.length} utcheckning${checkOuts.length === 1 ? '' : 'ar'} idag` : 'Inga utcheckningar idag') : '',
    settings.showTickerClockedIn ? `${clockedInEntries.length} instämplad${clockedInEntries.length === 1 ? '' : 'e'} just nu` : '',
    settings.showTickerUpdated && lastUpdated ? `Uppdaterad ${lastUpdated.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}` : '',
  ].filter(Boolean);

  const timeEntryTitle = (entry: TimeEntry) => {
    if (entry.entry_type === 'break') return 'Rast';
    return entry.work_order?.title || entry.customer_project?.title || entry.customer_project?.name || entry.property?.name || TIME_CATEGORY_LABELS[entry.category] || 'Arbete';
  };
  const isOrderOverdue = (order: WorkOrder) => Boolean(order.due_date && new Date(`${order.due_date}T23:59:59`).getTime() < Date.now());
  const assigneeLabel = (order: WorkOrder) => workOrderAssigneeLabel(order, staffMembers, true);
  const rightPanelCount = [settings.showNews, settings.showClockedIn, settings.showMeetings].filter(Boolean).length;
  const rightPanelRows = rightPanelCount === 0 ? '1fr' : rightPanelCount === 1 ? '1fr' : rightPanelCount === 2 ? '0.62fr 1.38fr' : '0.66fr 1.15fr 0.35fr';
  const scrollingNews = activeNews.length > 1;
  const visibleNews = scrollingNews ? [...activeNews, ...activeNews] : activeNews;

  return (
    <div
      className="relative overflow-hidden rounded-xl bg-slate-950 p-2 text-white"
      style={{
        height: availableHeight,
        display: 'grid',
        gridTemplateRows: 'minmax(0, 1fr) 42px',
        gap: 8,
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.3),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(20,184,166,0.2),transparent_32%)]" />

      <main
        className="relative min-h-0"
        style={{
          display: 'grid',
          gridTemplateColumns: rightPanelCount > 0 ? 'minmax(0, 1.35fr) minmax(300px, 0.95fr)' : '1fr',
          gap: 8,
        }}
      >
        {settings.showWorkOrders && (
          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white/10 p-2.5 ring-1 ring-white/10">
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-black" style={{ fontSize: 20 }}>
                <ClipboardList className="h-5 w-5 text-amber-200" />
                Arbetsordrar
              </h3>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-black" style={{ fontSize: 14 }}>{workOrders.length}</span>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-hidden">
              {activeWorkOrders.length === 0 ? (
                <p className="rounded-xl bg-white/5 px-4 py-5 font-bold text-slate-300" style={{ fontSize: 16 }}>Inga aktiva arbetsordrar.</p>
              ) : activeWorkOrders.slice(0, 10).map(order => (
                <div key={order.id} className="grid grid-cols-[minmax(0,1.15fr)_minmax(96px,0.45fr)_minmax(120px,0.55fr)] items-center gap-2 rounded-lg bg-white/10 px-2.5 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate font-black" style={{ fontSize: 14 }}>{order.title}</p>
                    <p className="truncate font-semibold text-slate-300" style={{ fontSize: 10.5 }}>
                      {order.property?.name || 'Ingen fastighet'}{order.due_date ? ` · ${formatDate(order.due_date)}` : ''}
                    </p>
                  </div>
                  <div className="flex min-w-0 justify-start gap-1">
                    <span className="truncate rounded-full bg-amber-400/15 px-2 py-0.5 font-black text-amber-100" style={{ fontSize: 10 }}>
                      {isOrderOverdue(order) ? 'Försenad' : WO_STATUS_LABELS[order.status]}
                    </span>
                  </div>
                  <span className="truncate rounded-full bg-blue-400/15 px-2 py-0.5 text-center font-black text-blue-100" style={{ fontSize: 10 }}>
                    {assigneeLabel(order)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {rightPanelCount > 0 && (
          <div className="min-h-0 overflow-hidden" style={{ display: 'grid', gridTemplateRows: rightPanelRows, gap: 8 }}>
            {settings.showNews && (
              <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white/10 p-2.5 ring-1 ring-white/10">
                <div className="mb-1.5 flex items-center gap-2">
                  <Newspaper className="h-5 w-5 text-blue-200" />
                  <h3 className="font-black" style={{ fontSize: 18 }}>Aktuella nyheter</h3>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {activeNews.length === 0 ? (
                    <p className="rounded-xl bg-white/5 px-3 py-3 font-bold text-slate-300" style={{ fontSize: 14 }}>Inga publicerade nyheter.</p>
                  ) : (
                    <div className={`space-y-1.5 ${scrollingNews ? 'animate-[vihemNewsScroll_28s_linear_infinite]' : ''}`}>
                      {visibleNews.map((item, index) => (
                        <div key={`${item.id}-${index}`} className="rounded-lg bg-white/10 px-2.5 py-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-black" style={{ fontSize: 13 }}>{item.title}</p>
                              <p className="line-clamp-1 font-semibold leading-4 text-slate-300" style={{ fontSize: 11 }}>{item.content}</p>
                            </div>
                            {item.priority === 'urgent' && <span className="rounded-full bg-rose-400 px-2 py-0.5 text-[10px] font-black text-white">Viktigt</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {settings.showClockedIn && (
              <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-emerald-400/10 p-2.5 ring-1 ring-emerald-300/20">
                <div className="mb-1.5 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 font-black" style={{ fontSize: 18 }}>
                    <Timer className="h-5 w-5 text-emerald-200" />
                    Instämplade
                  </h3>
                  <span className="rounded-full bg-emerald-300/20 px-2.5 py-0.5 font-black text-emerald-100" style={{ fontSize: 13 }}>{clockedInEntries.length}</span>
                </div>
                <div className="min-h-0 flex-1 space-y-1 overflow-hidden">
                  {clockedInEntries.length === 0 ? (
                    <p className="rounded-xl bg-white/5 px-3 py-3 font-bold text-slate-300" style={{ fontSize: 14 }}>Ingen är instämplad just nu.</p>
                  ) : clockedInEntries.slice(0, 9).map(entry => (
                    <div key={entry.id} className="grid grid-cols-[minmax(76px,0.85fr)_minmax(92px,1.15fr)_auto] items-center gap-1.5 rounded-md bg-white/10 px-2 py-1">
                      <p className="truncate font-black" style={{ fontSize: 11.5 }}>{entry.user?.name || 'Personal'}</p>
                      <p className="truncate font-semibold text-emerald-100" style={{ fontSize: 10.5 }}>{timeEntryTitle(entry)}</p>
                      <p className="whitespace-nowrap font-bold text-slate-400" style={{ fontSize: 9.5 }}>
                        {new Date(entry.start_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {settings.showMeetings && (
              <section className="min-h-0 overflow-hidden rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 font-black" style={{ fontSize: 20 }}>
                    <CalendarDays className="h-5 w-5 text-blue-200" />
                    Kalender
                  </h3>
                  <span className="rounded-full bg-white/10 px-3 py-1 font-black" style={{ fontSize: 14 }}>{meetings.length}</span>
                </div>
                <div className="space-y-2 overflow-hidden">
                  {activeMeetings.length === 0 ? (
                    <p className="rounded-xl bg-white/5 px-3 py-3 font-bold text-slate-300" style={{ fontSize: 14 }}>Inga kommande kalenderhändelser.</p>
                  ) : activeMeetings.slice(0, 2).map(meeting => (
                    <div key={meeting.id} className="rounded-xl bg-white/10 px-3 py-2">
                      <p className="truncate font-black" style={{ fontSize: 15 }}>{meeting.title}</p>
                      <p className="truncate font-semibold text-slate-300" style={{ fontSize: 12 }}>
                        {meeting.starts_at ? formatDateTime(meeting.starts_at) : 'Ingen tid'}{meeting.location ? ` · ${meeting.location}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      <footer className="relative overflow-hidden rounded-xl border border-white/10 bg-black/35">
        <div className="animate-[vihemTicker_38s_linear_infinite] whitespace-nowrap font-black text-white" style={{ fontSize: 18, lineHeight: '42px' }}>
          {[...tickerParts, ...tickerParts].map((part, index) => (
            <span key={`${part}-${index}`} className="mx-10 inline-flex items-center gap-4">
              <span className="h-2 w-2 rounded-full bg-blue-300" />
              {part}
            </span>
          ))}
        </div>
      </footer>

    </div>
  );
}

function ShortStayScreen({ units, bookings, days, screenHeight }: { units: ShortStayUnit[]; bookings: ShortStayBooking[]; days: string[]; screenHeight: number }) {
  const availableHeight = Math.max(screenHeight - 54, 420);
  const rowHeight = units.length > 0 ? Math.max(36, Math.min(68, Math.floor((availableHeight - 34) / units.length))) : 56;
  const compact = rowHeight < 52;
  const ultraCompact = rowHeight < 42;
  const unitColumnWidth = ultraCompact ? 170 : 190;
  const calendarHeaderHeight = 34;
  const bookingBandHeight = Math.max(34, Math.min(46, rowHeight - 8));
  const denseBookingBand = bookingBandHeight < 40;

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px', height: availableHeight }}>
      <div className="overflow-hidden rounded-xl bg-slate-950 text-white ring-1 ring-white/10">
        <div className="grid border-b border-white/[0.07] bg-slate-900" style={{ gridTemplateColumns: `${unitColumnWidth}px repeat(${days.length}, minmax(50px, 1fr))`, height: calendarHeaderHeight }}>
          <div className="px-2 py-2 text-[11px] font-black uppercase tracking-wide text-slate-300">Rum/lgh</div>
          {days.map(day => (
            <div key={day} className={`border-l border-white/[0.05] px-1 py-1.5 text-center text-[11px] font-bold leading-tight ${day === dateKey(today()) ? 'bg-blue-500/25 text-blue-100' : 'text-slate-300'}`}>
              <div>{new Date(`${day}T12:00:00`).toLocaleDateString('sv-SE', { weekday: 'short' })}</div>
              <div>{new Date(`${day}T12:00:00`).getDate()}</div>
            </div>
          ))}
        </div>
        <div>
          {units.map(unit => {
            const unitBookings = bookings.filter(booking => booking.unit_id === unit.id);
            const lastVisibleEnd = dateKey(addDays(new Date(`${days[days.length - 1]}T12:00:00`), 1));
            const visibleBookings = unitBookings.filter(booking => booking.start_date < lastVisibleEnd && booking.end_date > days[0]);
            return (
              <div key={unit.id} className="grid border-b border-white/[0.06] last:border-b-0" style={{ gridTemplateColumns: `${unitColumnWidth}px 1fr`, height: rowHeight }}>
                <div className="min-w-0 bg-slate-900/95 px-2 py-1.5">
                  <p className={`${compact ? 'text-xs' : 'text-sm'} truncate font-black`}>{unit.name}</p>
                  {!ultraCompact && (
                    <p className={`${compact ? 'mt-0 text-[10px]' : 'mt-0.5 text-[11px]'} truncate text-slate-400`}>{unit.apartment?.apartment_number || unit.property?.name || unit.description}</p>
                  )}
                  {!compact && <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-slate-500"><Users className="h-3 w-3" /> Max {unit.max_guests || 2}</p>}
                </div>
                <div className="relative grid overflow-hidden" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(50px, 1fr))` }}>
                  {days.map(day => {
                    const activeBooking = unitBookings.find(item => overlaps(item, day));
                    return (
                      <div key={`${unit.id}-${day}`} className={`relative overflow-hidden border-l border-white/[0.04] px-1 ${activeBooking ? 'bg-white/[0.04]' : ''}`} />
                    );
                  })}
                  {visibleBookings.map(booking => {
                    const style = screenBookingBandStyle(booking, days);
                    if (!style) return null;
                    const isBlock = booking.booking_type === 'block';
                    const channel = getShortStayChannelMeta(booking.channel_name);
                    return (
                      <div
                        key={booking.id}
                        className={`absolute top-1/2 z-10 flex -translate-y-1/2 flex-col justify-center overflow-hidden rounded-lg px-2 font-black leading-none text-white shadow-sm ${
                          isBlock ? 'bg-slate-700' : channel.bandClass
                        }`}
                        style={{ ...style, height: `${bookingBandHeight}px` }}
                        title={`${guestLabel(booking)} (${booking.start_date} - ${booking.end_date})`}
                      >
                        <span className={`${denseBookingBand ? 'text-[10px]' : 'text-xs'} block w-full truncate`}>
                          {guestLabel(booking)}
                        </span>
                        {booking.booking_type === 'booking' ? (
                          <span className="mt-1 flex min-w-0 items-center justify-between gap-1 text-[10px]">
                            <span className="flex min-w-0 items-center gap-1">
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/25 text-[9px] font-black">
                                {channel.shortLabel}
                              </span>
                              {!denseBookingBand && <span className="truncate">{channel.label}</span>}
                            </span>
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-white/20 px-1.5 py-0.5">
                              <Users className="h-3 w-3" />
                              {booking.guest_count || 1}
                            </span>
                          </span>
                        ) : (
                          <span className="mt-1 text-[10px] text-white/80">Spärr</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <TodayEventsPanel units={units} bookings={bookings} />
    </div>
  );
}

function TodayEventsPanel({ units, bookings }: { units: ShortStayUnit[]; bookings: ShortStayBooking[] }) {
  const todayValue = dateKey(today());
  const unitName = (unitId: string) => units.find(unit => unit.id === unitId)?.name || 'Okänd enhet';
  const checkIns = bookings.filter(booking => booking.booking_type === 'booking' && booking.start_date === todayValue);
  const checkOuts = bookings.filter(booking => booking.booking_type === 'booking' && booking.end_date === todayValue);

  const renderItems = (items: ShortStayBooking[], emptyText: string, options: { showGuestCount?: boolean; showCleaningStatus?: boolean } = {}) => (
    <div className="space-y-1.5">
      {items.length === 0 ? (
        <p className="rounded-lg bg-white/5 px-2 py-2 text-xs font-semibold text-slate-400">{emptyText}</p>
      ) : items.slice(0, 5).map(booking => (
        <div key={booking.id} className="rounded-lg bg-white/10 px-2 py-2 ring-1 ring-white/10">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-black ring-1 ${getShortStayChannelMeta(booking.channel_name).darkBadgeClass}`}>
                  {getShortStayChannelMeta(booking.channel_name).shortLabel}
                </span>
                <div className="truncate text-xs font-black text-white">{guestLabel(booking)}</div>
              </div>
              {options.showCleaningStatus && (
                <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-black ${cleaningStatusClass(booking)}`}>
                  {cleaningStatusLabel(booking)}
                </div>
              )}
              <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-300">{unitName(booking.unit_id)}</div>
            </div>
            {options.showGuestCount && (
              <span className="shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-black text-emerald-200">
                {guestCountLabel(booking.guest_count)}
              </span>
            )}
          </div>
        </div>
      ))}
      {items.length > 5 && (
        <p className="text-center text-[11px] font-bold text-slate-400">+{items.length - 5} fler</p>
      )}
    </div>
  );

  return (
    <aside className="overflow-hidden rounded-xl bg-slate-900/95 p-3 text-white ring-1 ring-white/10">
      <div className="mb-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Idag</p>
        <h2 className="text-lg font-black">{new Date(`${todayValue}T12:00:00`).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'short' })}</h2>
      </div>
      <div className="grid gap-3">
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-sm font-black text-emerald-300">Incheckning</h3>
            <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs font-black text-emerald-200">{checkIns.length}</span>
          </div>
          {renderItems(checkIns, 'Inga incheckningar', { showGuestCount: true })}
        </section>
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-sm font-black text-amber-300">Utcheckning</h3>
            <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-black text-amber-200">{checkOuts.length}</span>
          </div>
          {renderItems(checkOuts, 'Inga utcheckningar', { showCleaningStatus: true })}
        </section>
      </div>
    </aside>
  );
}

function LaundryScreen({
  screen,
  rooms,
  slots,
  bookings,
  screenHeight,
  lastUpdated,
}: {
  screen: ScreenConfig;
  rooms: LaundryRoom[];
  slots: LaundrySlot[];
  bookings: LaundryBooking[];
  screenHeight: number;
  lastUpdated: Date | null;
}) {
  const room = rooms.find(item => item.id === screen.laundryRoomId) || rooms[0];
  const availableHeight = Math.max(screenHeight - 54, 420);
  const dayGap = 8;
  const dayRowHeight = Math.max(72, Math.floor((availableHeight - dayGap * 6) / 7));
  const compactSchedule = dayRowHeight < 128;
  const todayValue = dateKey(today());
  const now = new Date();
  const roomSlots = room ? slots.filter(slot => slot.laundry_room_id === room.id) : [];
  const bookingBySlotId = new Map(bookings.map(booking => [booking.laundry_slot_id, booking]));
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(today(), index);
    const key = dateKey(day);
    return {
      key,
      label: day.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' }),
      slots: roomSlots.filter(slot => slot.date === key),
    };
  });
  const currentSlot = roomSlots.find(slot => {
    const start = new Date(`${slot.date}T${slot.start_time}`);
    const end = new Date(`${slot.date}T${slot.end_time}`);
    return start <= now && end > now;
  });
  const currentBooking = currentSlot ? bookingBySlotId.get(currentSlot.id) : null;
  const nextBookedSlots = roomSlots
    .filter(slot => new Date(`${slot.date}T${slot.end_time}`).getTime() >= now.getTime() && bookingBySlotId.has(slot.id))
    .slice(0, 5);

  const slotStatus = (slot: LaundrySlot) => {
    if (slot.is_blocked) return { label: slot.block_reason || 'Blockerad', className: 'bg-amber-400/15 text-amber-100 ring-amber-300/20' };
    if (bookingBySlotId.has(slot.id)) return { label: 'Bokad', className: 'bg-rose-400/15 text-rose-100 ring-rose-300/20' };
    return { label: 'Ledig', className: 'bg-emerald-400/15 text-emerald-100 ring-emerald-300/20' };
  };

  if (!room) {
    return (
      <div className="flex items-center justify-center rounded-2xl bg-white p-12 text-center text-2xl font-black text-slate-700" style={{ height: availableHeight }}>
        Ingen tvättstuga vald för den här skärmen.
      </div>
    );
  }

  return (
    <div className="grid gap-3 overflow-hidden text-white xl:grid-cols-[0.9fr_1.1fr]" style={{ height: availableHeight }}>
      <section className="flex min-h-0 flex-col rounded-3xl bg-slate-900 p-6 ring-1 ring-white/10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-black uppercase tracking-[0.22em] text-blue-200">Tvättstuga</p>
            <h1 className="mt-2 truncate text-5xl font-black tracking-tight">{room.name}</h1>
            <p className="mt-2 text-xl font-bold text-slate-300">{room.property?.name || room.description || 'VI-HEM'}</p>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-3 text-right ring-1 ring-white/10">
            <p className="text-sm font-bold text-slate-300">Idag</p>
            <p className="text-2xl font-black">{new Date(`${todayValue}T12:00:00`).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          </div>
        </div>

        <div className="mt-8 rounded-3xl bg-white/10 p-5 ring-1 ring-white/10">
          <p className="text-sm font-black uppercase tracking-wide text-slate-400">Just nu</p>
          {currentSlot ? (
            <div className="mt-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-4xl font-black">{currentSlot.start_time.slice(0, 5)}-{currentSlot.end_time.slice(0, 5)}</p>
                <p className="mt-2 text-xl font-bold text-slate-300">{currentBooking ? 'Pågående bokning' : currentSlot.is_blocked ? currentSlot.block_reason || 'Blockerad tid' : 'Ledig just nu'}</p>
              </div>
              <span className={`rounded-full px-5 py-3 text-2xl font-black ring-1 ${slotStatus(currentSlot).className}`}>{slotStatus(currentSlot).label}</span>
            </div>
          ) : (
            <p className="mt-3 text-3xl font-black text-slate-200">Ingen aktiv tid just nu</p>
          )}
        </div>

        <div className="mt-5 min-h-0 flex-1 rounded-3xl bg-white/10 p-5 ring-1 ring-white/10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-black">Nästa bokningar</h2>
            <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-black">{nextBookedSlots.length}</span>
          </div>
          <div className="space-y-3">
            {nextBookedSlots.length === 0 ? (
              <p className="rounded-2xl bg-white/5 px-4 py-4 text-lg font-bold text-slate-300">Inga kommande bokningar.</p>
            ) : nextBookedSlots.map(slot => (
              <div key={slot.id} className="flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3">
                <div>
                  <p className="text-xl font-black">{new Date(`${slot.date}T12:00:00`).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'short' })}</p>
                  <p className="text-sm font-bold text-slate-300">{slot.start_time.slice(0, 5)}-{slot.end_time.slice(0, 5)}</p>
                </div>
                <span className="rounded-full bg-rose-400/15 px-4 py-2 text-lg font-black text-rose-100 ring-1 ring-rose-300/20">Bokad</span>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-4 text-sm font-bold text-slate-400">
          Uppdaterad {lastUpdated ? lastUpdated.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : 'nyss'}
        </p>
      </section>

      <section
        className="grid min-h-0 grid-cols-1 overflow-hidden"
        style={{ gap: dayGap, gridTemplateRows: 'repeat(7, minmax(0, 1fr))' }}
      >
        {days.map(day => (
          <div
            key={day.key}
            className={`grid min-h-0 overflow-hidden rounded-2xl ring-1 ring-white/10 ${day.key === todayValue ? 'bg-blue-500/20' : 'bg-white/10'}`}
            style={{ gridTemplateColumns: compactSchedule ? '7.5rem minmax(0, 1fr)' : '9rem minmax(0, 1fr)' }}
          >
            <div className={`flex min-h-0 items-center ${compactSchedule ? 'px-3' : 'px-4'}`}>
              <div>
                <p className={`${compactSchedule ? 'text-base' : 'text-xl'} font-black capitalize leading-tight`}>{day.label}</p>
                <p className={`${compactSchedule ? 'mt-0 text-[10px]' : 'mt-1 text-xs'} font-bold uppercase tracking-wide text-slate-400`}>{day.slots.length} tider</p>
              </div>
            </div>
            <div
              className={`grid min-h-0 min-w-0 grid-cols-3 ${compactSchedule ? 'gap-1.5 p-1.5' : 'gap-2 p-2'}`}
              style={{
                gridTemplateRows: `repeat(${Math.max(1, Math.ceil(Math.max(day.slots.length, 1) / 3))}, minmax(0, 1fr))`,
              }}
            >
              {day.slots.length === 0 ? (
                <div className="col-span-full rounded-xl bg-white/5 px-3 py-3 text-sm font-bold text-slate-400">Inga tider upplagda</div>
              ) : day.slots.map(slot => {
                const status = slotStatus(slot);
                return (
                  <div key={slot.id} className={`flex min-h-0 min-w-0 flex-col justify-center rounded-xl ring-1 ${compactSchedule ? 'px-2 py-1' : 'px-3 py-2'} ${status.className}`}>
                    <p className={`truncate font-black leading-tight ${compactSchedule ? 'text-sm' : 'text-lg'}`}>{slot.start_time.slice(0, 5)}-{slot.end_time.slice(0, 5)}</p>
                    <p className={`truncate font-bold leading-tight ${compactSchedule ? 'mt-0 text-[11px]' : 'mt-0.5 text-sm'}`}>{status.label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function WorkOrderScreen({ workOrders, staffMembers, screenHeight }: { workOrders: WorkOrder[]; staffMembers: Pick<Profile, 'id' | 'name'>[]; screenHeight: number }) {
  if (workOrders.length === 0) {
    return <div className="rounded-2xl bg-white p-12 text-center text-2xl font-black text-slate-700">Inga aktiva arbetsordrar.</div>;
  }

  const availableHeight = Math.max(screenHeight - 54, 420);
  const visibleCount = Math.max(4, Math.min(workOrders.length, Math.floor(availableHeight / 94)));
  const visibleOrders = workOrders.slice(0, visibleCount);

  return (
    <div className="grid gap-2 overflow-hidden" style={{ height: availableHeight }}>
      {visibleOrders.map(order => (
        <div key={order.id} className="grid grid-cols-[1fr_auto] gap-4 rounded-xl bg-white px-4 py-3 text-slate-950">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-black">{order.title}</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">{WO_STATUS_LABELS[order.status] || order.status}</span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-700">{WO_PRIORITY_LABELS[order.priority] || order.priority}</span>
            </div>
            <p className="mt-1 line-clamp-1 text-sm text-slate-600">{order.description || 'Ingen beskrivning'}</p>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              {[order.property?.name, order.apartment?.apartment_number, workOrderAssigneeLabel(order, staffMembers)].filter(Boolean).join(' · ') || 'Ingen plats/tilldelning'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Förfallodatum</p>
            <p className="mt-1 text-lg font-black text-slate-900">{order.due_date ? formatDate(order.due_date) : 'Ej satt'}</p>
          </div>
        </div>
      ))}
      {workOrders.length > visibleOrders.length && (
        <div className="rounded-2xl bg-white/10 px-5 py-3 text-center text-sm font-bold text-slate-200">
          +{workOrders.length - visibleOrders.length} fler arbetsordrar visas inte på den här skärmen
        </div>
      )}
    </div>
  );
}
