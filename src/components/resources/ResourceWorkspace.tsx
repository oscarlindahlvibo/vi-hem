import { useCallback, useEffect, useRef, useState, useId } from "react";
import { Package, ScanLine, Trash2, Wrench, CheckCircle2 } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import {
  emptyCatalog,
  matchResourceCode,
  resourceRequest,
  type Equipment,
  type EquipmentLine,
  type MaterialLine,
  type ResourceCatalog,
  type ResourceHistory,
} from "../../lib/staffResources";
import { Button, Input, Select, Textarea, Modal } from "../ui";
import { EquipmentPicker } from "./EquipmentPicker";
import { ResourceScanner } from "./ResourceScanner";

type Draft = {
  materials: MaterialLine[];
  equipment: EquipmentLine[];
  workOrder: string;
  notes: string;
  operation: { id: string; body: string } | null;
  uncertain: boolean;
};
const empty: Draft = {
  materials: [],
  equipment: [],
  workOrder: "",
  notes: "",
  operation: null,
  uncertain: false,
};
const formatDate = (value: string) =>
  new Date(value).toLocaleString("sv-SE", {
    dateStyle: "short",
    timeStyle: "short",
  });
const labels = {
  reserved: "Reserverad",
  picked_up: "Uthämtad",
  returned: "Återlämnad",
  cancelled: "Avbokad",
};
export function ResourceWorkspace(props: { workOrderId?: string }) {
  const { user } = useAuth();
  return (
    <ResourceWorkspaceForm
      key={`${user?.organisation_id}:${user?.id}:${props.workOrderId || "personal"}`}
      {...props}
    />
  );
}
function ResourceWorkspaceForm({ workOrderId }: { workOrderId?: string }) {
  const { user } = useAuth();
  const storageKey = `vihem-resources:${user?.organisation_id}:${user?.id}:${workOrderId || "personal"}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      return {
        ...empty,
        ...JSON.parse(sessionStorage.getItem(storageKey) || "null"),
      };
    } catch {
      return empty;
    }
  });
  const [catalog, setCatalog] = useState<ResourceCatalog>(emptyCatalog);
  const [history, setHistory] = useState<ResourceHistory>({
    reservations: [],
    materials: [],
  });
  const basket = useRef<HTMLDivElement>(null);
  const basketId = useId();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | "materials" | "equipment">("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [scanner, setScanner] = useState(false);
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [action, setAction] = useState<{
    id: string;
    action: string;
    name: string;
  } | null>(null);
  useUnsavedChanges(
    draft,
    !!(draft.materials.length || draft.equipment.length),
    empty,
  );
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      /* Private storage may be unavailable; in-memory draft survives save errors. */
    }
  }, [draft, storageKey]);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [c, h] = await Promise.all([
        supabase.rpc("vihem_resource_catalog"),
        supabase.rpc("vihem_resource_history", {
          p_work_order: workOrderId || null,
        }),
      ]);
      if (c.error || h.error)
        setError(
          c.error?.message ||
            h.error?.message ||
            "Kunde inte hämta material och utrustning.",
        );
      else {
        setCatalog(c.data);
        setHistory(h.data);
      }
    } catch {
      setError("Kunde inte ansluta. Försök igen när nätverket fungerar.");
    } finally {
      setLoading(false);
    }
  }, [workOrderId]);
  useEffect(() => {
    void load();
  }, [load]);
  function change(patch: Partial<Draft>) {
    if (draft.uncertain || lock.current) return;
    setError("");
    setDraft((d) => ({ ...d, ...patch, operation: null }));
  }
  const addMaterial = useCallback(
    (id: string) => {
      if (lock.current || draft.uncertain) return;
      setError("");
      const location =
        catalog.balances.find(
          (b) =>
            b.item_id === id &&
            b.quantity > 0 &&
            catalog.locations.some((l) => l.id === b.location_id),
        )?.location_id ||
        catalog.locations[0]?.id ||
        "";
      setDraft((d) => {
        const found = d.materials.find(
          (l) => l.item_id === id && l.location_id === location,
        );
        return {
          ...d,
          operation: null,
          materials: found
            ? d.materials.map((l) =>
                l === found ? { ...l, quantity: l.quantity + 1 } : l,
              )
            : [
                ...d.materials,
                { item_id: id, location_id: location, quantity: 1 },
              ],
        };
      });
      setNotice(
        "Material tillagt. Kontrollera antal och lagerplats före registrering.",
      );
    },
    [catalog, draft.uncertain],
  );
  const scan = useCallback(
    (code: string) => {
      setScanner(false);
      const found = matchResourceCode(catalog, code);
      const total = found.materials.length + found.equipment.length;
      if (total === 1) {
        if (found.materials.length) addMaterial(found.materials[0].id);
        else setEquipment(found.equipment[0]);
      } else {
        setSearch(code);
        setKind("all");
        setNotice(
          total
            ? "Koden matchar flera artiklar. Välj rätt artikel nedan."
            : "Koden finns inte i registren. Sök efter namn eller be administratören lägga in koden.",
        );
      }
    },
    [catalog, addMaterial],
  );
  const selectedWorkOrder = workOrderId || draft.workOrder;
  const request = resourceRequest(
    draft.materials,
    draft.equipment,
    selectedWorkOrder,
    draft.notes,
  );
  async function save() {
    if (lock.current) return;
    const body = JSON.stringify(request);
    let operation = draft.operation;
    if (!operation || operation.body !== body) {
      if (draft.uncertain) {
        setError(
          "Återförsök den tidigare registreringen innan du ändrar raderna.",
        );
        return;
      }
      operation = { id: crypto.randomUUID(), body };
    }
    lock.current = true;
    setSaving(true);
    setError("");
    const pending = { ...draft, operation, uncertain: true };
    setDraft(pending);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(pending));
    } catch {
      /* In-memory retry remains available. */
    }
    try {
      const { data, error: e } = await supabase.rpc("vihem_resource_checkout", {
        ...request,
        p_operation: operation.id,
      });
      if (e) {
        const rollbackConfirmed = /^[0-9A-Z]{5}$/.test(e.code || "");
        setDraft((d) => ({
          ...d,
          operation: rollbackConfirmed ? null : d.operation,
          uncertain: !rollbackConfirmed,
        }));
        throw e;
      }
      setDraft({ ...empty });
      setConfirm(false);
      setNotice("Registreringen är sparad.");
      await load();
    } catch (e) {
      setError(
        e && typeof e === "object" && "message" in e
          ? String(e.message)
          : "Registreringen kunde inte bekräftas. Återförsök med samma rader.",
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  async function update() {
    if (!action || lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const { error: e } = await supabase.rpc("vihem_resource_update", {
        p_id: action.id,
        p_action: action.action,
      });
      if (e) throw e;
      setAction(null);
      await load();
      setNotice("Reservationen har uppdaterats.");
    } catch (e) {
      setError(
        e && typeof e === "object" && "message" in e
          ? String(e.message)
          : "Kunde inte uppdatera reservationen.",
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  const needle = search.trim().toLocaleLowerCase("sv-SE");
  const materials = catalog.materials.filter((i) =>
    `${i.name} ${i.code} ${i.barcode} ${i.qr} ${i.id}`
      .toLocaleLowerCase("sv-SE")
      .includes(needle),
  );
  const machines = catalog.equipment.filter((i) =>
    `${i.name} ${i.code} ${i.id}`.toLocaleLowerCase("sv-SE").includes(needle),
  );
  const total = draft.materials.length + draft.equipment.length;
  return (
    <section className="space-y-5" aria-label="Material och utrustning">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Planera ditt arbetsuttag
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Hämta material och reservera maskiner för arbetet.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {draft.materials.length + draft.equipment.length > 0 && (
            <Button
              variant="secondary"
              className="xl:hidden"
              onClick={() =>
                basket.current?.scrollIntoView({
                  block: "start",
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "auto"
                    : "smooth",
                })
              }
            >
              Visa arbetsuttag (
              {draft.materials.length + draft.equipment.length})
            </Button>
          )}
          <Button
            variant="secondary"
            className="gap-2"
            disabled={draft.uncertain || saving || loading}
            onClick={() => setScanner(true)}
          >
            <ScanLine size={18} />
            Skanna kod
          </Button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 p-3 text-sm text-red-700"
        >
          {error}{" "}
          {
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              {total ? "Läs om saldo" : "Försök igen"}
            </Button>
          }
        </div>
      )}
      {notice && !error && (
        <p
          role="status"
          className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800"
        >
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status" className="text-sm text-slate-500">
          Hämtar material och utrustning…
        </p>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
          <div className="min-w-0 space-y-3">
            <Input
              label="Sök eller skriv artikelkod"
              type="search"
              placeholder="Material, maskin eller streckkod"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Artikeltyp"
            >
              {(["all", "materials", "equipment"] as const).map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant={kind === k ? "primary" : "secondary"}
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                >
                  {k === "all"
                    ? "Alla"
                    : k === "materials"
                      ? "Material"
                      : "Utrustning"}
                </Button>
              ))}
            </div>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {kind !== "equipment" &&
                materials.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 p-3">
                    <Package className="shrink-0 text-slate-400" size={20} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900">{i.name}</p>
                      <p className="text-xs text-slate-500">
                        Förbrukningsmaterial ·{" "}
                        {catalog.balances
                          .filter((b) => b.item_id === i.id)
                          .reduce((sum, b) => sum + Number(b.quantity), 0)}{" "}
                        {i.unit} i lager
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={draft.uncertain || saving}
                      onClick={() => addMaterial(i.id)}
                    >
                      Lägg till
                    </Button>
                  </div>
                ))}
              {kind !== "materials" &&
                machines.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 p-3">
                    <Wrench className="shrink-0 text-slate-400" size={20} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900">{i.name}</p>
                      <p className="text-xs text-slate-500">
                        {i.code || "Utrustning"}
                        {i.location ? ` · ${i.location}` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={draft.uncertain || saving}
                      onClick={() => setEquipment(i)}
                    >
                      Välj tid
                    </Button>
                  </div>
                ))}
              {!(kind === "materials"
                ? materials.length
                : kind === "equipment"
                  ? machines.length
                  : materials.length + machines.length) && (
                <p className="p-5 text-sm text-slate-500">
                  Inga artiklar hittades. Prova en annan sökning.
                </p>
              )}
            </div>
          </div>
          <div
            ref={basket}
            id={basketId}
            className="scroll-mt-24 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 xl:sticky xl:top-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">Ditt arbetsuttag</h3>
              <span className="text-sm text-slate-500">
                {total} {total === 1 ? "rad" : "rader"}
              </span>
            </div>
            {!total && (
              <p className="text-sm text-slate-500">
                Skanna eller välj material och utrustning. Allt bekräftas
                tillsammans.
              </p>
            )}
            {draft.materials.map((l, index) => {
              const i = catalog.materials.find((i) => i.id === l.item_id);
              return (
                <div
                  key={index}
                  className="space-y-2 border-t border-slate-200 pt-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {i?.name || "Material saknas i registret"}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Ta bort ${i?.name || "material"}`}
                      disabled={draft.uncertain || saving}
                      onClick={() =>
                        change({
                          materials: draft.materials.filter(
                            (_, n) => n !== index,
                          ),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                  <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-2">
                    <Input
                      label={`Antal (${i?.unit || "st"})`}
                      type="number"
                      min="0.001"
                      step="any"
                      value={l.quantity}
                      disabled={draft.uncertain || saving}
                      onChange={(e) =>
                        change({
                          materials: draft.materials.map((v, n) =>
                            n === index
                              ? { ...v, quantity: Number(e.target.value) }
                              : v,
                          ),
                        })
                      }
                    />
                    <Select
                      label="Från lagerplats"
                      value={l.location_id}
                      disabled={draft.uncertain || saving}
                      onChange={(e) =>
                        change({
                          materials: draft.materials.map((v, n) =>
                            n === index
                              ? { ...v, location_id: e.target.value }
                              : v,
                          ),
                        })
                      }
                      options={[
                        { value: "", label: "Välj lagerplats" },
                        ...catalog.locations.map((x) => ({
                          value: x.id,
                          label: `${x.name} · ${catalog.balances.find((b) => b.item_id === l.item_id && b.location_id === x.id)?.quantity || 0} ${i?.unit || "st"}`,
                        })),
                      ]}
                    />
                  </div>
                </div>
              );
            })}
            {draft.equipment.map((l, index) => (
              <div
                key={index}
                className="flex items-start justify-between gap-2 border-t border-slate-200 pt-3"
              >
                <div>
                  <p className="text-sm font-semibold">
                    {catalog.equipment.find((i) => i.id === l.asset_id)?.name ||
                      "Utrustning"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDate(l.start_at)}–{formatDate(l.end_at)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Intern reservation · kostnadsfri
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Ta bort utrustning"
                  disabled={draft.uncertain || saving}
                  onClick={() =>
                    change({
                      equipment: draft.equipment.filter((_, n) => n !== index),
                    })
                  }
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
            {!workOrderId && (
              <Select
                label="Koppla till arbetsorder (valfritt)"
                value={draft.workOrder}
                disabled={draft.uncertain || saving}
                onChange={(e) => change({ workOrder: e.target.value })}
                options={[
                  { value: "", label: "Tjänstebruk utan arbetsorder" },
                  ...catalog.work_orders.map((w) => ({
                    value: w.id,
                    label: w.title,
                  })),
                ]}
              />
            )}
            {workOrderId && (
              <p className="text-xs text-slate-500">
                Kopplas automatiskt till den här arbetsordern.
              </p>
            )}
            <Textarea
              label="Anteckning (valfritt)"
              rows={2}
              maxLength={2000}
              value={draft.notes}
              disabled={draft.uncertain || saving}
              onChange={(e) => change({ notes: e.target.value })}
            />
            {draft.uncertain && (
              <p className="text-sm text-amber-800">
                Svaret kunde inte bekräftas. Återförsök samma registrering; inga
                nya uttag skapas vid återförsök.
              </p>
            )}
            <Button
              className="w-full gap-2"
              disabled={
                !total ||
                saving ||
                draft.materials.some(
                  (l) =>
                    !l.location_id ||
                    !Number.isFinite(l.quantity) ||
                    l.quantity <= 0,
                )
              }
              onClick={() => setConfirm(true)}
            >
              <CheckCircle2 size={18} />
              {draft.uncertain
                ? "Återförsök registrering"
                : "Granska och bekräfta"}
            </Button>
          </div>
        </div>
      )}
      <div className="space-y-3 border-t border-slate-200 pt-5">
        <h3 className="font-bold text-slate-900">
          {workOrderId
            ? "Arbetsorderns utrustning och material"
            : "Mina reservationer och uttag"}
        </h3>
        {!history.reservations.length && !history.materials.length && (
          <p className="text-sm text-slate-500">
            Inga reservationer eller uttag ännu.
          </p>
        )}
        {history.reservations.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3"
          >
            <div>
              <p className="font-semibold">{r.name}</p>
              <p className="text-sm text-slate-500">
                {formatDate(r.start_at)}–{formatDate(r.end_at)} ·{" "}
                {labels[r.status]}
              </p>
              {r.status === "picked_up" &&
                Date.parse(r.end_at) < Date.now() && (
                  <p className="text-sm text-amber-800">
                    Återlämningstiden har passerat.
                  </p>
                )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(r.actor_id === user?.id ||
                user?.role === "admin" ||
                user?.role === "superadmin") && (
                <>
                  {r.status === "reserved" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={saving}
                      onClick={() =>
                        setAction({
                          id: r.id,
                          action: "cancelled",
                          name: r.name,
                        })
                      }
                    >
                      Avboka
                    </Button>
                  )}
                  {r.status === "reserved" &&
                    Date.parse(r.start_at) <= Date.now() && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={saving}
                        onClick={() =>
                          setAction({
                            id: r.id,
                            action: "picked_up",
                            name: r.name,
                          })
                        }
                      >
                        Markera uthämtad
                      </Button>
                    )}
                  {r.status === "picked_up" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={saving}
                      onClick={() =>
                        setAction({
                          id: r.id,
                          action: "returned",
                          name: r.name,
                        })
                      }
                    >
                      Återlämnad
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        {history.materials.map((m) => (
          <div key={m.id} className="flex justify-between gap-3 py-2 text-sm">
            <span>
              {m.name} · {m.quantity} {m.unit}
            </span>
            <span className="text-slate-500">{formatDate(m.created_at)}</span>
          </div>
        ))}
      </div>
      <ResourceScanner
        open={scanner}
        onClose={() => setScanner(false)}
        onCode={scan}
      />
      <EquipmentPicker
        key={equipment?.id || "empty"}
        equipment={equipment}
        onClose={() => setEquipment(null)}
        onAdd={(line) => {
          change({ equipment: [...draft.equipment, line] });
          setEquipment(null);
          setNotice(
            "Utrustning tillagd. Reservationen gäller först efter bekräftelse.",
          );
        }}
      />
      <Modal
        open={confirm}
        onClose={() => {
          if (!saving) setConfirm(false);
        }}
        title="Bekräfta material och utrustning"
        size="md"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => setConfirm(false)}
            >
              Tillbaka
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              Bekräfta registrering
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {draft.materials.length}{" "}
          {draft.materials.length === 1 ? "materialrad" : "materialrader"} dras
          från lagret och {draft.equipment.length}{" "}
          {draft.equipment.length === 1
            ? "maskin reserveras"
            : "maskiner reserveras"}{" "}
          för tjänstebruk. Allt sparas tillsammans. Om något är upptaget eller
          saknas ändras ingenting.
        </p>
        <div className="mt-4 divide-y divide-slate-100">
          {draft.materials.map((l, n) => (
            <p key={`m${n}`} className="py-2 text-sm">
              <strong>
                {catalog.materials.find((i) => i.id === l.item_id)?.name ||
                  "Material"}
              </strong>
              <br />
              {l.quantity}{" "}
              {catalog.materials.find((i) => i.id === l.item_id)?.unit} ·{" "}
              {catalog.locations.find((i) => i.id === l.location_id)?.name}
            </p>
          ))}
          {draft.equipment.map((l, n) => (
            <p key={`e${n}`} className="py-2 text-sm">
              <strong>
                {catalog.equipment.find((i) => i.id === l.asset_id)?.name ||
                  "Utrustning"}
              </strong>
              <br />
              {formatDate(l.start_at)}–{formatDate(l.end_at)}
            </p>
          ))}
        </div>
        {selectedWorkOrder && (
          <p className="mt-3 text-sm text-slate-600">
            Arbetsorder:{" "}
            {catalog.work_orders.find((w) => w.id === selectedWorkOrder)
              ?.title || "Den öppna arbetsordern"}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </Modal>
      <Modal
        open={!!action}
        onClose={() => {
          if (!saving) setAction(null);
        }}
        title={
          action?.action === "cancelled"
            ? "Avboka reservation"
            : "Uppdatera reservation"
        }
        footer={
          <>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => setAction(null)}
            >
              Avbryt
            </Button>
            <Button loading={saving} onClick={() => void update()}>
              Bekräfta
            </Button>
          </>
        }
      >
        <p>{action?.name}</p>
        <p className="mt-2 text-sm text-slate-600">
          {action?.action === "cancelled"
            ? "Reservationen släpps och utrustningen kan bokas igen. Historiken bevaras."
            : action?.action === "returned"
              ? "Utrustningen markeras som återlämnad och reservationens spärr släpps."
              : "Utrustningen markeras som uthämtad."}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </Modal>
    </section>
  );
}
