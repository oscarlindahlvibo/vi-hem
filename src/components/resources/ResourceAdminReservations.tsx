import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Button, Card, Modal, Select } from "../ui";
import type { Reservation } from "../../lib/staffResources";
type Row = Omit<Reservation, "actor_id" | "work_order_id"> & {
  employee: string;
  work_order: string | null;
  notes: string;
};
const labels = {
  reserved: "Reserverad",
  picked_up: "Uthämtad",
  returned: "Återlämnad",
  cancelled: "Avbokad",
};
export function ResourceAdminReservations() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("active");
  const [action, setAction] = useState<{ row: Row; status: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await supabase.rpc("vihem_resource_admin_reservations");
      if (r.error) throw r.error;
      setRows(r.data || []);
      setError("");
    } catch (e) {
      setError(
        e && typeof e === "object" && "message" in e
          ? String(e.message)
          : "Kunde inte hämta reservationer.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function save() {
    if (!action || lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const r = await supabase.rpc("vihem_resource_update", {
        p_id: action.row.id,
        p_action: action.status,
      });
      if (r.error) throw r.error;
      setAction(null);
      await load();
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
  const visible = rows.filter(
    (r) =>
      filter === "all" || r.status === "reserved" || r.status === "picked_up",
  );
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div>
          <h2 className="font-semibold">Personalens reservationer</h2>
          <p className="text-sm text-slate-500">
            Kostnadsfritt tjänstebruk. Spärrarna ingår i uthyrningskalendern.
          </p>
        </div>
        <Select
          aria-label="Visa reservationer"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          options={[
            { value: "active", label: "Aktiva reservationer" },
            { value: "all", label: "Alla statusar" },
          ]}
        />
      </div>
      {error && (
        <p role="alert" className="p-4 text-sm text-red-700">
          {error}{" "}
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            Försök igen
          </Button>
        </p>
      )}
      {loading ? (
        <p role="status" className="p-4 text-sm text-slate-500">
          Hämtar reservationer…
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {!visible.length && (
            <p className="p-4 text-sm text-slate-500">
              Inga reservationer att visa.
            </p>
          )}
          {visible.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-start justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="font-semibold">{r.name}</p>
                <p className="text-sm text-slate-600">
                  {r.employee}
                  {r.work_order ? ` · ${r.work_order}` : ""}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {new Date(r.start_at).toLocaleString("sv-SE", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                  –
                  {new Date(r.end_at).toLocaleString("sv-SE", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}{" "}
                  · {labels[r.status]}
                </p>
                {r.notes && (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">
                    {r.notes}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {r.status === "reserved" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={saving}
                    onClick={() => setAction({ row: r, status: "cancelled" })}
                  >
                    Avboka
                  </Button>
                )}
                {r.status === "picked_up" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={saving}
                    onClick={() => setAction({ row: r, status: "returned" })}
                  >
                    Återlämnad
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {rows.length === 200 && (
        <p className="p-4 text-xs text-slate-500">
          De 200 senaste reservationerna visas. Äldre historik finns kvar.
        </p>
      )}
      <Modal
        open={!!action}
        onClose={() => {
          if (!saving) setAction(null);
        }}
        title={
          action?.status === "cancelled"
            ? "Avboka personalreservation"
            : "Markera återlämnad"
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
            <Button loading={saving} onClick={() => void save()}>
              Bekräfta
            </Button>
          </>
        }
      >
        <p>
          {action?.row.name} · {action?.row.employee}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Utrustningens spärr släpps. Reservationens historik bevaras.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </Modal>
    </Card>
  );
}
