import { useEffect, useRef, useState } from "react";
import { useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { supabase } from "../lib/supabase";
import {
  languageLabel,
  renderMessageTemplate,
  type MessageTemplate,
} from "../lib/shortStayMessageTemplates";
import { Button, Input, Modal, Select } from "./ui";
type Rule = {
  id: string;
  unit_id: string;
  template_id: string;
  channels: string[];
  language: string;
  event: string;
  days_offset: number;
  send_time: string;
  enabled: boolean;
  revision: number;
  last_error?: string;
  last_checked_at?: string;
};
type Job = {
  id: string;
  rule_id: string;
  beds24_booking_id: string;
  status: string;
  note: string;
  created_at: string;
};
const channels = [
  ["booking", "Booking.com"],
  ["expedia", "Expedia"],
  ["airbnb", "Airbnb"],
  ["vrbo", "Vrbo (API)"],
] as const;
const fresh = (unit: string): Rule => ({
  id: crypto.randomUUID(),
  unit_id: unit,
  template_id: "",
  channels: ["booking", "expedia"],
  language: "en",
  event: "arrival",
  days_offset: 0,
  send_time: "10:00",
  enabled: false,
  revision: 0,
});
export function ShortStayAutoMessages({
  organisationId,
  units,
}: {
  organisationId: string;
  units: { id: string; name: string }[];
}) {
  const [rules, setRules] = useState<Rule[]>([]),
    [templates, setTemplates] = useState<MessageTemplate[]>([]),
    [jobs, setJobs] = useState<Job[]>([]);
  const [editing, setEditing] = useState<Rule | null>(null),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const dirty = useUnsavedChanges(editing, !!editing);
  const [discard, setDiscard] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const results = await Promise.all([
          supabase
            .from("vihem_guest_message_rules")
            .select("*")
            .eq("organisation_id", organisationId)
            .order("updated_at", { ascending: false }),
          supabase
            .from("vihem_short_stay_message_templates")
            .select("*")
            .eq("organisation_id", organisationId)
            .order("name"),
          supabase
            .from("vihem_guest_message_jobs")
            .select("id,rule_id,beds24_booking_id,status,note,created_at")
            .eq("organisation_id", organisationId)
            .order("created_at", { ascending: false })
            .limit(30),
        ]);
        if (!live) return;
        if (results.some((r) => r.error))
          setError(
            "Automatiska meddelanden kunde inte läsas. Kontrollera anslutning och att backend är installerad.",
          );
        else {
          setRules(results[0].data || []);
          setTemplates(results[1].data || []);
          setJobs(results[2].data || []);
          setError("");
        }
      } catch {
        if (live)
          setError(
            "Automatiska meddelanden kunde inte läsas. Försök uppdatera igen.",
          );
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [organisationId, revision]);
  const template = templates.find(
    (t) => t.id === editing?.template_id && t.unit_id === editing?.unit_id,
  );
  let preview = "",
    previewError = "";
  try {
    preview = renderMessageTemplate(
      template?.translations[editing?.language || ""] || "",
      "Anna Exempel",
    );
  } catch (e) {
    previewError = (e as Error).message;
  }
  function closeEditor() {
    if (busy) return;
    if (dirty) {
      setDiscard(true);
      return;
    }
    setConfirm(false);
    setEditing(null);
  }
  async function save() {
    if (!editing || lock.current) return;
    if (
      !template ||
      (editing.enabled && !template.translations[editing.language]) ||
      !editing.channels.length ||
      !editing.send_time ||
      !Number.isInteger(editing.days_offset) ||
      Math.abs(editing.days_offset) > 7 ||
      previewError
    ) {
      setError(
        "Välj mall, språk, minst en kanal, tid och förskjutning −7 till 7 dagar.",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { error: saveError } = await supabase.rpc(
        "vihem_save_guest_message_rule",
        {
          p_id: editing.id,
          p_revision: editing.revision,
          p_unit: editing.unit_id,
          p_template: editing.template_id,
          p_channels: editing.channels,
          p_language: editing.language,
          p_event: editing.event,
          p_days: editing.days_offset,
          p_time: editing.send_time,
          p_enabled: editing.enabled,
        },
      );
      if (saveError) {
        const { data: saved } = await supabase
          .from("vihem_guest_message_rules")
          .select("*")
          .eq("organisation_id", organisationId)
          .eq("id", editing.id)
          .maybeSingle();
        const matches =
          saved &&
          saved.revision === editing.revision + 1 &&
          saved.unit_id === editing.unit_id &&
          saved.template_id === editing.template_id &&
          saved.language === editing.language &&
          saved.event === editing.event &&
          saved.days_offset === editing.days_offset &&
          saved.send_time.slice(0, 5) === editing.send_time.slice(0, 5) &&
          saved.enabled === editing.enabled &&
          JSON.stringify(saved.channels) === JSON.stringify(editing.channels);
        if (!matches)
          throw Error(
            saveError.code === "40001"
              ? "Regeln ändrades av någon annan. Stäng och läs om innan du sparar."
              : saveError.code === "23505"
                ? "Den här mallen har redan en regel för samma händelse. Redigera den befintliga regeln."
                : "Sparningen kunde inte bekräftas. Regeln kan redan ha sparats. Behåll utkastet och uppdatera regellistan innan du försöker igen.",
          );
      }
      setEditing(null);
      setConfirm(false);
      setNotice("Regeln är sparad.");
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
      setConfirm(false);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <section className="space-y-4 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Automatiska gästmeddelanden</h2>
          <p className="max-w-2xl text-sm text-slate-500">
            En regel per rum, mall och händelse. Booking.com och Expedia är
            förvalda; Airbnb och Vrbo väljs separat.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => setRevision((v) => v + 1)}
          >
            Uppdatera
          </Button>
          <Button
            disabled={loading || !!error}
            onClick={() => {
              setEditing(fresh(units[0]?.id || ""));
              setNotice("");
            }}
          >
            Ny utskicksregel
          </Button>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}
      <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
        Alla nya regler är avstängda. Aktivering och ändring gäller framtida
        utskick, inte gamla bokningar vars utskickstid redan passerat. Kontroll
        sker var femte minut i svensk tid. Samma regel skickar högst en gång per
        bokning. Osäker leverans skickas aldrig om automatiskt.
      </p>
      {loading ? (
        <p role="status">Läser utskicksregler…</p>
      ) : !rules.length ? (
        <p className="text-sm text-slate-500">
          Inga regler skapade. Befintliga manuella meddelanden och andra
          kanalers ankomstguider påverkas inte.
        </p>
      ) : (
        <div className="divide-y rounded-xl border bg-white">
          {rules.map((r) => (
            <button
              key={r.id}
              className="flex w-full flex-wrap justify-between gap-2 p-4 text-left hover:bg-slate-50"
              onClick={() => {
                setEditing({ ...r, channels: [...r.channels] });
                setError("");
              }}
            >
              <span>
                <strong className="block">
                  {units.find((u) => u.id === r.unit_id)?.name} ·{" "}
                  {templates.find((t) => t.id === r.template_id)?.name}
                </strong>
                <span className="block text-sm text-slate-500">
                  {r.event === "arrival" ? "Ankomst" : "Avresa"}{" "}
                  {r.days_offset === 0 ? "samma dag" : `${r.days_offset} dagar`}{" "}
                  · {r.send_time.slice(0, 5)} ·{" "}
                  {r.channels
                    .map((c) => channels.find((v) => v[0] === c)?.[1])
                    .join(", ")}{" "}
                  · {languageLabel(r.language)}
                </span>
                {r.last_error && (
                  <span className="mt-1 block text-sm text-red-700">
                    {r.last_error}
                  </span>
                )}
              </span>
              <span
                className={
                  r.enabled
                    ? "text-sm font-semibold text-emerald-700"
                    : "text-sm text-slate-500"
                }
              >
                {r.enabled ? "Aktiv" : "Avstängd"}
              </span>
            </button>
          ))}
        </div>
      )}
      {!!jobs.length && (
        <div className="space-y-2">
          <h3 className="font-semibold">Senaste utskick</h3>
          {jobs.map((j) => (
            <div key={j.id} className="rounded-lg border bg-white p-3 text-sm">
              <strong>
                Bokning {j.beds24_booking_id} ·{" "}
                {{
                  sent: "Mottaget av Beds24",
                  pending: "Behöver kontrolleras i Beds24",
                  failed: "Misslyckat",
                  skipped: "Överhoppat",
                }[j.status] || j.status}
              </strong>
              <p className="text-slate-500">
                {new Date(j.created_at).toLocaleString("sv-SE", {
                  timeZone: "Europe/Stockholm",
                })}
                {j.note && ` · ${j.note}`}
              </p>
            </div>
          ))}
        </div>
      )}
      <Modal
        open={!!editing}
        onClose={closeEditor}
        title="Automatiskt gästmeddelande"
        size="lg"
        mobileFullscreen
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={closeEditor}>
              Avbryt
            </Button>
            <Button
              loading={busy}
              onClick={() => {
                if (editing?.enabled) setConfirm(true);
                else void save();
              }}
            >
              Spara regel
            </Button>
          </div>
        }
      >
        {editing && (
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
              >
                {error}
              </p>
            )}
            <Select
              label="Rum"
              value={editing.unit_id}
              options={units.map((u) => ({ value: u.id, label: u.name }))}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  unit_id: e.target.value,
                  template_id: "",
                })
              }
            />
            <Select
              label="Meddelandemall"
              value={editing.template_id}
              options={[
                { value: "", label: "Välj mall" },
                ...templates
                  .filter((t) => t.unit_id === editing.unit_id)
                  .map((t) => ({ value: t.id, label: t.name })),
              ]}
              onChange={(e) => {
                const t = templates.find((t) => t.id === e.target.value);
                setEditing({
                  ...editing,
                  template_id: e.target.value,
                  language: t?.translations.en
                    ? "en"
                    : Object.keys(t?.translations || {})[0] || "en",
                });
              }}
            />
            <Select
              label="Språk för utskicket"
              value={editing.language}
              options={Object.keys(template?.translations || {}).map(
                (code) => ({ value: code, label: languageLabel(code) }),
              )}
              onChange={(e) =>
                setEditing({ ...editing, language: e.target.value })
              }
            />
            <div>
              <p className="mb-2 text-sm font-semibold">
                Skicka endast till dessa kanaler
              </p>
              <div className="grid grid-cols-2 gap-2">
                {channels.map(([key, label]) => (
                  <label
                    key={key}
                    className="flex min-h-11 items-center gap-2 rounded-lg border p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={editing.channels.includes(key)}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          channels: e.target.checked
                            ? [...editing.channels, key]
                            : editing.channels.filter((c) => c !== key),
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Endast bekräftade bokningar skickas. Vrbo kräver direkt
                API-koppling. iCal och manuella bokningar stöds inte. Befintliga
                utskick i Beds24 bör stängas av separat om de annars skickar
                samma information.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                label="Utgå från"
                value={editing.event}
                options={[
                  { value: "arrival", label: "Ankomst" },
                  { value: "departure", label: "Avresa" },
                ]}
                onChange={(e) =>
                  setEditing({ ...editing, event: e.target.value })
                }
              />
              <Input
                label="Förskjutning i dagar"
                type="number"
                min={-7}
                max={7}
                value={editing.days_offset}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    days_offset: Number(e.target.value),
                  })
                }
              />
              <Input
                label="Tid (Sverige)"
                type="time"
                value={editing.send_time.slice(0, 5)}
                onChange={(e) =>
                  setEditing({ ...editing, send_time: e.target.value })
                }
              />
            </div>
            <p className="text-xs text-slate-500">
              −1 = dagen före, 0 = samma dag, 1 = dagen efter. Sena jobb
              kontrolleras upp till två timmar efter planerad tid.
            </p>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={(e) =>
                  setEditing({ ...editing, enabled: e.target.checked })
                }
              />
              Aktivera automatiska utskick
            </label>
            {previewError && (
              <p role="alert" className="text-sm text-red-700">
                {previewError}
              </p>
            )}
            {preview && (
              <div className="rounded-xl bg-slate-50 p-4">
                <h3 className="font-semibold">
                  Förhandsvisning · exempelgästen Anna
                </h3>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                  {preview}
                </p>
              </div>
            )}
          </fieldset>
        )}
      </Modal>
      <Modal
        open={confirm}
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
        title="Aktivera utskicksregeln?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Tillbaka
            </Button>
            <Button loading={busy} onClick={() => void save()}>
              Bekräfta och spara
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-sm font-semibold">
          {units.find((u) => u.id === editing?.unit_id)?.name} ·{" "}
          {template?.name} · {languageLabel(editing?.language || "")}
          <br />
          {editing?.channels
            .map((c) => channels.find((v) => v[0] === c)?.[1])
            .join(", ")}{" "}
          · {editing?.event === "arrival" ? "Ankomst" : "Avresa"}{" "}
          {editing?.days_offset} dagar · {editing?.send_time.slice(0, 5)}
        </p>
        <p className="text-sm">
          Den valda mallen skickas automatiskt till de valda bokningskanalerna
          vid framtida tillfällen. Kontrollera rum, språk, kanaler och text
          ovan. Redan skickade utskick återkallas inte. Påbörjade utskick kan
          hinna slutföras vid paus.
        </p>
      </Modal>
      <Modal
        open={discard}
        onClose={() => setDiscard(false)}
        title="Lämna osparad regel?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDiscard(false)}>
              Fortsätt redigera
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDiscard(false);
                setConfirm(false);
                setEditing(null);
              }}
            >
              Lämna utan att spara
            </Button>
          </div>
        }
      >
        <p className="text-sm">
          Ändringarna har inte sparats. Den befintliga regeln ändras inte om du
          lämnar.
        </p>
      </Modal>
    </section>
  );
}
