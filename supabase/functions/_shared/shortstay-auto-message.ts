export type AutoRule = {
  event: "arrival" | "departure";
  days_offset: number;
  send_time: string;
  channels: string[];
  language: string;
  activated_at: string | null;
};
export function dayShift(day: string, offset: number) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
export function swedishNow(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}
export function dueToday(
  rule: AutoRule,
  booking: { start_date: string; end_date: string },
  now = new Date(),
) {
  const local = swedishNow(now);
  const date = dayShift(
    rule.event === "arrival" ? booking.start_date : booking.end_date,
    rule.days_offset,
  );
  const [h, m] = rule.send_time.split(":").map(Number);
  const elapsed =
    ((Date.parse(local.day + "T12:00:00Z") - Date.parse(date + "T12:00:00Z")) /
      86400000) *
      1440 +
    local.minute -
    h * 60 -
    m;
  return elapsed >= 0 && elapsed < 120;
}
export function automaticText(text: string, guestName: string) {
  const first = guestName.trim().split(/\s+/u)[0] || "";
  if (
    /\[FIRST_NAME\]/i.test(text) &&
    (!first || first.toLowerCase() === "beds24-bokning")
  )
    throw Error("Gästnamn saknas");
  const rendered = text.replace(/\[FIRST_NAME\]/gi, () => first).trim();
  if (!rendered || rendered.length > 5000)
    throw Error("Ogiltig meddelandelängd");
  return rendered;
}
export function providerMatches(
  booking: Record<string, unknown>,
  local: { beds24_booking_id: string; start_date: string; end_date: string },
  unit: { beds24_room_id: string; beds24_property_id: string },
  rule: AutoRule,
) {
  return (
    String(booking.id) === local.beds24_booking_id &&
    String(booking.roomId) === String(unit.beds24_room_id) &&
    String(booking.propertyId) === String(unit.beds24_property_id) &&
    String(booking.status || "").toLowerCase() === "confirmed" &&
    String(booking.arrival || "").slice(0, 10) === local.start_date &&
    String(booking.departure || "").slice(0, 10) === local.end_date &&
    rule.channels.includes(String(booking.channel || "").toLowerCase())
  );
}
