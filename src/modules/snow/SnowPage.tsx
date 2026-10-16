import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map, Plus, Snowflake, Check } from "lucide-react";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import {
  Button,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  Tabs,
  Textarea,
} from "../../components/ui";
import {
  executeClockOperation,
  pendingClockOperation,
  reconcileClockOperation,
  saveClockOperation,
  type ClockAction,
  type ClockOperation,
} from "../../lib/clockTransitions";
import type { TimeEntry } from "../../types";
import { JourPage } from "../../pages/JourPage";
import { SnowDriverHome } from "./SnowDriverHome";
import { SnowAvailability } from "./SnowAvailability";
import { SnowMap } from "./SnowMap";
import {
  activityLabel,
  geometryParts,
  methodLabel,
  mixedGeometry,
  sortRoutes,
  snowClientColors,
  type SnowActivity,
  type SnowClient,
  type SnowMethod,
  type SnowRoute,
} from "./model";

const NO_ROUTES: SnowRoute[] = [];

export function SnowPage(props: { onNavigate?: (page: string) => void }) {
  const { user, signOut } = useAuth();
  if (user?.role !== "snow")
    return (
      <SnowWorkspace key={`${user?.id}:${user?.organisation_id}`} {...props} />
    );
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="flex items-center justify-between border-b bg-white p-4">
        <strong>VI-HEM · Snökörning</strong>
        <Button variant="secondary" size="sm" onClick={() => void signOut()}>
          Logga ut
        </Button>
      </header>
      {user.snow_time_access ? (
        <SnowWorkspace key={`${user.id}:${user.organisation_id}`} />
      ) : (
        <SnowDutyOnly />
      )}
    </div>
  );
}
function SnowDutyOnly() {
  const { user } = useAuth();
  const [shifts, setShifts] = useState<
      { id: string; starts_at: string; ends_at: string }[]
    >([]),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!user?.organisation_id) return;
    const { data, error } = await supabase
      .from("vihem_jour_shifts")
      .select("id,starts_at,ends_at")
      .eq("organisation_id", user.organisation_id)
      .eq("user_id", user.id)
      .eq("duty_type", "sno")
      .gt("ends_at", new Date().toISOString())
      .order("starts_at");
    if (error) {
      setError(error.message);
      return;
    }
    setShifts(data || []);
    setError("");
  }, [user?.id, user?.organisation_id]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => clearInterval(timer);
  }, [load]);
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-5">
      <PageHeader
        title="Min snöjour"
        subtitle="Dina kommande jourpass"
        icon={Snowflake}
      />
      {error && <p role="alert">{error}</p>}
      <Button variant="secondary" onClick={() => void load()}>
        Uppdatera
      </Button>
      {shifts.map((s) => (
        <section key={s.id} className="rounded-xl border bg-white p-4">
          <strong>Snöjour</strong>
          <p>
            {new Date(s.starts_at).toLocaleString("sv-SE")} –{" "}
            {new Date(s.ends_at).toLocaleString("sv-SE")}
          </p>
        </section>
      ))}
      {!shifts.length && !error && <p>Inga kommande jourpass.</p>}
    </div>
  );
}
type SnowTime = TimeEntry & {
  snow_client_id: string | null;
  snow_route_id: string | null;
  snow_method: SnowMethod | null;
};
const describe = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String(e.message)
      : "Något gick fel. Försök igen.";

