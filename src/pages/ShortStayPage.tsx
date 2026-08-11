import React, { useEffect, useMemo, useState } from 'react';
import {
  BedDouble, CalendarDays, RefreshCw, Plus, Edit2, ExternalLink,
  Sparkles, Search, ClipboardCheck, AlertTriangle, DoorOpen,
  ChevronLeft, ChevronRight, LogIn, LogOut, Users, Wrench,
  ReceiptText, Printer, CheckCircle2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatDateTime } from '../lib/utils';
import { getShortStayChannelMeta } from '../lib/shortStayChannels';
import {
  Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select, Textarea,
} from '../components/ui';
import type {
  Apartment, Property, ShortStayBooking, ShortStayBookingType,
  ShortStayCleaningStatus, ShortStayPaymentStatus, ShortStayUnit,
  FinanceCompany,
} from '../types';

interface ShortStayPageProps {
  onNavigate: (page: string) => void;
}

type Tab = 'overview' | 'calendar' | 'cleaning' | 'bookings' | 'receipts' | 'settings';

interface UnitForm {
  name: string;
  description: string;
  max_guests: string;
  receipt_vat_rate: string;
  receipt_vat_exempt: boolean;
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
  total_price: string;
  paid_amount: string;
  currency: string;
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

interface CommonCleaning {
  id: string;
  organisation_id: string;
  title: string;
  description: string;
  due_date: string;
  required_unit_ids: string[];
  cleaning_status: ShortStayCleaningStatus;
  completed_by: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  rule_id?: string | null;
}

interface CommonCleaningRule {
  id: string;
  organisation_id: string;
  title: string;
  description: string;
  required_unit_ids: string[];
  weekdays: number[];
  active: boolean;
}

interface CommonCleaningForm {
  title: string;
  description: string;
  required_unit_ids: string[];
  weekdays: number[];
}

interface ReceiptLineForm {
  id: string;
  description: string;
  amount: string;
}

interface ReceiptForm {
  booking_id: string;
  company_id: string;
  title: string;
  vat_rate: string;
  vat_exempt: boolean;
  commission_rate: string;
  commission_amount: string;
  lines: ReceiptLineForm[];
}

type CleaningItem =
  | { kind: 'booking'; id: string; status: ShortStayCleaningStatus; date: string; title: string; subtitle: string; booking: ShortStayBooking }
  | { kind: 'common'; id: string; status: ShortStayCleaningStatus; date: string; title: string; subtitle: string; cleaning: CommonCleaning };

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

function ShortStayChannelBadge({ booking }: { booking: ShortStayBooking }) {
  const channel = getShortStayChannelMeta(booking.channel_name);
  return (
    <Badge className={`${channel.badgeClass} gap-1`}>
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/45 text-[9px] font-black">
        {channel.shortLabel}
      </span>
      {channel.label}
    </Badge>
  );
}

const defaultUnitForm: UnitForm = {
  name: '',
  description: '',
  max_guests: '2',
  receipt_vat_rate: '12',
  receipt_vat_exempt: false,
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
  total_price: '',
  paid_amount: '',
  currency: 'SEK',
  payment_status: 'unpaid',
  cleaning_status: 'dirty',
  notes: '',
};

const defaultCommonCleaningForm: CommonCleaningForm = {
  title: '',
  description: '',
  required_unit_ids: [],
  weekdays: [1, 2, 3, 4, 5],
};

const defaultReceiptForm: ReceiptForm = {
  booking_id: '',
  company_id: '',
  title: 'Kvitto',
  vat_rate: '12',
  vat_exempt: false,
  commission_rate: '0',
  commission_amount: '0',
  lines: [],
};

const weekdayOptions = [
  { value: 1, label: 'Måndag' },
  { value: 2, label: 'Tisdag' },
  { value: 3, label: 'Onsdag' },
  { value: 4, label: 'Torsdag' },
  { value: 5, label: 'Fredag' },
  { value: 6, label: 'Lördag' },
  { value: 7, label: 'Söndag' },
];

const cleaningLabels: Record<ShortStayCleaningStatus, string> = {
  not_needed: 'Arkiverad',
  dirty: 'Behöver städas',
  in_progress: 'Städning pågår',
  clean: 'Klar',
};

function SwipeableCleaningCard({
  item,
  disabled,
  onOpen,
  onToggle,
}: {
  item: CleaningItem;
  disabled: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const [startX, setStartX] = useState<number | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const threshold = -88;

  function resetSwipe() {
    setStartX(null);
    setOffsetX(0);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    setStartX(event.clientX);
    setOffsetX(0);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (startX === null || disabled) return;
    const nextOffset = Math.max(Math.min(event.clientX - startX, 0), -132);
    setOffsetX(nextOffset);
  }

  function handlePointerUp() {
    if (disabled) return;
    const shouldToggle = offsetX <= threshold;
    const shouldOpen = Math.abs(offsetX) < 8;
    resetSwipe();
    if (shouldToggle) {
      onToggle();
      return;
    }
    if (shouldOpen) onOpen();
  }

  const isClean = item.status === 'clean';

  return (
    <div className={`relative overflow-hidden rounded-lg ${isClean ? 'bg-amber-600' : 'bg-emerald-600'}`}>
      <div className="absolute inset-y-0 right-0 flex w-32 items-center justify-center gap-1 px-3 text-sm font-bold text-white">
        {isClean ? <Wrench className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        {isClean ? 'Ostädad' : 'Klar'}
      </div>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Öppna eller svep för att ändra städstatus för ${item.title}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={resetSwipe}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onOpen();
        }}
        className={`touch-pan-y select-none rounded-lg border border-slate-200 bg-white p-3 text-left transition-shadow hover:bg-slate-50 ${
          disabled ? 'opacity-70' : 'cursor-pointer'
        }`}
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: startX === null ? 'transform 160ms ease' : 'none',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium text-slate-900">{item.title}</p>
          <Badge className={disabled ? 'bg-slate-100 text-slate-600' : isClean ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}>
            {disabled ? 'Sparar...' : cleaningLabels[item.status]}
          </Badge>
        </div>
        <p className="text-sm text-slate-500">{item.subtitle}</p>
        <p className="mt-1 text-xs font-medium text-blue-700">
          {isClean ? 'Svep vänster om den ska markeras som ostädad igen' : 'Svep vänster när kontroll/städ är klar'}
        </p>
      </div>
    </div>
  );
}

const paymentLabels: Record<ShortStayPaymentStatus, string> = {
  unpaid: 'Obetald',
  partial: 'Delbetald',
  paid: 'Betald',
};

const bookingTypeLabels: Record<ShortStayBookingType, string> = {
  booking: 'Bokning',
  block: 'Spärr',
};

const moneyFormatterCache = new Map<string, Intl.NumberFormat>();

function formatMoney(amount: number | string | null | undefined, currency = 'SEK') {
  const numeric = Number(amount || 0);
  let normalizedCurrency = (currency || 'SEK').toUpperCase();
  const key = `sv-SE-${normalizedCurrency}`;
  try {
    if (!moneyFormatterCache.has(key)) {
      moneyFormatterCache.set(key, new Intl.NumberFormat('sv-SE', {
        style: 'currency',
        currency: normalizedCurrency,
        maximumFractionDigits: 2,
      }));
    }
  } catch {
    normalizedCurrency = 'SEK';
    if (!moneyFormatterCache.has('sv-SE-SEK')) {
      moneyFormatterCache.set('sv-SE-SEK', new Intl.NumberFormat('sv-SE', {
        style: 'currency',
        currency: 'SEK',
        maximumFractionDigits: 2,
      }));
    }
  }
  return moneyFormatterCache.get(`sv-SE-${normalizedCurrency}`)!.format(numeric);
}

function parseMoneyInput(value: string, allowNegative = false) {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? (allowNegative ? parsed : Math.max(parsed, 0)) : 0;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function overlaps(booking: ShortStayBooking, day: string) {
  return booking.start_date <= day && booking.end_date > day;
}

function rangeOverlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart < bEnd && bStart < aEnd;
}

function overlapDateRange(first: ShortStayBooking, second: ShortStayBooking) {
  const start = first.start_date > second.start_date ? first.start_date : second.start_date;
  const end = first.end_date < second.end_date ? first.end_date : second.end_date;
  return formatDateRange(start, end);
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

function isMissingSchemaError(error: any) {
  const message = String(error?.message || error?.details || '');
  return message.includes('schema cache') || message.includes('does not exist') || error?.code === 'PGRST205';
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

export function ShortStayPage({ onNavigate }: ShortStayPageProps) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [units, setUnits] = useState<ShortStayUnit[]>([]);
  const [bookings, setBookings] = useState<ShortStayBooking[]>([]);
  const [commonCleanings, setCommonCleanings] = useState<CommonCleaning[]>([]);
  const [commonCleaningRules, setCommonCleaningRules] = useState<CommonCleaningRule[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [financeCompanies, setFinanceCompanies] = useState<FinanceCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [commonCleaningModalOpen, setCommonCleaningModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<ShortStayUnit | null>(null);
  const [editingBooking, setEditingBooking] = useState<ShortStayBooking | null>(null);
  const [unitForm, setUnitForm] = useState<UnitForm>(defaultUnitForm);
  const [bookingForm, setBookingForm] = useState<BookingForm>(defaultBookingForm);
  const [commonCleaningForm, setCommonCleaningForm] = useState<CommonCleaningForm>(defaultCommonCleaningForm);
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
  const [updatingCleaningId, setUpdatingCleaningId] = useState<string | null>(null);
  const [conflictsModalOpen, setConflictsModalOpen] = useState(false);
  const [receiptMessage, setReceiptMessage] = useState('');
  const [creatingReceiptId, setCreatingReceiptId] = useState<string | null>(null);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [receiptForm, setReceiptForm] = useState<ReceiptForm>(defaultReceiptForm);

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
    const cleaningHistoryStart = toDateKey(addDays(new Date(`${today}T12:00:00`), -3));
    const activeUnits = units.filter(unit => unit.is_active);
    const current = bookings.filter(booking => overlaps(booking, today) && booking.booking_type === 'booking');
    const checkIns = bookings.filter(booking => booking.start_date === today && booking.booking_type === 'booking');
    const checkOuts = bookings.filter(booking => booking.end_date === today && booking.booking_type === 'booking');
    const bookingCleaningItems = bookings.filter(booking =>
      booking.booking_type === 'booking' &&
      booking.cleaning_status !== 'not_needed' &&
      booking.end_date <= today &&
      booking.end_date >= cleaningHistoryStart &&
      (booking.cleaning_status === 'clean' ? booking.end_date === today : true)
    );
    const commonCleaningItems = commonCleanings.filter(cleaning =>
      cleaning.cleaning_status !== 'not_needed' &&
      cleaning.due_date <= today &&
      cleaning.due_date >= cleaningHistoryStart &&
      (cleaning.cleaning_status === 'clean' ? cleaning.due_date === today : true)
    );
    const cleaningItems: CleaningItem[] = [
      ...bookingCleaningItems.map((booking) => {
        const unit = units.find(unit => unit.id === booking.unit_id);
        return {
          kind: 'booking' as const,
          id: booking.id,
          status: booking.cleaning_status,
          date: booking.end_date,
          title: unit?.name || 'Okänd enhet',
          subtitle: `Efter ${booking.guest_name || booking.title || 'bokning'} · ut ${formatShortDate(booking.end_date)}`,
          booking,
        };
      }),
      ...commonCleaningItems.map((cleaning) => {
        const requiredUnits = cleaning.required_unit_ids
          .map(unitId => units.find(unit => unit.id === unitId)?.name)
          .filter(Boolean)
          .join(', ');
        return {
          kind: 'common' as const,
          id: cleaning.id,
          status: cleaning.cleaning_status,
          date: cleaning.due_date,
          title: cleaning.title,
          subtitle: `${formatShortDate(cleaning.due_date)}${requiredUnits ? ` · gäller ${requiredUnits}` : ''}`,
          cleaning,
        };
      }),
    ].sort((a, b) => {
      if (a.status === 'clean' && b.status !== 'clean') return 1;
      if (a.status !== 'clean' && b.status === 'clean') return -1;
      return a.date.localeCompare(b.date);
    });
    const pendingCleaningCount = cleaningItems.filter(item => item.status !== 'clean').length;
    const currentGuests = current.reduce((sum, booking) => sum + (booking.guest_count || 1), 0);
    return { activeUnits, current, currentGuests, checkIns, checkOuts, cleaningItems, pendingCleaningCount };
  }, [bookings, commonCleanings, units]);

  const conflicts = useMemo(() => {
    const today = todayKey();
    const found: Array<[ShortStayBooking, ShortStayBooking]> = [];
    units.forEach((unit) => {
      const unitBookings = (bookingsByUnit.get(unit.id) || [])
        .filter(booking => booking.booking_type === 'booking')
        .sort((a, b) => a.start_date.localeCompare(b.start_date));
      unitBookings.forEach((booking, index) => {
        unitBookings.slice(index + 1).forEach((other) => {
          const overlapEnds = booking.end_date < other.end_date ? booking.end_date : other.end_date;
          if (overlapEnds >= today && rangeOverlaps(booking.start_date, booking.end_date, other.start_date, other.end_date)) {
            found.push([booking, other]);
          }
        });
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

  useEffect(() => {
    if (!organisationId || !isAdmin) return;
    supabase.from('vihem_companies').select('*').eq('organisation_id', organisationId).eq('active', true).order('name')
      .then(({ data }) => setFinanceCompanies((data || []) as FinanceCompany[]));
  }, [organisationId, isAdmin]);

  async function fetchData() {
    if (!organisationId) return;
    setLoading(true);
    setError('');

    const [unitsRes, bookingsRes, commonCleaningsRes, rulesRes, propertiesRes, apartmentsRes] = await Promise.all([
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
        .from('vihem_short_stay_common_cleanings')
        .select('*')
        .eq('organisation_id', organisationId)
        .gte('due_date', toDateKey(addDays(new Date(), -30)))
        .order('due_date'),
      supabase
        .from('vihem_short_stay_common_cleaning_rules')
        .select('*')
        .eq('organisation_id', organisationId)
        .order('title'),
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
      setCommonCleanings(commonCleaningsRes.error && isMissingSchemaError(commonCleaningsRes.error)
        ? []
        : (commonCleaningsRes.data || []) as CommonCleaning[]);
      setCommonCleaningRules(rulesRes.error && isMissingSchemaError(rulesRes.error)
        ? []
        : (rulesRes.data || []) as CommonCleaningRule[]);
      setProperties((propertiesRes.data || []) as Property[]);
      setApartments((apartmentsRes.data || []) as Apartment[]);
      if (commonCleaningsRes.error && !isMissingSchemaError(commonCleaningsRes.error)) {
        setError(commonCleaningsRes.error.message || 'Kunde inte ladda gemensamma städytor.');
      }
      if (rulesRes.error && !isMissingSchemaError(rulesRes.error)) {
        setError(rulesRes.error.message || 'Kunde inte ladda städregler.');
      }
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
      receipt_vat_rate: String(unit.receipt_vat_rate ?? 12),
      receipt_vat_exempt: Boolean(unit.receipt_vat_exempt),
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

  function openCreateCommonCleaning() {
    setCommonCleaningForm({
      ...defaultCommonCleaningForm,
      required_unit_ids: [],
    });
    setFormError('');
    setCommonCleaningModalOpen(true);
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
      total_price: booking.total_price ? String(booking.total_price) : '',
      paid_amount: booking.paid_amount ? String(booking.paid_amount) : '',
      currency: booking.currency || 'SEK',
      payment_status: booking.payment_status,
      cleaning_status: booking.cleaning_status,
      notes: booking.notes || '',
    });
    setFormError('');
    setBookingModalOpen(true);
  }

  function openConflictInCalendar(booking: ShortStayBooking) {
    setCalendarStartDate(new Date(`${booking.start_date}T12:00:00`));
    setTab('calendar');
    setConflictsModalOpen(false);
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
      receipt_vat_rate: Math.max(parseMoneyInput(unitForm.receipt_vat_rate), 0),
      receipt_vat_exempt: unitForm.receipt_vat_exempt,
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
    const totalPrice = parseMoneyInput(bookingForm.total_price);
    const paidAmount = parseMoneyInput(bookingForm.paid_amount);
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
      total_price: bookingForm.booking_type === 'booking' ? totalPrice : 0,
      paid_amount: bookingForm.booking_type === 'booking' ? paidAmount : 0,
      balance_due: bookingForm.booking_type === 'booking' ? Math.max(totalPrice - paidAmount, 0) : 0,
      currency: (bookingForm.currency.trim() || 'SEK').toUpperCase(),
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
    if (organisationId) {
      await supabase.rpc('vihem_generate_short_stay_common_cleanings', {
        p_organisation_id: organisationId,
        p_from: toDateKey(addDays(new Date(), -3)),
        p_to: toDateKey(addDays(new Date(), 370)),
      });
    }
    await fetchData();
  }

  async function saveCommonCleaning() {
    if (!organisationId || !user) return;
    setFormError('');
    if (!commonCleaningForm.title.trim()) {
      setFormError('Ange namn på den gemensamma ytan.');
      return;
    }
    if (commonCleaningForm.required_unit_ids.length === 0) {
      setFormError('Välj minst ett rum/lägenhet som villkor.');
      return;
    }
    if (commonCleaningForm.weekdays.length === 0) {
      setFormError('Välj minst en veckodag.');
      return;
    }

    setSaving(true);
    const { error: insertError } = await supabase
      .from('vihem_short_stay_common_cleaning_rules')
      .insert({
        organisation_id: organisationId,
        title: commonCleaningForm.title.trim(),
        description: commonCleaningForm.description.trim(),
        required_unit_ids: commonCleaningForm.required_unit_ids,
        weekdays: commonCleaningForm.weekdays,
        active: true,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      });
    setSaving(false);

    if (insertError) {
      setFormError(isMissingSchemaError(insertError)
        ? 'Databasen behöver uppdateras med senaste migrationen innan gemensamma städytor kan skapas.'
        : insertError.message);
      return;
    }

    setCommonCleaningModalOpen(false);
    await supabase.rpc('vihem_generate_short_stay_common_cleanings', {
      p_organisation_id: organisationId,
      p_from: toDateKey(addDays(new Date(), -3)),
      p_to: toDateKey(addDays(new Date(), 370)),
    });
    await fetchData();
  }

  async function toggleBookingCleaning(booking: ShortStayBooking) {
    if (!user || updatingCleaningId) return;
    setError('');
    setUpdatingCleaningId(`booking-${booking.id}`);
    const nextStatus: ShortStayCleaningStatus = booking.cleaning_status === 'clean' ? 'dirty' : 'clean';
    try {
      const { error: updateError } = await supabase
        .from('vihem_short_stay_bookings')
        .update({
          cleaning_status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking.id);

      if (updateError) throw updateError;

      setBookings((current) => current.map((item) => (
        item.id === booking.id ? { ...item, cleaning_status: nextStatus } : item
      )));
      await fetchData();
    } catch (err: any) {
      console.error('Error updating cleaning order:', err);
      setError(err.message || 'Kunde inte ändra städstatus.');
    } finally {
      setUpdatingCleaningId(null);
    }
  }

  async function toggleCommonCleaning(cleaning: CommonCleaning) {
    if (!user || updatingCleaningId) return;
    setError('');
    setUpdatingCleaningId(`common-${cleaning.id}`);
    const nextStatus: ShortStayCleaningStatus = cleaning.cleaning_status === 'clean' ? 'dirty' : 'clean';
    try {
      const { error: updateError } = await supabase
        .from('vihem_short_stay_common_cleanings')
        .update({
          cleaning_status: nextStatus,
          completed_by: nextStatus === 'clean' ? user.id : null,
          completed_at: nextStatus === 'clean' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', cleaning.id);

      if (updateError) throw updateError;

      setCommonCleanings((current) => current.map((item) => (
        item.id === cleaning.id
          ? { ...item, cleaning_status: nextStatus, completed_by: nextStatus === 'clean' ? user.id : null, completed_at: nextStatus === 'clean' ? new Date().toISOString() : null }
          : item
      )));
      await fetchData();
    } catch (err: any) {
      console.error('Error updating common cleaning:', err);
      setError(isMissingSchemaError(err)
        ? 'Databasen behöver uppdateras med senaste migrationen innan gemensamma städytor kan användas.'
        : err.message || 'Kunde inte ändra städstatus.');
    } finally {
      setUpdatingCleaningId(null);
    }
  }

  function openReceiptEditor(booking: ShortStayBooking) {
    const existingLines = Array.isArray(booking.receipt_lines) && booking.receipt_lines.length > 0
      ? booking.receipt_lines
      : [{ description: `Boende · ${units.find(unit => unit.id === booking.unit_id)?.name || 'Korttidsboende'}`, amount: Number(booking.total_price || 0) }];
    setReceiptForm({
      booking_id: booking.id,
      company_id: booking.receipt_company_id || financeCompanies[0]?.id || '',
      title: booking.receipt_title || 'Kvitto',
      vat_rate: String(booking.receipt_vat_rate ?? units.find(unit => unit.id === booking.unit_id)?.receipt_vat_rate ?? 12),
      vat_exempt: Boolean(booking.receipt_vat_exempt ?? units.find(unit => unit.id === booking.unit_id)?.receipt_vat_exempt),
      commission_rate: String(booking.platform_commission_rate ?? 0),
      commission_amount: String(booking.platform_commission_amount ?? 0),
      lines: existingLines.map(line => ({ id: crypto.randomUUID(), description: line.description, amount: String(line.amount ?? 0) })),
    });
    setFormError('');
    setReceiptModalOpen(true);
  }

  async function saveReceiptConfiguration() {
    const booking = bookings.find(item => item.id === receiptForm.booking_id);
    if (!booking || !organisationId) return;
    const lines = receiptForm.lines
      .map(line => ({ id: line.id, description: line.description.trim(), amount: parseMoneyInput(line.amount, true) }))
      .filter(line => line.description);
    if (lines.length === 0) {
      setFormError('Lägg till minst en kvittorad.');
      return;
    }
    const total = Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
    if (total <= 0) {
      setFormError('Kvittots total måste vara större än 0 kr. Negativa rader kan användas som avdrag.');
      return;
    }
    const commissionRate = Math.max(parseMoneyInput(receiptForm.commission_rate), 0);
    const commissionAmount = Math.min(Math.max(parseMoneyInput(receiptForm.commission_amount), 0), total);
    setSaving(true);
    const { error: updateError } = await supabase
      .from('vihem_short_stay_bookings')
      .update({
        receipt_company_id: receiptForm.company_id || null,
        receipt_title: receiptForm.title.trim() || 'Kvitto',
        receipt_lines: lines,
        receipt_vat_rate: Math.max(parseMoneyInput(receiptForm.vat_rate), 0),
        receipt_vat_exempt: receiptForm.vat_exempt,
        platform_commission_rate: commissionRate,
        platform_commission_amount: commissionAmount,
        platform_settlement_amount: Math.max(total - commissionAmount, 0),
        total_price: total,
        balance_due: Math.max(total - Number(booking.paid_amount || 0), 0),
        price_breakdown: { ...(booking.price_breakdown || {}), receipt_lines: lines, commission_amount: commissionAmount },
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking.id);
    if (!updateError) {
      await supabase.rpc('vihem_upsert_short_stay_settlement', { target_booking_id: booking.id, target_company_id: receiptForm.company_id || null });
      setReceiptModalOpen(false);
      await fetchData();
    }
    setSaving(false);
    if (updateError) setFormError(updateError.message);
  }

  function printReceipt(booking: ShortStayBooking) {
    const unit = units.find(u => u.id === booking.unit_id);
    const currency = booking.currency || 'SEK';
    const configuredLines = Array.isArray(booking.receipt_lines) && booking.receipt_lines.length > 0
      ? booking.receipt_lines
      : [{ description: `Boende · ${unit?.name || 'Korttidsboende'}`, amount: Number(booking.total_price || 0) }];
    const total = configuredLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const vatRate = booking.receipt_vat_exempt ? 0 : Number(booking.receipt_vat_rate ?? 12);
    const subtotal = vatRate === 0 ? total : Math.round((total / (1 + vatRate / 100)) * 100) / 100;
    const vat = Math.round((total - subtotal) * 100) / 100;
    const paid = Number(booking.paid_amount || 0);
    const due = Number(booking.balance_due ?? Math.max(total - paid, 0));
    const receiptWindow = window.open('', '_blank');
    if (!receiptWindow) {
      setError('Kunde inte öppna kvittot. Tillåt popup-fönster och försök igen.');
      return;
    }

    receiptWindow.document.write(`<!doctype html>
      <html lang="sv">
        <head>
          <meta charset="utf-8" />
          <title>Kvitto ${escapeHtml(booking.guest_name || booking.title)}</title>
          <style>
            body { margin: 0; padding: 32px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0f172a; background: #f8fafc; }
            main { max-width: 720px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 18px; background: #fff; padding: 32px; }
            header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 22px; }
            h1 { margin: 0; font-size: 28px; }
            h2 { margin: 26px 0 10px; font-size: 16px; }
            p { margin: 4px 0; color: #475569; }
            table { width: 100%; border-collapse: collapse; margin-top: 14px; }
            th, td { border-bottom: 1px solid #e2e8f0; padding: 12px 0; text-align: left; }
            th:last-child, td:last-child { text-align: right; }
            .total td { border-bottom: 0; font-size: 18px; font-weight: 800; color: #0f172a; }
            .muted { color: #64748b; font-size: 13px; }
            .print { margin: 0 auto 16px; display: block; border: 0; border-radius: 999px; background: #2563eb; color: white; padding: 12px 20px; font-weight: 700; }
            @media print { body { background: #fff; padding: 0; } main { border: 0; border-radius: 0; } .print { display: none; } }
          </style>
        </head>
        <body>
          <button class="print" onclick="window.print()">Skriv ut / spara som PDF</button>
          <main>
            <header>
              <div>
                <h1>${escapeHtml(booking.receipt_title || 'Kvitto')}</h1>
                <p>${escapeHtml(financeCompanies.find(company => company.id === booking.receipt_company_id)?.legal_name || financeCompanies.find(company => company.id === booking.receipt_company_id)?.name || 'VI-HEM korttidsuthyrning')}</p>
                ${financeCompanies.find(company => company.id === booking.receipt_company_id)?.organisation_number ? `<p>Org.nr ${escapeHtml(financeCompanies.find(company => company.id === booking.receipt_company_id)?.organisation_number || '')}</p>` : ''}
              </div>
              <div>
                <p><strong>Datum:</strong> ${escapeHtml(new Date().toLocaleDateString('sv-SE'))}</p>
                <p><strong>Bokning:</strong> ${escapeHtml(booking.beds24_booking_id || booking.external_uid || booking.id)}</p>
              </div>
            </header>
            <h2>Kund</h2>
            <p>${escapeHtml(booking.guest_name || booking.title || 'Gäst')}</p>
            ${booking.guest_email ? `<p>${escapeHtml(booking.guest_email)}</p>` : ''}
            ${booking.guest_phone ? `<p>${escapeHtml(booking.guest_phone)}</p>` : ''}
            <h2>Bokning</h2>
            <p><strong>${escapeHtml(unit?.name || 'Enhet')}</strong></p>
            <p>${escapeHtml(formatDateRange(booking.start_date, booking.end_date))}</p>
            <p>${escapeHtml(booking.guest_count || 1)} gäster · ${escapeHtml(booking.channel_name || 'VI-HEM')}</p>
            <table>
              <thead><tr><th>Rad</th><th>Belopp</th></tr></thead>
              <tbody>
                ${configuredLines.map(line => `<tr><td>${escapeHtml(line.description)}</td><td>${escapeHtml(formatMoney(Number(line.amount || 0), currency))}</td></tr>`).join('')}
                <tr><td>Exkl. moms</td><td>${escapeHtml(formatMoney(subtotal, currency))}</td></tr>
                <tr><td>Moms (${vatRate}%)</td><td>${escapeHtml(formatMoney(vat, currency))}</td></tr>
                <tr><td>Betalt</td><td>${escapeHtml(formatMoney(paid, currency))}</td></tr>
                <tr class="total"><td>Kvar att betala</td><td>${escapeHtml(formatMoney(due, currency))}</td></tr>
              </tbody>
            </table>
            <p class="muted">Kvitto skapat från bokningsuppgifter i VI-HEM. Kontrollera moms- och bolagsuppgifter innan kvittot används externt.</p>
          </main>
        </body>
      </html>`);
    receiptWindow.document.close();
    receiptWindow.focus();
  }

  async function createFinanceReceipt(booking: ShortStayBooking) {
    if (!isAdmin) {
      setError('Endast admin kan skapa ekonomiskt kvitto.');
      return;
    }

    setCreatingReceiptId(booking.id);
    setReceiptMessage('');
    setError('');

    const { data, error: receiptError } = await supabase.rpc('vihem_create_invoice_from_short_stay_booking', {
      target_booking_id: booking.id,
      target_company_id: booking.receipt_company_id || null,
      target_customer_id: null,
      approve_invoice: booking.payment_status === 'paid',
    });

    setCreatingReceiptId(null);

    if (receiptError) {
      setError(receiptError.message || 'Kunde inte skapa ekonomiskt kvitto.');
      return;
    }

    const invoice = Array.isArray(data) ? data[0] : data;
    setReceiptMessage(`Kvitto/faktura skapad${invoice?.invoice_number ? `: ${invoice.invoice_number}` : ''}.`);
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
          ['cleaning', 'Städning'],
          ['bookings', 'Bokningar'],
          ['receipts', 'Kvitton'],
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
              <p className="mt-1 text-2xl font-bold text-rose-700">{stats.pendingCleaningCount}</p>
            </Card>
          </div>

          {conflicts.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 w-4 h-4 flex-shrink-0" />
                  <div>
                    <p className="font-semibold">Möjlig dubbelbokning hittad</p>
                    <p>{conflicts.length} potentiella krockar behöver kontrolleras i kalendern.</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-amber-300 bg-white text-amber-900 hover:border-amber-400"
                  onClick={() => setConflictsModalOpen(true)}
                >
                  Visa krockar
                </Button>
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
                          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                            <ShortStayChannelBadge booking={booking} />
                            <Badge className={isCheckOut ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}>
                              {isCheckOut ? 'Check-out' : 'Check-in'}
                            </Badge>
                          </div>
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
              {commonCleaningRules.length > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aktiva städregler</p>
                  <div className="mt-2 grid gap-2">
                    {commonCleaningRules.map(rule => (
                      <div key={rule.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                        <p className="font-medium text-slate-800">{rule.title}</p>
                        <p className="text-xs text-slate-500">{rule.required_unit_ids.length} valda rum · {rule.weekdays.map(day => weekdayOptions.find(option => option.value === day)?.label.slice(0, 3)).join(', ')}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-semibold text-slate-900">Städstatus</h2>
                {isAdmin && (
                  <Button size="sm" variant="secondary" onClick={openCreateCommonCleaning}>
                    <Plus className="w-4 h-4" /> Gemensam yta
                  </Button>
                )}
              </div>
              <div className="grid gap-3">
                {stats.cleaningItems.length === 0 ? (
                  <p className="text-sm text-slate-500">Inget väntar på städning.</p>
                ) : (
                  stats.cleaningItems.slice(0, 8).map((item) => (
                    <SwipeableCleaningCard
                      key={`${item.kind}-${item.id}`}
                      item={item}
                      disabled={updatingCleaningId === `${item.kind}-${item.id}`}
                      onOpen={() => item.kind === 'booking' ? openEditBooking(item.booking) : undefined}
                      onToggle={() => item.kind === 'booking' ? toggleBookingCleaning(item.booking) : toggleCommonCleaning(item.cleaning)}
                    />
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      ) : tab === 'cleaning' ? (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Städning</h2>
                <p className="text-sm text-slate-500">Klara städningar ligger kvar och kan svepas tillbaka till ostädade.</p>
              </div>
              {isAdmin && (
                <Button onClick={openCreateCommonCleaning}>
                  <Plus className="w-4 h-4" /> Gemensam yta
                </Button>
              )}
            </div>
            {commonCleaningRules.length > 0 && (
              <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                <p className="font-semibold">Automatiska regler</p>
                <p className="mt-1 text-xs text-blue-800">{commonCleaningRules.length} regel/regler skapar städning när valda rum är bebodda.</p>
              </div>
            )}
          </Card>
          <div className="grid gap-3">
            {stats.cleaningItems.length === 0 ? (
              <Card className="p-8">
                <EmptyState icon={<CheckCircle2 className="w-12 h-12" />} title="Ingen städning att visa" />
              </Card>
            ) : (
              stats.cleaningItems.map((item) => (
                <SwipeableCleaningCard
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  disabled={updatingCleaningId === `${item.kind}-${item.id}`}
                  onOpen={() => item.kind === 'booking' ? openEditBooking(item.booking) : undefined}
                  onToggle={() => item.kind === 'booking' ? toggleBookingCleaning(item.booking) : toggleCommonCleaning(item.cleaning)}
                />
              ))
            )}
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
                <div className="sticky left-0 z-40 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 shadow-[8px_0_12px_-12px_rgba(15,23,42,0.45)]">Rum/lägenhet</div>
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
                    <div className="sticky left-0 z-40 bg-white px-4 py-3 shadow-[8px_0_12px_-12px_rgba(15,23,42,0.45)]">
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
                        const channel = getShortStayChannelMeta(booking.channel_name);
                        return (
                          <button
                            key={booking.id}
                            type="button"
                            onClick={() => openEditBooking(booking)}
                            title={`${booking.guest_name || booking.title || booking.channel_name} (${formatDateRange(booking.start_date, booking.end_date)})`}
                            className={`absolute top-2 z-10 flex h-7 min-w-0 items-center gap-1 rounded-lg px-1.5 text-left text-[10px] font-semibold text-white shadow-sm transition hover:brightness-95 sm:h-8 sm:gap-2 sm:px-2 sm:text-[11px] ${
                              isBlock ? 'bg-slate-700' : channel.bandClass
                            }`}
                            style={style}
                          >
                            {booking.booking_type === 'booking' && (
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/20 text-[9px] font-black">
                                {channel.shortLabel}
                              </span>
                            )}
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
                            <div className="relative z-10 flex flex-wrap items-center gap-1 overflow-hidden">
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
                      {booking.booking_type === 'booking' && <ShortStayChannelBadge booking={booking} />}
                      {Number(booking.total_price || 0) > 0 && (
                        <Badge className="bg-emerald-100 text-emerald-700">
                          {formatMoney(booking.total_price, booking.currency)}
                        </Badge>
                      )}
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
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ) : tab === 'receipts' ? (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Kvitton</h2>
                <p className="text-sm text-slate-500">Skapa utskriftsvänliga kvitton eller riktiga ekonomiunderlag från korttidsbokningar.</p>
              </div>
              <ReceiptText className="h-8 w-8 text-blue-600" />
            </div>
            {receiptMessage && (
              <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                {receiptMessage}
              </p>
            )}
          </Card>
          <div className="grid gap-3">
            {bookings.filter(booking => booking.booking_type === 'booking').length === 0 ? (
              <Card className="p-8">
                <EmptyState icon={<ReceiptText className="w-12 h-12" />} title="Inga bokningar att skapa kvitto för" />
              </Card>
            ) : bookings
              .filter(booking => booking.booking_type === 'booking')
              .sort((a, b) => b.start_date.localeCompare(a.start_date))
              .map((booking) => {
                const unit = units.find(u => u.id === booking.unit_id);
                const total = Number(booking.total_price || 0);
                const paid = Number(booking.paid_amount || 0);
                const due = Number(booking.balance_due ?? Math.max(total - paid, 0));
                return (
                  <Card key={booking.id} className="p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">{booking.guest_name || booking.title}</p>
                          <ShortStayChannelBadge booking={booking} />
                          <Badge className={due > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}>
                            {due > 0 ? `${formatMoney(due, booking.currency)} kvar` : 'Betald'}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{unit?.name} · {formatDateRange(booking.start_date, booking.end_date)}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Totalt {formatMoney(total, booking.currency)} · betalt {formatMoney(paid, booking.currency)}
                        </p>
                        {(Number(booking.platform_commission_amount || 0) > 0 || booking.receipt_vat_exempt || booking.receipt_vat_rate !== undefined) && (
                          <p className="mt-1 text-xs text-slate-500">
                            Moms {booking.receipt_vat_exempt ? 'momsfritt' : `${booking.receipt_vat_rate ?? 12}%`}
                            {Number(booking.platform_commission_amount || 0) > 0 ? ` · provision ${formatMoney(Number(booking.platform_commission_amount), booking.currency)} · netto ${formatMoney(Math.max(total - Number(booking.platform_commission_amount), 0), booking.currency)}` : ''}
                          </p>
                        )}
                        {booking.finance_invoice_id && (
                          <p className="mt-1 text-xs font-semibold text-emerald-700">Kopplad till ekonomifaktura</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => openReceiptEditor(booking)}>
                          <Edit2 className="w-4 h-4" /> Anpassa kvitto
                        </Button>
                        {isAdmin && (
                          booking.finance_invoice_id ? (
                            <Button variant="secondary" onClick={() => onNavigate('finance')}>
                              <ReceiptText className="w-4 h-4" /> Öppna ekonomi
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              onClick={() => createFinanceReceipt(booking)}
                              loading={creatingReceiptId === booking.id}
                              disabled={total <= 0}
                            >
                              <ReceiptText className="w-4 h-4" /> Skapa i ekonomi
                            </Button>
                          )
                        )}
                        <Button onClick={() => printReceipt(booking)} disabled={total <= 0}>
                          <Printer className="w-4 h-4" /> Skapa kvitto
                        </Button>
                      </div>
                    </div>
                    {total <= 0 && (
                      <p className="mt-3 text-sm text-amber-700">Lägg in pris på bokningen innan kvitto skapas.</p>
                    )}
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

      <Modal open={conflictsModalOpen} onClose={() => setConflictsModalOpen(false)} title="Potentiella dubbelbokningar" size="xl">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Kontrollera bokningarna nedan. Varje rad visar två bokningar på samma enhet där datumen överlappar.
          </p>
          {conflicts.length === 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              Inga datumkrockar hittades just nu.
            </div>
          ) : (
            <div className="space-y-3">
              {conflicts.map(([first, second], index) => {
                const unit = units.find(item => item.id === first.unit_id) || units.find(item => item.id === second.unit_id);
                return (
                  <div key={`${first.id}-${second.id}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">{unit?.name || 'Okänd enhet'}</p>
                        <p className="mt-0.5 text-xs text-amber-800">
                          Överlapp: {overlapDateRange(first, second)}
                        </p>
                      </div>
                      <Button variant="secondary" size="sm" onClick={() => openConflictInCalendar(first)}>
                        <CalendarDays className="h-4 w-4" /> Visa i kalender
                      </Button>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {[first, second].map((booking) => (
                        <div key={booking.id} className="rounded-lg border border-white/80 bg-white p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-slate-900">
                                {booking.guest_name || booking.title || 'Bokning utan namn'}
                              </p>
                              <p className="mt-1 text-sm text-slate-600">{formatDateRange(booking.start_date, booking.end_date)}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                {booking.guest_count || 1} gäster
                                {booking.arrival_time ? ` · in ${booking.arrival_time.slice(0, 5)}` : ''}
                                {booking.departure_time ? ` · ut ${booking.departure_time.slice(0, 5)}` : ''}
                              </p>
                            </div>
                            <ShortStayChannelBadge booking={booking} />
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setConflictsModalOpen(false);
                                openEditBooking(booking);
                              }}
                            >
                              Öppna bokning
                            </Button>
                            {(booking.external_uid || booking.beds24_booking_id) && (
                              <Badge className="bg-slate-100 text-slate-600">
                                ID {booking.external_uid || booking.beds24_booking_id}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Standardmoms på kvitto (%)" type="number" min={0} step={0.01} value={unitForm.receipt_vat_rate} disabled={unitForm.receipt_vat_exempt} onChange={e => setUnitForm({ ...unitForm, receipt_vat_rate: e.target.value })} />
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
              <input type="checkbox" checked={unitForm.receipt_vat_exempt} onChange={e => setUnitForm({ ...unitForm, receipt_vat_exempt: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
              Standard är momsfritt
            </label>
          </div>
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

      <Modal open={receiptModalOpen} onClose={() => setReceiptModalOpen(false)} title="Anpassa korttidskvitto" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Rubrik på kvittot" value={receiptForm.title} onChange={event => setReceiptForm(prev => ({ ...prev, title: event.target.value }))} />
            <Select
              label="Utfärdande bolag"
              value={receiptForm.company_id}
              options={financeCompanies.map(company => ({ value: company.id, label: `${company.name}${company.organisation_number ? ` · ${company.organisation_number}` : ''}` }))}
              onChange={event => setReceiptForm(prev => ({ ...prev, company_id: event.target.value }))}
            />
            <Input label="Moms %" type="number" min={0} step={0.01} value={receiptForm.vat_rate} disabled={receiptForm.vat_exempt} onChange={event => setReceiptForm(prev => ({ ...prev, vat_rate: event.target.value }))} />
            <Input label="Plattformsprovision" inputMode="decimal" value={receiptForm.commission_amount} onChange={event => setReceiptForm(prev => ({ ...prev, commission_amount: event.target.value }))} placeholder="0" />
          </div>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={receiptForm.vat_exempt} onChange={event => setReceiptForm(prev => ({ ...prev, vat_exempt: event.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
              Momsfritt
            </label>
            <label className="flex items-center gap-2">
              Provisionen är avdragen av bokningskanalen
              <input
                type="number"
                min={0}
                step={0.01}
                value={receiptForm.commission_rate}
                onChange={event => {
                  const rate = Math.max(parseMoneyInput(event.target.value), 0);
                  const gross = receiptForm.lines.reduce((sum, line) => sum + parseMoneyInput(line.amount), 0);
                  setReceiptForm(prev => ({ ...prev, commission_rate: event.target.value, commission_amount: String(Math.round(gross * rate) / 100) }));
                }}
                className="w-20 rounded-lg border border-slate-300 px-2 py-1"
              /> %
            </label>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Kvittorader</p>
                <p className="text-xs text-slate-500">Beloppen anges inklusive moms. Negativa belopp kan användas för rabatt, avdrag eller provision.</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setReceiptForm(prev => ({ ...prev, lines: [...prev.lines, { id: crypto.randomUUID(), description: '', amount: '0' }] }))}>
                <Plus className="h-4 w-4" /> Lägg till rad
              </Button>
            </div>
            <div className="space-y-2">
              {receiptForm.lines.map((line, index) => (
                <div key={line.id} className="grid grid-cols-[1fr_110px_auto] items-end gap-2">
                  <Input label={index === 0 ? 'Text' : undefined} value={line.description} onChange={event => setReceiptForm(prev => ({ ...prev, lines: prev.lines.map(item => item.id === line.id ? { ...item, description: event.target.value } : item) }))} placeholder="T.ex. boende, städning, extra säng" />
                  <Input label={index === 0 ? 'Belopp' : undefined} inputMode="decimal" value={line.amount} onChange={event => setReceiptForm(prev => ({ ...prev, lines: prev.lines.map(item => item.id === line.id ? { ...item, amount: event.target.value } : item) }))} />
                  <Button size="sm" variant="ghost" onClick={() => setReceiptForm(prev => ({ ...prev, lines: prev.lines.filter(item => item.id !== line.id) }))} aria-label="Ta bort kvittorad">×</Button>
                </div>
              ))}
            </div>
          </div>
          {formError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{formError}</div>}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setReceiptModalOpen(false)}>Avbryt</Button>
            <Button onClick={saveReceiptConfiguration} loading={saving}>Spara kvittoinställningar</Button>
          </div>
        </div>
      </Modal>

      <Modal open={commonCleaningModalOpen} onClose={() => setCommonCleaningModalOpen(false)} title="Automatisk städning av gemensam yta" size="lg">
        <div className="space-y-4">
          <Input
            label="Gemensam yta"
            value={commonCleaningForm.title}
            onChange={e => setCommonCleaningForm({ ...commonCleaningForm, title: e.target.value })}
            placeholder="T.ex. kök, korridor, badrum"
          />
          <Textarea
            label="Instruktion"
            rows={3}
            value={commonCleaningForm.description}
            onChange={e => setCommonCleaningForm({ ...commonCleaningForm, description: e.target.value })}
            placeholder="Vad ska kontrolleras eller städas?"
          />
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-900">Dagar då villkoret gäller</p>
            <p className="mt-1 text-xs text-slate-500">En städning skapas automatiskt varje vald dag när minst ett valt rum har en aktiv gäst.</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {weekdayOptions.map(day => {
                const checked = commonCleaningForm.weekdays.includes(day.value);
                return (
                  <label key={day.value} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={event => setCommonCleaningForm(current => ({
                        ...current,
                        weekdays: event.target.checked
                          ? [...current.weekdays, day.value].sort((a, b) => a - b)
                          : current.weekdays.filter(value => value !== day.value),
                      }))}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {day.label}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-900">Rum/lägenheter som ingår i villkoret</p>
            <p className="mt-1 text-xs text-slate-500">Välj de rum eller lägenheter som ska omfattas för att städningen ska vara uppfylld.</p>
            <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
              {units.map(unit => {
                const checked = commonCleaningForm.required_unit_ids.includes(unit.id);
                return (
                  <label key={unit.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setCommonCleaningForm(current => ({
                          ...current,
                          required_unit_ids: event.target.checked
                            ? [...current.required_unit_ids, unit.id]
                            : current.required_unit_ids.filter(id => id !== unit.id),
                        }));
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-medium text-slate-900">{unit.name}</span>
                      <span className="block text-xs text-slate-500">{unit.property?.name || 'Ingen fastighet'}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          {formError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{formError}</div>}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setCommonCleaningModalOpen(false)}>Avbryt</Button>
            <Button onClick={saveCommonCleaning} loading={saving}>
              <ClipboardCheck className="w-4 h-4" /> Spara automatisk regel
            </Button>
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
          {bookingForm.booking_type === 'booking' && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="mb-3 text-sm font-semibold text-slate-800">Pris och kvitto</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  label="Totalpris"
                  inputMode="decimal"
                  value={bookingForm.total_price}
                  onChange={e => setBookingForm({ ...bookingForm, total_price: e.target.value })}
                  placeholder="0"
                />
                <Input
                  label="Betalt"
                  inputMode="decimal"
                  value={bookingForm.paid_amount}
                  onChange={e => setBookingForm({ ...bookingForm, paid_amount: e.target.value })}
                  placeholder="0"
                />
                <Input
                  label="Valuta"
                  value={bookingForm.currency}
                  onChange={e => setBookingForm({ ...bookingForm, currency: e.target.value.toUpperCase() })}
                  placeholder="SEK"
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Kvar att betala: {formatMoney(Math.max(parseMoneyInput(bookingForm.total_price) - parseMoneyInput(bookingForm.paid_amount), 0), bookingForm.currency || 'SEK')}
              </p>
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
