export type LaundryBookingWithSlot = {
  status?: string | null;
  slot?: {
    date?: string | null;
    end_time?: string | null;
  } | null;
};

export function isActiveLaundryBooking(
  booking: LaundryBookingWithSlot,
  now = new Date()
) {
  if (booking.status !== 'active' || !booking.slot?.date || !booking.slot.end_time) {
    return false;
  }

  const endAt = new Date(`${booking.slot.date}T${booking.slot.end_time}`);
  return !Number.isNaN(endAt.getTime()) && endAt > now;
}
