import React, { useEffect, useMemo, useState } from 'react';
import {
  BedDouble, CalendarDays, RefreshCw, Plus, Edit2, ExternalLink,
  Sparkles, Search, ClipboardCheck, AlertTriangle, DoorOpen,
  ChevronLeft, ChevronRight, LogIn, LogOut, Users, Wrench,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDateTime } from '../lib/utils';
import {
  Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select, Textarea,
} from '../components/ui';
import type {
  Apartment, Property, ShortStayBooking, ShortStayBookingType,
  ShortStayCleaningStatus, ShortStayPaymentStatus, ShortStayUnit,
} from '../types';

interface ShortStayPageProps {
  onNavigate: (page: string) => void;
}

type Tab = 'overview' | 'calendar' | 'bookings' | 'settings';

interface UnitForm {
  name: string;
  description: string;
  max_guests: string;
  property_id: string;
  apartment_id: string;
  is_active: boolean;
  beds24_enabled: boolean;
  beds24_property_id: string;
  beds24_room_id: string;
  channel_name_1: string;
  ical_url_1: string;
  channel_name_2: string;
  ical_url_2: string;
  channel_name_3: string;
  ical_url_3: string;
}

interface BookingForm {
  unit_id: string;
  booking_type: ShortStayBookingType;
  title: string;
  start_date: string;
  end_date: string;
  arrival_time: string;
  departure_time: string;
  guest_name: string;
  guest_email: string;
  guest_phone: string;
  guest_count: string;
  payment_status: ShortStayPaymentStatus;
  cleaning_status: ShortStayCleaningStatus;
  notes: string;
}

interface Beds24Connection {
  enabled: boolean;
  connected: boolean;
  webhook_secret?: string;
  last_sync_at?: string | null;
  last_error?: string | null;
  webhook_url_hint?: string;
}

interface Beds24Log {
  id: string;
  status: 'success' | 'warning' | 'error' | 'info';
  event_type: string;
  message: string;
  imported_count: number;
  external_id?: string | null;
  created_at: string;
}

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const formatShortDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });

const formatDateRange = (start: string, end: string) =>
  `${formatShortDate(start)} - ${formatShortDate(end)}`;

const CALENDAR_DAY_WIDTH = 72;
const CALENDAR_UNIT_WIDTH = 230;
const CALENDAR_WINDOW_DAYS = 31;

const getCalendarDays = (date: Date) =>
  Array.from({ length: CALENDAR_WINDOW_DAYS }, (_, index) => toDateKey(addDays(date, index)));