function SnowWorkspace({
  onNavigate,
}: {
  onNavigate?: (page: string) => void;
}) {
  const { user } = useAuth();
  const admin = user?.role === "admin" || user?.role === "superadmin";
  const [tab, setTab] = useState(user?.role === "snow" ? "home" : "work"),
    [clients, setClients] = useState<SnowClient[]>([]),
    [routes, setRoutes] = useState<SnowRoute[]>([]),
    [entries, setEntries] = useState<SnowTime[]>([]);
  const [completed, setCompleted] = useState<
      { id: string; route_id: string; completed_at: string }[]
    >([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<SnowMethod>("machine"),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState(""),
    [clientFilter, setClientFilter] = useState("");
  const [pending, setPending] = useState<ClockOperation | null>(() =>
    user?.organisation_id
      ? pendingClockOperation(user.id, user.organisation_id)
      : null,
  );
  const [editor, setEditor] = useState<{
      kind: "client" | "route";
      id: string;
      revision: number | null;
    } | null>(null),
    [form, setForm] = useState({
      name: "",
      client_id: "",
      method: "machine" as SnowMethod,
      priority: "2",
      instructions: "",
      active: true,
    }),
    [segments, setSegments] = useState<number[][][]>([[]]),
    [activeSegment, setActiveSegment] = useState(0),
    [areas, setAreas] = useState<boolean[]>([false]);
  const [discard, setDiscard] = useState(false);
  const points = segments[activeSegment] || [];
  const area = areas[activeSegment] || false;
  const setArea = (value: boolean) =>
    setAreas((current) =>
      current.map((old, index) => (index === activeSegment ? value : old)),
    );
  function addPart(isArea: boolean) {
    setSegments([...segments, []]);
    setAreas([...areas, isArea]);
    setActiveSegment(segments.length);
  }

  const setPoints = useCallback(
    (next: number[][]) =>
      setSegments((current) =>
        current.map((line, index) => (index === activeSegment ? next : line)),
      ),
    [activeSegment],
  );
  const dirty = useUnsavedChanges({ form, segments, areas }, !!editor);
  function closeEditor() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else setEditor(null);
  }
  const lock = useRef(false);
  const [tick, setTick] = useState(Date.now());
  const load = useCallback(async () => {
    if (!user?.organisation_id) return;
    const org = user.organisation_id;
    const responses = await Promise.all([
      supabase
        .from("vihem_snow_clients")
        .select("*")
        .eq("organisation_id", org)
        .order("name"),
      supabase
        .from("vihem_snow_routes")
        .select("*")
        .eq("organisation_id", org)
        .order("priority"),
      supabase
        .from("vihem_time_entries")
        .select("*")
        .eq("user_id", user.id)
        .eq("organisation_id", org)
        .or("end_time.is.null,snow_client_id.not.is.null")
        .order("start_time", { ascending: false })
        .limit(100),
      supabase
        .from("vihem_snow_completions")
        .select("id,route_id,completed_at")
        .eq("organisation_id", org)
        .gte(
          "completed_at",
          new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
        ),
    ]);
    const failed = responses.find((r) => r.error);
    if (failed?.error) throw failed.error;
    setClients(responses[0].data || []);
    setRoutes(responses[1].data || []);
    setEntries(responses[2].data || []);
    setCompleted(responses[3].data || []);
  }, [user?.id, user?.organisation_id]);
  useEffect(() => {
    let alive = true;
    void load()
      .catch((e) => {
        if (alive) setError(describe(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    const timer = setInterval(() => {
      void load().catch((e) => {
        if (alive) setError(describe(e));
      });
      setTick(Date.now());
    }, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [load]);
  const current = entries.find((e) => !e.end_time),
    selectedRoute = routes.find((r) => r.id === selected);
  const clientColors = useMemo(
    () => snowClientColors(clients.map((c) => c.id)),
    [clients],
  );
  const shownRoutes = useMemo(
    () =>
      sortRoutes(
        routes.filter(
          (r) =>
            r.active &&
            clients.some((c) => c.id === r.client_id && c.active) &&
            r.method === method &&
            (!clientFilter || r.client_id === clientFilter) &&
            `${r.name} ${r.instructions}`
              .toLowerCase()
              .includes(filter.toLowerCase()),
        ),
      ),
    [routes, clients, method, clientFilter, filter],
  );
  const canClock = !busy && !pending && !loading;
  async function clock(
    client: SnowClient | null,
    activity: SnowActivity | null,
    action?: ClockAction,
  ) {
    if (!user?.organisation_id || lock.current) return;
    setError("");
    setNotice("");
    if (pendingClockOperation(user.id, user.organisation_id)) {
      setError("Kontrollera den väntande stämplingen innan du fortsätter.");
      return;
    }
    if (
      !action &&
      current?.snow_client_id === client?.id &&
      current?.category === activity &&
      current?.snow_method === method &&
      current?.snow_route_id ===
        (selectedRoute?.client_id === client?.id ? selected : null)
    ) {
      setNotice("Du arbetar redan på detta jobb.");
      return;
    }
    if (
      current &&
      !current.snow_client_id &&
      current.category !== "work_order" &&
      current.entry_type === "work"
    ) {
      setError(
        "Avsluta ditt nuvarande vanliga pass i Tidrapportering först. Snöjobb kräver sedan inga kommentarer.",
      );
      return;
    }
    const operation: ClockOperation = {
      p_id: crypto.randomUUID(),
      p_action: action || (current ? "switch" : "clockin"),
      p_expected: current?.id || null,
      p_event: new Date().toISOString(),
      p_timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Stockholm",
      p_comment: "",
      p_job: client
        ? {
            category: activity,
            snow_client_id: client.id,
            snow_route_id:
              selectedRoute?.client_id === client.id ? selectedRoute.id : null,
            snow_method: method,
            completion_status: "submitted",
          }
        : { completion_status: "submitted" },
    };
    lock.current = true;
    setBusy(true);
    try {
      saveClockOperation(user.id, user.organisation_id, operation);
      setPending(operation);
      await executeClockOperation(user.id, user.organisation_id, operation);
      setPending(null);
      setNotice(
        operation.p_action === "clockout"
          ? "Utstämplad."
          : action
            ? "Stämplingen är sparad."
            : `${client?.name} · ${activityLabel(activity || "")} är igång.`,
      );
      await load();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function recover(retry: boolean) {
    if (!pending || !user?.organisation_id || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (retry)
        await executeClockOperation(user.id, user.organisation_id, pending);
      else
        await reconcileClockOperation(user.id, user.organisation_id, pending);
      setPending(null);
      await load();
      setError("");
    } catch (e) {
      setError(describe(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function edit(route?: SnowRoute) {
    setEditor({
      kind: "route",
      id: route?.id || crypto.randomUUID(),
      revision: route?.revision || null,
    });
    setForm({
      name: route?.name || "",
      client_id: route?.client_id || clients.find((c) => c.active)?.id || "",
      method: route?.method || method,
      priority: String(route?.priority || 2),
      instructions: route?.instructions || "",
      active: route?.active ?? true,
    });
    const parts = geometryParts(route?.geometry);
    setSegments(parts.map((p) => p.points));
    setAreas(parts.map((p) => p.area));
    setActiveSegment(0);

    setError("");
  }
  async function save() {
    if (!editor || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const data =
        editor.kind === "client"
          ? { name: form.name, active: form.active }
          : {
              ...form,
              priority: Number(form.priority),
              geometry: mixedGeometry(
                segments.map((points, i) => ({
                  points,
                  area: areas[i] || false,
                })),
              ),
            };
      const { error: e } = await supabase.rpc("vihem_snow_save", {
        p_kind: editor.kind,
        p_id: editor.id,
        p_revision: editor.revision,
        p_data: data,
      });
      if (e) throw e;
      setEditor(null);
      setError("");
      await load();
      setNotice("Sparat.");
    } catch (e) {
      setError(describe(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function finish() {
    if (!current || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const { error: e } = await supabase.rpc("vihem_snow_complete", {
        p_entry: current.id,
      });
      if (e) throw e;
      await load();
      setNotice("Området är klarmarkerat. Välj nästa jobb eller stämpla ut.");
    } catch (e) {
      setError(describe(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const duration = current
    ? Math.max(
        0,
        Math.floor((tick - new Date(current.start_time).getTime()) / 60000),
      )
    : 0;
  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6">
      <PageHeader
        title={user?.role === "snow" ? "Min snökörning" : "Snö & halka"}
        subtitle={
          user?.role === "snow"
            ? "Körpass, tillgänglighet och snöjour – din arbetsyta som snöchaufför."
            : "Dina rutter, din jour och dina körpass på samma plats."
        }
        icon={Snowflake}
      />
      <Tabs
        tabs={[
          ...(user?.role === "snow"
            ? [{ key: "home", label: "Översikt" }]
            : []),
          { key: "work", label: "Körpass" },
          { key: "map", label: "Karta & prioritet" },
          { key: "jour", label: "Snöjour" },
          { key: "availability", label: "Tillgänglighet" },
          { key: "history", label: "Min tid" },
          ...(admin ? [{ key: "admin", label: "Planering" }] : []),
        ]}
        active={tab}
        onChange={(key) => {
          setTab(key);
          setFilter("");
        }}
      />
      {error && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
          {!editor && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void load()
                  .then(() => setError(""))
                  .catch((e) => setError(describe(e)))
              }
            >
              Läs in igen
            </Button>
          )}
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          {notice}
        </p>
      )}
      {pending && (
        <section className="rounded-xl bg-amber-50 p-4">
          <h2 className="font-bold">Stämpling väntar på bekräftelse</h2>
          <p className="mb-3 text-sm">
            Händelsetiden är sparad. Kontrollera serverstatus eller skicka samma
            åtgärd igen.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void recover(true)}>
              Försök igen
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void recover(false)}
            >
              Kontrollera serverstatus
            </Button>
          </div>
        </section>
      )}
      {tab === "home" && user?.role === "snow" && (
        <SnowDriverHome current={current} onNavigate={setTab} />
      )}
      {(tab === "work" || tab === "map") && (
        <>
          <section className="rounded-2xl bg-slate-950 p-5 text-white">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-blue-200">
                  {current ? "Pågående pass" : "Redo för nästa pass"}
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  {current
                    ? `${current.customer_name || "Pågående arbete"} · ${activityLabel(current.category)}`
                    : "Välj uppdragsgivare och arbete"}
                </h2>
                {current && (
                  <p className="mt-1 text-sm text-slate-300">
                    {current.snow_method
                      ? methodLabel(current.snow_method)
                      : "Vanliga stämpelklockan"}{" "}
                    · {Math.floor(duration / 60)} h {duration % 60} min ·{" "}
                    {routes.find((r) => r.id === current.snow_route_id)?.name ||
                      "Utan vald rutt"}
                  </p>
                )}
              </div>
              {current && (
                <Button
                  variant="secondary"
                  disabled={!canClock}
                  onClick={() => void clock(null, null, "clockout")}
                >
                  Stämpla ut
                </Button>
              )}
            </div>
            {current && (
              <div className="mt-4 flex flex-wrap gap-2">
                {current.entry_type === "work" ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!canClock}
                      onClick={() => void clock(null, null, "break")}
                    >
                      Rast
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!canClock}
                      onClick={() => void clock(null, null, "lunch")}
                    >
                      Lunch
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={!canClock}
                    onClick={() => void clock(null, null, "resume")}
                  >
                    Återgå till jobb
                  </Button>
                )}
                {current.snow_route_id && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={
                      busy || completed.some((c) => c.id === current.id)
                    }
                    onClick={() => void finish()}
                  >
                    <Check className="h-4 w-4" />
                    Klart på området
                  </Button>
                )}
              </div>
            )}
          </section>
          <div className="flex flex-wrap gap-2">
            {(["machine", "hand"] as const).map((m) => (
              <Button
                key={m}
                variant={method === m ? "primary" : "secondary"}
                onClick={() => {
                  setMethod(m);
                  setSelected("");
                }}
              >
                {methodLabel(m)}
              </Button>
            ))}
          </div>
          {selectedRoute && (
            <div className="flex flex-wrap justify-between gap-2 rounded-xl bg-blue-50 p-4">
              <div>
                <strong>
                  Prio {selectedRoute.priority} · {selectedRoute.name}
                </strong>
                <p className="text-sm">{selectedRoute.instructions}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected("")}>
                Avmarkera rutt
              </Button>
            </div>
          )}
          {tab === "work" ? (
            <>
              <p className="text-sm text-slate-500">
                Tryck på arbetet under rätt uppdragsgivare för att starta eller
                växla. Tiden sparas i den vanliga stämpelklockan.
              </p>
              <Input
                label="Sök uppdragsgivare"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {clients
                  .filter(
                    (c) =>
                      c.active &&
                      c.name.toLowerCase().includes(filter.toLowerCase()),
                  )
                  .map((c) => (
                    <section
                      key={c.id}
                      className={`rounded-2xl border p-4 ${current?.snow_client_id === c.id ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}
                    >
                      <h2 className="mb-4 font-bold text-slate-950">
                        {c.name}
                      </h2>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          disabled={!canClock}
                          onClick={() => void clock(c, "snow_plowing")}
                        >
                          <Snowflake className="h-4 w-4" />
                          Snöröjning
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={!canClock}
                          onClick={() => void clock(c, "snow_sanding")}
                        >
                          Sandning
                        </Button>
                      </div>
                    </section>
                  ))}
              </div>
              {!loading && !clients.some((c) => c.active) && (
                <EmptyState
                  icon={Snowflake}
                  title="Lägg upp era uppdragsgivare"
                  description="Administratören lägger till Svevia och privata bolag under Planering."
                />
              )}
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Input
                  label="Sök rutt eller område"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <Select
                  label="Uppdragsgivare"
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                  options={[
                    { value: "", label: "Alla uppdragsgivare" },
                    ...clients
                      .filter((c) => c.active)
                      .map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </div>
              <div
                aria-label="Uppdragsgivarnas kartfärger"
                className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-700"
              >
                {clients
                  .filter((c) => shownRoutes.some((r) => r.client_id === c.id))
                  .map((c) => (
                    <span
                      key={c.id}
                      className="inline-flex min-w-0 items-center gap-2"
                    >
                      <span
                        aria-hidden="true"
                        className="h-3 w-6 shrink-0 rounded-sm"
                        style={{ backgroundColor: clientColors[c.id] }}
                      />
                      {c.name}
                    </span>
                  ))}
                <span className="text-xs text-slate-500">
                  Heldragen: maskin · Streckad: handskottning
                </span>
              </div>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <SnowMap
                  routes={shownRoutes}
                  clientColors={clientColors}
                  selected={selected}
                  onSelect={setSelected}
                />
                <div className="space-y-2">
                  {shownRoutes.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelected(r.id)}
                      style={{
                        borderLeftColor: clientColors[r.client_id],
                        borderLeftWidth: 4,
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${selected === r.id ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"}`}
                    >
                      <span className="rounded-lg bg-slate-100 px-3 py-2 text-lg font-black">
                        {r.priority}
                      </span>
                      <span className="min-w-0">
                        <strong className="block truncate">{r.name}</strong>
                        <span className="text-xs text-slate-500">
                          {clients.find((c) => c.id === r.client_id)?.name}
                          {completed.some((c) => c.route_id === r.id)
                            ? " · Klart idag"
                            : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                  {selectedRoute && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        disabled={!canClock}
                        onClick={() =>
                          void clock(
                            clients.find(
                              (c) => c.id === selectedRoute.client_id,
                            ) || null,
                            "snow_plowing",
                          )
                        }
                      >
                        Snöröj här
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={!canClock}
                        onClick={() =>
                          void clock(
                            clients.find(
                              (c) => c.id === selectedRoute.client_id,
                            ) || null,
                            "snow_sanding",
                          )
                        }
                      >
                        Sanda här
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
      {tab === "availability" && (
        <SnowAvailability key={`${user?.id}:${user?.organisation_id}`} />
      )}
      {tab === "jour" &&
        (user?.role === "snow" ? <SnowDutyOnly /> : <JourPage snowOnly />)}
      {tab === "history" && (
        <section className="overflow-hidden rounded-2xl border bg-white">
          <div className="flex items-center justify-between p-4">
            <h2 className="font-bold">Mina senaste snöpass</h2>
            {user?.role !== "snow" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onNavigate?.("timetracking")}
              >
                Vanliga tidrapporteringen
              </Button>
            )}
          </div>
          <div className="divide-y">
            {entries
              .filter((e) => e.snow_client_id)
              .map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap justify-between gap-2 px-4 py-3"
                >
                  <div>
                    <strong>
                      {e.customer_name} · {activityLabel(e.category)}
                    </strong>
                    <p className="text-sm text-slate-500">
                      {new Date(e.start_time).toLocaleString("sv-SE")} ·{" "}
                      {methodLabel(e.snow_method || "machine")}
                      {e.snow_route_id &&
                        ` · ${routes.find((r) => r.id === e.snow_route_id)?.name || "Arkiverat område"}`}
                    </p>
                  </div>
                  <span className="tabular-nums">
                    {e.end_time ? `${e.total_minutes} min` : "Pågår"}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}
      {tab === "admin" && admin && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setEditor({
                  kind: "client",
                  id: crypto.randomUUID(),
                  revision: null,
                });
                setForm({ ...form, name: "" });
                setError("");
              }}
            >
              <Plus className="h-4 w-4" />
              Uppdragsgivare
            </Button>
            <Button
              variant="secondary"
              disabled={!clients.some((c) => c.active)}
              onClick={() => edit()}
            >
              <Map className="h-4 w-4" />
              Rita rutt / område
            </Button>
          </div>
          <p className="text-sm text-slate-500">
            Lägg upp exempelvis SVEVIA VIRSERUM, SVEVIA JÄRNFORSEN och era
            privata kunder. Prio 1 utförs först. Arkivering bevarar tidigare
            tidsunderlag.
          </p>
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border bg-white p-4">
              <h2 className="mb-3 font-bold">Uppdragsgivare</h2>
              {clients.map((c) => (
                <button
                  className="flex w-full justify-between border-t py-3 text-left"
                  key={c.id}
                  onClick={() => {
                    setEditor({
                      kind: "client",
                      id: c.id,
                      revision: c.revision,
                    });
                    setForm({ ...form, name: c.name, active: c.active });
                  }}
                >
                  <span>
                    {c.name}
                    {!c.active ? " · Arkiverad" : ""}
                  </span>
                  <span className="text-sm text-blue-700">Redigera</span>
                </button>
              ))}
            </section>
            <section className="rounded-2xl border bg-white p-4">
              <h2 className="mb-3 font-bold">Rutter och områden</h2>
              {sortRoutes(routes).map((r) => (
                <button
                  className="flex w-full justify-between gap-3 border-t py-3 text-left"
                  key={r.id}
                  onClick={() => edit(r)}
                >
                  <span>
                    Prio {r.priority} · {r.name}
                    <span className="block text-sm text-slate-500">
                      {methodLabel(r.method)}
                      {!r.active ? " · Arkiverad" : ""}
                    </span>
                  </span>
                  <span className="text-sm text-blue-700">Redigera</span>
                </button>
              ))}
            </section>
          </div>
        </div>
      )}
      <Modal
        open={!!editor}
        size={editor?.kind === "route" ? "xxl" : "md"}
        onClose={closeEditor}
        title={editor?.kind === "client" ? "Uppdragsgivare" : "Rutt / område"}
        mobileFullscreen
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={closeEditor}>
              Avbryt
            </Button>
            <Button
              loading={busy}
              disabled={!form.name.trim()}
              onClick={() => void save()}
            >
              Spara
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {editor?.kind === "client" && (
            <Input
              label="Namn"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          )}
          {editor?.kind === "route" && (
            <>
              <details
                open={!editor?.revision}
                className="rounded-xl border border-slate-200 bg-white p-3"
              >
                <summary className="cursor-pointer font-semibold">
                  Ruttuppgifter · {form.name || "Ny rutt"}
                </summary>
                <div className="mt-3 space-y-3">
                  <Input
                    label="Namn"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Select
                      label="Uppdragsgivare"
                      value={form.client_id}
                      onChange={(e) =>
                        setForm({ ...form, client_id: e.target.value })
                      }
                      options={clients
                        .filter((c) => c.active)
                        .map((c) => ({ value: c.id, label: c.name }))}
                    />
                    <Select
                      label="Arbetsmetod"
                      value={form.method}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          method: e.target.value as SnowMethod,
                        })
                      }
                      options={[
                        { value: "machine", label: "Maskinskottning" },
                        { value: "hand", label: "Handskottning" },
                      ]}
                    />
                    <Select
                      label="Prioritet"
                      value={form.priority}
                      onChange={(e) =>
                        setForm({ ...form, priority: e.target.value })
                      }
                      options={[1, 2, 3, 4, 5].map((n) => ({
                        value: String(n),
                        label: `Prio ${n}${n === 1 ? " · Först" : ""}`,
                      }))}
                    />
                  </div>
                </div>
              </details>
              {
                <div className="flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
                  <div className="min-w-36 flex-1">
                    <Select
                      label="Redigera markering"
                      value={String(activeSegment)}
                      onChange={(e) => setActiveSegment(Number(e.target.value))}
                      options={segments.map((line, i) => ({
                        value: String(i),
                        label: `${i + 1}. ${areas[i] ? "Område" : "Sträcka"} · ${line.length} punkter`,
                      }))}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    disabled={
                      points.length < (area ? 3 : 2) || segments.length >= 100
                    }
                    onClick={() => {
                      addPart(false);
                    }}
                  >
                    Ny sträcka
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={
                      points.length < (area ? 3 : 2) || segments.length >= 100
                    }
                    onClick={() => addPart(true)}
                  >
                    Nytt område
                  </Button>
                  <div className="min-w-36">
                    <Select
                      label="Typ av markering"
                      value={area ? "area" : "line"}
                      onChange={(e) => setArea(e.target.value === "area")}
                      options={[
                        { value: "line", label: "Sträcka" },
                        { value: "area", label: "Område" },
                      ]}
                    />
                  </div>
                  {segments.length > 1 && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSegments(
                          segments.filter((_, i) => i !== activeSegment),
                        );
                        setAreas(areas.filter((_, i) => i !== activeSegment));
                        setActiveSegment(0);
                      }}
                    >
                      Ta bort markering
                    </Button>
                  )}
                  <p className="w-full text-sm text-slate-600">
                    Lägg till sträckor och områden i samma rutt. Varje markering
                    ritas separat och delar ruttens uppdragsgivare och
                    prioritet.
                  </p>
                </div>
              }
              <SnowMap
                routes={NO_ROUTES}
                clientColors={clientColors}
                drawingColor={clientColors[form.client_id] || "#2563eb"}
                drawingMethod={form.method}
                segments={segments}
                segmentAreas={areas}
                activeSegment={activeSegment}
                points={points}
                area={area}
                onPoints={setPoints}
              />
              <Textarea
                label="Instruktioner (valfritt)"
                value={form.instructions}
                onChange={(e) =>
                  setForm({ ...form, instructions: e.target.value })
                }
              />
            </>
          )}
          {editor?.revision && (
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Aktiv
            </label>
          )}
        </div>
      </Modal>
      <Modal
        open={discard}
        onClose={() => setDiscard(false)}
        title="Kasta osparade ändringar?"
        size="sm"
      >
        <p>Din ritning och dina ändringar har inte sparats.</p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => setDiscard(false)}>
            Fortsätt redigera
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setDiscard(false);
              setEditor(null);
            }}
          >
            Kasta ändringar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
