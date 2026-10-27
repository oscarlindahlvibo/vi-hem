import { useState } from "react";
import { Button } from "../../../components/ui";
import { fromLocal } from "../../personal-workspace/reminders/time";
import type { Board, Duty } from "./types";
import type { Mutate } from "./AvailabilityPattern";
import { SnowForm } from "./Forms";
import { snowDateTime } from "./presentation";
export function Callouts({
  board,
  owner,
  mutate,
  busy,
  onStart,
}: {
  board: Board;
  owner: string;
  mutate: Mutate;
  busy: boolean;
  onStart: (d: Duty) => void;
}) {
  const [relief, setRelief] = useState<Duty | null>(null);
  const push: Record<string, string> = {
    provider_accepted:
      "Pushleverantören har accepterat larmet · telefonleverans okänd",
    unknown: "Pushens resultat är okänt",
    failed: "Pushförsök misslyckades",
    not_confirmed: "Ingen bekräftad pushleverans",
  };
  return (
    <section className="snow-panel">
      <header>
        <h2>Utkallningar och mina körpass</h2>
        <p>
          En push är ingen väckningsgaranti. Jag kommer bokar passet först när
          servern bekräftat svaret.
        </p>
      </header>
      {board.invitations.map((i) => {
        const d = board.duties.find((d) => d.id === i.duty_id);
        if (!d) return null;
        const open =
          i.state === "pending" && Date.parse(i.expires_at) > Date.now();
        return (
          <article className="snow-invitation" key={i.id}>
            <strong>
              {board.clients.find((c) => c.id === d.client_id)?.name} ·{" "}
              {board.resources.find((r) => r.id === d.resource_id)?.name}
            </strong>
            <p>
              {snowDateTime(d.starts_at)} ·{" "}
              {board.people.find((p) => p.id === i.user_id)?.name}
            </p>
            <p>{d.message}</p>
            <p>
              {i.state === "accepted"
                ? "Bekräftad"
                : i.state === "declined"
                  ? "Avböjt"
                  : i.state === "expired" || (!open && i.state === "pending")
                    ? "Svarstiden har gått ut"
                    : i.state === "superseded"
                      ? "Förfrågan stängd"
                      : "Inväntar svar"}
            </p>
            <p className="snow-hint">{push[i.push_status] || i.push_status}</p>
            {i.user_id === owner && open && (
              <div className="snow-inline">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void mutate("respond", {
                      invitation_id: i.id,
                      accept: true,
                    }).catch(() => {})
                  }
                >
                  Jag kommer
                </Button>
                <Button
                  disabled={busy}
                  variant="secondary"
                  onClick={() =>
                    void mutate("respond", {
                      invitation_id: i.id,
                      accept: false,
                    }).catch(() => {})
                  }
                >
                  Kan inte köra
                </Button>
              </div>
            )}
          </article>
        );
      })}
      {board.duties
        .filter(
          (d) =>
            d.accepted_user === owner &&
            ["accepted", "working"].includes(d.state),
        )
        .map((d) => (
          <article key={d.id} className="snow-invitation">
            <strong>
              {board.clients.find((c) => c.id === d.client_id)?.name} ·{" "}
              {board.resources.find((r) => r.id === d.resource_id)?.name}
            </strong>
            <p>{snowDateTime(d.starts_at)}</p>
            <div className="snow-inline">
              {d.state === "accepted" && (
                <Button disabled={busy} onClick={() => onStart(d)}>
                  Starta körning
                </Button>
              )}
              <Button
                disabled={busy}
                variant="secondary"
                onClick={() => setRelief(d)}
              >
                Begär avlösning
              </Button>
            </div>
          </article>
        ))}
      {!board.invitations.length &&
        !board.duties.some((d) => d.accepted_user === owner) && (
          <p className="snow-empty">
            Inga utkallningar eller bekräftade körpass i perioden.
          </p>
        )}
      {relief && (
        <SnowForm
          title="Begär avlösning"
          busy={busy}
          onClose={() => setRelief(null)}
          fields={[
            {
              key: "at",
              label: "Önskad avlösning (svensk tid)",
              type: "datetime-local",
              required: true,
            },
            { key: "message", label: "Information" },
          ]}
          onSave={(v) =>
            mutate("relief", {
              duty_id: relief.id,
              at: fromLocal(v.at),
              message: v.message,
            })
          }
        />
      )}
    </section>
  );
}
