import type { ShortStayBooking } from '../types';

export type GuestMessageBooking = Pick<ShortStayBooking, 'id' | 'unit_id' | 'beds24_booking_id' | 'guest_name' | 'channel_name' | 'start_date' | 'end_date'> & { unit_name: string };
export const messageBookingColumns = 'id,unit_id,beds24_booking_id,guest_name,channel_name,start_date,end_date,unit:vihem_short_stay_units(name)';
type BookingRow = Omit<GuestMessageBooking, 'unit_name'> & { unit: { name: string } | { name: string }[] | null };
export function messageBookings(rows: BookingRow[]): GuestMessageBooking[] {
  const seen = new Set<string>();
  return rows.flatMap(row => {
    if (!/^\d+$/.test(row.beds24_booking_id || '') || seen.has(row.beds24_booking_id)) return [];
    seen.add(row.beds24_booking_id);
    const unit = Array.isArray(row.unit) ? row.unit[0] : row.unit;
    const { unit: _unit, ...booking } = row;
    return [{ ...booking, unit_name: unit?.name || 'Boende' }];
  });
}
