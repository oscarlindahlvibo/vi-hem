import { useUnsavedChanges } from "../../../hooks/useUnsavedChanges";
import { messageOf } from "./errors";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Note, Stroke } from "../types";
import {
  loadInk,
  loadNote,
  saveDraft,
  saveInk,
  syncWorkspace,
} from "./repository";
export function useDocument(owner: string, id: string, onSaved: () => void) {
  const [note, setNote] = useState<Note | null>(null),
    [strokes, setStrokes] = useState<Stroke[]>([]),
    [status, setStatus] = useState("Hämtar…"),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [readOnly, setReadOnly] = useState(true),
    [hasLocalRisk, setHasLocalRisk] = useState(false);
  useUnsavedChanges(hasLocalRisk, true, false);
  useEffect(() => {
    let release: () => void = () => {};
    let closed = false;
    setReadOnly(true);
    if (!navigator.locks) {
      setError(
        "Webbläsaren saknar säkert redigeringslås. Uppdatera webbläsaren för att redigera anteckningar.",
      );
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    void navigator.locks
      .request(
        "vihem-personal:" + owner + ":" + id,
        { signal: controller.signal },
        async () => {
          clearTimeout(timeout);
          if (closed) return;
          setReadOnly(false);
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      )
      .catch(() => {
        if (!closed) setReadOnly(true);
      });
    return () => {
      closed = true;
      clearTimeout(timeout);
      controller.abort();
      release();
    };
  }, [owner, id]);
  const current = useRef<Note | null>(null),
    ink = useRef<Stroke[]>([]),
    writes = useRef<Promise<void>>(Promise.resolve()),
    pendingWork = useRef<Array<() => Promise<void>>>([]),
    draining = useRef(false),
    dirty = useRef(false),
    generation = useRef(0),
    notify = useRef(onSaved);
  notify.current = onSaved;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  useEffect(() => {
    const g = ++generation.current;
    setNote(null);
    setStrokes([]);
    setConflict(false);
    setError("");
    current.current = null;
    ink.current = [];
    void (async () => {
      try {
        await writes.current;
        const n = await loadNote(owner, id);
        const s = await loadInk(owner, id);
        if (g !== generation.current) return;
        current.current = n;
        ink.current = s;
        setNote(n);
        setStrokes(s);
        setStatus(
          navigator.onLine ? "Kontrollerar synkning…" : "Sparat lokalt",
        );
      } catch (e) {
        if (g === generation.current) {
          setError(messageOf(e));
          setStatus("Kunde inte hämta");
        }
      }
    })();
    return () => {
      if (generation.current === g) generation.current = g + 1;
    };
  }, [owner, id]);
  const drain = useCallback(() => {
    if (draining.current) return writes.current;
    draining.current = true;
    writes.current = (async () => {
      while (pendingWork.current.length) {
        try {
          await pendingWork.current[0]();
          pendingWork.current.shift();
        } catch (e) {
          setError(
            "Lokal sparning misslyckades. Behåll vyn öppen eller exportera innehållet. " +
              messageOf(e),
          );
          setStatus("Sparfel lokalt");
          return;
        }
      }
      dirty.current = false;
      setHasLocalRisk(false);
    })().finally(() => {
      draining.current = false;
    });
    return writes.current;
  }, []);
  const queue = useCallback(
    (work: () => Promise<void>) => {
      dirty.current = true;
      setHasLocalRisk(true);
      setStatus("Sparar lokalt…");
      pendingWork.current.push(work);
      void drain().then(() => {
        if (!pendingWork.current.length)
          setStatus(navigator.onLine ? "Väntar på synkning" : "Sparat lokalt");
      });
    },
    [drain],
  );
  const update = useCallback(
    (patch: Partial<Note>) => {
      if (!current.current || readOnlyRef.current) return;
      const n = {
        ...current.current,
        ...patch,
        updated_at: new Date().toISOString(),
      };
      current.current = n;
      setNote(n);
      queue(async () => {
        await saveDraft(n);
      });
    },
    [queue],
  );
  const changeInk = useCallback(
    (changes: Stroke[]) => {
      if (readOnlyRef.current) return;
      ink.current = [
        ...ink.current.filter((s) => !changes.some((c) => c.id === s.id)),
        ...changes,
      ];
      setStrokes(ink.current);
      queue(async () => {
        for (const s of changes) await saveInk(owner, s);
      });
    },
    [owner, queue],
  );
  useEffect(() => {
    let running = false,
      alive = true;
    async function sync() {
      if (running || !navigator.onLine) return;
      running = true;
      try {
        await drain();
        if (pendingWork.current.length) return;
        const result = await syncWorkspace(owner);
        if (!alive) return;
        if (result.conflicts.includes(id)) {
          setConflict(true);
          setStatus("Synkningskonflikt – lokala ändringar bevarade");
          return;
        }
        // Refresh revision only. Never replace edits made while the request was in flight.
        const { records } = await import("./local");
        const locals = await records("notes", owner);
        const d = locals.find((x) => "note" in x && x.note.id === id);
        if (d && "note" in d && current.current) {
          current.current = { ...current.current, revision: d.note.revision };
          setNote(current.current);
        }
        const inkLocal = await records("ink", owner);
        for (const s of ink.current) {
          const saved = inkLocal.find(
            (x) => "value" in x && x.value.id === s.id,
          );
          if (saved && "value" in saved) s.revision = saved.value.revision;
        }
        const inkPending = inkLocal.some(
          (x) => "value" in x && x.value.note_id === id && x.dirty,
        );
        if (
          d &&
          "note" in d &&
          !d.dirty &&
          !inkPending &&
          !pendingWork.current.length
        ) {
          setStatus("Sparat");
          notify.current();
        }
        setError("");
      } catch (e) {
        if (alive) {
          setStatus("Synkningsfel – sparat lokalt");
          setError(messageOf(e));
        }
      } finally {
        running = false;
      }
    }
    const timer = window.setInterval(() => void sync(), 3000);
    const online = () => void sync();
    const hidden = () => {
      if (document.visibilityState === "hidden") void sync();
    };
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("beforeunload", before);
    void sync();
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("beforeunload", before);
    };
  }, [owner, id, drain]);
  return {
    note,
    strokes,
    status,
    error,
    conflict,
    readOnly,
    update,
    changeInk,
  };
}
