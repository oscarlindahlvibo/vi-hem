import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useToast } from "./toast";
import { Button, Input, Modal } from "./ui";
import { NOTIFICATION_SETTING_LABELS } from "../lib/utils";
import type { Profile } from "../types";
type Routing = { settings: Record<string, boolean>; revision: string };
export function StaffNotificationAssignments({
  person,
  onClose,
}: {
  person: Profile | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const operational = new Set([
    "short_stay_new_booking",
    "short_stay_new_message",
    "kompetensportalen",
    "website_inquiry",
  ]);
  const visible = NOTIFICATION_SETTING_LABELS.filter((t) =>
    (t.label + " " + t.description)
      .toLocaleLowerCase("sv-SE")
      .includes(query.toLocaleLowerCase("sv-SE")),
  ).sort(
    (a, b) => Number(operational.has(b.key)) - Number(operational.has(a.key)),
  );
  const [reload, setReload] = useState(0);
  const [routing, setRouting] = useState<Routing | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!person) return;
    let active = true;
    setRouting(null);
    setQuery("");
    setError("");
    void Promise.resolve(
      supabase.rpc("vihem_notification_assignment_read", {
        p_target: person.id,
      }),
    )
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else setRouting(data);
      })
      .catch(() => {
        if (active) setError("Kunde inte ansluta. Stäng och försök igen.");
      });
    return () => {
      active = false;
    };
  }, [person, reload]);
  async function save() {
    if (!person || !routing || lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await supabase.rpc("vihem_notification_assignment_save", {
        p_target: person.id,
        p_settings: routing.settings,
        p_revision: routing.revision,
      });
      if (result.error) throw result.error;
      setRouting(result.data);
      toast.show(`Aviseringsval för ${person.name} har sparats.`, {
        tone: "success",
      });
      onClose();
    } catch (e) {
      setError(
        e && typeof e === "object" && "message" in e
          ? String(e.message)
          : "Kunde inte spara aviseringsvalen. Dina val finns kvar.",
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <Modal
      open={!!person}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={`Aviseringar · ${person?.name || "Medarbetare"}`}
      size="lg"
      mobileFullscreen
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Avbryt
          </Button>
          <Button
            loading={saving}
            disabled={!routing}
            onClick={() => void save()}
          >
            Spara aviseringsval
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-600">
        Välj vilka typer {person?.name} ska få. Valen gäller nya aviseringar i
        appen och push. Personliga chattar och arbetsorder följer fortfarande
        sina befintliga mottagarregler. Detta ger inte tillgång till fler
        moduler.
      </p>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"
        >
          {error}{" "}
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => setReload((n) => n + 1)}
          >
            Hämta senaste val
          </Button>
        </p>
      )}
      {!routing && !error && <p role="status">Hämtar aviseringsval…</p>}
      {routing && (
        <>
          <Input
            className="mb-3"
            label="Sök aviseringskategori"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Till exempel korttid, chatt eller lunch"
          />
          <div className="mb-4 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={saving}
              onClick={() =>
                setRouting({
                  ...routing,
                  settings: Object.assign(
                    {},
                    routing.settings,
                    Object.fromEntries(visible.map((t) => [t.key, true])),
                  ),
                })
              }
            >
              Markera visade
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={saving}
              onClick={() =>
                setRouting({
                  ...routing,
                  settings: Object.assign(
                    {},
                    routing.settings,
                    Object.fromEntries(visible.map((t) => [t.key, false])),
                  ),
                })
              }
            >
              Avmarkera visade
            </Button>
          </div>
          {!visible.length && (
            <p className="py-4 text-sm text-slate-500">
              Inga kategorier matchar sökningen.
            </p>
          )}
          <div className="grid gap-x-5 sm:grid-cols-2">
            {visible.map((t) => (
              <label
                key={t.key}
                className="flex cursor-pointer items-start gap-3 border-b border-slate-100 py-3"
              >
                <input
                  className="mt-1 h-4 w-4 accent-blue-600"
                  type="checkbox"
                  disabled={saving}
                  checked={!!routing.settings[t.key]}
                  onChange={(e) =>
                    setRouting({
                      ...routing,
                      settings: {
                        ...routing.settings,
                        [t.key]: e.target.checked,
                      },
                    })
                  }
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">
                    {t.label}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {t.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Egna tysta inställningar kan stänga av tilldelade typer. De kan inte
            slå på en typ som admin har stängt av. Organisationens gemensamma
            avstängningar gäller också. Tidigare aviseringar bevaras.
          </p>
        </>
      )}
    </Modal>
  );
}
