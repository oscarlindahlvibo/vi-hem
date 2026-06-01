import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Card,
  Badge,
  Button,
  Modal,
  PageHeader,
  EmptyState,
  LoadingPage,
} from '../components/ui';
import { formatDate } from '../lib/utils';
import type { LaundryRoom, LaundrySlot, LaundryBooking } from '../types';
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

interface SlotWithBooking extends LaundrySlot {
  booking?: LaundryBooking | null;
  isTaken?: boolean;
  isPast?: boolean;
}

interface MyBooking extends LaundryBooking {
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

export function LaundryPage({ onNavigate: _onNavigate }: { onNavigate: (page: string) => void }) {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<LaundryRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [slots, setSlots] = useState<SlotWithBooking[]>([]);
  const [myBookings, setMyBookings] = useState<MyBooking[]>([]);
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    slot: SlotWithBooking | null;
    day: string;
  }>({ open: false, slot: null, day: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [bookingInProgress, setBookingInProgress] = useState(false);
  const [cancellingBookingId, setCancellingBookingId] = useState('');
  const [mobileViewDay, setMobileViewDay] = useState(0);

  // Get week range for current offset
  const getWeekRange = (offset: number) => {
    const now = new Date();
    now.setDate(now.getDate() - now.getDay() + offset * 7);
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay() + 1); // Monday
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

  // Format date as YYYY-MM-DD
  const formatDateString = (d: Date) => d.toISOString().split('T')[0];

  // Fetch laundry rooms
  useEffect(() => {
    if (authLoading || !user) return;

    const fetchRooms = async () => {
      try {
        const { data, error: err } = await supabase
          .from('laundry_rooms')
          .select('*')
          .eq('active', true)
          .order('name');

        if (err) throw err;
        if (data && data.length > 0) {
          setRooms(data as LaundryRoom[]);
          setSelectedRoomId(data[0].id);
        }
      } catch (e) {
        console.error('Error fetching laundry rooms:', e);
      }
    };

    fetchRooms();
  }, [authLoading, user]);

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

      // Check max bookings
      const activeCount = myBookings.filter((b) => b.status === 'active').length;
      const room = rooms.find((r) => r.id === selectedRoomId);
      if (activeCount >= (room?.max_bookings_per_tenant || 2)) {
        setError(
          `Du kan inte boka fler än ${room?.max_bookings_per_tenant || 2} tvättpass samtidigt.`
        );
        setConfirmModal({ open: false, slot: null, day: '' });
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
        setError('Denna tid är redan bokad. Försök igen.');
        setConfirmModal({ open: false, slot: null, day: '' });
        return;
      }

      // Insert booking
      const { error: bookingErr } = await supabase
        .from('laundry_bookings')
        .insert({
          laundry_slot_id: confirmModal.slot.id,
          tenant_id: user.id,
          status: 'active',
        });

      if (bookingErr) throw bookingErr;

      setSuccess('Bokning bekräftad!');
      setConfirmModal({ open: false, slot: null, day: '' });

      // Refresh bookings
      setTimeout(() => {
        setSelectedRoomId(selectedRoomId);
        setSuccess('');
      }, 1500);
    } catch (e) {
      console.error('Error booking slot:', e);
      setError('Något gick fel. Försök igen.');
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

      setSuccess('Bokning avbokad.');
      setTimeout(() => {
        setSelectedRoomId(selectedRoomId);
        setSuccess('');
      }, 1500);
    } catch (e) {
      console.error('Error cancelling booking:', e);
      setError('Kunde inte avboka. Försök igen.');
    } finally {
      setCancellingBookingId('');
    }
  };

  if (authLoading || loading) return <LoadingPage />;

  if (!user) return null;

  if (rooms.length === 0) {
    return (
      <div className="p-4 md:p-6">
        <PageHeader title="Tvättbokning" />
        <EmptyState
          icon={<WashingMachine className="w-12 h-12" />}
          title="Ingen tvättstuga tillgänglig"
          description="Det finns ingen tvättstuga konfigurerad för denna fastighet."
        />
      </div>
    );
  }

  const currentRoom = rooms.find((r) => r.id === selectedRoomId);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader title="Tvättbokning" subtitle="Boka tvättstuga" />

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
                  setMobileViewDay(0);
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
          <div className="flex items-center justify-between mb-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWeekOffset(weekOffset - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
              Förra vecka
            </Button>

            <div className="text-sm font-medium text-slate-700">
              {formatDate(weekStart)} - {formatDate(weekEnd)}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setWeekOffset(weekOffset + 1)}
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
                        }
                      }}
                      className={`p-4 transition-all ${isClickable ? 'cursor-pointer hover:shadow-md active:scale-95' : 'cursor-not-allowed opacity-60'}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
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
        onClose={() => setConfirmModal({ open: false, slot: null, day: '' })}
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

          <div className="flex gap-3 justify-end pt-4">
            <Button
              variant="outline"
              onClick={() => setConfirmModal({ open: false, slot: null, day: '' })}
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
    </div>
  );
}