const calendarRangeLabel = (days: string[]) => {
  if (days.length === 0) return '';
  const start = days[0];
  const end = days[days.length - 1];
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const startLabel = startDate.toLocaleDateString('sv-SE', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  const endLabel = endDate.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${startLabel} - ${endLabel}`;
};

const defaultUnitForm: UnitForm = {
  name: '',
  description: '',
  max_guests: '2',
  property_id: '',
  apartment_id: '',
  is_active: true,
  beds24_enabled: false,
  beds24_property_id: '',
  beds24_room_id: '',
  channel_name_1: 'Booking.com',
  ical_url_1: '',
  channel_name_2: 'Expedia / Hotels.com',
  ical_url_2: '',
  channel_name_3: 'Airbnb',
  ical_url_3: '',
};

const defaultBookingForm: BookingForm = {
  unit_id: '',
  booking_type: 'booking',
  title: '',
  start_date: todayKey(),
  end_date: toDateKey(addDays(new Date(), 1)),
  arrival_time: '15:00',
  departure_time: '11:00',
  guest_name: '',
  guest_email: '',
  guest_phone: '',
  guest_count: '1',
  payment_status: 'unpaid',
  cleaning_status: 'dirty',
  notes: '',
};

const cleaningLabels: Record<ShortStayCleaningStatus, string> = {
  not_needed: 'Ingen städning',
  dirty: 'Behöver städas',
  in_progress: 'Städning pågår',
  clean: 'Klar',
};

const paymentLabels: Record<ShortStayPaymentStatus, string> = {
  unpaid: 'Obetald',
  partial: 'Delbetald',
  paid: 'Betald',
};

const bookingTypeLabels: Record<ShortStayBookingType, string> = {
  booking: 'Bokning',
  block: 'Spärr',
};

function overlaps(booking: ShortStayBooking, day: string) {
  return booking.start_date <= day && booking.end_date > day;
}

function rangeOverlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart < bEnd && bStart < aEnd;
}

function bookingBandStyle(booking: ShortStayBooking, days: string[]) {
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  if (!firstDay || !lastDay) return null;

  const visibleStart = booking.start_date < firstDay ? firstDay : booking.start_date;
  const visibleEndExclusive = booking.end_date > toDateKey(addDays(new Date(`${lastDay}T12:00:00`), 1))
    ? toDateKey(addDays(new Date(`${lastDay}T12:00:00`), 1))
    : booking.end_date;
  const startIndex = days.indexOf(visibleStart);
  const endIndex = days.indexOf(toDateKey(addDays(new Date(`${visibleEndExclusive}T12:00:00`), -1)));
  if (startIndex < 0 || endIndex < startIndex) return null;

  return {
    left: `${startIndex * CALENDAR_DAY_WIDTH}px`,
    width: `${(endIndex - startIndex + 1) * CALENDAR_DAY_WIDTH}px`,
  };
}

function getExportUrl(token: string) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base || !token) return '';
  return `${base}/functions/v1/vihem-export-short-stay-ical?token=${token}`;
}

function getBeds24WebhookUrl(connection: Beds24Connection | null) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base || !connection?.webhook_secret) return '';
  return `${base}/functions/v1/vihem-beds24-webhook?secret=${connection.webhook_secret}`;
}

async function edgeFunctionErrorMessage(error: any, fallback: string) {
  const context = error?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (body?.error) return body.error;
      if (body?.message) return body.message;
    } catch {
      // Supabase can only read the response body once; fall through to generic message.
    }
  }
  return error?.message || fallback;
}

export function ShortStayPage({ onNavigate: _onNavigate }: ShortStayPageProps) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [units, setUnits] = useState<ShortStayUnit[]>([]);
  const [bookings, setBookings] = useState<ShortStayBooking[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<ShortStayUnit | null>(null);
  const [editingBooking, setEditingBooking] = useState<ShortStayBooking | null>(null);
  const [unitForm, setUnitForm] = useState<UnitForm>(defaultUnitForm);
  const [bookingForm, setBookingForm] = useState<BookingForm>(defaultBookingForm);
  const [saving, setSaving] = useState(false);
  const [syncingUnitId, setSyncingUnitId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [calendarStartDate, setCalendarStartDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  });
  const [beds24Connection, setBeds24Connection] = useState<Beds24Connection | null>(null);
  const [beds24Logs, setBeds24Logs] = useState<Beds24Log[]>([]);
  const [beds24InviteCode, setBeds24InviteCode] = useState('');
  const [beds24RefreshToken, setBeds24RefreshToken] = useState('');
  const [savingBeds24, setSavingBeds24] = useState(false);
  const [syncingBeds24, setSyncingBeds24] = useState(false);
  const [beds24Message, setBeds24Message] = useState('');

  const isAdmin = user?.role === 'admin';
  const organisationId = user?.organisation_id;

  const days = useMemo(() => getCalendarDays(calendarStartDate), [calendarStartDate]);
  const calendarGridWidth = days.length * CALENDAR_DAY_WIDTH;
  const calendarTotalWidth = CALENDAR_UNIT_WIDTH + calendarGridWidth;

  const bookingsByUnit = useMemo(() => {
    const map = new Map<string, ShortStayBooking[]>();
    bookings.forEach((booking) => {
      map.set(booking.unit_id, [...(map.get(booking.unit_id) || []), booking]);
    });
    return map;
  }, [bookings]);

  const stats = useMemo(() => {
    const today = todayKey();
    const activeUnits = units.filter(unit => unit.is_active);
    const current = bookings.filter(booking => overlaps(booking, today) && booking.booking_type === 'booking');
    const checkIns = bookings.filter(booking => booking.start_date === today && booking.booking_type === 'booking');
    const checkOuts = bookings.filter(booking => booking.end_date === today && booking.booking_type === 'booking');
    const cleaning = bookings.filter(booking => booking.end_date <= today && booking.cleaning_status !== 'clean');
    const currentGuests = current.reduce((sum, booking) => sum + (booking.guest_count || 1), 0);
    return { activeUnits, current, currentGuests, checkIns, checkOuts, cleaning };
  }, [bookings, units]);

  const conflicts = useMemo(() => {
    const found: ShortStayBooking[][] = [];
    units.forEach((unit) => {
      const unitBookings = (bookingsByUnit.get(unit.id) || [])
        .filter(booking => booking.booking_type === 'booking')
        .sort((a, b) => a.start_date.localeCompare(b.start_date));
      unitBookings.forEach((booking, index) => {
        const conflict = unitBookings.slice(index + 1).find(other =>
          rangeOverlaps(booking.start_date, booking.end_date, other.start_date, other.end_date)
        );
        if (conflict) found.push([booking, conflict]);
      });
    });
    return found;
  }, [bookingsByUnit, units]);

  useEffect(() => {
    fetchData();
  }, [organisationId]);

  useEffect(() => {
    if (organisationId && isAdmin) fetchBeds24Connection();
  }, [organisationId, isAdmin]);

  async function fetchData() {
    if (!organisationId) return;
    setLoading(true);
    setError('');

    const [unitsRes, bookingsRes, propertiesRes, apartmentsRes] = await Promise.all([
      supabase
        .from('vihem_short_stay_units')
        .select('*, property:vihem_properties(*), apartment:vihem_apartments(*)')
        .eq('organisation_id', organisationId)
        .order('sort_order')
        .order('name'),
      supabase
        .from('vihem_short_stay_bookings')
        .select('*, unit:vihem_short_stay_units(*)')
        .eq('organisation_id', organisationId)
        .gte('end_date', toDateKey(addDays(new Date(), -30)))
        .order('start_date'),
      supabase
        .from('vihem_properties')
        .select('*')
        .eq('organisation_id', organisationId)
        .order('name'),
      supabase
        .from('vihem_apartments')
        .select('*, property:vihem_properties(*)')
        .eq('organisation_id', organisationId)
        .order('apartment_number'),
    ]);

    if (unitsRes.error || bookingsRes.error) {
      setError(unitsRes.error?.message || bookingsRes.error?.message || 'Kunde inte ladda korttidsuthyrning.');
    } else {
      setUnits((unitsRes.data || []) as ShortStayUnit[]);
      setBookings((bookingsRes.data || []) as ShortStayBooking[]);
      setProperties((propertiesRes.data || []) as Property[]);
      setApartments((apartmentsRes.data || []) as Apartment[]);
    }
    setLoading(false);
  }

  async function fetchBeds24Connection() {
    setBeds24Message('');
    const { data, error: connectionError } = await supabase.functions.invoke('vihem-beds24-connection', {
      body: { action: 'get' },
    });
    if (connectionError) {
      setBeds24Message(await edgeFunctionErrorMessage(connectionError, 'Kunde inte hämta Beds24-anslutningen.'));
      return;
    }
    setBeds24Connection(data?.connection || null);
    setBeds24Logs(data?.logs || []);
  }

  async function saveBeds24Connection(enabled: boolean) {
    setSavingBeds24(true);
    setBeds24Message('');
    const { data, error: saveError } = await supabase.functions.invoke('vihem-beds24-connection', {
      body: {
        action: 'save',
        enabled,
        invite_code: beds24InviteCode.trim(),
        refresh_token: beds24RefreshToken.trim(),
      },
    });
    setSavingBeds24(false);
    if (saveError || data?.error) {
      setBeds24Message(data?.error || await edgeFunctionErrorMessage(saveError, 'Kunde inte spara Beds24-anslutningen.'));
      return;
    }
    setBeds24InviteCode('');
    setBeds24RefreshToken('');
    setBeds24Connection(data.connection);
    setBeds24Message(enabled ? 'Beds24-anslutningen är sparad.' : 'Beds24 är avstängt.');
    await fetchBeds24Connection();
  }

  async function testBeds24Connection() {
    setSavingBeds24(true);
    setBeds24Message('');
    const { data, error: testError } = await supabase.functions.invoke('vihem-beds24-connection', {
      body: { action: 'test' },
    });
    setSavingBeds24(false);
    if (testError || data?.error) {
      setBeds24Message(data?.error || await edgeFunctionErrorMessage(testError, 'Kunde inte testa Beds24.'));
      return;
    }
    setBeds24Message(`Beds24 svarar. ${data.properties_count ?? 0} properties kunde läsas.`);
    await fetchBeds24Connection();
  }

  async function syncBeds24Bookings() {
    setSyncingBeds24(true);
    setBeds24Message('');
    const { data, error: syncError } = await supabase.functions.invoke('vihem-sync-beds24-bookings', {
      body: {},
    });
    setSyncingBeds24(false);
    if (syncError || data?.error) {
      setBeds24Message(data?.error || await edgeFunctionErrorMessage(syncError, 'Beds24-synken misslyckades.'));
      await fetchBeds24Connection();
      return;
    }
    setBeds24Message(`Importerade ${data.imported || 0} bokningar från Beds24.`);
    await Promise.all([fetchData(), fetchBeds24Connection()]);
  }

  function openCreateUnit() {
    setEditingUnit(null);
    setUnitForm(defaultUnitForm);
    setFormError('');
    setUnitModalOpen(true);
  }

  function openEditUnit(unit: ShortStayUnit) {
    setEditingUnit(unit);
    setUnitForm({
      name: unit.name,
      description: unit.description || '',
      max_guests: String(unit.max_guests || 2),
      property_id: unit.property_id || '',
      apartment_id: unit.apartment_id || '',
      is_active: unit.is_active,
      beds24_enabled: Boolean(unit.beds24_enabled),
      beds24_property_id: unit.beds24_property_id || '',
      beds24_room_id: unit.beds24_room_id || '',
      channel_name_1: unit.channel_name_1 || 'Booking.com',
      ical_url_1: unit.ical_url_1 || '',
      channel_name_2: unit.channel_name_2 || 'Expedia / Hotels.com',
      ical_url_2: unit.ical_url_2 || '',
      channel_name_3: unit.channel_name_3 || 'Airbnb',
      ical_url_3: unit.ical_url_3 || '',
    });
    setFormError('');
    setUnitModalOpen(true);
  }

  function openCreateBooking(unitId?: string, startDate?: string) {
    const start = startDate || todayKey();
    setEditingBooking(null);
    setBookingForm({
      ...defaultBookingForm,
      unit_id: unitId || units[0]?.id || '',
      start_date: start,
      end_date: toDateKey(addDays(new Date(`${start}T12:00:00`), 1)),
    });
    setFormError('');
    setBookingModalOpen(true);
  }

  function openEditBooking(booking: ShortStayBooking) {
    setEditingBooking(booking);
    setBookingForm({
      unit_id: booking.unit_id,
      booking_type: booking.booking_type,
      title: booking.title || '',
      start_date: booking.start_date,
      end_date: booking.end_date,
      arrival_time: booking.arrival_time || '15:00',
      departure_time: booking.departure_time || '11:00',
      guest_name: booking.guest_name || '',
      guest_email: booking.guest_email || '',
      guest_phone: booking.guest_phone || '',
      guest_count: String(booking.guest_count || 1),
      payment_status: booking.payment_status,
      cleaning_status: booking.cleaning_status,
      notes: booking.notes || '',
    });
    setFormError('');
    setBookingModalOpen(true);
  }

  async function saveUnit() {
    if (!organisationId || !user) return;
    setFormError('');
    if (!unitForm.name.trim()) {
      setFormError('Ange namn på enheten.');
      return;
    }

    setSaving(true);
    const payload = {
      organisation_id: organisationId,
      name: unitForm.name.trim(),
      description: unitForm.description.trim(),
      max_guests: Math.max(parseInt(unitForm.max_guests) || 1, 1),
      property_id: unitForm.property_id || null,
      apartment_id: unitForm.apartment_id || null,
      is_active: unitForm.is_active,
      beds24_enabled: unitForm.beds24_enabled,
      beds24_property_id: unitForm.beds24_property_id.trim(),
      beds24_room_id: unitForm.beds24_room_id.trim(),
      channel_name_1: unitForm.channel_name_1.trim() || 'Booking.com',
      ical_url_1: unitForm.ical_url_1.trim(),
      channel_name_2: unitForm.channel_name_2.trim() || 'Expedia / Hotels.com',
      ical_url_2: unitForm.ical_url_2.trim(),
      channel_name_3: unitForm.channel_name_3.trim() || 'Airbnb',
      ical_url_3: unitForm.ical_url_3.trim(),
      created_by: user.id,
      updated_at: new Date().toISOString(),
    };

    const result = editingUnit
      ? await supabase.from('vihem_short_stay_units').update(payload).eq('id', editingUnit.id)
      : await supabase.from('vihem_short_stay_units').insert(payload);

    setSaving(false);
    if (result.error) {
      setFormError(result.error.message);
      return;
    }

    setUnitModalOpen(false);
    await fetchData();
  }

  async function saveBooking() {
    if (!organisationId || !user) return;
    setFormError('');
    if (!bookingForm.unit_id) {
      setFormError('Välj en enhet.');
      return;
    }
    if (bookingForm.end_date <= bookingForm.start_date) {
      setFormError('Slutdatum måste vara efter startdatum.');
      return;
    }

    const conflicting = bookings.find(booking =>
      booking.id !== editingBooking?.id &&
      booking.unit_id === bookingForm.unit_id &&
      booking.booking_type === 'booking' &&
      bookingForm.booking_type === 'booking' &&
      rangeOverlaps(booking.start_date, booking.end_date, bookingForm.start_date, bookingForm.end_date)
    );
    if (conflicting) {
      setFormError(`Krockar med ${conflicting.guest_name || conflicting.title || 'befintlig bokning'} (${formatDateRange(conflicting.start_date, conflicting.end_date)}).`);
      return;
    }

    setSaving(true);
    const payload = {
      organisation_id: organisationId,
      unit_id: bookingForm.unit_id,
      booking_type: bookingForm.booking_type,
      title: bookingForm.title.trim() || bookingTypeLabels[bookingForm.booking_type],
      start_date: bookingForm.start_date,
      end_date: bookingForm.end_date,
      arrival_time: bookingForm.booking_type === 'booking' ? bookingForm.arrival_time || null : null,
      departure_time: bookingForm.booking_type === 'booking' ? bookingForm.departure_time || null : null,
      is_manual: true,
      channel_name: 'VI-HEM',
      guest_name: bookingForm.booking_type === 'booking' ? bookingForm.guest_name.trim() : '',
      guest_email: bookingForm.booking_type === 'booking' ? bookingForm.guest_email.trim() : '',
      guest_phone: bookingForm.booking_type === 'booking' ? bookingForm.guest_phone.trim() : '',
      guest_count: parseInt(bookingForm.guest_count) || 1,
      payment_status: bookingForm.payment_status,
      cleaning_status: bookingForm.cleaning_status,
      notes: bookingForm.notes.trim(),
      created_by: user.id,
      updated_at: new Date().toISOString(),
    };

    const result = editingBooking
      ? await supabase.from('vihem_short_stay_bookings').update(payload).eq('id', editingBooking.id)
      : await supabase.from('vihem_short_stay_bookings').insert(payload);

    setSaving(false);
    if (result.error) {
      setFormError(result.error.message);
      return;
    }

    setBookingModalOpen(false);
    await fetchData();
  }

  async function deleteBooking() {
    if (!editingBooking) return;
    setSaving(true);
    const { error: deleteError } = await supabase
      .from('vihem_short_stay_bookings')
      .delete()
      .eq('id', editingBooking.id);
    setSaving(false);
    if (deleteError) {
      setFormError(deleteError.message);
      return;
    }
    setBookingModalOpen(false);
    await fetchData();
  }

  async function syncUnit(unitId?: string) {
    setSyncingUnitId(unitId || 'all');
    const { error: syncError } = await supabase.functions.invoke('vihem-sync-short-stay-ical', {
      body: unitId ? { unit_id: unitId } : {},
    });
    setSyncingUnitId(null);
    if (syncError) {
      setError(syncError.message);
      return;
    }
    await fetchData();
  }

  const filteredBookings = bookings.filter((booking) => {
    const unit = units.find(u => u.id === booking.unit_id);
    const text = `${booking.title} ${booking.guest_name} ${booking.channel_name} ${unit?.name || ''}`.toLowerCase();
    return text.includes(searchQuery.toLowerCase());
  });

  if (loading) return <LoadingPage />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Korttidsuthyrning"
        subtitle="Bokningar, spärrar, städstatus och iCal-synk för lediga lägenheter"
        icon={BedDouble}
        action={
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="secondary" onClick={() => syncUnit()} loading={syncingUnitId === 'all'} disabled={units.length === 0}>
              <RefreshCw className="w-4 h-4" /> Synka kalendrar
            </Button>
            <Button variant="primary" onClick={() => openCreateBooking()} disabled={units.length === 0}>
              <Plus className="w-4 h-4" /> Ny bokning
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {[
          ['overview', 'Översikt'],
          ['calendar', 'Kalender'],
          ['bookings', 'Bokningar'],
          ...(isAdmin ? [['settings', 'Inställningar']] : []),
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value as Tab)}
            className={`rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap ${
              tab === value ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {units.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={<DoorOpen className="w-12 h-12" />}
            title="Inga korttidsenheter ännu"
            description={isAdmin ? 'Lägg upp en lägenhet eller ett rum som kan synkas mot bokningskanaler.' : 'Be admin lägga upp en korttidsenhet först.'}
            action={isAdmin && (
              <Button onClick={openCreateUnit}>
                <Plus className="w-4 h-4" /> Lägg till enhet
              </Button>
            )}
          />
        </Card>
      ) : tab === 'overview' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Card className="p-4">
              <p className="text-xs text-slate-500">Aktiva enheter</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.activeUnits.length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-slate-500">Belagda nu</p>
              <p className="mt-1 text-2xl font-bold text-blue-700">{stats.current.length}</p>
              <p className="mt-1 text-xs text-slate-500">{stats.currentGuests} gäster</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-slate-500">Check-in idag</p>
              <p className="mt-1 text-2xl font-bold text-emerald-700">{stats.checkIns.length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-slate-500">Check-out idag</p>
              <p className="mt-1 text-2xl font-bold text-amber-700">{stats.checkOuts.length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-slate-500">Att städa</p>
              <p className="mt-1 text-2xl font-bold text-rose-700">{stats.cleaning.length}</p>
            </Card>
          </div>

          {conflicts.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 w-4 h-4 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Möjlig dubbelbokning hittad</p>
                  <p>{conflicts.length} datumkrock behöver kontrolleras i kalendern.</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card className="p-5">
              <h2 className="font-semibold text-slate-900 mb-4">Idag</h2>
              <div className="grid gap-3">
                {[...stats.checkIns, ...stats.checkOuts].length === 0 ? (
                  <p className="text-sm text-slate-500">Inga in- eller utcheckningar idag.</p>
                ) : (
                  [...stats.checkIns, ...stats.checkOuts].map((booking) => {
                    const unit = units.find(u => u.id === booking.unit_id);
                    const isCheckOut = booking.end_date === todayKey();
                    return (
                      <button key={`${booking.id}-${isCheckOut ? 'out' : 'in'}`} onClick={() => openEditBooking(booking)} className="text-left rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-slate-900">{booking.guest_name || booking.title}</p>
                          <Badge className={isCheckOut ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}>
                            {isCheckOut ? 'Check-out' : 'Check-in'}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-500">{unit?.name} · {formatDateRange(booking.start_date, booking.end_date)}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {booking.guest_count || 1} gäster
                          {booking.arrival_time ? ` · ankomst ${booking.arrival_time.slice(0, 5)}` : ''}
                          {booking.departure_time ? ` · avresa ${booking.departure_time.slice(0, 5)}` : ''}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="font-semibold text-slate-900 mb-4">Städstatus</h2>
              <div className="grid gap-3">
                {stats.cleaning.length === 0 ? (
                  <p className="text-sm text-slate-500">Inget väntar på städning.</p>
                ) : (
                  stats.cleaning.slice(0, 8).map((booking) => {
                    const unit = units.find(u => u.id === booking.unit_id);
                    return (
                      <button key={booking.id} onClick={() => openEditBooking(booking)} className="text-left rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-slate-900">{unit?.name}</p>
                          <Badge className="bg-rose-100 text-rose-700">{cleaningLabels[booking.cleaning_status]}</Badge>
                        </div>
                        <p className="text-sm text-slate-500">Efter {booking.guest_name || booking.title || 'bokning'} · ut {formatShortDate(booking.end_date)}</p>
                        {booking.cleaning_work_order_id && (
                          <p className="mt-1 text-xs font-medium text-blue-700">Arbetsorder skapad</p>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </Card>
          </div>
        </div>
      ) : tab === 'calendar' ? (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900 capitalize">{calendarRangeLabel(days)}</h2>
              <p className="text-sm text-slate-500">Visar 31 dagar från valt startdatum</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setCalendarStartDate(addDays(calendarStartDate, -31))}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const now = new Date();
                  setCalendarStartDate(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12));
                }}
              >
                Idag
              </Button>
              <Button
                variant="secondary"
                onClick={() => setCalendarStartDate(addDays(calendarStartDate, 31))}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div style={{ width: `${calendarTotalWidth}px` }}>
              <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: `${CALENDAR_UNIT_WIDTH}px repeat(${days.length}, ${CALENDAR_DAY_WIDTH}px)` }}>
                <div className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Rum/lägenhet</div>
                {days.map((day) => (
                  <div key={day} className={`px-2 py-3 text-center text-xs font-medium ${day === todayKey() ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}>
                    <div>{new Date(`${day}T12:00:00`).toLocaleDateString('sv-SE', { weekday: 'short' })}</div>
                    <div>{new Date(`${day}T12:00:00`).getDate()}</div>
                  </div>
                ))}
              </div>

              {units.map((unit) => {
                const unitBookings = bookingsByUnit.get(unit.id) || [];
                const visibleBookings = unitBookings.filter(item =>
                  item.start_date <= toDateKey(addDays(new Date(`${days[days.length - 1]}T12:00:00`), 1)) &&
                  item.end_date > days[0]
                );
                return (
                  <div key={unit.id} className="grid border-b border-slate-100" style={{ gridTemplateColumns: `${CALENDAR_UNIT_WIDTH}px ${calendarGridWidth}px` }}>
                    <div className="sticky left-0 z-10 bg-white px-4 py-3">
                      <p className="text-sm font-semibold text-slate-900">{unit.name}</p>
                      <p className="text-xs text-slate-500">{unit.apartment?.apartment_number || unit.property?.name || 'Fristående'}</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400">
                        <Users className="h-3 w-3" /> Max {unit.max_guests || 2}
                      </p>
                    </div>
                    <div className="relative grid min-h-[72px]" style={{ gridTemplateColumns: `repeat(${days.length}, ${CALENDAR_DAY_WIDTH}px)` }}>
                      {visibleBookings.map((booking, index) => {
                        const style = bookingBandStyle(booking, days);
                        if (!style) return null;
                        const isBlock = booking.booking_type === 'block';
                        const isSingleNight = booking.end_date === toDateKey(addDays(new Date(`${booking.start_date}T12:00:00`), 1));
                        return (
                          <button
                            key={booking.id}
                            type="button"
                            onClick={() => openEditBooking(booking)}
                            title={`${booking.guest_name || booking.title || booking.channel_name} (${formatDateRange(booking.start_date, booking.end_date)})`}
                            className={`absolute top-2 z-10 flex h-7 min-w-0 items-center gap-1 rounded-lg px-1.5 text-left text-[10px] font-semibold text-white shadow-sm transition hover:brightness-95 sm:h-8 sm:gap-2 sm:px-2 sm:text-[11px] ${
                              isBlock ? 'bg-slate-700' : 'bg-blue-600'
                            }`}
                            style={style}
                          >
                            <span className="min-w-0 flex-1 truncate">{isSingleNight ? (booking.guest_name || booking.title || booking.channel_name).split(' ')[0] : (booking.guest_name || booking.title || booking.channel_name)}</span>
                            {booking.booking_type === 'booking' && (
                              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-white/20 px-1 py-0.5">
                                <Users className="h-3 w-3" />
                                {booking.guest_count || 1}
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {days.map((day) => {
                        const activeBooking = unitBookings.find(item => overlaps(item, day));
                        const arrival = unitBookings.find(item => item.start_date === day && item.booking_type === 'booking');
                        const departure = unitBookings.find(item => item.end_date === day && item.booking_type === 'booking');
                        const block = unitBookings.find(item => item.booking_type === 'block' && (overlaps(item, day) || item.start_date === day));
                        const booking = activeBooking || arrival || departure || block;
                        const isTurnover = Boolean(arrival && departure && arrival.id !== departure.id);
                        return (
                          <button
                            key={`${unit.id}-${day}`}
                            onClick={() => booking ? openEditBooking(booking) : openCreateBooking(unit.id, day)}
                            className={`relative min-h-[72px] border-l border-slate-100 px-1 pb-2 pt-11 text-left transition hover:bg-slate-50 ${
                              block ? 'bg-slate-100' : activeBooking ? 'bg-blue-50' : departure ? 'bg-amber-50' : ''
                            }`}
                            title={booking ? `${booking.guest_name || booking.title || booking.channel_name} (${formatDateRange(booking.start_date, booking.end_date)})` : 'Skapa bokning'}
                          >
                            <div className="relative z-20 flex flex-wrap items-center gap-1 overflow-hidden">
                              {arrival && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold text-emerald-700">
                                  <LogIn className="h-2.5 w-2.5" /> In
                                </span>
                              )}
                              {departure && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-700">
                                  <LogOut className="h-2.5 w-2.5" /> Ut
                                </span>
                              )}
                              {departure?.cleaning_status && departure.cleaning_status !== 'clean' && departure.cleaning_status !== 'not_needed' && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1 py-0.5 text-[9px] font-semibold text-rose-700">
                                  <Wrench className="h-2.5 w-2.5" /> Städ
                                </span>
                              )}
                              {isTurnover && (
                                <span className="rounded-full bg-violet-100 px-1 py-0.5 text-[9px] font-semibold text-violet-700">Byte</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      ) : tab === 'bookings' ? (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Sök gäst, kanal eller enhet..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid gap-3">
            {filteredBookings.length === 0 ? (
              <Card className="p-8">
                <EmptyState icon={<CalendarDays className="w-12 h-12" />} title="Inga bokningar hittades" />
              </Card>
            ) : filteredBookings.map((booking) => {
              const unit = units.find(u => u.id === booking.unit_id);
              return (
                <Card key={booking.id} className="p-4" onClick={() => openEditBooking(booking)}>
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-900">{booking.guest_name || booking.title}</p>
                        <Badge className={booking.booking_type === 'block' ? 'bg-slate-100 text-slate-700' : 'bg-blue-100 text-blue-700'}>
                          {bookingTypeLabels[booking.booking_type]}
                        </Badge>
                        <Badge className="bg-slate-100 text-slate-600">{booking.channel_name || 'Manuell'}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{unit?.name} · {formatDateRange(booking.start_date, booking.end_date)}</p>
                      {booking.booking_type === 'booking' && (
                        <p className="mt-1 text-xs text-slate-500">
                          {booking.guest_count || 1} gäster
                          {booking.arrival_time ? ` · in ${booking.arrival_time.slice(0, 5)}` : ''}
                          {booking.departure_time ? ` · ut ${booking.departure_time.slice(0, 5)}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className="bg-emerald-100 text-emerald-700">{paymentLabels[booking.payment_status]}</Badge>
                      <Badge className="bg-amber-100 text-amber-700">{cleaningLabels[booking.cleaning_status]}</Badge>
                      {booking.cleaning_work_order_id && <Badge className="bg-blue-100 text-blue-700">Städorder</Badge>}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">Beds24-integration</h2>
                  <Badge className={beds24Connection?.enabled ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}>
                    {beds24Connection?.enabled ? 'Aktiv' : 'Avstängd'}
                  </Badge>
                  <Badge className={beds24Connection?.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>
                    {beds24Connection?.connected ? 'Ansluten' : 'Saknar token'}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Aktivera Beds24 separat från korttidsuthyrningen. Bokningar importeras till kalendern och skapar städarbetsorder automatiskt.
                </p>
                {beds24Connection?.last_sync_at && (
                  <p className="mt-2 text-xs text-slate-500">Senast synkad {formatDateTime(beds24Connection.last_sync_at)}</p>
                )}
                {beds24Connection?.last_error && (
                  <p className="mt-2 text-sm text-red-700">{beds24Connection.last_error}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={testBeds24Connection} loading={savingBeds24} disabled={!beds24Connection?.connected}>
                  Testa
                </Button>
                <Button variant="primary" onClick={syncBeds24Bookings} loading={syncingBeds24} disabled={!beds24Connection?.enabled || !beds24Connection?.connected}>
                  <RefreshCw className="w-4 h-4" /> Synka Beds24
                </Button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-3">
                <Input
                  label="Beds24 invite code"
                  value={beds24InviteCode}
                  onChange={e => setBeds24InviteCode(e.target.value)}
                  placeholder="Klistra in invite code första gången"
                />
                <Input
                  label="Refresh token"
                  value={beds24RefreshToken}
                  onChange={e => setBeds24RefreshToken(e.target.value)}
                  placeholder="Alternativt befintlig refresh token"
                />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => saveBeds24Connection(true)} loading={savingBeds24}>
                    Spara och aktivera
                  </Button>
                  <Button variant="secondary" onClick={() => saveBeds24Connection(false)} loading={savingBeds24}>
                    Stäng av
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-900">Webhook till Beds24</p>
                <p className="mt-1 text-sm text-slate-500">
                  Lägg in denna under Beds24 Booking Webhook när anslutningen är sparad.
                </p>
                {getBeds24WebhookUrl(beds24Connection) ? (
                  <a
                    href={getBeds24WebhookUrl(beds24Connection)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex max-w-full items-center gap-1 break-all text-sm text-blue-700 hover:underline"
                  >
                    {getBeds24WebhookUrl(beds24Connection)}
                    <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                  </a>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">Spara anslutningen för att skapa webhook-URL.</p>
                )}
                <p className="mt-3 text-xs text-slate-500">
                  Använd API v2 webhook med persondata om ni vill få gästnamn, e-post och telefon.
                </p>
              </div>
            </div>

            {beds24Message && (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                {beds24Message}
              </div>
            )}

            {beds24Logs.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-slate-900">Senaste Beds24-loggar</h3>
                <div className="mt-2 grid gap-2">
                  {beds24Logs.slice(0, 6).map(log => (
                    <div key={log.id} className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{log.message}</p>
                        <p className="text-xs text-slate-500">{log.event_type} · {formatDateTime(log.created_at)}</p>
                      </div>
                      <Badge className={
                        log.status === 'success' ? 'bg-emerald-100 text-emerald-700' :
                          log.status === 'error' ? 'bg-red-100 text-red-700' :
                            log.status === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                      }>
                        {log.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <div className="flex justify-end">
            <Button onClick={openCreateUnit}>
              <Plus className="w-4 h-4" /> Lägg till enhet
            </Button>
          </div>
          <div className="grid gap-4">
            {units.map((unit) => (
              <Card key={unit.id} className="p-5">
                <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-slate-900">{unit.name}</h2>
                      <Badge className={unit.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}>
                        {unit.is_active ? 'Aktiv' : 'Inaktiv'}
                      </Badge>
                      <Badge className="bg-blue-100 text-blue-700">Max {unit.max_guests || 2} gäster</Badge>
                      {unit.beds24_enabled && <Badge className="bg-violet-100 text-violet-700">Beds24</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{unit.description || unit.apartment?.apartment_number || unit.property?.name || 'Ingen koppling till lägenhet vald'}</p>
                    {unit.beds24_enabled && (
                      <p className="mt-2 text-xs text-slate-500">
                        Beds24: property {unit.beds24_property_id || 'ej angivet'} · room {unit.beds24_room_id || 'ej angivet'}
                      </p>
                    )}
                    <div className="mt-3 grid gap-2 text-sm text-slate-600">
                      {[1, 2, 3].map((channel) => {
                        const name = unit[`channel_name_${channel}` as keyof ShortStayUnit] as string;
                        const url = unit[`ical_url_${channel}` as keyof ShortStayUnit] as string;
                        const syncError = unit[`sync_error_${channel}` as keyof ShortStayUnit] as string | null;
                        return (
                          <div key={channel} className="rounded-lg bg-slate-50 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{name || `Kanal ${channel}`}</span>
                              <span className="text-xs text-slate-400">{url ? 'Import aktiv' : 'Ingen importlänk'}</span>
                              {syncError && <span className="text-xs text-red-600">{syncError}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {unit.ical_token && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <p className="text-xs font-medium text-slate-500">Exportlänk till kanaler</p>
                        <a href={getExportUrl(unit.ical_token)} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-sm text-blue-700 hover:underline">
                          {getExportUrl(unit.ical_token)}
                          <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => syncUnit(unit.id)} loading={syncingUnitId === unit.id}>
                      <RefreshCw className="w-4 h-4" /> Synka
                    </Button>
                    <Button variant="secondary" onClick={() => openEditUnit(unit)}>
                      <Edit2 className="w-4 h-4" /> Redigera
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Modal open={unitModalOpen} onClose={() => setUnitModalOpen(false)} title={editingUnit ? 'Redigera korttidsenhet' : 'Ny korttidsenhet'} size="lg">
        <div className="space-y-4">
          <Input label="Namn" value={unitForm.name} onChange={e => setUnitForm({ ...unitForm, name: e.target.value })} placeholder="T.ex. Lägenhet 1201" />
          <Textarea label="Beskrivning" rows={3} value={unitForm.description} onChange={e => setUnitForm({ ...unitForm, description: e.target.value })} />
          <Input
            label="Max antal gäster"
            type="number"
            min={1}
            value={unitForm.max_guests}
            onChange={e => setUnitForm({ ...unitForm, max_guests: e.target.value })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Fastighet"
              value={unitForm.property_id}
              onChange={e => setUnitForm({ ...unitForm, property_id: e.target.value, apartment_id: '' })}
              options={[{ value: '', label: 'Ingen vald' }, ...properties.map(property => ({ value: property.id, label: property.name }))]}
            />
            <Select
              label="Lägenhet"
              value={unitForm.apartment_id}
              onChange={e => setUnitForm({ ...unitForm, apartment_id: e.target.value })}
              options={[
                { value: '', label: 'Ingen vald' },
                ...apartments
                  .filter(apartment => !unitForm.property_id || apartment.property_id === unitForm.property_id)
                  .map(apartment => ({ value: apartment.id, label: `${apartment.apartment_number} · ${apartment.property?.name || ''}` })),
              ]}
            />
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={unitForm.beds24_enabled}
                onChange={e => setUnitForm({ ...unitForm, beds24_enabled: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>
                <span className="block font-semibold text-slate-900">Aktivera Beds24 för den här enheten</span>
                <span className="block text-slate-500">Används när API/webhook-kopplingen slås på separat i korttidsuthyrnings-tillägget.</span>
              </span>
            </label>
            {unitForm.beds24_enabled && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Beds24 property-id"
                  value={unitForm.beds24_property_id}
                  onChange={e => setUnitForm({ ...unitForm, beds24_property_id: e.target.value })}
                />
                <Input
                  label="Beds24 room-id"
                  value={unitForm.beds24_room_id}
                  onChange={e => setUnitForm({ ...unitForm, beds24_room_id: e.target.value })}
                />
              </div>
            )}
          </div>
          {[1, 2, 3].map((channel) => (
            <div key={channel} className="rounded-lg border border-slate-200 p-3">
              <p className="mb-3 text-sm font-semibold text-slate-800">Kanal {channel}</p>
              <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3">
                <Input
                  label="Namn"
                  value={unitForm[`channel_name_${channel}` as keyof UnitForm] as string}
                  onChange={e => setUnitForm({ ...unitForm, [`channel_name_${channel}`]: e.target.value })}
                />
                <Input
                  label="iCal-importlänk"
                  value={unitForm[`ical_url_${channel}` as keyof UnitForm] as string}
                  onChange={e => setUnitForm({ ...unitForm, [`ical_url_${channel}`]: e.target.value })}
                  placeholder="https://..."
                />
              </div>
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={unitForm.is_active} onChange={e => setUnitForm({ ...unitForm, is_active: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
            Aktiv enhet
          </label>
          {formError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{formError}</div>}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setUnitModalOpen(false)}>Avbryt</Button>
            <Button onClick={saveUnit} loading={saving}>{editingUnit ? 'Spara' : 'Skapa'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={bookingModalOpen} onClose={() => setBookingModalOpen(false)} title={editingBooking ? 'Redigera bokning' : 'Ny bokning'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Enhet"
              value={bookingForm.unit_id}
              onChange={e => setBookingForm({ ...bookingForm, unit_id: e.target.value })}
              options={units.map(unit => ({ value: unit.id, label: unit.name }))}
            />
            <Select
              label="Typ"
              value={bookingForm.booking_type}
              onChange={e => setBookingForm({ ...bookingForm, booking_type: e.target.value as ShortStayBookingType })}
              options={[
                { value: 'booking', label: 'Bokning' },
                { value: 'block', label: 'Spärrad period' },
              ]}
            />
            <Input label="Startdatum" type="date" value={bookingForm.start_date} onChange={e => setBookingForm({ ...bookingForm, start_date: e.target.value })} />
            <Input label="Slutdatum" type="date" value={bookingForm.end_date} onChange={e => setBookingForm({ ...bookingForm, end_date: e.target.value })} />
            {bookingForm.booking_type === 'booking' && (
              <>
                <Input label="Ankomsttid" type="time" value={bookingForm.arrival_time} onChange={e => setBookingForm({ ...bookingForm, arrival_time: e.target.value })} />
                <Input label="Avresetid" type="time" value={bookingForm.departure_time} onChange={e => setBookingForm({ ...bookingForm, departure_time: e.target.value })} />
              </>
            )}
          </div>
          <Input label={bookingForm.booking_type === 'block' ? 'Rubrik' : 'Rubrik / bokningsnamn'} value={bookingForm.title} onChange={e => setBookingForm({ ...bookingForm, title: e.target.value })} />
          {bookingForm.booking_type === 'booking' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Gästnamn" value={bookingForm.guest_name} onChange={e => setBookingForm({ ...bookingForm, guest_name: e.target.value })} />
              <Input label="Antal gäster" type="number" min={1} value={bookingForm.guest_count} onChange={e => setBookingForm({ ...bookingForm, guest_count: e.target.value })} />
              <Input label="E-post" type="email" value={bookingForm.guest_email} onChange={e => setBookingForm({ ...bookingForm, guest_email: e.target.value })} />
              <Input label="Telefon" value={bookingForm.guest_phone} onChange={e => setBookingForm({ ...bookingForm, guest_phone: e.target.value })} />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Betalning"
              value={bookingForm.payment_status}
              onChange={e => setBookingForm({ ...bookingForm, payment_status: e.target.value as ShortStayPaymentStatus })}
              options={Object.entries(paymentLabels).map(([value, label]) => ({ value, label }))}
            />
            <Select
              label="Städstatus"
              value={bookingForm.cleaning_status}
              onChange={e => setBookingForm({ ...bookingForm, cleaning_status: e.target.value as ShortStayCleaningStatus })}
              options={Object.entries(cleaningLabels).map(([value, label]) => ({ value, label }))}
            />
          </div>
          <Textarea label="Anteckningar" rows={3} value={bookingForm.notes} onChange={e => setBookingForm({ ...bookingForm, notes: e.target.value })} />
          {formError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{formError}</div>}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-3">
            {editingBooking ? (
              <Button variant="danger" onClick={deleteBooking} loading={saving}>Ta bort</Button>
            ) : <span />}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setBookingModalOpen(false)}>Avbryt</Button>
              <Button onClick={saveBooking} loading={saving}>
                <ClipboardCheck className="w-4 h-4" /> {editingBooking ? 'Spara' : 'Skapa'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
