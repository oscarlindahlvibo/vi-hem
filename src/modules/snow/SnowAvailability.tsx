import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Users,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import {
  Button,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
} from "../../components/ui";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import {
  addDays,
  calendarDay,
  capacitySegments,
  dutyConflict,
  dutySlots,
  minuteLabel,
  parseMinute,
  statusLabels,
  validateSlots,
  weekStart,
  monthStart,
  monthDays,
  shiftMonth,
  monthLeadingDays,
  type AvailabilityStatus,
  type SnowAvailabilitySnapshot,
} from "./availability";
const EMPTY: SnowAvailabilitySnapshot = {
  people: [],
  days: [],
  shifts: [],
  absences: [],
};
const dateLabel = (d: string) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("sv-SE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const styles: Record<AvailabilityStatus, string> = {
  available: "bg-blue-50 text-blue-800",
  partial: "bg-amber-50 text-amber-900",
  unavailable: "bg-red-50 text-red-800",
  unknown: "bg-slate-50 text-slate-500",
};
export function SnowAvailability() {
  const { user } = useAuth();
  const selfOnly = user?.role === "snow";
  const [view, setView] = useState<"week" | "month">(
    selfOnly ? "month" : "week",
  );
  const [showDays, setShowDays] = useState(false);
  const [picking, setPicking] = useState(false),
    [picked, setPicked] = useState<string[]>([]);
  const admin = user?.role === "admin" || user?.role === "superadmin";
  const [loadedAnchor, setLoadedAnchor] = useState("");
  const [anchor, setAnchor] = useState(() =>
    selfOnly ? monthStart(calendarDay()) : weekStart(calendarDay()),
  );
  const days = useMemo(
    () =>
      view === "month"
        ? monthDays(anchor)
        : Array.from({ length: 7 }, (_, i) => addDays(anchor, i)),
    [anchor, view],
  );
  const rangeKey = anchor + ":" + view;
  const [selected, setSelected] = useState(calendarDay()),
    [target, setTarget] = useState(user?.id || ""),
    [data, setData] = useState<SnowAvailabilitySnapshot>(EMPTY),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [windowStart, setWindowStart] = useState("00:00"),
    [windowEnd, setWindowEnd] = useState("24:00");
  const [editing, setEditing] = useState(false),
    [chosen, setChosen] = useState<string[]>([]),
    [status, setStatus] = useState<AvailabilityStatus>("available"),
    [times, setTimes] = useState<[string, string][]>([["00:00", "24:00"]]),
    [expected, setExpected] = useState<Record<string, number>>({}),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(""),
    [discard, setDiscard] = useState(false),
    [stale, setStale] = useState(false);
  const pending = useRef<{ id: string; body: string } | null>(null),
    lock = useRef(false),
    generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const dayRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = dayRow.current;
    if (!node) return;
    const reveal = () => {
      const button = node.querySelector<HTMLElement>(
        `[data-day="${selected}"]`,
      );
      if (button && node.scrollWidth > node.clientWidth)
        node.scrollTo({
          left: button.offsetLeft - (node.clientWidth - button.offsetWidth) / 2,
        });
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(node);
    return () => observer.disconnect();
  }, [selected, loadedAnchor]);
  const dirty = useUnsavedChanges({ chosen, status, times }, editing);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const { data: next, error: e } = await supabase.rpc(
        "vihem_snow_availability_snapshot",
        { p_from: anchor, p_days: days.length },
      );
      if (e) throw e;
      if (request === generation.current) {
        setData(next as SnowAvailabilitySnapshot);
        setLoadedAnchor(rangeKey);
        setError("");
        return next as SnowAvailabilitySnapshot;
      }
    } catch (e) {
      if (request === generation.current)
        setError(
          e instanceof Error
            ? e.message
            : (e as { message?: string }).message ||
                "Kunde inte läsa tillgängligheten.",
        );
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [anchor, days.length, rangeKey]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => {
      invalidate();
      clearInterval(timer);
    };
  }, [load, invalidate]);
  function changeWeek(by: number) {
    const next =
      view === "month"
        ? shiftMonth(anchor, by < 0 ? -1 : 1)
        : addDays(anchor, by);
    setAnchor(next);
    setSelected(next);
    setNotice("");
    setPicked([]);
    setPicking(false);
  }
  function openEditor(dates: string[], person = target) {
    const entry = data.days.find(
      (d) => d.user_id === person && d.work_date === dates[0],
    );
    setTarget(person);
    setChosen(dates);
    setStatus(entry?.status || "available");
    setTimes(
      entry?.status === "partial"
        ? entry.slots.map(([a, b]) => [minuteLabel(a), minuteLabel(b)])
        : [["00:00", "24:00"]],
    );
    setExpected(
      Object.fromEntries(
        days.map((d) => [
          d,
          data.days.find((a) => a.user_id === person && a.work_date === d)
            ?.revision || 0,
        ]),
      ),
    );
    setSaveError("");
    setStale(false);
    pending.current = null;
    setShowDays(false);
    setEditing(true);
  }
  function closeEditor() {
    if (saving) return;
    if (dirty) setDiscard(true);
    else setEditing(false);
  }
  async function save() {
    if (lock.current || !user) return;
    lock.current = true;
    setSaving(true);
    setSaveError("");
    try {
      if (!chosen.length) throw Error("Välj minst en dag.");
      const slots =
        status === "partial"
          ? validateSlots(
              times.map(([a, b]) => [parseMinute(a), parseMinute(b)]),
            )
          : [];
      const payload = {
        p_user: target,
        p_days: [...chosen].sort(),
        p_status: status,
        p_slots: slots,
        p_expected: Object.fromEntries(
          chosen.map((d) => [d, expected[d] ?? 0]),
        ),
      };
      const body = JSON.stringify(payload);
      if (pending.current && pending.current.body !== body)
        throw Error(
          "Återförsök först den föregående sparningen innan du ändrar uppgifterna.",
        );
      pending.current ??= { id: crypto.randomUUID(), body };
      const { data: rows, error: e } = await supabase.rpc(
        "vihem_snow_availability_save",
        { p_operation: pending.current.id, ...payload },
      );
      if (e) {
        if (e.code === "40001") {
          setStale(true);
          pending.current = null;
        } else if (
          e.code &&
          ![
            "57014",
            "08006",
            "PGRST000",
            "PGRST001",
            "PGRST002",
            "PGRST003",
          ].includes(e.code)
        )
          pending.current = null;
        throw e;
      }
      const ids = new Set(chosen);
      setData((old) => ({
        ...old,
        days: [
          ...old.days.filter(
            (d) => d.user_id !== target || !ids.has(d.work_date),
          ),
          ...(rows || []),
        ],
      }));
      pending.current = null;
      setEditing(false);
      setPicked([]);
      setPicking(false);
      setNotice(
        `${chosen.length} ${chosen.length === 1 ? "dag sparad" : "dagar sparade"} för ${data.people.find((p) => p.id === target)?.name || "dig"}.`,
      );
      void load();
    } catch (e) {
      setSaveError(
        e instanceof Error
          ? e.message
          : (e as { message?: string }).message ||
              "Kunde inte spara. Uppgifterna finns kvar; försök igen.",
      );
    } finally {
      setSaving(false);
      lock.current = false;
    }
  }
  let windowError = "";
  let from = 0,
    to = 1440;
  try {
    from = parseMinute(windowStart);
    to = parseMinute(windowEnd);
    if (from >= to) throw Error("Sluttiden måste vara efter starttiden.");
  } catch (e) {
    windowError = (e as Error).message;
  }
  const coverage = capacitySegments(
    data,
    selected,
    from < to ? from : 0,
    from < to ? to : 1440,
  );
  const min = coverage.length
    ? Math.min(...coverage.map((c) => c.people.length))
    : 0;
  const dailyCapacity = useMemo(
    () =>
      Object.fromEntries(
        days.map((day) => [
          day,
          Math.min(
            ...capacitySegments(
              data,
              day,
              from < to ? from : 0,
              from < to ? to : 1440,
            ).map((p) => p.people.length),
          ),
        ]),
      ),
    [days, data, from, to],
  );
  const rowFor = (person: string, date: string) =>
    data.days.find((d) => d.user_id === person && d.work_date === date);
  const absent = (person: string, date: string) =>
    data.absences.some(
      (a) => a.user_id === person && a.start_date <= date && a.end_date >= date,
    );
  const labelFor = (person: string, date: string) => {
    const entry = rowFor(person, date);
    return entry?.status === "partial"
      ? entry.slots
          .map(([a, b]) => `${minuteLabel(a)}–${minuteLabel(b)}`)
          .join(", ")
      : statusLabels[entry?.status || "unknown"];
  };
  const dayJour = data.people.filter(
    (p) => dutySlots(data, selected, p.id).length > 0,
  );
  return (
    <section className="space-y-5">
      <PageHeader
        title={selfOnly ? "Min tillgänglighet" : "Tillgänglighet för snö"}
        subtitle={
          selfOnly
            ? "Ange när du kan köra. Välj en dag eller flera dagar samtidigt."
            : "Planera tre chaufförer samtidigt. Jouransvarig visas grönt och räknas högst en gång."
        }
        icon={Users}
      />
      <div className="flex gap-2" role="group" aria-label="Kalendervy">
        {(
          [
            ["week", "Vecka"],
            ["month", "Månad"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant={view === key ? "primary" : "secondary"}
            aria-pressed={view === key}
            onClick={() => {
              setView(key);
              setAnchor(
                key === "month" ? monthStart(selected) : weekStart(selected),
              );
              setPicked([]);
              setPicking(false);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          aria-label={
            view === "month" ? "Föregående månad" : "Föregående vecka"
          }
          onClick={() => changeWeek(-7)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <strong className="min-w-44">
          {view === "month"
            ? new Date(anchor + "T12:00:00Z").toLocaleDateString("sv-SE", {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })
            : `${dateLabel(anchor)} – ${dateLabel(days[6])} ${anchor.slice(0, 4)}${anchor.slice(0, 4) !== days[6].slice(0, 4) ? "/" + days[6].slice(0, 4) : ""}`}
        </strong>
        <Button
          variant="secondary"
          aria-label={view === "month" ? "Nästa månad" : "Nästa vecka"}
          onClick={() => changeWeek(7)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            const today = calendarDay();
            setAnchor(view === "month" ? monthStart(today) : weekStart(today));
            setPicked([]);
            setPicking(false);
            setSelected(today);
          }}
        >
          {view === "month" ? "Denna månad" : "Denna vecka"}
        </Button>
        <Button
          variant="secondary"
          aria-label="Uppdatera tillgänglighet"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">
          {error}{" "}
          <button className="underline" onClick={() => void load()}>
            Försök igen
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-blue-50 p-3 text-blue-800">
          {notice}
        </p>
      )}
      {!error && loading && data.people.length === 0 && (
        <p role="status">Läser tillgänglighet…</p>
      )}
      {(!selfOnly || view === "week") && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-4">
          {admin && (
            <div className="min-w-48 flex-1">
              <Select
                label="Registrera för"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                options={data.people.map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
              />
            </div>
          )}
          <Button
            disabled={loading || !!error || !target}
            onClick={() => openEditor([selected])}
          >
            Ange tillgänglighet
          </Button>
          <Button
            variant="secondary"
            disabled={loading || !!error || !target}
            onClick={() => openEditor(days)}
          >
            Fyll flera dagar
          </Button>
          <p className="w-full text-sm text-slate-500">
            Tillgänglighet är ett besked om när man kan köra. Jourpass tilldelas
            som vanligt under Snöjour. Ett tomt svar räknas inte som
            tillgängligt, förutom under tilldelad jour.
          </p>
        </div>
      )}
      {!error && loadedAnchor === rangeKey && (
        <>
          {view === "month" ? (
            <section
              className="overflow-hidden rounded-2xl border bg-white"
              aria-label="Månadskalender"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                <p className="text-sm text-slate-600">
                  {picking
                    ? `${picked.length} dagar valda`
                    : "Tryck på en dag för att ange tillgänglighet."}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPicking(!picking);
                    setPicked([]);
                  }}
                >
                  {picking ? "Avsluta dagval" : "Välj flera dagar"}
                </Button>
                {picking && (
                  <Button
                    disabled={!picked.length}
                    onClick={() => openEditor(picked)}
                  >
                    Registrera {picked.length} dagar
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-7 border-b bg-slate-50 text-center text-xs font-semibold">
                {["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"].map((d) => (
                  <span className="py-3" key={d}>
                    {d}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {Array.from({ length: monthLeadingDays(anchor) }, (_, i) => (
                  <div
                    key={"blank" + i}
                    aria-hidden="true"
                    className="min-h-24 border-b border-r bg-slate-50"
                  />
                ))}
                {days.map((day) => {
                  const jour = dutySlots(data, day, target).length > 0;
                  const entry = rowFor(target, day);
                  return (
                    <button
                      key={day}
                      aria-label={`${dateLabel(day)}: ${labelFor(target, day)}${jour ? ", jouransvarig" : ""}`}
                      aria-pressed={
                        picking ? picked.includes(day) : selected === day
                      }
                      onClick={() => {
                        setSelected(day);
                        if (picking)
                          setPicked((old) =>
                            old.includes(day)
                              ? old.filter((d) => d !== day)
                              : [...old, day],
                          );
                        else openEditor([day]);
                      }}
                      className={`min-h-24 min-w-0 border-b border-r p-1 text-left sm:min-h-28 sm:p-3 ${picked.includes(day) || (!picking && selected === day) ? "ring-2 ring-inset ring-blue-500 " : ""}${jour ? "bg-emerald-50" : styles[entry?.status || "unknown"]}`}
                    >
                      <strong className="block text-sm">
                        {Number(day.slice(-2))}
                      </strong>
                      <span className="block break-words text-[11px] leading-4 sm:text-xs">
                        {entry?.status === "partial"
                          ? "Del av dag"
                          : entry?.status === "available"
                            ? "Kan köra"
                            : entry?.status === "unavailable"
                              ? "Kan inte"
                              : "Ej svar"}
                      </span>
                      {jour && (
                        <span className="block text-[10px] font-bold text-emerald-800 sm:text-xs">
                          Jour
                        </span>
                      )}
                      {!selfOnly && (
                        <span className="mt-1 block text-[10px] text-slate-500 sm:text-xs">
                          {windowError ? "–" : `${dailyCapacity[day]}/3`}
                        </span>
                      )}
                    </button>
                  );
                })}
                {Array.from(
                  {
                    length:
                      (7 - ((monthLeadingDays(anchor) + days.length) % 7)) % 7,
                  },
                  (_, i) => (
                    <div
                      key={"endblank" + i}
                      aria-hidden="true"
                      className="min-h-24 border-b border-r bg-slate-50"
                    />
                  ),
                )}
              </div>
            </section>
          ) : (
            <div
              ref={dayRow}
              className="relative flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-4 lg:grid-cols-7"
              aria-label="Välj dag"
            >
              {days.map((day) => {
                const count = dailyCapacity[day];
                return (
                  <button
                    key={day}
                    data-day={day}
                    aria-pressed={selected === day}
                    onClick={() => setSelected(day)}
                    className={`min-h-24 min-w-28 shrink-0 rounded-xl border p-3 text-left sm:min-w-0 ${selected === day ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"}`}
                  >
                    <span className="block text-sm font-semibold">
                      {dateLabel(day)}
                    </span>
                    <strong
                      className={`block text-lg ${count >= 3 ? "text-emerald-700" : "text-amber-800"}`}
                    >
                      {selfOnly
                        ? rowFor(target, day)?.status === "partial"
                          ? "Del av dag"
                          : rowFor(target, day)?.status === "available"
                            ? "Kan köra"
                            : rowFor(target, day)?.status === "unavailable"
                              ? "Kan inte"
                              : "Ej svar"
                        : windowError
                          ? "–"
                          : `${count}/3`}
                    </strong>
                    <span className="text-xs text-slate-600">
                      {selfOnly
                        ? dutySlots(data, day, target).length
                          ? "Jouransvarig"
                          : "Min tillgänglighet"
                        : "minst samtidigt"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {!selfOnly && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <section className="overflow-hidden rounded-2xl border bg-white">
                <div className="border-b p-4">
                  <h2 className="font-bold">Bemanning {dateLabel(selected)}</h2>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Input
                      label="Kontrollera från"
                      type="time"
                      value={windowStart}
                      onChange={(e) => setWindowStart(e.target.value)}
                    />
                    <Input
                      label="Kontrollera till"
                      value={windowEnd}
                      placeholder="24:00"
                      inputMode="numeric"
                      onChange={(e) => setWindowEnd(e.target.value)}
                    />
                  </div>
                  {windowError ? (
                    <p role="alert" className="mt-2 text-sm text-red-700">
                      {windowError}
                    </p>
                  ) : (
                    <p className="mt-3 text-sm">
                      {min >= 3
                        ? "Minst tre chaufförer täcker hela det valda intervallet."
                        : `Som lägst ${min} av 3 chaufförer under det valda intervallet.`}
                    </p>
                  )}
                </div>
                {!windowError &&
                  coverage.map((part) => (
                    <div
                      key={part.start}
                      className="flex flex-wrap items-start gap-x-4 gap-y-1 border-b px-4 py-3 last:border-0"
                    >
                      <strong className="w-28 shrink-0 text-sm tabular-nums">
                        {minuteLabel(part.start)}–{minuteLabel(part.end)}
                      </strong>
                      <span
                        className={`rounded px-2 py-0.5 text-sm font-semibold ${part.people.length >= 3 ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}
                      >
                        {part.people.length}/3
                      </span>
                      <span className="min-w-0 flex-1 text-sm text-slate-600">
                        {part.people.map((p) => p.name).join(", ") ||
                          "Ingen har angett tillgänglighet eller tilldelats jour."}
                      </span>
                    </div>
                  ))}
              </section>
              <section className="rounded-2xl border bg-white p-4">
                <h2 className="font-bold">Jouransvarig</h2>
                {!dayJour.length && (
                  <p className="mt-3 text-sm text-amber-800">
                    Ingen tilldelad snöjour denna dag.
                  </p>
                )}
                {dayJour.map((p) => (
                  <div key={p.id} className="mt-3 rounded-lg bg-emerald-50 p-3">
                    <strong className="text-emerald-900">{p.name}</strong>
                    <p className="text-sm text-emerald-800">
                      {dutySlots(data, selected, p.id)
                        .map(([a, b]) => `${minuteLabel(a)}–${minuteLabel(b)}`)
                        .join(", ")}
                    </p>
                    {dutyConflict(data, selected, p.id) && (
                      <p className="mt-2 text-sm font-semibold text-red-800">
                        Jouren krockar med angiven tillgänglighet eller godkänd
                        frånvaro.
                      </p>
                    )}
                  </div>
                ))}
              </section>
            </div>
          )}
          {view === "week" && !selfOnly && (
            <section className="hidden overflow-hidden rounded-2xl border bg-white md:block">
              <h2 className="border-b p-4 font-bold">Veckans tillgänglighet</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-white p-3">Chaufför</th>
                      {days.map((d) => (
                        <th key={d} className="min-w-28 p-3">
                          {dateLabel(d)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.people.map((p) => (
                      <tr key={p.id} className="border-t">
                        <th className="sticky left-0 bg-white p-3 font-semibold">
                          {p.name}
                        </th>
                        {days.map((d) => {
                          const jour = dutySlots(data, d, p.id).length > 0;
                          return (
                            <td key={d} className="p-1">
                              <button
                                disabled={!admin && p.id !== user?.id}
                                onClick={() => openEditor([d], p.id)}
                                className={`min-h-16 w-full rounded-lg p-2 text-left ${styles[rowFor(p.id, d)?.status || "unknown"]} ${jour ? "ring-2 ring-inset ring-emerald-500" : ""}`}
                              >
                                <span className="block">
                                  {labelFor(p.id, d)}
                                </span>
                                {absent(p.id, d) && (
                                  <strong className="block text-xs text-red-700">
                                    Ej i tjänst
                                  </strong>
                                )}
                                {jour && (
                                  <strong className="block text-xs text-emerald-800">
                                    Jouransvarig
                                  </strong>
                                )}
                                {dutyConflict(data, d, p.id) && (
                                  <strong className="block text-xs text-red-700">
                                    Jourkonflikt
                                  </strong>
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {!selfOnly && (
            <section className="space-y-2 md:hidden">
              <h2 className="font-bold">Chaufförer {dateLabel(selected)}</h2>
              {data.people.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between gap-2 rounded-xl border p-3 ${dutySlots(data, selected, p.id).length ? "border-emerald-500 bg-emerald-50" : "bg-white"}`}
                >
                  <div>
                    <strong className="block">{p.name}</strong>
                    <span className="text-sm text-slate-600">
                      {labelFor(p.id, selected)}
                    </span>
                    {absent(p.id, selected) && (
                      <strong className="block text-xs text-red-700">
                        Ej i tjänst
                      </strong>
                    )}
                    {dutySlots(data, selected, p.id).length > 0 && (
                      <span className="block text-xs font-semibold text-emerald-800">
                        Jouransvarig
                      </span>
                    )}
                  </div>
                  {(admin || p.id === user?.id) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openEditor([selected], p.id)}
                    >
                      Ändra
                    </Button>
                  )}
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {!loading && !error && data.people.length === 0 && (
        <EmptyState
          icon={CalendarDays}
          title="Inga aktiva chaufförer"
          description="Lägg först upp personal i organisationen."
        />
      )}
      <Modal
        open={editing}
        onClose={closeEditor}
        title={`Tillgänglighet · ${data.people.find((p) => p.id === target)?.name || "Min tid"}`}
        mobileFullscreen
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={saving} onClick={closeEditor}>
              Avbryt
            </Button>
            <Button
              loading={saving}
              disabled={stale || !chosen.length}
              onClick={() => void save()}
            >
              {pending.current ? "Försök spara igen" : "Spara"}
            </Button>
          </div>
        }
      >
        <fieldset
          disabled={saving || !!pending.current}
          className="min-w-0 space-y-4"
        >
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-semibold">
                {view === "month"
                  ? `${chosen.length} dagar valda`
                  : "Välj dagar"}
              </p>
              {view === "month" && (
                <Button
                  variant="secondary"
                  onClick={() => setShowDays(!showDays)}
                >
                  {showDays ? "Dölj dagar" : "Ändra dagar"}
                </Button>
              )}
            </div>
            {(view === "week" || showDays) && (
              <div className="flex flex-wrap gap-2">
                {days.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={chosen.includes(d)}
                    onClick={() =>
                      setChosen((old) =>
                        old.includes(d)
                          ? old.filter((v) => v !== d)
                          : [...old, d],
                      )
                    }
                    className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${chosen.includes(d) ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-200"}`}
                  >
                    {view === "month"
                      ? `${Number(d.slice(-2))} ${new Date(d + "T12:00:00Z").toLocaleDateString("sv-SE", { weekday: "short", timeZone: "UTC" })}`
                      : dateLabel(d)}
                  </button>
                ))}
              </div>
            )}
            {view === "month" && !showDays && (
              <p className="text-sm text-slate-600">
                {chosen
                  .slice()
                  .sort()
                  .map((d) => dateLabel(d))
                  .join(", ")}
              </p>
            )}
          </div>
          <Select
            label="När kan du köra?"
            value={status}
            onChange={(e) => setStatus(e.target.value as AvailabilityStatus)}
            options={Object.entries(statusLabels).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          {status === "partial" && (
            <div className="space-y-3">
              {times.map(([a, b], i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-28 flex-1">
                    <Input
                      label={`Från ${i + 1}`}
                      value={a}
                      placeholder="00:00"
                      onChange={(e) =>
                        setTimes((old) =>
                          old.map((v, j) =>
                            j === i ? [e.target.value, v[1]] : v,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="min-w-28 flex-1">
                    <Input
                      label={`Till ${i + 1}`}
                      value={b}
                      placeholder="24:00"
                      onChange={(e) =>
                        setTimes((old) =>
                          old.map((v, j) =>
                            j === i ? [v[0], e.target.value] : v,
                          ),
                        )
                      }
                    />
                  </div>
                  {times.length > 1 && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setTimes((old) => old.filter((_, j) => i !== j))
                      }
                    >
                      Ta bort
                    </Button>
                  )}
                </div>
              ))}
              <Button
                variant="secondary"
                disabled={times.length >= 4}
                onClick={() => setTimes([...times, ["00:00", "24:00"]])}
              >
                Lägg till tidsintervall
              </Button>
              <p className="text-sm text-slate-500">
                Tiderna gäller svensk tid. Använd exempelvis 00:00–06:00 och
                17:00–24:00 om du kan köra utanför ordinarie arbetstid.
              </p>
            </div>
          )}
          {admin && (
            <p className="text-sm text-slate-500">
              Du registrerar för{" "}
              {data.people.find((p) => p.id === target)?.name}. Jouransvaret
              ändras inte.
            </p>
          )}
        </fieldset>
        {saveError && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 p-3 text-red-800"
          >
            {saveError}
          </p>
        )}
        {stale && (
          <Button
            variant="secondary"
            onClick={async () => {
              const latest = await load();
              if (!latest) return;
              setExpected(
                Object.fromEntries(
                  days.map((d) => [
                    d,
                    latest.days.find(
                      (a) => a.user_id === target && a.work_date === d,
                    )?.revision || 0,
                  ]),
                ),
              );
              setStale(false);
              setSaveError(
                "Ditt utkast är kvar. Kontrollera senaste sparade svar innan du sparar igen: " +
                  chosen
                    .map((d) => {
                      const entry = latest.days.find(
                        (a) => a.user_id === target && a.work_date === d,
                      );
                      return (
                        dateLabel(d) +
                        ": " +
                        statusLabels[entry?.status || "unknown"] +
                        (entry?.status === "partial"
                          ? " " +
                            entry.slots
                              .map(
                                ([a, b]) =>
                                  minuteLabel(a) + "–" + minuteLabel(b),
                              )
                              .join(", ")
                          : "")
                      );
                    })
                    .join("; "),
              );
            }}
          >
            Läs in senaste uppgifter
          </Button>
        )}
      </Modal>
      <Modal
        open={discard}
        onClose={() => setDiscard(false)}
        title="Kasta osparad tillgänglighet?"
        size="sm"
      >
        <p>Dina ändringar har inte sparats.</p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => setDiscard(false)}>
            Fortsätt redigera
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              pending.current = null;
              setDiscard(false);
              setEditing(false);
            }}
          >
            Kasta ändringar
          </Button>
        </div>
      </Modal>
    </section>
  );
}
