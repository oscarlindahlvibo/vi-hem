// Alla tider i ViboRent är lokal tid i uthyrarens tidszon (inte besökarens webbläsare).
export function offsetMinutes(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** "2026-10-17" + 10 (timme) i given tidszon -> ISO-sträng (UTC). */
export function zonedToIso(dateStr: string, hour: number, timeZone: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
  let utc = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  utc = guess - offsetMinutes(new Date(utc), timeZone) * 60000; // andra varvet hanterar sommartidsbyte
  return new Date(utc).toISOString();
}

export function isoToLocalParts(iso: string, timeZone: string): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" })
      .formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export const todayLocal = (timeZone: string) => isoToLocalParts(new Date().toISOString(), timeZone).date;

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}
