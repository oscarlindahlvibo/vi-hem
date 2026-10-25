// Explicit Stockholm conversion. Reject nonexistent local times at spring DST.
export function localInput(iso: string, timezone = "Europe/Stockholm") {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function fromLocal(value: string, timezone = "Europe/Stockholm") {
  const base = Date.parse(value + "Z");
  if (!Number.isFinite(base))
    throw Error("Ange ett giltigt datum och klockslag.");
  // Covers UTC offsets including half/quarter-hour zones, chooses first autumn occurrence.
  for (let offset = 14 * 60; offset >= -12 * 60; offset -= 15) {
    const iso = new Date(base - offset * 60000).toISOString();
    if (localInput(iso, timezone) === value) return iso;
  }
  throw Error(
    "Den tiden finns inte vid övergång till sommartid. Välj ett annat klockslag.",
  );
}
export function parseQuick(text: string, now = new Date()) {
  const m = text.match(
    /^(?:påminn mig\s+)?(imorgon|idag)\s+(?:kl\.?\s*)?(\d{1,2})(?:[:.](\d{2}))?\s+(?:att\s+)?(.+)$/i,
  );
  if (!m || Number(m[2]) > 23 || Number(m[3] || 0) > 59) return null;
  const date = localInput(now.toISOString()).slice(0, 10);
  const day = new Date(date + "T12:00:00Z");
  if (m[1].toLowerCase() === "imorgon") day.setUTCDate(day.getUTCDate() + 1);
  return {
    title: m[4],
    local: `${day.toISOString().slice(0, 10)}T${m[2].padStart(2, "0")}:${m[3] || "00"}`,
  };
}

export function snoozeAt(
  kind: string,
  now = new Date(),
  timezone = "Europe/Stockholm",
) {
  if (kind === "hour") return new Date(now.getTime() + 3600000).toISOString();
  const local = localInput(now.toISOString(), timezone),
    day = new Date(local.slice(0, 10) + "T12:00:00Z");
  if (kind === "today" && local.slice(11) < "18:00")
    return fromLocal(local.slice(0, 10) + "T18:00", timezone);
  day.setUTCDate(day.getUTCDate() + (kind === "week" ? 7 : 1));
  return fromLocal(day.toISOString().slice(0, 10) + "T09:00", timezone);
}
