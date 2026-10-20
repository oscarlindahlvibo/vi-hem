export type FleetPosition = {
  id: number;
  vehicle_id: string;
  device_id: string;
  recorded_at: string;
  received_at: string;
  latitude: number | null;
  longitude: number | null;
  gps_valid: boolean;
  speed_kmh: number | null;
  heading: number | null;
  ignition: boolean | null;
  odometer: number | null;
  odometer_source: string | null;
  engine_rpm: number | null;
  fuel_level_pct: number | null;
  battery_voltage: number | null;
  backup_battery_voltage?: number | null;
  engine_hours: number | null;
  signal_quality: number | null;
};
export type FleetTrip = {
  id: string;
  vehicle_id: string;
  started_at: string;
  ended_at: string | null;
  distance_km: number | null;
  start_address: string;
  end_address: string;
  start_latitude: number | null;
  start_longitude: number | null;
  end_latitude: number | null;
  end_longitude: number | null;
  purpose: "unknown" | "business" | "private";
  driver_id: string | null;
  description: string;
  notes: string;
  revision: number;
  idle_seconds: number;
  needs_review: boolean;
  odometer_manual?: boolean;
  start_odometer_km: number | null;
  end_odometer_km: number | null;
};
export function trackingOnline(
  last: string | null | undefined,
  now = Date.now(),
) {
  return (
    !!last &&
    now - Date.parse(last) < 300000 &&
    now >= Date.parse(last) - 300000
  );
}
export function stockholmDay(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function stockholmBoundary(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error("Ogiltigt datum");
  const utc = Date.parse(day + "T00:00:00Z");
  let instant = utc;
  for (let i = 0; i < 3; i++) {
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
        .formatToParts(new Date(instant))
        .map((p) => [p.type, p.value]),
    );
    instant +=
      utc -
      Date.parse(
        `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`,
      );
  }
  return new Date(instant).toISOString();
}
export function nextDay(day: string) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
export function journalRows(
  trips: FleetTrip[],
  registration: string,
  driverNames: Record<string, string>,
) {
  return trips.map((t) => [
    registration,
    new Date(t.started_at).toLocaleString("sv-SE", {
      timeZone: "Europe/Stockholm",
    }),
    t.ended_at
      ? new Date(t.ended_at).toLocaleString("sv-SE", {
          timeZone: "Europe/Stockholm",
        })
      : "Pågår",
    t.start_address || [t.start_latitude, t.start_longitude].join(", "),
    t.end_address || [t.end_latitude, t.end_longitude].join(", "),
    t.start_odometer_km ?? "",
    t.end_odometer_km ?? "",
    t.distance_km ?? "",
    t.odometer_manual
      ? "GPS beräknad · mätare manuellt kompletterad"
      : "GPS beräknad · mätare OBD om tillgänglig",
    t.ended_at
      ? Math.round((Date.parse(t.ended_at) - Date.parse(t.started_at)) / 60000)
      : "",
    Math.round(t.idle_seconds / 60),
    {
      business: "Tjänsteresa",
      private: "Privatresa",
      unknown: "Ej klassificerad",
    }[t.purpose],
    driverNames[t.driver_id || ""] || "",
    t.description,
    t.notes,
    t.needs_review ? "Kontroll krävs" : "",
  ]);
}
export const journalHeaders = [
  "Fordon",
  "Start (Europe/Stockholm)",
  "Slut (Europe/Stockholm)",
  "Startplats",
  "Slutplats",
  "Startmätare (km)",
  "Slutmätare (km)",
  "Sträcka (km)",
  "Underlag",
  "Tid (min)",
  "Stillestånd (min)",
  "Typ",
  "Förare",
  "Syfte",
  "Anteckningar",
  "Datakvalitet",
];
export function csvJournal(rows: (string | number)[][]) {
  const safe = (v: string | number) => {
    const s = String(v);
    return (
      '"' + (/^[\s]*[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"'
    );
  };
  return (
    "\ufeff" +
    [journalHeaders, ...rows].map((row) => row.map(safe).join(";")).join("\r\n")
  );
}
