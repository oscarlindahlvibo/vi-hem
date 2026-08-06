import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ClipboardList, Monitor, RefreshCw, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { AppLogo } from '../components/AppLogo';
import { Button, LoadingPage } from '../components/ui';
import type { ShortStayBooking, ShortStayUnit, WorkOrder } from '../types';
import { formatDate, WO_PRIORITY_LABELS, WO_STATUS_LABELS } from '../lib/utils';

type ScreenView = 'short-stay' | 'work-orders';
const SCREEN_REFRESH_INTERVAL_MS = 60_000;

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

function readStoredScreenView(): ScreenView {
  const urlView = new URLSearchParams(window.location.search).get('view');
  if (urlView === 'work-orders' || urlView === 'short-stay') return urlView;
  const storedView = localStorage.getItem('vihem.screen.view');
  return storedView === 'work-orders' || storedView === 'short-stay' ? storedView : 'short-stay';
}

export function ScreenDisplayPage() {
  const { user, loading, signIn, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [view, setView] = useState<ScreenView>(readStoredScreenView);
  const [units, setUnits] = useState<ShortStayUnit[]>([]);
  const [bookings, setBookings] = useState<ShortStayBooking[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [screenHeight, setScreenHeight] = useState(() => window.innerHeight || 1080);

  const allowed = user && ['screen', 'admin', 'staff'].includes(user.role);
  const days = useMemo(() => Array.from({ length: 14 }, (_, index) => dateKey(addDays(today(), index))), []);

  useEffect(() => {
    localStorage.setItem('vihem.screen.view', view);
  }, [view]);

  useEffect(() => {
    const updateScreenSize = () => setScreenHeight(window.innerHeight || 1080);
    updateScreenSize();
    window.addEventListener('resize', updateScreenSize);
    return () => window.removeEventListener('resize', updateScreenSize);
  }, []);

  useEffect(() => {
    if (!allowed || !user?.organisation_id) return;
    fetchScreenData();
    const interval = window.setInterval(fetchScreenData, SCREEN_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [allowed, user?.organisation_id]);

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
  }

  async function fetchScreenData() {
    if (!user?.organisation_id) return;
    setDataLoading(true);
    setDataError('');

    const start = days[0];
    const end = dateKey(addDays(new Date(`${days[days.length - 1]}T12:00:00`), 1));

    const [unitsResult, bookingsResult, workOrdersResult] = await Promise.all([
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
        .gt('end_date', start)
        .order('start_date'),
      supabase
        .from('vihem_work_orders')
        .select('*, property:vihem_properties(name), apartment:vihem_apartments(apartment_number), assigned:vihem_profiles!work_orders_assigned_to_fkey(name)')
        .eq('organisation_id', user.organisation_id)
        .not('status', 'in', '(completed,cancelled)')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('priority', { ascending: false }),
    ]);

    if (unitsResult.error || bookingsResult.error || workOrdersResult.error) {
      setDataError(unitsResult.error?.message || bookingsResult.error?.message || workOrdersResult.error?.message || 'Kunde inte ladda skärmdata.');
    } else {
      setUnits((unitsResult.data || []) as ShortStayUnit[]);
      setBookings((bookingsResult.data || []) as ShortStayBooking[]);
      setWorkOrders((workOrdersResult.data || []) as WorkOrder[]);
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
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700">Vad ska skärmen visa?</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setView('short-stay')}
                  className={`rounded-2xl border px-4 py-4 text-left transition ${
                    view === 'short-stay'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-100'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <CalendarDays className="mb-2 h-5 w-5" />
                  <span className="block font-black">Korttidskalender</span>
                  <span className="mt-1 block text-xs text-slate-500">Ankomster, avresor och städ.</span>
                </button>
                <button
                  type="button"
                  onClick={() => setView('work-orders')}
                  className={`rounded-2xl border px-4 py-4 text-left transition ${
                    view === 'work-orders'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-100'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <ClipboardList className="mb-2 h-5 w-5" />
                  <span className="block font-black">Arbetsordrar</span>
                  <span className="mt-1 block text-xs text-slate-500">Aktiva jobb efter förfallodatum.</span>
                </button>
              </div>
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

  return (
    <div className="h-screen overflow-hidden bg-slate-950 p-4 text-white">
      <header className="mb-3 flex flex-col gap-3 rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/10 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 overflow-hidden rounded-xl">
            <AppLogo className="h-full w-full" />
          </div>
          <div>
            <h1 className="text-xl font-black">VI-HEM Skärm</h1>
            <p className="text-sm text-slate-300">
              {view === 'short-stay' ? 'Korttidskalender' : 'Arbetsordrar'} · {lastUpdated ? `uppdaterad ${lastUpdated.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}` : 'laddar data'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold text-slate-300">
          <RefreshCw className={`h-4 w-4 ${dataLoading ? 'animate-spin' : ''}`} />
          Automatisk uppdatering
        </div>
      </header>

      {dataError && <div className="mb-4 rounded-2xl bg-red-500/20 px-5 py-4 text-red-100 ring-1 ring-red-400/30">{dataError}</div>}

      {view === 'short-stay' ? (
        <ShortStayScreen units={units} bookings={bookings} days={days} screenHeight={screenHeight} />
      ) : (
        <WorkOrderScreen workOrders={workOrders} screenHeight={screenHeight} />
      )}
    </div>
  );
}

function ShortStayScreen({ units, bookings, days, screenHeight }: { units: ShortStayUnit[]; bookings: ShortStayBooking[]; days: string[]; screenHeight: number }) {
  const availableHeight = Math.max(screenHeight - 124, 420);
  const rowHeight = units.length > 0 ? Math.max(44, Math.min(76, Math.floor((availableHeight - 46) / units.length))) : 64;
  const compact = rowHeight < 58;

  return (
    <div className="overflow-hidden rounded-2xl bg-white text-slate-950" style={{ height: availableHeight }}>
      <div className="grid border-b border-slate-200 bg-slate-100" style={{ gridTemplateColumns: `220px repeat(${days.length}, minmax(58px, 1fr))`, height: 46 }}>
        <div className="px-3 py-3 text-xs font-black uppercase tracking-wide text-slate-500">Rum/lägenhet</div>
        {days.map(day => (
          <div key={day} className={`px-1 py-2 text-center text-xs font-bold ${day === dateKey(today()) ? 'bg-blue-100 text-blue-700' : 'text-slate-600'}`}>
            <div>{new Date(`${day}T12:00:00`).toLocaleDateString('sv-SE', { weekday: 'short' })}</div>
            <div>{new Date(`${day}T12:00:00`).getDate()}</div>
          </div>
        ))}
      </div>
      <div>
        {units.map(unit => {
          const unitBookings = bookings.filter(booking => booking.unit_id === unit.id);
          return (
            <div key={unit.id} className="grid border-b border-slate-100 last:border-b-0" style={{ gridTemplateColumns: `220px repeat(${days.length}, minmax(58px, 1fr))`, height: rowHeight }}>
              <div className="min-w-0 bg-white px-3 py-2">
                <p className={`${compact ? 'text-sm' : 'text-base'} truncate font-black`}>{unit.name}</p>
                <p className={`${compact ? 'mt-0 text-[11px]' : 'mt-1 text-xs'} truncate text-slate-500`}>{unit.apartment?.apartment_number || unit.property?.name || unit.description}</p>
                {!compact && <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400"><Users className="h-3 w-3" /> Max {unit.max_guests || 2}</p>}
              </div>
              {days.map(day => {
                const booking = unitBookings.find(item => overlaps(item, day));
                const arrival = unitBookings.find(item => item.start_date === day);
                const departure = unitBookings.find(item => item.end_date === day);
                return (
                  <div key={`${unit.id}-${day}`} className={`overflow-hidden border-l border-slate-100 px-1 py-1 ${booking ? 'bg-blue-50' : departure ? 'bg-amber-50' : ''}`}>
                    {booking && (
                      <div className={`rounded-lg bg-blue-600 px-1.5 ${compact ? 'py-0.5 text-[10px]' : 'py-1 text-xs'} font-black leading-tight text-white`}>
                        <div className="truncate">{guestLabel(booking)}</div>
                        {!compact && <div className="mt-0.5 text-[10px] opacity-90">{booking.guest_count || 1} gäster</div>}
                      </div>
                    )}
                    <div className={`${compact ? 'mt-1' : 'mt-1.5'} flex flex-wrap gap-0.5`}>
                      {arrival && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">In</span>}
                      {departure && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Ut</span>}
                      {departure?.cleaning_status && departure.cleaning_status !== 'clean' && departure.cleaning_status !== 'not_needed' && (
                        <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">Städ</span>
                      )}
                      {arrival && departure && arrival.id !== departure.id && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">Byte</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkOrderScreen({ workOrders, screenHeight }: { workOrders: WorkOrder[]; screenHeight: number }) {
  if (workOrders.length === 0) {
    return <div className="rounded-2xl bg-white p-12 text-center text-2xl font-black text-slate-700">Inga aktiva arbetsordrar.</div>;
  }

  const availableHeight = Math.max(screenHeight - 124, 420);
  const visibleCount = Math.max(4, Math.min(workOrders.length, Math.floor(availableHeight / 104)));
  const visibleOrders = workOrders.slice(0, visibleCount);

  return (
    <div className="grid gap-2 overflow-hidden" style={{ height: availableHeight }}>
      {visibleOrders.map(order => (
        <div key={order.id} className="grid grid-cols-[1fr_auto] gap-4 rounded-2xl bg-white px-5 py-4 text-slate-950">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-black">{order.title}</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">{WO_STATUS_LABELS[order.status] || order.status}</span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-700">{WO_PRIORITY_LABELS[order.priority] || order.priority}</span>
            </div>
            <p className="mt-1 line-clamp-1 text-base text-slate-600">{order.description || 'Ingen beskrivning'}</p>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              {[order.property?.name, order.apartment?.apartment_number, order.assigned?.name].filter(Boolean).join(' · ') || 'Ingen plats/tilldelning'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Förfallodatum</p>
            <p className="mt-1 text-xl font-black text-slate-900">{order.due_date ? formatDate(order.due_date) : 'Ej satt'}</p>
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
