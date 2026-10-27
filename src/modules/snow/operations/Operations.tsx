import { useEffect, useState } from "react";
import { Button, Input } from "../../../components/ui";
import { useAuth } from "../../../contexts/AuthContext";
import { calendarDay, addDays, weekStart } from "../availability";
import { useSnowBoard } from "./useSnowBoard";
import { Staffing } from "./Staffing";
import { Callouts } from "./Callouts";
import { Customers } from "./Customers";
import { Pricing } from "./Pricing";
import { Billing } from "./Billing";
import { AvailabilityPattern } from "./AvailabilityPattern";
import { SnowForm } from "./Forms";
import { dutyLabels } from "./types";
import type { Board, Duty } from "./types";
import "./operations.css";
export function SnowOperations({
  active,
  onNavigate,
  onStart,
  onBoard,
}: {
  active: string;
  onNavigate: (v: string) => void;
  onStart: (d: Duty) => void;
  onBoard: (b: Board) => void;
}) {
  const { user } = useAuth();
  const owner = user!.id,
    org = user!.organisation_id!;
  const [from, setFrom] = useState(weekStart(calendarDay())),
    [days, setDays] = useState(7),
    [settings, setSettings] = useState(false);
  const api = useSnowBoard(owner, org, from, days),
    { board, busy, pending, mutate } = api;
  const blocked = busy || !!pending;
  useEffect(() => {
    if (board) onBoard(board);
  }, [board, onBoard]);
  if (
    ![
      "overview",
      "staffing",
      "callouts",
      "customers",
      "pricing",
      "billing",
      "settings",
      "availability",
    ].includes(active)
  )
    return null;
  if (!board)
    return (
      <section className="snow-panel" role="status">
        Läser verksamhetsöversikten…
        {api.error && <p role="alert">{api.error}</p>}
      </section>
    );
  return (
    <div className="snow-operations">
      <div className="snow-inline">
        <Input
          label="Period från (svenskt datum)"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          label="Period till (svenskt datum)"
          type="date"
          value={addDays(from, days - 1)}
          onChange={(e) => {
            const difference =
              Math.round(
                (Date.parse(e.target.value + "T12:00:00Z") -
                  Date.parse(from + "T12:00:00Z")) /
                  86400000,
              ) + 1;
            if (difference >= 1 && difference <= 31) setDays(difference);
            else api.setError("Välj en period på 1–31 dagar.");
          }}
        />
        <Button
          variant="secondary"
          onClick={() => {
            const today = calendarDay();
            const first = today.slice(0, 7) + "-01";
            setFrom(first);
            setDays(
              new Date(
                Number(today.slice(0, 4)),
                Number(today.slice(5, 7)),
                0,
              ).getDate(),
            );
          }}
        >
          Denna månad
        </Button>
        <Button
          variant="secondary"
          onClick={() => void api.load().catch((e) => api.setError(String(e)))}
        >
          Uppdatera
        </Button>
      </div>
      {api.error && (
        <p role="alert" className="snow-error">
          {api.error}
        </p>
      )}
      {pending && (
        <section className="snow-pending">
          <strong>Ändringen är inte bekräftad av servern</strong>
          <p>
            Ingen ny ändring skickas medan svaret är osäkert. Återförsöket
            använder samma operations-ID.
          </p>
          <Button
            disabled={busy}
            onClick={() => void api.retry().catch(() => {})}
          >
            Kontrollera genom säkert återförsök
          </Button>
        </section>
      )}
      {active === "overview" && (
        <>
          <div className="snow-stats">
            {[
              [
                "Aktiva maskiner",
                new Set(
                  board.entries
                    .filter((e) => !e.end_time && e.snow_resource_id)
                    .map((e) => e.snow_resource_id),
                ).size,
              ],
              [
                "Bekräftade maskinpass",
                board.duties.filter((d) =>
                  ["accepted", "working"].includes(d.state),
                ).length,
              ],
              [
                "Obekräftad bemanning",
                board.duties.filter((d) =>
                  ["planned", "calling"].includes(d.state),
                ).length,
              ],
              [
                "Obesvarade utkallningar",
                board.invitations.filter((i) => i.state === "pending").length,
              ],
              [
                "Pass för granskning",
                board.entries.filter(
                  (e) => e.end_time && e.status !== "approved",
                ).length,
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <section className="snow-panel">
            <header>
              <h2>Läget i vald period</h2>
              <p>
                Tillgänglighet, bekräftad utkallning och påbörjat arbete är
                olika statusar.
              </p>
            </header>
            <div className="snow-resource-grid">
              {board.resources
                .filter((r) => r.active)
                .map((r) => {
                  const duties = board.duties.filter(
                    (d) =>
                      d.resource_id === r.id &&
                      !["done", "cancelled"].includes(d.state),
                  );
                  return (
                    <article key={r.id}>
                      <h3>{r.name}</h3>
                      {board.entries
                        .filter(
                          (e) => e.snow_resource_id === r.id && !e.end_time,
                        )
                        .map((e) => (
                          <p className="snow-confirmed" key={e.id}>
                            Kör nu:{" "}
                            {board.people.find((p) => p.id === e.user_id)?.name}{" "}
                            ·{" "}
                            {
                              board.clients.find(
                                (c) => c.id === e.snow_client_id,
                              )?.name
                            }{" "}
                            · start{" "}
                            {new Date(e.start_time).toLocaleTimeString(
                              "sv-SE",
                              {
                                timeZone: "Europe/Stockholm",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </p>
                        ))}
                      {duties.length ? (
                        duties.map((d) => (
                          <p key={d.id}>
                            {new Date(d.starts_at).toLocaleString("sv-SE", {
                              timeZone: "Europe/Stockholm",
                              weekday: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                            · {dutyLabels[d.state]}
                            {d.accepted_user
                              ? " · " +
                                board.people.find(
                                  (p) => p.id === d.accepted_user,
                                )?.name
                              : ""}
                          </p>
                        ))
                      ) : (
                        <p className="snow-gap">Inget bekräftat maskinpass</p>
                      )}
                    </article>
                  );
                })}
            </div>
            <div className="snow-inline">
              {board.admin && (
                <Button onClick={() => onNavigate("staffing")}>
                  Planera och kalla ut
                </Button>
              )}
              <Button variant="secondary" onClick={() => onNavigate("work")}>
                Till körningen
              </Button>
              <Button
                variant="secondary"
                onClick={() => onNavigate("availability")}
              >
                Min tillgänglighet
              </Button>
            </div>
          </section>
          <Callouts
            board={board}
            owner={owner}
            mutate={mutate}
            busy={blocked}
            onStart={onStart}
          />
        </>
      )}
      {active === "availability" && (
        <AvailabilityPattern
          board={board}
          owner={owner}
          mutate={mutate}
          busy={blocked}
        />
      )}
      {active === "staffing" && board.admin && (
        <Staffing board={board} mutate={mutate} busy={blocked} />
      )}
      {active === "callouts" && (
        <Callouts
          board={board}
          owner={owner}
          mutate={mutate}
          busy={blocked}
          onStart={onStart}
        />
      )}
      {active === "customers" && (
        <Customers
          board={board}
          mutate={mutate}
          busy={blocked}
          onWork={() => onNavigate("work")}
        />
      )}
      {active === "pricing" && (
        <Pricing board={board} mutate={mutate} busy={blocked} />
      )}
      {active === "billing" && board.admin && (
        <Billing
          board={board}
          mutate={mutate}
          busy={blocked}
          from={from}
          to={addDays(from, days - 1)}
          refresh={api.load}
        />
      )}
      {active === "settings" && board.admin && (
        <section className="snow-panel">
          <header>
            <h2>Planerings- och larmregler</h2>
            <p>
              Konfigurerbara skyddsregler, inte ett juridiskt godkännande av
              arbetstidsupplägget.
            </p>
          </header>
          <p>
            Maximalt planerat pass: {board.settings.max_hours} timmar · vila
            mellan pass: {board.settings.rest_hours} timmar.
          </p>
          <p>
            Påminnelse efter {board.settings.remind_minutes} minuter · reserv
            efter {board.settings.response_minutes} minuter.
          </p>
          <p>
            Veckopåminnelse veckodag {board.settings.weekly_day} kl{" "}
            {board.settings.weekly_hour}:00, Europe/Stockholm.
          </p>
          <Button onClick={() => setSettings(true)}>Ändra regler</Button>
          <h3>Larmkanaler</h3>
          <p>
            Push och in-app använder VI-HEM:s befintliga integration.
            Leverantörens acceptans är inte bevis på telefonleverans. Kritiska
            iOS-larm och automatisk röstuppringning är inte aktiverade; separat
            leverantörskonfiguration krävs. Ring manuellt om svar saknas.
          </p>
        </section>
      )}
      {settings && (
        <SnowForm
          title="Planeringsregler och påminnelser"
          busy={blocked}
          onClose={() => setSettings(false)}
          initial={Object.fromEntries(
            Object.entries(board.settings).map(([k, v]) => [k, String(v)]),
          )}
          fields={[
            {
              key: "max_hours",
              label: "Maximal passlängd (timmar)",
              type: "number",
            },
            {
              key: "rest_hours",
              label: "Vila mellan pass (timmar)",
              type: "number",
            },
            {
              key: "response_minutes",
              label: "Svarstid före reserv (minuter)",
              type: "number",
            },
            {
              key: "remind_minutes",
              label: "Påminnelse efter (minuter)",
              type: "number",
            },
            {
              key: "weekly_day",
              label: "Veckopåminnelse (1=mån … 7=sön)",
              type: "number",
            },
            {
              key: "weekly_hour",
              label: "Klockslag för veckopåminnelse (0–23)",
              type: "number",
            },
            {
              key: "auto_approve",
              label: "Godkänn kompletta giltiga klockpass automatiskt",
              options: [
                { value: "true", label: "Ja" },
                { value: "false", label: "Nej · administrativ granskning" },
              ],
            },
          ]}
          onSave={(v) =>
            mutate("settings", {
              ...v,
              revision: board.settings_revision,
              auto_approve: v.auto_approve === "true",
            })
          }
        />
      )}
    </div>
  );
}
