import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Calendar, CheckCircle, Clock, Home, Loader2, WashingMachine, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Badge, Button, Card, EmptyState, Input, Modal } from '../components/ui';
import { formatDate } from '../lib/utils';
import type { LaundryRoom, LaundrySlot } from '../types';

interface PublicLaundrySlot extends LaundrySlot {
  is_booked: boolean;
  own_booking_id: string | null;
}

interface PublicLaundryData {
  link: {
    id: string;
    label: string;
    max_bookings: number;
    active_bookings: number;
    property?: { id: string; name: string; address: string };
    apartment?: { id: string; apartment_number: string };
    short_stay_unit?: { id: string; name: string };
  };
  rooms: LaundryRoom[];
  slots: PublicLaundrySlot[];
}

const getToken = () => new URLSearchParams(window.location.search).get('token') || '';

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export function GuestLaundryPage() {
  const [token] = useState(getToken);
  const [data, setData] = useState<PublicLaundryData | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [selectedDate, setSelectedDate] = useState(dateKey(new Date()));
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [busySlotId, setBusySlotId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pendingSlot, setPendingSlot] = useState<PublicLaundrySlot | null>(null);
  const actionLock = useRef(false);

  const days = useMemo(() => Array.from({ length: 14 }, (_, index) => addDays(new Date(), index)), []);

  const loadLaundry = async () => {
    if (!token) {
      setError('Länken saknar token.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    const { data: result, error: invokeError } = await supabase.functions.invoke('vihem-public-laundry', {
      body: { action: 'get', token },
    });

    if (invokeError || result?.error) {
      setError(result?.error || invokeError?.message || 'Kunde inte ladda tvättbokningen.');
      setLoading(false);
      return;
    }

    const nextData = result.data as PublicLaundryData;
    setData(nextData);
    setSelectedRoomId((current) => current || nextData.rooms[0]?.id || '');
    setLoading(false);
  };

  useEffect(() => {
    loadLaundry();
  }, []);

  const selectedRoom = data?.rooms.find((room) => room.id === selectedRoomId);
  const selectedSlots = (data?.slots || []).filter(
    (slot) => slot.laundry_room_id === selectedRoomId && slot.date === selectedDate
  );

  const bookSlot = async (slot: PublicLaundrySlot) => {
    if (actionLock.current) return;
    if (!guestName.trim()) {
      setError('Skriv ditt namn innan du bokar.');
      return;
    }

    actionLock.current = true;
    setBusySlotId(slot.id);
    setError('');
    setMessage('');
    try {
    const { data: result, error: invokeError } = await supabase.functions.invoke('vihem-public-laundry', {
      body: {
        action: 'book',
        token,
        slot_id: slot.id,
        guest_name: guestName,
        guest_email: guestEmail,
        guest_phone: guestPhone,
      },
    });

    if (invokeError || result?.error) {
      setError(result?.error || invokeError?.message || 'Kunde inte boka tiden.');
    } else {
      setData(result.data as PublicLaundryData);
      setMessage('Bokningen är klar.');
    }
    if (!invokeError && !result?.error) setPendingSlot(null);
    } catch { setError('Anslutningen avbröts. Hämta bokningarna igen innan du försöker på nytt.'); }
    finally { actionLock.current = false; setBusySlotId(''); }
  };

  const cancelBooking = async (slot: PublicLaundrySlot) => {
    if (!slot.own_booking_id || actionLock.current) return;
    actionLock.current = true;
    setBusySlotId(slot.id);
    setError('');
    setMessage('');
    try {
    const { data: result, error: invokeError } = await supabase.functions.invoke('vihem-public-laundry', {
      body: { action: 'cancel', token, booking_id: slot.own_booking_id },
    });

    if (invokeError || result?.error) {
      setError(result?.error || invokeError?.message || 'Kunde inte avboka tiden.');
    } else {
      setData(result.data as PublicLaundryData);
      setMessage('Bokningen är avbokad.');
    }
    if (!invokeError && !result?.error) setPendingSlot(null);
    } catch { setError('Anslutningen avbröts. Hämta bokningarna igen innan du försöker på nytt.'); }
    finally { actionLock.current = false; setBusySlotId(''); }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 flex items-center justify-center">
        <Card className="max-w-md p-6 text-center">
          <X className="mx-auto h-10 w-10 text-red-500" />
          <h1 className="mt-3 text-xl font-bold text-slate-950">Länken fungerar inte</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p><Button variant="secondary" className="shrink-0" onClick={loadLaundry}>Försök igen</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="rounded-xl bg-blue-600 p-2 text-white">
            <Home className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">VI-HEM</p>
            <h1 className="text-xl font-bold text-slate-950">Tvättbokning för gäst</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 p-4 pb-10">
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-950">
                {data?.link.short_stay_unit?.name || data?.link.apartment?.apartment_number || data?.link.label || 'Gästlägenhet'}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {data?.link.property?.name}{data?.link.property?.address ? `, ${data.link.property.address}` : ''}
              </p>
            </div>
            <Badge className="bg-blue-50 text-blue-700">
              {data?.link.active_bookings || 0}/{data?.link.max_bookings || 3} aktiva bokningar
            </Badge>
          </div>
        </Card>

        {message && <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div>}
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 space-y-4">
        <h2 className="text-lg font-semibold text-slate-950">Välj tvättstuga och dag</h2>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {(data?.rooms || []).map((room) => (
            <button
              key={room.id}
              aria-pressed={selectedRoomId === room.id}
              onClick={() => setSelectedRoomId(room.id)}
              className={`flex-shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                selectedRoomId === room.id ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'
              }`}
            >
              {room.name}
            </button>
          ))}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2">
          {days.map((day) => {
            const key = dateKey(day);
            return (
              <button
                key={key}
                aria-pressed={selectedDate === key}
                aria-label={day.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" })}
                onClick={() => setSelectedDate(key)}
                className={`min-w-[76px] flex-shrink-0 rounded-xl px-3 py-2 text-center text-sm font-semibold transition-colors ${
                  selectedDate === key ? 'bg-slate-950 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'
                }`}
              >
                <span className="block text-xs opacity-75">{day.toLocaleDateString('sv-SE', { weekday: 'short' })}</span>
                {day.getDate()}
              </button>
            );
          })}
        </div>

        <Card className="p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-950">{selectedRoom?.name || 'Tvättstuga'}</h2>
              <p className="text-sm text-slate-500">{formatDate(selectedDate)}</p>
            </div>
            <WashingMachine className="h-6 w-6 text-blue-600" />
          </div>

          {selectedSlots.length === 0 ? (
            <EmptyState icon={<Calendar className="h-8 w-8" />} title="Inga tider" description="Det finns inga bokningsbara tider denna dag." />
          ) : (
            <div className="divide-y divide-slate-100">
              {selectedSlots.map((slot) => {
                const isOwn = Boolean(slot.own_booking_id);
                const isPast = new Date(`${slot.date}T${slot.end_time.slice(0,5)}`).getTime() <= Date.now();
                const isFree = !slot.is_booked && !slot.is_blocked && !isPast;
                return (
                  <div key={slot.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-4 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-2 font-bold text-slate-950">
                          <Clock className="h-4 w-4 text-slate-400" />
                          {slot.start_time.slice(0,5)} - {slot.end_time.slice(0,5)}
                        </p>
                        <Badge className={`mt-2 ${isFree ? 'bg-green-50 text-green-700' : isOwn ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                          {isPast ? 'Passerat' : isFree ? 'Ledig' : isOwn ? 'Bokad av dig' : 'Upptagen'}
                        </Badge>
                      </div>
                      {isOwn ? <CheckCircle className="h-5 w-5 text-blue-600" /> : null}
                    </div>
                    <div className="shrink-0">
                      {isOwn ? (
                        <Button variant="outline" size="sm" className="min-w-24" onClick={() => setPendingSlot(slot)} loading={busySlotId === slot.id} disabled={Boolean(busySlotId)}>
                          Avboka
                        </Button>
                      ) : (
                        <Button variant="primary" size="sm" className="min-w-24" onClick={() => setPendingSlot(slot)} loading={busySlotId === slot.id} disabled={!isFree || Boolean(busySlotId) || (data?.link.active_bookings ?? 0) >= (data?.link.max_bookings ?? 0)}>
                          Boka tid
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        </section>
        <aside className="space-y-4 lg:sticky lg:top-5 lg:self-start">
          <div className="rounded-2xl bg-white p-5">
            <h2 className="text-lg font-semibold text-slate-950">Dina bokningar</h2>
            <p className="mt-1 text-sm text-slate-500">{data?.link.active_bookings ?? 0} av {data?.link.max_bookings ?? 0} tillåtna bokningar</p>
            {(data?.slots || []).filter(slot => slot.own_booking_id).map(slot => <button key={slot.id} onClick={() => { setSelectedRoomId(slot.laundry_room_id); setSelectedDate(slot.date); }} className="mt-3 block w-full rounded-xl bg-blue-50 p-3 text-left text-sm text-blue-900 hover:bg-blue-100 focus-visible:ring-2 focus-visible:ring-blue-600"><span className="block font-semibold">{formatDate(slot.date)} · {slot.start_time.slice(0,5)}–{slot.end_time.slice(0,5)}</span><span>{data?.rooms.find(room => room.id === slot.laundry_room_id)?.name} · Visa pass</span></button>)}
            {!data?.link.active_bookings && <p className="mt-3 text-sm text-slate-500">Välj ett ledigt pass för att boka.</p>}
          </div>
          <p className="px-1 text-sm leading-6 text-slate-500">Bokningen hör till denna gästlänk. Spara länken för att kunna se eller avboka dina pass.</p>
        </aside>
        </div>
        <Modal open={Boolean(pendingSlot)} onClose={() => { if (!busySlotId) setPendingSlot(null); }} title={pendingSlot?.own_booking_id ? 'Avboka tvättid?' : 'Boka tvättid'} footer={<div className="flex justify-end gap-2"><Button variant="secondary" disabled={Boolean(busySlotId)} onClick={() => setPendingSlot(null)}>Tillbaka</Button><Button loading={Boolean(busySlotId)} disabled={!pendingSlot || (!pendingSlot.own_booking_id && !guestName.trim())} onClick={() => { if (pendingSlot) void (pendingSlot.own_booking_id ? cancelBooking(pendingSlot) : bookSlot(pendingSlot)); }}>{pendingSlot?.own_booking_id ? 'Avboka' : 'Bekräfta bokning'}</Button></div>}>
          {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {pendingSlot && <p className="mb-5 font-semibold text-slate-900">{formatDate(pendingSlot.date)} · {pendingSlot.start_time.slice(0,5)}–{pendingSlot.end_time.slice(0,5)}</p>}
          {!pendingSlot?.own_booking_id && <div className="space-y-4"><Input label="Ditt namn" autoComplete="name" required value={guestName} onChange={event => setGuestName(event.target.value)} /><details><summary className="cursor-pointer py-2 text-sm font-medium text-slate-600">Kontaktuppgifter (valfritt)</summary><div className="mt-3 space-y-3"><Input label="E-post" type="email" autoComplete="email" value={guestEmail} onChange={event => setGuestEmail(event.target.value)} /><Input label="Telefon" type="tel" autoComplete="tel" value={guestPhone} onChange={event => setGuestPhone(event.target.value)} /></div></details></div>}
        </Modal>
      </main>
    </div>
  );
}
