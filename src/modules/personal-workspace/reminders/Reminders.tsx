import { messageOf } from "../services/errors";
import React, { useEffect, useRef, useState } from "react";
import { Bell, Check, Plus, Trash2 } from "lucide-react";
import { Button, Input, Modal, Select, Textarea } from "../../../components/ui";
import { supabase } from "../../../lib/supabase";
import { reminders, saveReminder } from "../services/repository";
import type { Reminder } from "../types";
import { fromLocal, localInput, parseQuick, snoozeAt } from "./time";
export function ReminderForm({
  owner,
  noteId,
  blockId,
  title,
  onClose,
  onSaved,
  existing,
}: {
  owner: string;
  noteId?: string;
  blockId?: string;
  title?: string;
  onClose: () => void;
  onSaved: () => void;
  existing?: Reminder;
}) {
  const [name, setName] = useState(existing?.title || title || ""),
    [description, setDescription] = useState(existing?.description || ""),
    [when, setWhen] = useState(
      localInput(
        existing?.due_at || new Date(Date.now() + 3600000).toISOString(),
      ),
    ),
    [recurrence, setRecurrence] = useState<Reminder["recurrence"]>(
      existing?.recurrence || "none",
    ),
    [repeatEvery, setRepeatEvery] = useState(existing?.repeat_every || 1),
    [weekdays, setWeekdays] = useState<number[]>(
      existing?.weekdays || [1, 2, 3, 4, 5],
    ),
    [priority, setPriority] = useState(existing?.priority || 0),
    [preview, setPreview] = useState(existing?.preview || false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [quick, setQuick] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await saveReminder({
        id: existing?.id || crypto.randomUUID(),
        owner_id: owner,
        note_id: existing?.note_id || noteId || null,
        block_id: existing?.block_id || blockId || null,
        title: name.trim(),
        description,
        due_at: fromLocal(when, existing?.timezone || "Europe/Stockholm"),
        timezone: existing?.timezone || "Europe/Stockholm",
        priority,
        recurrence,
        repeat_every: repeatEvery,
        weekdays,
        completed_at: existing?.completed_at || null,
        cancelled_at: null,
        preview,
        revision: existing?.revision || 0,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Kunde inte spara påminnelsen.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={existing ? "Redigera påminnelse" : "Ny personlig påminnelse"}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Button
          disabled={
            !name.trim() ||
            !when ||
            (recurrence === "weekdays" && !weekdays.length) ||
            (recurrence === "interval" &&
              (!Number.isInteger(repeatEvery) ||
                repeatEvery < 1 ||
                repeatEvery > 365))
          }
          loading={busy}
          onClick={() => void save()}
        >
          Spara påminnelse
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="pw-hint">
          Bara du kan se påminnelsen. Tider anges i{" "}
          {existing?.timezone || "Europe/Stockholm"}.
        </p>
        {!existing && (
          <div>
            <Input
              label="Skriv snabbt"
              placeholder="Imorgon kl 09 att ringa banken"
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
            />
            <Button
              variant="ghost"
              onClick={() => {
                try {
                  const r = parseQuick(quick);
                  if (!r) {
                    setError(
                      "Skriv exempelvis ”imorgon kl 09 att ringa banken”, eller fyll i fälten nedan.",
                    );
                    return;
                  }
                  setName(r.title);
                  setWhen(r.local);
                  setError("");
                } catch (e) {
                  setError(messageOf(e));
                }
              }}
            >
              Tolka och förhandsvisa i fälten
            </Button>
          </div>
        )}
        <Input
          label="Titel"
          value={name}
          maxLength={500}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          label="Beskrivning"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Input
          label="Datum och tid"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <Select
          label="Upprepning"
          value={recurrence}
          onChange={(e) =>
            setRecurrence(e.target.value as Reminder["recurrence"])
          }
          options={[
            { value: "none", label: "Ingen" },
            { value: "daily", label: "Varje dag" },
            { value: "weekly", label: "Varje vecka" },
            { value: "monthly", label: "Varje månad" },
            { value: "weekdays", label: "Utvalda veckodagar" },
            { value: "interval", label: "Eget intervall" },
          ]}
        />
        {recurrence === "weekdays" && (
          <fieldset>
            <legend>Veckodagar</legend>
            <div className="flex flex-wrap gap-3">
              {["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"].map(
                (day, i) => (
                  <label key={day} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={weekdays.includes(i + 1)}
                      onChange={(e) =>
                        setWeekdays(
                          e.target.checked
                            ? [...weekdays, i + 1]
                            : weekdays.filter((d) => d !== i + 1),
                        )
                      }
                    />
                    {day}
                  </label>
                ),
              )}
            </div>
          </fieldset>
        )}
        {recurrence === "interval" && (
          <Input
            label="Upprepa var … dag"
            type="number"
            min={1}
            max={365}
            value={repeatEvery}
            onChange={(e) => setRepeatEvery(Number(e.target.value))}
          />
        )}
        <Select
          label="Prioritet"
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          options={[
            { value: "0", label: "Normal" },
            { value: "1", label: "Viktig" },
            { value: "2", label: "Hög" },
          ]}
        />
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={preview}
            onChange={(e) => setPreview(e.target.checked)}
          />{" "}
          Visa titeln i pushnotisen (kan synas på låsskärmen)
        </label>
        {error && (
          <p role="alert" className="pw-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
export function Reminders({
  owner,
  openNote,
  initialId,
}: {
  owner: string;
  openNote: (id: string, blockId?: string) => void;
  initialId?: string;
}) {
  const [items, setItems] = useState<Reminder[]>([]),
    [view, setView] = useState("today"),
    [form, setForm] = useState<Reminder | true | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0),
    [hasMore, setHasMore] = useState(false);
  const request = useRef(0);
  async function load(append = false) {
    const generation = ++request.current;
    try {
      const data = await reminders(view, append ? offset : 0);
      if (generation !== request.current) return;
      setItems((old) =>
        append
          ? [...old, ...data.filter((r) => !old.some((x) => x.id === r.id))]
          : data,
      );
      setOffset((append ? offset : 0) + 100);
      setHasMore(data.length === 100);
      setError("");
    } catch (e) {
      if (generation === request.current) setError(messageOf(e));
    } finally {
      if (generation === request.current) setLoading(false);
    }
  }
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    setLoading(true);
    void loadRef.current();
  }, [owner, view]);
  useEffect(() => {
    let live = true;
    if (initialId)
      void supabase
        .from("vihem_personal_reminders")
        .select("*")
        .eq("id", initialId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!live) return;
          if (error || !data)
            setError("Påminnelsen är borttagen eller saknar åtkomst.");
          else setForm(data as Reminder);
        });
    return () => {
      live = false;
    };
  }, [owner, initialId]);
  const today = localInput(new Date().toISOString()).slice(0, 10);
  const visible = items.filter((r) =>
    view === "done"
      ? r.completed_at
      : !r.completed_at &&
        (view === "all" ||
          (view === "late" && r.due_at < new Date().toISOString()) ||
          (view === "today" && localInput(r.due_at).startsWith(today)) ||
          (view === "upcoming" && localInput(r.due_at).slice(0, 10) > today)),
  );
  async function action(r: Reminder, kind: string) {
    setBusy(r.id);
    try {
      if (kind === "complete") {
        const { error } = await supabase.rpc(
          "vihem_personal_complete_reminder",
          { p_id: r.id, p_expected: r.revision },
        );
        if (error) throw error;
      } else
        await saveReminder({
          ...r,
          ...(kind === "delete"
            ? { cancelled_at: new Date().toISOString() }
            : {
                due_at: snoozeAt(kind, new Date(), r.timezone),
              }),
        });
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="pw-reminders">
      <header>
        <div>
          <span className="pw-eyebrow">DITT PERSONLIGA FOKUS</span>
          <h2>Mina påminnelser</h2>
          <p className="pw-hint">Små saker att komma ihåg. Bara för dig.</p>
        </div>
        <Button onClick={() => setForm(true)}>
          <Plus size={17} /> Ny påminnelse
        </Button>
      </header>
      <nav className="pw-filter" aria-label="Filtrera påminnelser">
        {Object.entries({
          today: "Idag",
          upcoming: "Kommande",
          late: "Försenade",
          all: "Alla",
          done: "Avklarade",
        }).map(([v, l]) => (
          <button aria-pressed={view === v} key={v} onClick={() => setView(v)}>
            {l}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="pw-error">
          {error}
          <button onClick={() => void load()}>Försök igen</button>
        </p>
      )}
      {loading ? (
        <p role="status">Hämtar påminnelser…</p>
      ) : !visible.length ? (
        <div className="pw-empty">
          <Bell size={32} />
          <h3>Lite mer utrymme i huvudet</h3>
          <p>Inga påminnelser i den här vyn.</p>
        </div>
      ) : (
        visible.map((r) => (
          <article className="pw-reminder-row" key={r.id}>
            <button
              disabled={busy === r.id || !!r.completed_at}
              className="pw-check"
              aria-label={"Klarmarkera " + r.title}
              onClick={() => void action(r, "complete")}
            >
              <Check size={18} />
            </button>
            <div>
              <button className="pw-reminder-title" onClick={() => setForm(r)}>
                {r.title}
              </button>
              <p className="pw-hint">
                {new Date(r.due_at).toLocaleString("sv-SE", {
                  timeZone: r.timezone,
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                {r.recurrence !== "none" ? " · Återkommande" : ""}
                {r.priority ? " · Viktig" : ""}
              </p>
              {r.description && <p>{r.description}</p>}
              {r.note_id && (
                <button
                  className="pw-link"
                  onClick={() => openNote(r.note_id!, r.block_id || undefined)}
                >
                  Öppna anteckning
                </button>
              )}
            </div>
            {!r.completed_at && (
              <select
                aria-label={"Skjut upp " + r.title}
                value=""
                disabled={busy === r.id}
                onChange={(e) => void action(r, e.target.value)}
              >
                <option value="" disabled>
                  Skjut upp
                </option>
                <option value="hour">En timme</option>
                <option value="today">Senare idag (18)</option>
                <option value="tomorrow">Imorgon kl. 09</option>
                <option value="week">Nästa vecka kl. 09</option>
              </select>
            )}
            <button
              aria-label={"Ta bort " + r.title}
              disabled={busy === r.id}
              onClick={() => {
                if (confirm("Ta bort påminnelsen?")) void action(r, "delete");
              }}
            >
              <Trash2 size={17} />
            </button>
          </article>
        ))
      )}
      {hasMore && (
        <Button variant="secondary" onClick={() => void load(true)}>
          Visa fler påminnelser
        </Button>
      )}
      {form && (
        <ReminderForm
          owner={owner}
          existing={form === true ? undefined : form}
          onClose={() => setForm(null)}
          onSaved={() => void load()}
        />
      )}
    </section>
  );
}
