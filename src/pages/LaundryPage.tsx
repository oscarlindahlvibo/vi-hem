import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Card,
  Badge,
  Button,
  Input,
  Modal,
  PageHeader,
  EmptyState,
  LoadingPage,
  Select,
  Textarea,
} from '../components/ui';
import { formatDate } from '../lib/utils';
import type { LaundryRoom, LaundrySlot, LaundryBooking, Property } from '../types';
import {
  WashingMachine,
  Calendar,
  Clock,
  CheckCircle,
  X,
  ChevronLeft,
  ChevronRight,
  Plus,
} from 'lucide-react';

interface SlotWithBooking extends Omit<LaundrySlot, 'booking'> {
  booking?: LaundryBooking | null;
  isTaken?: boolean;
  isPast?: boolean;
}

interface MyBooking extends Omit<LaundryBooking, 'slot'> {
  slot?: {
    date: string;
    start_time: string;
    end_time: string;
    laundry_room?: LaundryRoom;
  };
}

const SLOT_TIMES = [
  { start: '07:00', end: '10:00' },
  { start: '10:00', end: '13:00' },
  { start: '13:00', end: '16:00' },
  { start: '16:00', end: '19:00' },
  { start: '19:00', end: '22:00' },
];

const INITIAL_LAUNDRY_ROOM_FORM = {
  property_id: '',
  name: '',
  description: '',
  max_bookings_per_tenant: '3',
  weeks_to_generate: '8',
};

const getTodayWeekdayIndex = () => {
  const today = new Date().getDay();
  return today === 0 ? 6 : today - 1;
};

