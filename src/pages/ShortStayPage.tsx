import React, { useEffect, useMemo, useState } from 'react';
import {
  BedDouble, CalendarDays, RefreshCw, Plus, Edit2, ExternalLink,
  Sparkles, Search, ClipboardCheck, AlertTriangle, DoorOpen,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
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
  property_id: string;
  apartment_id: string;
  is_active: boolean;
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
  guest_name: string;
  guest_email: string;
  guest_phone: string;
  guest_count: string;
  payment_status: ShortStayPaymentStatus;
  cleaning_status: ShortStayCleaningStatus;
  notes: string;
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

const defaultUnitForm: UnitForm = {
  name: '',
  description: '',
  property_id: '',
  apartment_id: '',
  is_active: true,
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

function getExportUrl(token: string) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base || !token) return '';
  return `${base}/functions/v1/vihem-export-short-stay-ical?token=${token}`;
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

  const isAdmin = user?.role === 'admin';
  const organisationId = user?.organisation_id;

  const days = useMemo(() => {
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    return Array.from({ length: 35 }, (_, index) => toDateKey(addDays(start, index)));
  }, []);

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
    return { activeUnits, current, checkIns, checkOuts, cleaning };
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
      property_id: unit.property_id || '',
      apartment_id: unit.apartment_id || '',
      is_active: unit.is_active,
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
      property_id: unitForm.property_id || null,
      apartment_id: unitForm.apartment_id || null,
      is_active: unitForm.is_active,
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
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: `210px repeat(${days.length}, minmax(38px, 1fr))` }}>
                <div className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Enhet</div>
                {days.map((day) => (
                  <div key={day} className={`px-2 py-3 text-center text-xs font-medium ${day === todayKey() ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}>
                    <div>{new Date(`${day}T12:00:00`).toLocaleDateString('sv-SE', { weekday: 'short' })}</div>
                    <div>{new Date(`${day}T12:00:00`).getDate()}</div>
                  </div>
                ))}
              </div>

              {units.map((unit) => (
                <div key={unit.id} className="grid border-b border-slate-100" style={{ gridTemplateColumns: `210px repeat(${days.length}, minmax(38px, 1fr))` }}>
                  <div className="sticky left-0 z-10 bg-white px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">{unit.name}</p>
                    <p className="text-xs text-slate-500">{unit.apartment?.apartment_number || unit.property?.name || 'Fristående'}</p>
                  </div>
                  {days.map((day) => {
                    const booking = (bookingsByUnit.get(unit.id) || []).find(item => overlaps(item, day));
                    return (
                      <button
                        key={`${unit.id}-${day}`}
                        onClick={() => booking ? openEditBooking(booking) : openCreateBooking(unit.id, day)}
                        className={`min-h-[58px] border-l border-slate-100 px-1 py-2 text-left hover:bg-slate-50 ${
                          booking?.booking_type === 'block' ? 'bg-slate-100' : booking ? 'bg-blue-50' : ''
                        }`}
                      >
                        {booking && (
                          <div className={`rounded-md px-2 py-1 text-[11px] font-medium leading-tight ${
                            booking.booking_type === 'block' ? 'bg-slate-700 text-white' : 'bg-blue-600 text-white'
                          }`}>
                            {booking.guest_name || booking.title || booking.channel_name}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
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
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className="bg-emerald-100 text-emerald-700">{paymentLabels[booking.payment_status]}</Badge>
                      <Badge className="bg-amber-100 text-amber-700">{cleaningLabels[booking.cleaning_status]}</Badge>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
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
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{unit.description || unit.apartment?.apartment_number || unit.property?.name || 'Ingen koppling till lägenhet vald'}</p>
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
