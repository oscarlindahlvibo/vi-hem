import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw, MapPin, Radio } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { saveOrShareFile } from "../../lib/utils";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Textarea,
} from "../../components/ui";
import type { FleetTelematicsDevice, FleetVehicle } from "../../types";
import { FleetGpsMap } from "./FleetGpsMap";
import { FleetGpsOdometer } from "./FleetGpsOdometer";
import {
  csvJournal,
  journalHeaders,
  journalRows,
  nextDay,
  stockholmBoundary,
  stockholmDay,
  trackingOnline,
  type FleetPosition,
  type FleetTrip,
} from "./telematics";
const time = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("sv-SE", {
        timeZone: "Europe/Stockholm",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Ingen kontakt";
const number = (value: number | null | undefined, unit = "") =>
  value === null || value === undefined
    ? "Ej tillgängligt"
    : new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 1 }).format(
        value,
      ) + (unit ? " " + unit : "");
const purposeLabels = {
  unknown: "Ej klassificerad",
  private: "Privatresa",
  business: "Tjänsteresa",
};
const statusError =
  "Telematik kunde inte hämtas. Kontrollera anslutningen och att GPS-backend är installerad.";
const EMPTY_LABELS: Record<string, string> = {};
export function FleetLiveOverview({
  vehicles,
  onOpenVehicle,
}: {
  vehicles: FleetVehicle[];
  onOpenVehicle: (id: string) => void;
}) {
  const [points, setPoints] = useState<FleetPosition[]>([]),
    [error, setError] = useState("");
  const labels = useMemo(
    () =>
      Object.fromEntries(
        vehicles.map((v) => [
          v.id,
          [v.registration_number, v.name].filter(Boolean).join(" · "),
        ]),
      ),
    [vehicles],
  );
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc(
          "vihem_fleet_latest_positions",
        );
        if (!live) return;
        if (error) throw error;
        setPoints(data || []);
        setError("");
      } catch {
        if (live) setError(statusError);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <Card className="mb-6 p-4 sm:p-5">
      <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
        <MapPin className="h-5 w-5" />
        Fordonskarta
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        Senaste kända GPS-position. En punkt innebär inte att fordonet är
        online. Öppna fordonet för kontaktstatus och körjournal.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : points.length ? (
        <FleetGpsMap
          positions={points}
          labels={labels}
          onOpen={onOpenVehicle}
        />
      ) : (
        <p className="py-6 text-sm text-slate-500">
          Inga GPS-positioner mottagna ännu. Registrerade fordon visas när deras
          anslutna enheter börjar rapportera.
        </p>
      )}
    </Card>
  );
}
export function FleetTelemetry({
  vehicle,
  device,
  isAdmin,
  profiles,
}: {
  vehicle: FleetVehicle;
  device: FleetTelematicsDevice | null;
  isAdmin: boolean;
  profiles: { id: string; name: string }[];
}) {
  const [latest, setLatest] = useState<FleetPosition | null>(null),
    [points, setPoints] = useState<FleetPosition[]>([]),
    [trips, setTrips] = useState<FleetTrip[]>([]);
  const [from, setFrom] = useState(stockholmDay()),
    [to, setTo] = useState(stockholmDay()),
    [selected, setSelected] = useState<FleetTrip | null>(null),
    [editing, setEditing] = useState<FleetTrip | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [limited, setLimited] = useState(false),
    [revision, setRevision] = useState(0);
  const [contact, setContact] = useState(device?.last_contact_at);
  const [online, setOnline] = useState(false);
  const [manualMeterKm, setManualMeterKm] = useState<number | null>(null);
  useEffect(() => setManualMeterKm(null), [vehicle.id]);
  const [settings, setSettings] = useState({
      position_retention_days: 90,
      trip_retention_days: 730,
    }),
    [settingsOpen, setSettingsOpen] = useState(false);
  const lock = useRef(false);
  const generation = useRef(0);
  const dirty = useUnsavedChanges(editing, !!editing),
    [discard, setDiscard] = useState(false);
  const load = useCallback(async () => {
    if (!isAdmin) return;
    if (from > to) {
      setError("Slutdatum måste vara samma dag eller senare än startdatum.");
      return;
    }
    const current = ++generation.current;
    setLoading(true);
    try {
      const start = stockholmBoundary(from),
        end = stockholmBoundary(nextDay(to));
      const [last, history, journal, connection, policy] = await Promise.all([
        supabase
          .from("vihem_fleet_telematics_readings")
          .select("*")
          .eq("vehicle_id", vehicle.id)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        (async () => {
          const rows: FleetPosition[] = [];
          for (let page = 0; page <= 10; page++) {
            const result = await supabase
              .from("vihem_fleet_telematics_readings")
              .select("*")
              .eq("vehicle_id", vehicle.id)
              .gte("recorded_at", selected?.started_at || start)
              .lt(
                "recorded_at",
                selected?.ended_at
                  ? new Date(Date.parse(selected.ended_at) + 1).toISOString()
                  : end,
              )
              .order("recorded_at", { ascending: false })
              .order("id", { ascending: false })
              .range(page * 500, page * 500 + 499);
            if (result.error) return { data: rows, error: result.error };
            rows.push(...(result.data || []));
            if ((result.data?.length || 0) < 500) break;
          }
          return { data: rows, error: null };
        })(),
        supabase
          .from("vihem_fleet_trips")
          .select("*")
          .eq("vehicle_id", vehicle.id)
          .gte("started_at", start)
          .lt("started_at", end)
          .order("started_at", { ascending: false })
          .limit(501),
        supabase
          .from("vihem_fleet_telematics_devices")
          .select("last_contact_at")
          .eq("vehicle_id", vehicle.id)
          .eq("active", true)
          .maybeSingle(),
        supabase
          .from("vihem_fleet_tracking_settings")
          .select("position_retention_days,trip_retention_days")
          .eq("organisation_id", vehicle.organisation_id)
          .maybeSingle(),
      ]);
      if (current !== generation.current) return;
      if ([last, history, journal, connection, policy].some((r) => r.error))
        throw Error(statusError);
      setLatest(last.data);
      setPoints((history.data || []).slice(0, 5000));
      setTrips((journal.data || []).slice(0, 500));
      setLimited(
        (history.data?.length || 0) > 5000 || (journal.data?.length || 0) > 500,
      );
      setContact(connection.data?.last_contact_at);
      setOnline(trackingOnline(connection.data?.last_contact_at));
      if (policy.data && !settingsOpen) setSettings(policy.data);
      setError("");
    } catch {
      if (current === generation.current) setError(statusError);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [
    vehicle.id,
    vehicle.organisation_id,
    isAdmin,
    from,
    to,
    selected,
    settingsOpen,
  ]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    const resume = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", resume);
    const requests = generation;
    return () => {
      requests.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [load, revision]);
  async function exportJournal(format: "csv" | "xlsx") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      // Fetch every journal row in the selected period; never silently export only the visible page.
      const all: FleetTrip[] = [];
      let page = 0;
      while (true) {
        const { data, error } = await supabase
          .from("vihem_fleet_trips")
          .select("*")
          .eq("vehicle_id", vehicle.id)
          .gte("started_at", stockholmBoundary(from))
          .lt("started_at", stockholmBoundary(nextDay(to)))
          .order("started_at", { ascending: true })
          .order("id")
          .range(page * 500, page * 500 + 499);
        if (error) throw error;
        all.push(...(data || []));
        if ((data?.length || 0) < 500) break;
        if (++page >= 100) throw Error("Välj en kortare exportperiod.");
      }
      const rows = journalRows(
        all,
        vehicle.registration_number || vehicle.name,
        Object.fromEntries(profiles.map((p) => [p.id, p.name])),
      );
      let blob: Blob;
      if (format === "csv")
        blob = new Blob([csvJournal(rows)], { type: "text/csv;charset=utf-8" });
      else {
        const XLSX = await import("xlsx");
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
          book,
          XLSX.utils.aoa_to_sheet([journalHeaders, ...rows]),
          "Körjournal",
        );
        blob = new Blob(
          [XLSX.write(book, { type: "array", bookType: "xlsx" })],
          {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        );
      }
      await saveOrShareFile(
        blob,
        `korjournal-${(vehicle.registration_number || "fordon").replace(/[^a-z0-9]/gi, "_")}-${from}-${to}.${format}`,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Exporten misslyckades. Försök igen.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function saveTrip() {
    if (!editing || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("vihem_fleet_edit_trip", {
        p_id: editing.id,
        p_revision: editing.revision,
        p_purpose: editing.purpose,
        p_driver: editing.driver_id,
        p_description: editing.description,
        p_notes: editing.notes,
        p_start_address: editing.start_address,
        p_end_address: editing.end_address,
        p_start_meter: editing.start_odometer_km,
        p_end_meter: editing.end_odometer_km,
        p_meter_manual: !!editing.odometer_manual,
      });
      if (error)
        throw Error(
          error.code === "40001"
            ? "Resan ändrades av någon annan. Behåll texten och läs om resan innan du sparar."
            : "Kunde inte spara journalen. Ditt utkast finns kvar.",
        );
      setEditing(null);
      setNotice("Körjournalen är sparad.");
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function saveSettings() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("vihem_fleet_tracking_settings")
        .upsert({ organisation_id: vehicle.organisation_id, ...settings });
      if (error) throw error;
      setSettingsOpen(false);
      setNotice(
        "Organisationens lagringstid är sparad. Gallring gäller även befintlig historik.",
      );
    } catch {
      setError("Lagringstiden kunde inte sparas. Ange 7–3650 dagar.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!isAdmin)
    return (
      <p className="text-sm text-slate-500">
        Positioner och körjournal är tillgängliga för administratörer. Enhetens
        status visas nedan.
      </p>
    );
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Position & körjournal</h3>
          <p className="text-sm text-slate-500">
            Tider visas i svensk tid. Saknade OBD-värden visas aldrig som noll.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void load()}
          loading={loading}
        >
          <RefreshCw className="h-4 w-4" />
          Uppdatera
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4" />
            <Badge
              className={
                online
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 text-slate-600"
              }
            >
              {contact ? (online ? "Online" : "Offline") : "Ingen kontakt ännu"}
            </Badge>
          </div>
          <p className="mt-2 text-sm">{time(contact)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-slate-500">Senast uppmätt hastighet</p>
          <p className="text-xl font-semibold">
            {number(latest?.speed_kmh, "km/h")}
          </p>
          <p className="text-xs text-slate-500">
            {online && latest && trackingOnline(latest.recorded_at)
              ? Number(latest.speed_kmh) >= 5
                ? "Kör"
                : "Står stilla"
              : "Inaktuell/okänd rörelsestatus"}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-slate-500">
            Fordonsmätare · serviceunderlag
          </p>
          <p className="text-xl font-semibold">
            {number(manualMeterKm === null ? vehicle.current_odometer : vehicle.odometer_unit === "mil" ? manualMeterKm / 10 : manualMeterKm, vehicle.odometer_unit)}
          </p>
          <p className="text-xs text-slate-500">
            Avläst manuellt eller rimlig uppmätt OBD-mätare.
          </p>
        </Card>
      </div>
      <FleetGpsOdometer key={vehicle.id} vehicleId={vehicle.id} onCalibrated={setManualMeterKm} />
      {latest ? (
        <dl className="grid grid-cols-2 gap-4 border-y border-slate-200 py-4 text-sm md:grid-cols-4">
          {[
            ["OBD/GPS-mätare", number(latest.odometer, "km")],
            [
              "Mätarunderlag",
              latest.odometer_source === "obd_measured"
                ? "OBD uppmätt"
                : latest.odometer_source === "gps_estimated"
                  ? "GPS beräknat"
                  : "Ej tillgängligt",
            ],
            ["Motorvarvtal", number(latest.engine_rpm, "rpm")],
            ["Färdriktning", number(latest.heading, "°")],
            ["GPS-tid", time(latest.recorded_at)],
            ["Bränslenivå", number(latest.fuel_level_pct, "%")],
            ["Extern spänning", number(latest.battery_voltage, "V")],
            [
              "GPS-enhetens batteri",
              number(latest.backup_battery_voltage, "V"),
            ],
            ["Signal (0–5)", number(latest.signal_quality)],
            [
              "Tändning",
              latest.ignition === null
                ? "Ej tillgängligt"
                : latest.ignition
                  ? "På"
                  : "Av",
            ],
            ["Motortid · enhetsräknare", number(latest.engine_hours, "h")],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
          Ingen telematik mottagen ännu.{" "}
          {device
            ? "Enheten är registrerad; GPS-server och enhetsinställningar måste vara aktiverade."
            : "Koppla en enhet nedan för att komma igång."}
        </p>
      )}
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          label="Från datum (Sverige)"
          type="date"
          value={from}
          onChange={(e) => {
            setSelected(null);
            setFrom(e.target.value);
          }}
        />
        <Input
          label="Till datum (Sverige)"
          type="date"
          value={to}
          onChange={(e) => {
            setSelected(null);
            setTo(e.target.value);
          }}
        />
        <Button
          variant="secondary"
          onClick={() => void exportJournal("csv")}
          disabled={busy || !from || !to || from > to}
        >
          <Download className="h-4 w-4" />
          CSV
        </Button>
        <Button
          variant="secondary"
          onClick={() => void exportJournal("xlsx")}
          disabled={busy || !from || !to || from > to}
        >
          Excel
        </Button>
      </div>
      {limited && (
        <p role="status" className="text-sm text-amber-800">
          Vyn visar högst 5 000 positioner och 500 resor. Välj en enskild resa
          eller kortare period. Exporten hämtar alla resor i perioden.
        </p>
      )}
      {selected && (
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">
            Visar resa {time(selected.started_at)}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
            Alla resor
          </Button>
        </div>
      )}
      {points.length ? (
        <>
          <FleetGpsMap positions={points} labels={EMPTY_LABELS} />
          <p className="text-xs text-slate-500">
            {points.length} positioner · kartan sammanbinder inte uppehåll över
            fem minuter. Senaste i perioden: {points[0].latitude?.toFixed(6)},{" "}
            {points[0].longitude?.toFixed(6)} · {time(points[0].recorded_at)}
          </p>
        </>
      ) : (
        <p className="py-4 text-sm text-slate-500">
          Inga positioner i vald period.
        </p>
      )}
      <div className="space-y-3 md:hidden" aria-label="Körjournal">
        <h3 className="font-semibold">Körjournal · {trips.length} resor</h3>
        {trips.map((t) => (
          <article
            key={t.id}
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{time(t.started_at)}</p>
              <Badge>{purposeLabels[t.purpose]}</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {t.start_address || "GPS-start"} → {t.end_address || "GPS-slut"}
            </p>
            <p className="mt-2 text-sm">
              {number(t.distance_km, "km")} · GPS beräknat ·{" "}
              {t.ended_at
                ? number(
                    Math.round(
                      (Date.parse(t.ended_at) - Date.parse(t.started_at)) /
                        60000,
                    ),
                    "min",
                  )
                : "Pågår"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {profiles.find((p) => p.id === t.driver_id)?.name ||
                "Förare saknas"}{" "}
              · stilla {number(Math.round(t.idle_seconds / 60), "min")}
              {t.needs_review ? " · Kontroll krävs" : ""}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setSelected(t)}>
                Karta
              </Button>
              <Button
                onClick={() => {
                  setError("");
                  setEditing({ ...t });
                }}
              >
                Journal
              </Button>
            </div>
          </article>
        ))}
        {!trips.length && (
          <p className="text-sm text-slate-500">Inga resor i vald period.</p>
        )}
      </div>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
        <table className="w-full text-left text-sm">
          <caption className="p-4 text-left font-semibold">
            Körjournal · nya resor behöver klassificeras
          </caption>
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              {["Resa", "Sträcka / tid", "Typ / förare", "Åtgärder"].map(
                (h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {trips.map((t) => (
              <tr key={t.id}>
                <td className="min-w-40 px-4 py-3">
                  <p className="font-medium">{time(t.started_at)}</p>
                  <p className="text-xs text-slate-500">
                    {t.ended_at ? time(t.ended_at) : "Pågående"}
                    {t.needs_review ? " · Kontroll krävs" : ""}
                  </p>
                  <p className="text-xs">
                    {t.start_address || "GPS-start"} →{" "}
                    {t.end_address || "GPS-slut"}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <p>{number(t.distance_km, "km")} · beräknat</p>
                  <p className="text-xs text-slate-500">
                    {t.ended_at
                      ? number(
                          Math.round(
                            (Date.parse(t.ended_at) -
                              Date.parse(t.started_at)) /
                              60000,
                          ),
                          "min",
                        )
                      : "Pågår"}{" "}
                    · stilla {number(Math.round(t.idle_seconds / 60), "min")}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <p>{purposeLabels[t.purpose]}</p>
                  <p className="text-xs text-slate-500">
                    {profiles.find((p) => p.id === t.driver_id)?.name ||
                      "Förare saknas"}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setSelected(t)}
                    >
                      Karta
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setError("");
                        setEditing({ ...t });
                      }}
                    >
                      Journal
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!trips.length && (
          <p className="p-4 text-sm text-slate-500">
            Inga resor i vald period.
          </p>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
        Lagringstid · {settings.position_retention_days} dagar positioner /{" "}
        {settings.trip_retention_days} dagar journal
      </Button>
      <Modal
        open={!!editing}
        onClose={() => {
          if (busy) return;
          if (dirty) setDiscard(true);
          else setEditing(null);
        }}
        title="Komplettera körjournal"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (dirty) setDiscard(true);
                else setEditing(null);
              }}
            >
              Avbryt
            </Button>
            <Button loading={busy} onClick={() => void saveTrip()}>
              Spara journal
            </Button>
          </>
        }
      >
        {editing && (
          <fieldset disabled={busy} className="space-y-4">
            <p className="text-sm text-slate-500">
              {time(editing.started_at)} · GPS-sträckan är beräknad. Kontrollera
              uppgifterna inför användning som skatteunderlag.
            </p>
            <Select
              label="Resans typ"
              value={editing.purpose}
              options={Object.entries(purposeLabels).map(([value, label]) => ({
                value,
                label,
              }))}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  purpose: e.target.value as FleetTrip["purpose"],
                })
              }
            />
            <Select
              label="Förare"
              value={editing.driver_id || ""}
              options={[
                { value: "", label: "Välj förare" },
                ...profiles.map((p) => ({ value: p.id, label: p.name })),
              ]}
              onChange={(e) =>
                setEditing({ ...editing, driver_id: e.target.value || null })
              }
            />
            <Input
              label="Syfte / kund eller arbetsplats"
              value={editing.description}
              onChange={(e) =>
                setEditing({ ...editing, description: e.target.value })
              }
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="number"
                min="0"
                label="Startmätare (km)"
                value={editing.start_odometer_km ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    odometer_manual: true,
                    start_odometer_km:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <Input
                type="number"
                min="0"
                label="Slutmätare (km)"
                value={editing.end_odometer_km ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    odometer_manual: true,
                    end_odometer_km:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </div>
            <p className="text-xs text-slate-500">
              OBD-värden fylls i när de finns. Egna ändringar märks som manuella
              i exporten.
            </p>
            <Input
              label="Startadress"
              value={editing.start_address}
              onChange={(e) =>
                setEditing({ ...editing, start_address: e.target.value })
              }
            />
            <Input
              label="Slutadress"
              value={editing.end_address}
              onChange={(e) =>
                setEditing({ ...editing, end_address: e.target.value })
              }
            />
            <Textarea
              label="Anteckningar"
              value={editing.notes}
              onChange={(e) =>
                setEditing({ ...editing, notes: e.target.value })
              }
            />
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
          </fieldset>
        )}
      </Modal>
      <Modal
        open={discard}
        onClose={() => setDiscard(false)}
        title="Kasta osparade journaländringar?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDiscard(false)}>
              Fortsätt redigera
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDiscard(false);
                setEditing(null);
              }}
            >
              Kasta ändringar
            </Button>
          </>
        }
      >
        <p>Dina ändringar har inte sparats.</p>
      </Modal>
      <Modal
        open={settingsOpen}
        onClose={() => {
          if (!busy) setSettingsOpen(false);
        }}
        title="Organisationens GPS-lagring"
        footer={
          <Button loading={busy} onClick={() => void saveSettings()}>
            Bekräfta lagringstid
          </Button>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-amber-800">
            En kortare lagringstid gallrar även befintlig historik.
            Inställningen gäller alla organisationens fordon. Kö och Traccars
            rådata har separat lagringstid som driftansvarig måste samordna.
          </p>
          <Input
            type="number"
            min="7"
            max="3650"
            label="Positioner, dagar"
            value={settings.position_retention_days}
            onChange={(e) =>
              setSettings({
                ...settings,
                position_retention_days: Number(e.target.value),
              })
            }
          />
          <Input
            type="number"
            min="7"
            max="3650"
            label="Körjournal, dagar"
            value={settings.trip_retention_days}
            onChange={(e) =>
              setSettings({
                ...settings,
                trip_retention_days: Number(e.target.value),
              })
            }
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </section>
  );
}
