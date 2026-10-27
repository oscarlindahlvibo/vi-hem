import { useState } from "react";
import { Button } from "../../../components/ui";
import { fromLocal, localInput } from "../../personal-workspace/reminders/time";
import type { Board, Duty } from "./types";
import type { Mutate } from "./AvailabilityPattern";
import { SnowForm } from "./Forms";
import { options } from "./presentation";
import { snowDateTime as format } from "./presentation";
export function Staffing({
  board,
  mutate,
  busy,
}: {
  board: Board;
  mutate: Mutate;
  busy: boolean;
}) {
  const [day, setDay] = useState("");
  const [create, setCreate] = useState(false),
    [resource, setResource] = useState(false),
    [competency, setCompetency] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [edit, setEdit] = useState<Duty | null>(null);
  return (
    <div className="space-y-5">
      <section className="snow-panel">
        <header>
          <h2>Bemanning och utkallning</h2>
          <p>
            Planerad är inte bekräftad. Endast ett accepterat maskinpass räknas
            som bemanning.
          </p>
        </header>
        <div className="snow-inline">
          <Button disabled={busy} onClick={() => setCreate(true)}>
            Planera maskinpass
          </Button>
          <Button variant="secondary" onClick={() => setResource(true)}>
            Lägg till resurs
          </Button>
          <Button variant="secondary" onClick={() => setCompetency(true)}>
            Maskinkompetens
          </Button>
          <Button
            disabled={busy || !selected.length}
            onClick={() =>
              void mutate("callout", { duties: selected })
                .then(() => setSelected([]))
                .catch(() => {})
            }
          >
            Starta snöröjning · kalla ut {selected.length || "valda"}
          </Button>
        </div>
        <p className="snow-hint">
          Markera pass för valda uppdrag eller maskiner. Föraren behöver aktuell
          veckobekräftelse, rätt kompetens och ledig tid. Välj ingen förare för
          att låta servern föreslå reserv efter minst snötid senaste 30 dagarna.
        </p>
        <section aria-label="Bemanningskalender" className="snow-calendar">
          <Button
            variant={day === "" ? "primary" : "secondary"}
            onClick={() => setDay("")}
          >
            Hela perioden
          </Button>
          {[
            ...new Set(
              board.duties.map((d) =>
                new Intl.DateTimeFormat("sv-SE", {
                  timeZone: "Europe/Stockholm",
                }).format(new Date(d.starts_at)),
              ),
            ),
          ]
            .sort()
            .map((date) => {
              const duties = board.duties.filter(
                (d) =>
                  new Intl.DateTimeFormat("sv-SE", {
                    timeZone: "Europe/Stockholm",
                  }).format(new Date(d.starts_at)) === date &&
                  d.state !== "cancelled",
              );
              return (
                <Button
                  key={date}
                  variant={day === date ? "primary" : "secondary"}
                  onClick={() => setDay(date)}
                >
                  {date} ·{" "}
                  {
                    duties.filter((d) =>
                      ["accepted", "working", "done"].includes(d.state),
                    ).length
                  }
                  /{duties.length} bekräftade
                </Button>
              );
            })}
        </section>
        <div className="snow-resource-grid">
          {board.resources
            .filter((r) => r.active)
            .map((r) => (
              <article key={r.id}>
                <h3>{r.name}</h3>
                {board.duties
                  .filter(
                    (d) =>
                      d.resource_id === r.id &&
                      d.state !== "cancelled" &&
                      (!day ||
                        new Intl.DateTimeFormat("sv-SE", {
                          timeZone: "Europe/Stockholm",
                        }).format(new Date(d.starts_at)) === day),
                  )
                  .map((d) => (
                    <div key={d.id} className="snow-duty">
                      <div className="snow-inline">
                        {d.state === "planned" && (
                          <input
                            type="checkbox"
                            aria-label={`Kalla ut ${r.name} ${format(d.starts_at)}`}
                            checked={selected.includes(d.id)}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, d.id]
                                  : selected.filter((id) => id !== d.id),
                              )
                            }
                          />
                        )}
                        <strong>
                          {
                            board.clients.find((c) => c.id === d.client_id)
                              ?.name
                          }
                        </strong>
                      </div>
                      <p>
                        {format(d.starts_at)}–{format(d.ends_at)}
                      </p>
                      <p
                        className={
                          d.accepted_user ? "snow-confirmed" : "snow-gap"
                        }
                      >
                        {d.accepted_user
                          ? "Bekräftad: " +
                            board.people.find((p) => p.id === d.accepted_user)
                              ?.name
                          : d.planned_user
                            ? "Planerad: " +
                              board.people.find((p) => p.id === d.planned_user)
                                ?.name
                            : "Saknar bekräftad förare"}
                      </p>
                      <p>
                        {d.candidates.length} lämpliga alternativ ·{" "}
                        {d.relief_of ? "Avlösning" : "Ordinarie pass"}
                      </p>
                      {!!d.candidates.length && (
                        <details>
                          <summary>Lämpliga reserver och alternativ</summary>
                          <ul>
                            {d.candidates.map((c) => (
                              <li key={c.user_id}>
                                {c.name} ·{" "}
                                {Math.round((c.worked_minutes / 60) * 10) / 10}{" "}
                                snötimmar senaste 30 dagarna
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {d.state === "planned" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEdit(d)}
                        >
                          Ändra planering
                        </Button>
                      )}
                      {["planned", "calling", "accepted"].includes(d.state) && (
                        <Button
                          disabled={busy}
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (
                              window.confirm(
                                "Avboka passet och stäng obesvarade utkallningar?",
                              )
                            )
                              void mutate("cancel_duty", {
                                duty_id: d.id,
                                revision: d.revision,
                              }).catch(() => {});
                          }}
                        >
                          Avboka
                        </Button>
                      )}
                    </div>
                  ))}
                {!board.duties.some(
                  (d) =>
                    d.resource_id === r.id &&
                    d.state !== "cancelled" &&
                    (!day ||
                      new Intl.DateTimeFormat("sv-SE", {
                        timeZone: "Europe/Stockholm",
                      }).format(new Date(d.starts_at)) === day),
                ) && <p>Inget maskinpass planerat i perioden.</p>}
              </article>
            ))}
        </div>
        {!board.resources.length && (
          <p className="snow-empty">
            Lägg till era resurser och koppla dem till Fleet-maskiner. Inga
            orter eller maskiner är förifyllda.
          </p>
        )}
      </section>
      {(create || edit) && (
        <SnowForm
          title={edit ? "Ändra planerat pass" : "Planera maskinpass"}
          busy={busy}
          onClose={() => {
            setCreate(false);
            setEdit(null);
          }}
          initial={
            edit
              ? {
                  resource_id: edit.resource_id,
                  client_id: edit.client_id,
                  user_id: edit.planned_user || "",
                  starts_at: localInput(edit.starts_at),
                  ends_at: localInput(edit.ends_at),
                  activity: edit.activity,
                  message: edit.message,
                }
              : { activity: "snow_plowing" }
          }
          fields={[
            {
              key: "resource_id",
              label: "Maskin / resurs",
              options: options(board.resources),
              required: true,
            },
            {
              key: "client_id",
              label: "Uppdrag",
              options: options(board.clients.filter((c) => c.active)),
              required: true,
            },
            {
              key: "user_id",
              label: "Planerad förare",
              options: options(
                board.people,
                "Ingen vald · servern föreslår vid utkallning",
              ),
            },
            {
              key: "starts_at",
              label: "Start (svensk tid)",
              type: "datetime-local",
              required: true,
            },
            {
              key: "ends_at",
              label: "Slut (svensk tid)",
              type: "datetime-local",
              required: true,
            },
            {
              key: "activity",
              label: "Arbete",
              options: [
                { value: "snow_plowing", label: "Snöröjning" },
                { value: "snow_sanding", label: "Halkbekämpning / sandning" },
              ],
            },
            { key: "message", label: "Information till föraren" },
          ]}
          onSave={(v) =>
            mutate(edit ? "plan_update" : "plan", {
              ...v,
              id: edit?.id,
              revision: edit?.revision,
              starts_at: fromLocal(v.starts_at),
              ends_at: fromLocal(v.ends_at),
            })
          }
        />
      )}
      {resource && (
        <SnowForm
          title="Resurs från Fleet / handlag"
          busy={busy}
          onClose={() => setResource(false)}
          fields={[
            { key: "name", label: "Resursens namn", required: true },
            {
              key: "method",
              label: "Arbetsmetod",
              options: [
                { value: "machine", label: "Maskin" },
                { value: "hand", label: "Handlag" },
              ],
            },
            {
              key: "vehicle_id",
              label: "Befintlig maskin i Fleet",
              options: options(
                board.vehicles,
                "Ingen maskin · exempelvis handlag",
              ),
            },
          ]}
          onSave={(v) => mutate("resource", v)}
        />
      )}
      {competency && (
        <SnowForm
          title="Maskinkompetens"
          busy={busy}
          onClose={() => setCompetency(false)}
          initial={{ active: "true" }}
          fields={[
            {
              key: "user_id",
              label: "Förare",
              options: options(board.people),
              required: true,
            },
            {
              key: "resource_id",
              label: "Resurs",
              options: options(board.resources),
              required: true,
            },
            {
              key: "active",
              label: "Behörighet och kompetens kontrollerad",
              options: [
                { value: "true", label: "Ja · tillåt" },
                { value: "false", label: "Nej · återkalla" },
              ],
            },
          ]}
          onSave={(v) =>
            mutate("competency", { ...v, active: v.active === "true" })
          }
        />
      )}
    </div>
  );
}
