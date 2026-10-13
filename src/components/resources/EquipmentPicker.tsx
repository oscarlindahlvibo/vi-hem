import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  dateInput,
  type Equipment,
  type EquipmentLine,
} from "../../lib/staffResources";
import { Button, Input, Modal } from "../ui";
export function EquipmentPicker({
  equipment,
  onClose,
  onAdd,
}: {
  equipment: Equipment | null;
  onClose: () => void;
  onAdd: (line: EquipmentLine) => void;
}) {
  const [start, setStart] = useState(() => dateInput(new Date()));
  const [end, setEnd] = useState(() =>
    dateInput(new Date(Date.now() + 4 * 3600000)),
  );
  const [check, setCheck] = useState<{
    key: string;
    available: boolean;
    next_start?: string;
    next_end?: string;
    error?: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([equipment?.id, start, end]);
  useEffect(() => {
    if (!equipment) return;
    let alive = true;
    if (
      !Number.isFinite(Date.parse(start)) ||
      !Number.isFinite(Date.parse(end)) ||
      Date.parse(end) <= Date.parse(start)
    ) {
      setCheck({
        key,
        available: false,
        error: "Slutet måste vara efter starten.",
      });
      return;
    }
    const timer = setTimeout(() => {
      void Promise.resolve(
        supabase.rpc("vihem_resource_availability", {
          p_asset: equipment.id,
          p_start: new Date(start).toISOString(),
          p_end: new Date(end).toISOString(),
        }),
      )
        .then(({ data, error }) => {
          if (alive)
            setCheck(
              error
                ? { key, available: false, error: error.message }
                : { key, ...data },
            );
        })
        .catch(() => {
          if (alive)
            setCheck({
              key,
              available: false,
              error: "Anslutningen misslyckades. Försök igen.",
            });
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [equipment, key, start, end, retry]);
  const current = check?.key === key ? check : null;
  function duration(hours: number) {
    const from = Number.isFinite(Date.parse(start))
      ? new Date(start)
      : new Date();
    setStart(dateInput(from));
    setEnd(dateInput(new Date(from.getTime() + hours * 3600000)));
  }
  return (
    <Modal
      open={!!equipment}
      onClose={onClose}
      title={equipment?.name || "Boka utrustning"}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Avbryt
          </Button>
          <Button
            disabled={!current?.available}
            onClick={() => {
              if (equipment && current?.available)
                onAdd({
                  asset_id: equipment.id,
                  product_id: equipment.product_id,
                  start_at: new Date(start).toISOString(),
                  end_at: new Date(end).toISOString(),
                });
            }}
          >
            Lägg till reservation
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Kostnadsfri reservation för tjänstebruk. Ingen kundbokning eller
          faktura skapas.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            type="datetime-local"
            label="Från"
            value={start}
            onChange={(e) => {
              const span = Date.parse(end) - Date.parse(start);
              setStart(e.target.value);
              if (Number.isFinite(Date.parse(e.target.value)))
                setEnd(
                  dateInput(
                    new Date(
                      Date.parse(e.target.value) +
                        (span > 0 ? span : 4 * 3600000),
                    ),
                  ),
                );
            }}
          />
          <Input
            type="datetime-local"
            label="Till"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {[1, 4, 8, 24].map((h) => (
            <Button
              key={h}
              variant="secondary"
              size="sm"
              onClick={() => duration(h)}
            >
              {h === 24 ? "1 dygn" : h === 1 ? "1 timme" : `${h} timmar`}
            </Button>
          ))}
        </div>
        <div
          role="status"
          className={`rounded-xl p-4 text-sm ${current?.available ? "bg-emerald-50 text-emerald-800" : current ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-600"}`}
        >
          {!current ? (
            "Kontrollerar tillgänglighet…"
          ) : current.error ? (
            <>
              {current.error}{" "}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRetry((n) => n + 1)}
              >
                Försök igen
              </Button>
            </>
          ) : current.available ? (
            "Ledig under hela perioden."
          ) : (
            <>
              Upptagen under vald period.
              {current.next_start && current.next_end ? (
                <>
                  <p className="mt-1">
                    Nästa möjliga period:{" "}
                    {new Date(current.next_start).toLocaleString("sv-SE")}–
                    {new Date(current.next_end).toLocaleString("sv-SE")}
                  </p>
                  <Button
                    variant="secondary"
                    className="mt-3"
                    onClick={() => {
                      const next =
                        Math.ceil(Date.parse(current.next_start!) / 60000) *
                        60000;
                      const span =
                        Date.parse(current.next_end!) -
                        Date.parse(current.next_start!);
                      setStart(dateInput(new Date(next)));
                      setEnd(dateInput(new Date(next + span)));
                    }}
                  >
                    Välj denna period
                  </Button>
                </>
              ) : (
                <p className="mt-1">Välj andra tider eller en annan maskin.</p>
              )}
            </>
          )}
        </div>
        <p className="text-xs text-slate-500">
          Tider visas i enhetens lokala tidszon. Tillgängligheten kontrolleras
          igen när du bekräftar.
        </p>
      </div>
    </Modal>
  );
}
