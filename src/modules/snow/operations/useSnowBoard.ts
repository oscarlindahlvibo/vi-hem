import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../../lib/supabase";
import type { Board } from "./types";
export interface Command {
  id: string;
  action: string;
  data: Record<string, unknown>;
}
const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String(e.message)
      : "Servern kunde inte bekräfta ändringen.";
export function useSnowBoard(
  owner: string,
  org: string,
  from: string,
  days: number,
) {
  const [board, setBoard] = useState<Board | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Command | null>(() => {
      try {
        return JSON.parse(
          localStorage.getItem(`vihem.snow.command:${owner}:${org}`) || "null",
        );
      } catch {
        return null;
      }
    });
  const generation = useRef(0),
    lock = useRef(false),
    key = `vihem.snow.command:${owner}:${org}`;
  const load = useCallback(async () => {
    const g = ++generation.current;
    const { data, error } = await supabase.rpc("vihem_snow_board", {
      p_from: from,
      p_days: days,
    });
    if (error) throw error;
    if (g === generation.current) setBoard(data as Board);
  }, [from, days]);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void load().catch((e) => {
        if (active) setError(message(e));
      });
    refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;

      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  const execute = async (command: Command) => {
    if (lock.current) throw Error("En ändring pågår.");
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      // Never put tax identifiers in browser storage. Such corrections have no external side effect.
      if (command.action !== "customer_update")
        localStorage.setItem(key, JSON.stringify(command));
      setPending(command);
      if (!navigator.onLine)
        throw Error(
          "Ingen anslutning. Ändringen är inte bekräftad av servern.",
        );
      const { data, error } = await supabase.rpc("vihem_snow_command", {
        p_id: command.id,
        p_action: command.action,
        p_data: command.data,
      });
      if (error) {
        if (error.code && /^[0-9A-Z]{5}$/.test(error.code)) {
          localStorage.removeItem(key);
          setPending(null);
        }
        throw error;
      }
      localStorage.removeItem(key);
      setPending(null);
      await load().catch((e) =>
        setError(
          "Ändringen är sparad, men vyn kunde inte uppdateras. " + message(e),
        ),
      );
      return data as Record<string, unknown>;
    } catch (e) {
      setError(message(e));
      throw e;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const mutate = (action: string, data: Record<string, unknown>) => {
    if (pending)
      return Promise.reject(Error("Bekräfta först den väntande ändringen."));
    return execute({ id: crypto.randomUUID(), action, data });
  };
  return {
    board,
    error,
    busy,
    pending,
    load,
    mutate,
    retry: () => (pending ? execute(pending) : Promise.resolve(undefined)),
    setError,
  };
}
