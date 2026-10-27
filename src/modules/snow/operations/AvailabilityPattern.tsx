import { useState } from "react";
import { Button, Select } from "../../../components/ui";
import {
  addDays,
  minuteLabel,
  parseMinute,
  weekStart,
  calendarDay,
} from "../availability";
import type { Board } from "./types";
import { options } from "./presentation";
export type Mutate = (
  action: string,
  data: Record<string, unknown>,
) => Promise<Record<string, unknown>>;
export function AvailabilityPattern({
  board,
  owner,
  mutate,
  busy,
}: {
  board: Board;
  owner: string;
  mutate: Mutate;
  busy: boolean;
}) {
  const [target, setTarget] = useState(owner),
    [editing, setEditing] = useState(false),
    [slots, setSlots] = useState<{ enabled: boolean; ranges: string }[]>([]),
    [error, setError] = useState(""),
    [revision, setRevision] = useState("");
  const week = weekStart(calendarDay()),
    [selectedWeek, setWeek] = useState(addDays(week, 7));
  const confirm = board.confirmations.find(
    (c) => c.user_id === owner && c.week_start === selectedWeek,
  );
  return (
    <section className="snow-panel">
      <header>
        <h2>Min grundtillgänglighet</h2>
        <p>
          Frivilliga tider. Detta är ingen jour eller bokning av arbetspass.
        </p>
      </header>
      <div className="snow-inline">
        <Select
          label="Vecka att bekräfta"
          value={selectedWeek}
          onChange={(e) => setWeek(e.target.value)}
          options={[week, addDays(week, 7), addDays(week, 14)].map((w) => ({
            value: w,
            label: `${w} – ${addDays(w, 6)}`,
          }))}
        />
        <p>
          {confirm?.current
            ? confirm.available
              ? "Veckan är bekräftad"
              : "Inte tillgänglig denna vecka"
            : "Veckan är inte bekräftad eller har ändrats"}
        </p>
      </div>
      <div className="snow-inline">
        <Button
          disabled={busy}
          onClick={() =>
            void mutate("confirm_week", {
              week: selectedWeek,
              available: true,
            }).catch(() => {})
          }
        >
          Bekräfta hela veckan
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void mutate("confirm_week", {
              week: selectedWeek,
              available: false,
            }).catch(() => {})
          }
        >
          Kan inte denna vecka
        </Button>
      </div>
      {board.admin && (
        <section aria-label="Veckobekräftelser">
          <h3>Förarnas besked · {selectedWeek}</h3>
          <div className="snow-resource-grid">
            {board.people.map((p) => {
              const c = board.confirmations.find(
                (c) => c.user_id === p.id && c.week_start === selectedWeek,
              );
              return (
                <p key={p.id}>
                  <strong>{p.name}</strong> ·{" "}
                  {c?.current
                    ? c.available
                      ? "Bekräftad tillgänglighet"
                      : "Kan inte denna vecka"
                    : "Inväntar aktuellt svar"}
                </p>
              );
            })}
          </div>
        </section>
      )}
      {board.admin && (
        <Select
          label="Grundschema för"
          value={target}
          options={options(board.people)}
          onChange={(e) => {
            setTarget(e.target.value);
            setEditing(false);
          }}
        />
      )}
      {!editing ? (
        <Button
          variant="secondary"
          onClick={() => {
            setRevision(board.pattern_revisions[target] || "");
            setSlots(
              Array.from({ length: 7 }, (_, i) => {
                const s = board.patterns.find(
                  (p) => p.user_id === target && p.weekday === i + 1,
                )?.slots;
                return {
                  enabled: !!s?.length,
                  ranges:
                    s
                      ?.map(([a, b]) => `${minuteLabel(a)}–${minuteLabel(b)}`)
                      .join(", ") || "04:00–23:00",
                };
              }),
            );
            setEditing(true);
          }}
        >
          Ändra återkommande grundvecka
        </Button>
      ) : (
        <div className="space-y-3">
          {[
            "Måndag",
            "Tisdag",
            "Onsdag",
            "Torsdag",
            "Fredag",
            "Lördag",
            "Söndag",
          ].map((label, i) => (
            <div className="snow-inline" key={label}>
              <label>
                <input
                  type="checkbox"
                  checked={slots[i].enabled}
                  onChange={(e) =>
                    setSlots(
                      slots.map((s, j) =>
                        j === i ? { ...s, enabled: e.target.checked } : s,
                      ),
                    )
                  }
                />{" "}
                {label}
              </label>
              <input
                aria-label={`${label} tidsintervall`}
                placeholder="04:00–08:00, 16:00–23:00"
                value={slots[i].ranges}
                onChange={(e) =>
                  setSlots(
                    slots.map((s, j) =>
                      j === i ? { ...s, ranges: e.target.value } : s,
                    ),
                  )
                }
              />
            </div>
          ))}
          <p className="text-sm text-slate-500">
            Upp till fyra intervall per dag, separerade med komma. Tider
            00:00–24:00. Undantag och extra tider anger du i den vanliga
            vecka-/månadskalendern nedan. Ändringar kräver ny veckobekräftelse.
          </p>
          <Button
            disabled={busy}
            onClick={() => {
              try {
                const days = slots.map((s, i) => ({
                  weekday: i + 1,
                  slots: s.enabled
                    ? s.ranges.split(",").map((range) => {
                        const parts = range.trim().split(/[–-]/);
                        if (parts.length !== 2)
                          throw Error("Ange tidsintervall som 04:00–08:00");
                        const start = parseMinute(parts[0]),
                          end = parseMinute(parts[1]);
                        if (start === null || end === null || end <= start)
                          throw Error(
                            "Kontrollera intervallets start och slut.",
                          );
                        return [start, end];
                      })
                    : [],
                }));
                void mutate("pattern", { user_id: target, days, revision })
                  .then(() => setEditing(false))
                  .catch(() => {});
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Spara grundvecka
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Avbryt
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
