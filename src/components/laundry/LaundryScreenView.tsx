import type {LaundryRoom,LaundrySlot,LaundryBooking} from '../../types';
import type {ScreenConfig} from '../../lib/screenSettings';
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

export function LaundryScreenView({
  screen,
  rooms,
  slots,
  bookings,
  screenHeight,
  screenWidth,
  lastUpdated,
  startDate,
}: {
  screen: ScreenConfig;
  rooms: LaundryRoom[];
  slots: LaundrySlot[];
  bookings: LaundryBooking[];
  screenHeight: number;
  screenWidth: number;
  lastUpdated: Date | null;
  /** Explicit date for isolated demos; the real screen defaults to today. */
  startDate?: Date;
}) {
  const room = rooms.find(item => item.id === screen.laundryRoomId) || rooms[0];
  const narrow = screenWidth < 1024;
  const availableHeight = Math.max(screenHeight - 54, 420);
  const dayGap = 8;
  const dayRowHeight = Math.max(72, Math.floor((availableHeight - dayGap * 6) / 7));
  const compactSchedule = dayRowHeight < 128;
  const todayValue = dateKey(startDate || today());
  const now = new Date();
  const roomSlots = room ? slots.filter(slot => slot.laundry_room_id === room.id) : [];
  const bookingBySlotId = new Map(bookings.map(booking => [booking.laundry_slot_id, booking]));
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(startDate || today(), index);
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
      <div className="flex items-center justify-center rounded-2xl bg-white p-12 text-center text-2xl font-semibold text-slate-700" style={{ height: narrow ? undefined : availableHeight }}>
        Ingen tvättstuga vald för den här skärmen.
      </div>
    );
  }

  return (
    <div className="grid gap-3 overflow-hidden text-white xl:grid-cols-[0.9fr_1.1fr]" style={{ height: narrow ? undefined : availableHeight }}>
      <section className="flex min-h-0 flex-col rounded-3xl bg-slate-900 p-6 ring-1 ring-white/10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-black uppercase tracking-[0.22em] text-blue-200">Tvättstuga</p>
            <h1 className="mt-2 truncate text-5xl font-black tracking-tight">{room.name}</h1>
            <p className="mt-2 text-xl font-bold text-slate-300">{room.property?.name || room.description || 'VI-HEM'}</p>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-3 text-right ring-1 ring-white/10">
            <p className="text-sm font-bold text-slate-300">{startDate?'Exempeldag':'Idag'}</p>
            <p className="text-2xl font-semibold">{new Date(`${todayValue}T12:00:00`).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
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
              <span className={`rounded-full px-5 py-3 text-2xl font-semibold ring-1 ${slotStatus(currentSlot).className}`}>{slotStatus(currentSlot).label}</span>
            </div>
          ) : (
            <p className="mt-3 text-3xl font-black text-slate-200">Ingen aktiv tid just nu</p>
          )}
        </div>

        <div className="mt-5 min-h-0 flex-1 rounded-3xl bg-white/10 p-5 ring-1 ring-white/10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Nästa bokningar</h2>
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
        style={{ gap: dayGap, gridTemplateRows: narrow ? 'auto' : 'repeat(7, minmax(0, 1fr))' }}
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

