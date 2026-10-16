export type AvailabilityStatus =
  "available" | "partial" | "unavailable" | "unknown";
export type Slot = [number, number];
export interface AvailabilityDay {
  user_id: string;
  work_date: string;
  status: AvailabilityStatus;
  slots: Slot[];
  revision: number;
  updated_by: string;
}
export interface SnowAvailabilitySnapshot {
  people: { id: string; name: string }[];
  days: AvailabilityDay[];
  shifts: {
    id: string;
    user_id: string | null;
    starts_at: string;
    ends_at: string;
  }[];
  absences: { user_id: string; start_date: string; end_date: string }[];
}
export const statusLabels: Record<AvailabilityStatus, string> = {
  available: "Kan hela dygnet",
  partial: "Del av dygnet",
  unavailable: "Kan inte",
  unknown: "Ej svar",
};
export const calendarDay = (date = new Date()) =>
  date.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
export function addDays(date: string, count: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function weekStart(date: string) {
  const day = new Date(date + "T12:00:00Z").getUTCDay();
  return addDays(date, -((day + 6) % 7));
}
export function minuteLabel(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export function parseMinute(value: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(value))
    throw Error("Ange tider mellan 00:00 och 24:00.");
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
export function validateSlots(slots: Slot[]) {
  if (!slots.length || slots.length > 4) throw Error("Ange 1–4 tidsintervall.");
  const sorted = [...slots].sort((a, b) => a[0] - b[0]);
  sorted.forEach(([start, end], i) => {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > 1440 ||
      start >= end ||
      (i > 0 && start < sorted[i - 1][1])
    )
      throw Error("Kontrollera tiderna. Intervallen får inte överlappa.");
  });
  return sorted;
}
function shiftSlot(date: string, start: string, end: string): Slot | null {
  const first = calendarDay(new Date(start)),
    last = calendarDay(new Date(end));
  if (first > date || last < date) return null;
  const minutes = (value: string) => {
    const d = new Date(value);
    return parseMinute(
      d.toLocaleTimeString("sv-SE", {
        timeZone: "Europe/Stockholm",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    );
  };
  const from = first < date ? 0 : minutes(start),
    to = last > date ? 1440 : minutes(end);
  return from < to ? [from, to] : null;
}
export function dutySlots(
  data: SnowAvailabilitySnapshot,
  date: string,
  user: string,
): Slot[] {
  return data.shifts
    .filter((s) => s.user_id === user)
    .map((s) => shiftSlot(date, s.starts_at, s.ends_at))
    .filter((s): s is Slot => s !== null);
}
export function effectiveSlots(
  data: SnowAvailabilitySnapshot,
  date: string,
  user: string,
): Slot[] {
  if (
    data.absences.some(
      (a) => a.user_id === user && a.start_date <= date && a.end_date >= date,
    )
  )
    return [];
  const entry = data.days.find(
    (d) => d.user_id === user && d.work_date === date,
  );
  if (entry && entry.status !== "unknown")
    return entry.status === "unavailable" ? [] : entry.slots;
  return dutySlots(data, date, user);
}
export function capacitySegments(
  data: SnowAvailabilitySnapshot,
  date: string,
  from = 0,
  to = 1440,
) {
  const people = data.people.map((p) => ({
    ...p,
    slots: effectiveSlots(data, date, p.id),
  }));
  const points = [
    ...new Set([
      from,
      to,
      ...people
        .flatMap((p) => p.slots.flat())
        .filter((n) => n > from && n < to),
    ]),
  ].sort((a, b) => a - b);
  const result: {
    start: number;
    end: number;
    people: { id: string; name: string }[];
  }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i],
      end = points[i + 1];
    const available = people
      .filter((p) => p.slots.some(([a, b]) => a <= start && b >= end))
      .map(({ id, name }) => ({ id, name }));
    const previous = result[result.length - 1];
    if (
      previous &&
      previous.people.map((p) => p.id).join(",") ===
        available.map((p) => p.id).join(",")
    )
      previous.end = end;
    else result.push({ start, end, people: available });
  }
  return result;
}
export function dutyConflict(
  data: SnowAvailabilitySnapshot,
  date: string,
  user: string,
) {
  const available = effectiveSlots(data, date, user);
  return dutySlots(data, date, user).some(([start, end]) => {
    const points = [
      start,
      ...available.flat().filter((n) => n > start && n < end),
      end,
    ].sort((a, b) => a - b);
    return points
      .slice(0, -1)
      .some(
        (p, i) => !available.some(([a, b]) => a <= p && b >= points[i + 1]),
      );
  });
}