export function LaundryPage({ onNavigate: _onNavigate }: { onNavigate: (page: string) => void }) {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<LaundryRoom[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [slots, setSlots] = useState<SlotWithBooking[]>([]);
  const [myBookings, setMyBookings] = useState<MyBooking[]>([]);
  const [createRoomModalOpen, setCreateRoomModalOpen] = useState(false);
  const [createRoomLoading, setCreateRoomLoading] = useState(false);
  const [createRoomForm, setCreateRoomForm] = useState(INITIAL_LAUNDRY_ROOM_FORM);
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    slot: SlotWithBooking | null;
    day: string;
  }>({ open: false, slot: null, day: '' });
  const [bookingModalError, setBookingModalError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [bookingInProgress, setBookingInProgress] = useState(false);
  const [cancellingBookingId, setCancellingBookingId] = useState('');
  const [mobileViewDay, setMobileViewDay] = useState(() => getTodayWeekdayIndex());
  const canViewAllLaundryRooms = user?.role === 'staff' || user?.role === 'admin' || user?.role === 'superadmin';
  const canManageLaundryRooms = user?.role === 'admin' || user?.role === 'superadmin';

  // Get week range for current offset
  const getWeekRange = (offset: number) => {
    const now = new Date();
    const mondayIndex = (now.getDay() + 6) % 7;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(now.getDate() - mondayIndex + offset * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6); // Sunday
    return { start, end };
  };

  const { start: weekStart, end: weekEnd } = getWeekRange(weekOffset);

  // Get days of the week
  const getWeekDays = () => {
    const days = [];
    const current = new Date(weekStart);
    for (let i = 0; i < 7; i++) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return days;
  };

  const weekDays = getWeekDays();

  const formatDateString = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const addDays = (date: Date, days: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };

  // Fetch laundry rooms
  useEffect(() => {
    if (authLoading || !user) return;

    const fetchRooms = async () => {
      try {
        let query = supabase
          .from('laundry_rooms')
          .select('*')
          .eq('active', true)
          .order('name');

        if (!canViewAllLaundryRooms) {
          const { data: tenancies, error: tenancyErr } = await supabase
            .from('tenancies')
            .select('property_id')
            .eq('tenant_id', user.id)
            .eq('status', 'active');

          if (tenancyErr) throw tenancyErr;

          const propertyIds = [...new Set((tenancies || []).map((tenancy) => tenancy.property_id).filter(Boolean))];
          if (propertyIds.length === 0) {
            setRooms([]);
            setSelectedRoomId('');
            return;
          }

          query = query.in('property_id', propertyIds);
        }

        const { data, error: err } = await query;

        if (err) throw err;
        if (data && data.length > 0) {
          setRooms(data as LaundryRoom[]);
          setSelectedRoomId(data[0].id);
        } else {
          setRooms([]);
          setSelectedRoomId('');
        }
      } catch (e) {
        console.error('Error fetching laundry rooms:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchRooms();
  }, [authLoading, user?.id, canViewAllLaundryRooms]);

  useEffect(() => {
    if (authLoading || !user || !canManageLaundryRooms) return;

    const fetchProperties = async () => {
      const { data, error: err } = await supabase
        .from('properties')
        .select('*')
        .eq('active', true)
        .order('name');

      if (err) {
        console.error('Error fetching properties:', err);
        return;
      }

      setProperties((data || []) as Property[]);
      setCreateRoomForm((current) => ({
        ...current,
        property_id: current.property_id || data?.[0]?.id || '',
      }));
    };

    fetchProperties();
  }, [authLoading, user, canManageLaundryRooms]);

  // Fetch slots and bookings
  useEffect(() => {
    if (!selectedRoomId || !user) return;

    const fetchSlotsAndBookings = async () => {
      try {
        setLoading(true);
        const weekStartStr = formatDateString(weekStart);
        const weekEndStr = formatDateString(weekEnd);

        // Fetch slots for the week
        const { data: slotsData, error: slotsErr } = await supabase
          .from('laundry_slots')
          .select('*')
          .eq('laundry_room_id', selectedRoomId)
          .gte('date', weekStartStr)
          .lte('date', weekEndStr)
          .order('date')
          .order('start_time');

        if (slotsErr) throw slotsErr;

        // Fetch all bookings for these slots
        if (slotsData && slotsData.length > 0) {
          const slotIds = slotsData.map((s) => s.id);
          const { data: bookingsData, error: bookingsErr } = await supabase
            .from('laundry_bookings')
            .select('*')
            .in('laundry_slot_id', slotIds)
            .eq('status', 'active');

          if (bookingsErr) throw bookingsErr;

          // Merge bookings into slots
          const slotsWithBookings: SlotWithBooking[] = slotsData.map((slot) => {
            const booking = bookingsData?.find(
              (b) => b.laundry_slot_id === slot.id
            );
            const slotDate = new Date(slot.date + 'T' + slot.start_time);
            const isPast = slotDate < new Date();
            const isTaken =
              (booking && booking.tenant_id !== user.id) || slot.is_blocked;

            return {
              ...slot,
              booking: booking || null,
              isTaken,
              isPast,
            };
          });

          setSlots(slotsWithBookings);
        } else {
          setSlots([]);
        }

        // Fetch user's active bookings
        const { data: myBookingsData, error: myBookingsErr } = await supabase
          .from('laundry_bookings')
          .select(
            '*, slot:laundry_slot_id(date, start_time, end_time, laundry_room:laundry_room_id(id, name))'
          )
          .eq('tenant_id', user.id)
          .eq('status', 'active')
          .order('created_at', { ascending: false });

        if (myBookingsErr) throw myBookingsErr;
        setMyBookings(myBookingsData as MyBooking[]);
      } catch (e) {
        console.error('Error fetching slots and bookings:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchSlotsAndBookings();
  }, [selectedRoomId, user, weekOffset]);

  // Get slots for a specific day (for mobile view)
  const getSlotsForDay = (dayDate: Date) => {
    const dayStr = formatDateString(dayDate);
    return slots.filter((s) => s.date === dayStr);
  };

  // Get slot status display
  const getSlotStatus = (slot: SlotWithBooking) => {
    if (slot.isPast) return { label: 'Passerat', color: 'bg-slate-100', textColor: 'text-slate-500' };
    if (slot.is_blocked) return { label: 'Blockerad', color: 'bg-red-100', textColor: 'text-red-600' };
    if (slot.booking && slot.booking.tenant_id === user?.id)
      return { label: 'Bokad av dig', color: 'bg-blue-100', textColor: 'text-blue-600' };
    if (slot.booking) return { label: 'Upptagen', color: 'bg-slate-100', textColor: 'text-slate-500' };
    return { label: 'Ledig', color: 'bg-green-100', textColor: 'text-green-600' };
  };

  // Book a slot
  const handleBookSlot = async () => {
    if (!confirmModal.slot || !user) return;

    try {
      setBookingInProgress(true);
      setError('');
      setSuccess('');
      setBookingModalError('');

      // Check max bookings
      const room = rooms.find((r) => r.id === selectedRoomId);
      const maxBookings = room?.max_bookings_per_tenant || 3;
      const { count: activeCount, error: countErr } = await supabase
        .from('laundry_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', user.id)
        .eq('status', 'active');

      if (countErr) throw countErr;

      if ((activeCount ?? myBookings.filter((b) => b.status === 'active').length) >= maxBookings) {
        setBookingModalError(
          `Du har uppnått max antal bokningar (${maxBookings} aktiva tvättpass). Avboka en tid innan du bokar en ny.`
        );
        return;
      }

      // Check if slot is still available
      const { data: existingBooking } = await supabase
        .from('laundry_bookings')
        .select('id')
        .eq('laundry_slot_id', confirmModal.slot.id)
        .eq('status', 'active')
        .maybeSingle();

      if (existingBooking) {
        setBookingModalError('Denna tid är redan bokad. Välj en annan tid.');
        return;
      }

      // Insert booking
      const { data: bookingData, error: bookingErr } = await supabase
        .from('laundry_bookings')
        .insert({
          laundry_slot_id: confirmModal.slot.id,
          tenant_id: user.id,
          status: 'active',
        })
        .select('*')
        .single();

      if (bookingErr) throw bookingErr;

      const newBooking = bookingData as LaundryBooking;
      const bookedSlot = confirmModal.slot;
      const myBooking: MyBooking = {
        ...newBooking,
        slot: {
          date: bookedSlot.date,
          start_time: bookedSlot.start_time,
          end_time: bookedSlot.end_time,
          laundry_room: room,
        },
      };

      setSlots((current) =>
        current.map((slot) =>
          slot.id === bookedSlot.id
            ? { ...slot, booking: newBooking, isTaken: false }
            : slot
        )
      );
      setMyBookings((current) => [myBooking, ...current]);
      setSuccess('Bokning bekräftad!');
      setConfirmModal({ open: false, slot: null, day: '' });
      setTimeout(() => setSuccess(''), 2000);
    } catch (e) {
      console.error('Error booking slot:', e);
      const message = e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === '23505'
        ? 'Denna tid hann bli bokad av någon annan. Välj en annan tid.'
        : 'Något gick fel. Försök igen.';
      setBookingModalError(message);
    } finally {
      setBookingInProgress(false);
    }
  };

  // Cancel booking
  const handleCancelBooking = async (bookingId: string) => {
    if (!user) return;

    try {
      setCancellingBookingId(bookingId);

      const { error: err } = await supabase
        .from('laundry_bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId)
        .eq('tenant_id', user.id);

      if (err) throw err;

      setMyBookings((current) => current.filter((booking) => booking.id !== bookingId));
      setSlots((current) =>
        current.map((slot) =>
          slot.booking?.id === bookingId
            ? { ...slot, booking: null, isTaken: slot.is_blocked }
            : slot
        )
      );
      setSuccess('Bokning avbokad.');
      setTimeout(() => {
        setSuccess('');
      }, 1500);
    } catch (e) {
      console.error('Error cancelling booking:', e);
      setError('Kunde inte avboka. Försök igen.');
    } finally {
      setCancellingBookingId('');
    }
  };

  const handleCreateLaundryRoom = async () => {
    if (!user || !canManageLaundryRooms) return;

    const name = createRoomForm.name.trim();
    const description = createRoomForm.description.trim();
    const maxBookings = Number(createRoomForm.max_bookings_per_tenant);
    const weeksToGenerate = Number(createRoomForm.weeks_to_generate);

    if (!createRoomForm.property_id) {
      setError('Välj en fastighet först.');
      return;
    }

    if (!name) {
      setError('Ange ett namn på tvättstugan.');
      return;
    }

    if (!Number.isFinite(maxBookings) || maxBookings < 1 || maxBookings > 10) {
      setError('Max antal aktiva bokningar måste vara mellan 1 och 10.');
      return;
    }

    if (!Number.isFinite(weeksToGenerate) || weeksToGenerate < 1 || weeksToGenerate > 52) {
      setError('Antal veckor med tider måste vara mellan 1 och 52.');
      return;
    }

    try {
      setCreateRoomLoading(true);
      setError('');

      const { data: roomData, error: roomErr } = await supabase
        .from('laundry_rooms')
        .insert({
          property_id: createRoomForm.property_id,
          organisation_id: user.organisation_id,
          name,
          description,
          machines: [],
          max_bookings_per_tenant: maxBookings,
          active: true,
        })
        .select('*')
        .single();

      if (roomErr) throw roomErr;

      const today = new Date();
      const slotRows = Array.from({ length: weeksToGenerate * 7 }).flatMap((_, dayIndex) => {
        const date = formatDateString(addDays(today, dayIndex));
        return SLOT_TIMES.map((slot) => ({
          laundry_room_id: roomData.id,
          date,
          start_time: slot.start,
          end_time: slot.end,
          is_blocked: false,
        }));
      });

      const { error: slotsErr } = await supabase
        .from('laundry_slots')
        .insert(slotRows);

      if (slotsErr) throw slotsErr;

      setRooms((current) => [...current, roomData as LaundryRoom].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedRoomId(roomData.id);
      setWeekOffset(0);
      setMobileViewDay(0);
      setCreateRoomForm({
        ...INITIAL_LAUNDRY_ROOM_FORM,
        property_id: createRoomForm.property_id,
      });
      setCreateRoomModalOpen(false);
      setSuccess('Tvättstugan skapades med bokningsbara tider.');
      setTimeout(() => setSuccess(''), 2000);
    } catch (e) {
      console.error('Error creating laundry room:', e);
      setError('Kunde inte skapa tvättstugan. Kontrollera behörighet och försök igen.');
    } finally {
      setCreateRoomLoading(false);
    }
  };

  if (authLoading || loading) return <LoadingPage />;

  if (!user) return null;

  const closeConfirmModal = () => {
    setConfirmModal({ open: false, slot: null, day: '' });
    setBookingModalError('');
  };

  const createRoomAction = canManageLaundryRooms ? (
    <Button variant="primary" onClick={() => setCreateRoomModalOpen(true)}>
      <Plus className="w-4 h-4" />
      Ny tvättstuga
    </Button>
  ) : null;

  const createRoomModal = (
    <Modal
      open={createRoomModalOpen}
      onClose={() => setCreateRoomModalOpen(false)}
      title="Skapa tvättstuga"
    >
      <div className="space-y-4">
        {properties.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Du behöver skapa en fastighet i organisationen innan du kan lägga till en tvättstuga.
          </div>
        ) : (
          <>
            <Select
              label="Fastighet"
              value={createRoomForm.property_id}
              onChange={(event) =>
                setCreateRoomForm((current) => ({ ...current, property_id: event.target.value }))
              }
              options={properties.map((property) => ({
                value: property.id,
                label: `${property.name}${property.address ? `, ${property.address}` : ''}`,
              }))}
            />

            <Input
              label="Namn"
              value={createRoomForm.name}
              onChange={(event) =>
                setCreateRoomForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Ex. Tvättstuga A"
            />

            <Textarea
              label="Beskrivning"
              value={createRoomForm.description}
              onChange={(event) =>
                setCreateRoomForm((current) => ({ ...current, description: event.target.value }))
              }
              rows={3}
              placeholder="Ex. Källarplan, ingång från gården"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Max aktiva bokningar"
                type="number"
                min={1}
                max={10}
                value={createRoomForm.max_bookings_per_tenant}
                onChange={(event) =>
                  setCreateRoomForm((current) => ({
                    ...current,
                    max_bookings_per_tenant: event.target.value,
                  }))
                }
                hint="Per hyresgäst samtidigt"
              />
              <Input
                label="Skapa tider i veckor"
                type="number"
                min={1}
                max={52}
                value={createRoomForm.weeks_to_generate}
                onChange={(event) =>
                  setCreateRoomForm((current) => ({
                    ...current,
                    weeks_to_generate: event.target.value,
                  }))
                }
                hint="Standard är 8 veckor framåt"
              />
            </div>
          </>
        )}

        <div className="flex gap-3 justify-end pt-4">
          <Button variant="outline" onClick={() => setCreateRoomModalOpen(false)}>
            Avbryt
          </Button>
          <Button
            variant="primary"
            onClick={handleCreateLaundryRoom}
            loading={createRoomLoading}
            disabled={properties.length === 0}
          >
            Skapa
          </Button>
        </div>
      </div>
    </Modal>
  );

  if (rooms.length === 0) {
    return (
      <div className="p-4 md:p-6">
        <PageHeader title="Tvättbokning" action={createRoomAction} />
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-600">
            {success}
          </div>
        )}
        <EmptyState
          icon={<WashingMachine className="w-12 h-12" />}
          title="Ingen tvättstuga tillgänglig"
          description={
            canManageLaundryRooms
              ? 'Skapa en tvättstuga och generera bokningsbara tider för organisationen.'
              : 'Det finns ingen tvättstuga konfigurerad för denna fastighet.'
          }
        />
        {createRoomModal}
      </div>
    );
  }

  const currentRoom = rooms.find((r) => r.id === selectedRoomId);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader title="Tvättbokning" subtitle="Boka tvättstuga" action={createRoomAction} />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-600">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left column: My bookings */}
        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-blue-600" />
              Mina bokningar
            </h2>

            {myBookings.length === 0 ? (
              <EmptyState
                icon={<Calendar className="w-8 h-8" />}
                title="Ingen bokning"
                description="Du har inga aktiva bokningar."
              />
            ) : (
              <div className="space-y-3">
                {myBookings.map((booking) => (
                  <Card key={booking.id} className="p-4">
                    <div className="space-y-2">
                      <p className="font-medium text-slate-800 text-sm">
                        {booking.slot?.laundry_room?.name}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        <Calendar className="w-3.5 h-3.5" />
                        {booking.slot?.date
                          ? formatDate(booking.slot.date)
                          : 'N/A'}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        <Clock className="w-3.5 h-3.5" />
                        {booking.slot?.start_time} - {booking.slot?.end_time}
                      </div>
                      <Button
                        variant="danger"
                        size="sm"
                        className="w-full mt-3"
                        onClick={() => handleCancelBooking(booking.id)}
                        loading={cancellingBookingId === booking.id}
                      >
                        <X className="w-4 h-4" />
                        Avboka
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column: Calendar */}
        <div className="lg:col-span-3">
          {/* Room tabs */}
          <div className="flex gap-2 mb-6 flex-wrap">
            {rooms.map((room) => (
              <button
                key={room.id}
                onClick={() => {
                  setSelectedRoomId(room.id);
                  setWeekOffset(0);
                  setMobileViewDay(getTodayWeekdayIndex());
                }}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  selectedRoomId === room.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {room.name}
              </button>
            ))}
          </div>

          {/* Week navigation */}
          <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => {
                setWeekOffset(weekOffset - 1);
                setMobileViewDay(0);
              }}
            >
              <ChevronLeft className="w-4 h-4" />
              Förra vecka
            </Button>

            <div className="text-center text-sm font-medium text-slate-700">
              {formatDate(weekStart)} - {formatDate(weekEnd)}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => {
                setWeekOffset(weekOffset + 1);
                setMobileViewDay(0);
              }}
            >
              Nästa vecka
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Desktop calendar view */}
          <div className="hidden md:block overflow-x-auto">
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(7, minmax(140px, 1fr))' }}>
              {weekDays.map((day, dayIdx) => (
                <div key={dayIdx}>
                  <div className="text-center pb-3 border-b-2 border-slate-200">
                    <p className="text-sm font-semibold text-slate-800">
                      {day.toLocaleDateString('sv-SE', { weekday: 'short' })}
                    </p>
                    <p className="text-xs text-slate-500">
                      {day.getDate()} {day.toLocaleDateString('sv-SE', { month: 'short' })}
                    </p>
                  </div>

                  {/* Time slots for this day */}
                  <div className="space-y-2 pt-3">
                    {getSlotsForDay(day).length === 0 && (
                      <div className="text-xs text-slate-400 text-center py-8">
                        Ingen data
                      </div>
                    )}
                    {getSlotsForDay(day).map((slot) => {
                      const status = getSlotStatus(slot);
                      const isClickable =
                        !slot.isPast &&
                        !slot.is_blocked &&
                        !slot.booking &&
                        status.label === 'Ledig';

                      return (
                        <button
                          key={slot.id}
                          onClick={() => {
                            if (isClickable) {
                              setConfirmModal({
                                open: true,
                                slot,
                                day: `${day.toLocaleDateString('sv-SE', { weekday: 'long' })} ${formatDate(slot.date)}`,
                              });
                              setBookingModalError('');
                            }
                          }}
                          disabled={!isClickable}
                          className={`w-full p-2 rounded-lg text-xs font-medium transition-all ${status.color} ${status.textColor} ${
                            isClickable
                              ? 'cursor-pointer hover:shadow-md active:scale-95'
                              : 'cursor-not-allowed opacity-60'
                          }`}
                        >
                          <div>{slot.start_time}</div>
                          <div className="text-xs">{status.label}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile calendar view (day by day) */}
          <div className="md:hidden">
            <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
              {weekDays.map((day, dayIdx) => (
                <button
                  key={dayIdx}
                  onClick={() => setMobileViewDay(dayIdx)}
                  className={`flex-shrink-0 px-4 py-2 rounded-lg font-medium transition-colors ${
                    mobileViewDay === dayIdx
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  <div className="text-xs">
                    {day.toLocaleDateString('sv-SE', { weekday: 'short' })}
                  </div>
                  <div className="text-sm font-bold">{day.getDate()}</div>
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {getSlotsForDay(weekDays[mobileViewDay]).length === 0 ? (
                <EmptyState
                  icon={<Calendar className="w-8 h-8" />}
                  title="Ingen lediga tider"
                  description="Inga lediga tidsslots denna dag."
                />
              ) : (
                getSlotsForDay(weekDays[mobileViewDay]).map((slot) => {
                  const status = getSlotStatus(slot);
                  const isClickable =
                    !slot.isPast &&
                    !slot.is_blocked &&
                    !slot.booking &&
                    status.label === 'Ledig';

                  return (
                    <Card
                      key={slot.id}
                      onClick={() => {
                        if (isClickable) {
                          setConfirmModal({
                            open: true,
                            slot,
                            day: `${weekDays[mobileViewDay].toLocaleDateString('sv-SE', { weekday: 'long' })} ${formatDate(slot.date)}`,
                          });
                          setBookingModalError('');
                        }
                      }}
                      className={`p-4 transition-all ${isClickable ? 'cursor-pointer hover:shadow-md active:scale-95' : 'cursor-not-allowed opacity-60'}`}
                    >
                      <div className="flex items-center justify-between gap-3 min-w-0">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800">
                            {slot.start_time} - {slot.end_time}
                          </p>
                          <Badge className={`${status.color} ${status.textColor} mt-1`}>
                            {status.label}
                          </Badge>
                        </div>
                        {isClickable && (
                          <Plus className="w-5 h-5 text-blue-600" />
                        )}
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation modal */}
      <Modal
        open={confirmModal.open}
        onClose={closeConfirmModal}
        title="Bekräfta bokning"
      >
        <div className="space-y-4">
          <p className="text-slate-700">
            Vill du boka tvättstuga på {confirmModal.day}?
          </p>
          {confirmModal.slot && (
            <div className="bg-slate-50 p-4 rounded-lg">
              <p className="text-sm font-medium text-slate-800">
                {confirmModal.slot.start_time} - {confirmModal.slot.end_time}
              </p>
              <p className="text-sm text-slate-600">{currentRoom?.name}</p>
            </div>
          )}

          {bookingModalError && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {bookingModalError}
            </div>
          )}

          <div className="flex gap-3 justify-end pt-4">
            <Button
              variant="outline"
              onClick={closeConfirmModal}
            >
              Avbryt
            </Button>
            <Button
              variant="primary"
              onClick={handleBookSlot}
              loading={bookingInProgress}
            >
              Boka
            </Button>
          </div>
        </div>
      </Modal>
      {createRoomModal}
    </div>
  );
}
