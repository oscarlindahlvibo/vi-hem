import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Clock, Map, Snowflake } from "lucide-react";
import { Button } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import type { TimeEntry } from "../../types";
import { activityLabel } from "./model";
export function SnowDriverHome({
  current,
  onNavigate,
}: {
  current?: TimeEntry;
  onNavigate: (tab: string) => void;
}) {
  const { user } = useAuth();
  const [next, setNext] = useState<{
      starts_at: string;
      ends_at: string;
    } | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!user?.organisation_id) return;
    setLoading(true);
    const { data, error: e } = await supabase
      .from("vihem_jour_shifts")
      .select("starts_at,ends_at")
      .eq("organisation_id", user.organisation_id)
      .eq("user_id", user.id)
      .eq("duty_type", "sno")
      .gt("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(1);
    if (e) setError(e.message);
    else {
      setError("");
      setNext(data?.[0] || null);
    }
    setLoading(false);
  }, [user?.id, user?.organisation_id]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => clearInterval(timer);
  }, [load]);
  const format = (value: string) =>
    new Date(value).toLocaleString("sv-SE", {
      timeZone: "Europe/Stockholm",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <section className="space-y-5">
      <div className="rounded-2xl bg-slate-950 p-6 text-white">
        <p className="text-sm text-blue-200">
          Hej {user?.name?.split(" ")[0] || "chaufför"}
        </p>
        <h2 className="mt-2 text-2xl font-bold">
          {current ? "Ditt körpass är igång" : "Redo för nästa snöpass"}
        </h2>
        <p className="mt-3 text-sm text-slate-200">
          {current
            ? `${current.customer_name || "Snöarbete"} · ${activityLabel(current.category)}`
            : "Välj uppdragsgivare, snöröjning eller sandning och kom igång. Tiden hamnar i din vanliga stämpelklocka."}
        </p>
        <Button className="mt-5" onClick={() => onNavigate("work")}>
          {current ? "Fortsätt körpass" : "Starta körpass"}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            tab: "availability",
            title: "Min tillgänglighet",
            description: "Markera när du kan köra",
            icon: CalendarDays,
          },
          {
            tab: "map",
            title: "Karta & rutter",
            description: "Rutter, områden och prioritet",
            icon: Map,
          },
          {
            tab: "history",
            title: "Min tid",
            description: "Se dina registrerade snöpass",
            icon: Clock,
          },
        ].map((item) => (
          <button
            key={item.tab}
            onClick={() => onNavigate(item.tab)}
            className="flex min-h-28 items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-blue-300"
          >
            <item.icon
              aria-hidden="true"
              className="h-6 w-6 shrink-0 text-blue-600"
            />
            <span>
              <strong className="block">{item.title}</strong>
              <span className="mt-1 block text-sm text-slate-500">
                {item.description}
              </span>
            </span>
          </button>
        ))}
      </div>
      <section className="rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-bold">
            <Snowflake className="h-5 w-5 text-blue-600" />
            Min snöjour
          </h2>
          <Button variant="secondary" onClick={() => onNavigate("jour")}>
            Visa mina jourpass
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}{" "}
            <button className="underline" onClick={() => void load()}>
              Försök igen
            </button>
          </p>
        ) : loading ? (
          <p role="status" className="mt-3 text-sm text-slate-500">
            Läser jourpass…
          </p>
        ) : next ? (
          <p className="mt-4 rounded-lg bg-emerald-50 p-3 font-semibold text-emerald-900">
            {format(next.starts_at)} – {format(next.ends_at)}
          </p>
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            Inga kommande jourpass inlagda.
          </p>
        )}
      </section>
    </section>
  );
}
