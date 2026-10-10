import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, ClipboardCheck } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import {
  Button,
  EmptyState,
  LoadingPage,
  PageHeader,
  Tabs,
} from "../components/ui";
import type {
  ChecklistInstance,
  ChecklistInstanceItem,
} from "../lib/operations";

export function OperationsChecklistsPage({
  workOrderId,
}: {
  workOrderId?: string;
}) {
  const { user } = useAuth();
  const [instances, setInstances] = useState<ChecklistInstance[]>([]),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState("in_progress"),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  const actionLock = useRef(false),
    sequence = useRef(0);
  const fetchInstances = useCallback(
    async (initial = false) => {
      if (!user?.organisation_id) {
        setLoading(false);
        return;
      }
      const request = ++sequence.current;
      if (initial) setLoading(true);
      try {
        let query = supabase
          .from("vihem_checklist_instances")
          .select("*, items:vihem_checklist_instance_items(*)")
          .eq("organisation_id", user.organisation_id)
          .order("created_at", { ascending: false });
        if (workOrderId) query = query.eq("work_order_id", workOrderId);
        const result = await query;
        if (request !== sequence.current) return;
        if (result.error) throw result.error;
        setInstances(
          (result.data || []).map((row) => ({
            ...row,
            items: (row.items || []).sort(
              (a: ChecklistInstanceItem, b: ChecklistInstanceItem) =>
                a.sort_order - b.sort_order,
            ),
          })) as ChecklistInstance[],
        );
        setError("");
      } catch {
        if (request === sequence.current)
          setError("Checklistorna kunde inte hämtas. Försök igen.");
      } finally {
        if (request === sequence.current) setLoading(false);
      }
    },
    [user?.organisation_id, workOrderId],
  );
  useEffect(() => {
    const counter = sequence;
    void fetchInstances(true);
    return () => {
      counter.current++;
    };
  }, [fetchInstances]);
  async function toggleItem(
    instance: ChecklistInstance,
    item: ChecklistInstanceItem,
  ) {
    if (actionLock.current) return;
    actionLock.current = true;
    setSelected(instance.id);
    setBusy(item.id);
    setError("");
    try {
      const result = await supabase.rpc("vihem_set_checklist_step", {
        p_instance: instance.id,
        p_item: item.id,
        p_completed: !item.completed_at,
        p_expected: Boolean(item.completed_at),
      });
      if (result.error) {
        setError(
          result.error.code === "P0001"
            ? "Checklistan har ändrats på en annan enhet. Läs in den igen innan du fortsätter."
            : "Punkten kunde inte sparas. Försök igen.",
        );
        return;
      }
      await fetchInstances();
    } catch {
      setError("Punkten kunde inte sparas. Försök igen.");
    } finally {
      actionLock.current = false;
      setBusy(null);
    }
  }
  if (loading) return <LoadingPage />;
  const filtered = instances.filter((i) => i.status === tab),
    current = instances.find((i) => i.id === selected) || filtered[0],
    items = current?.items || [],
    done = items.filter((i) => i.completed_at).length;
  return (
    <div
      className={
        workOrderId ? "" : "mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
      }
    >
      {!workOrderId && (
        <PageHeader
          title="Checklistor"
          subtitle="Arbeta igenom punkterna. Varje markering sparas direkt."
          icon={ClipboardCheck}
        />
      )}
      <div className="mb-5">
        <Tabs
          active={tab}
          onChange={(key) => {
            setTab(key);
            setSelected(null);
          }}
          tabs={[
            {
              key: "in_progress",
              label: `Pågående (${instances.filter((i) => i.status === "in_progress").length})`,
            },
            { key: "completed", label: "Avslutade" },
          ]}
        />
      </div>
      {error && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-red-50 p-3 text-sm text-red-800"
        >
          <p className="flex-1">{error}</p>
          <Button
            size="sm"
            variant="secondary"
            disabled={Boolean(busy)}
            onClick={() => fetchInstances()}
          >
            Läs in igen
          </Button>
        </div>
      )}
      {!current ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Inga checklistor"
          description={
            workOrderId
              ? "Ingen checklista är kopplad till arbetsordern."
              : "Välj Avslutade för tidigare checklistor."
          }
        />
      ) : (
        <div
          className={
            filtered.length > 1
              ? "grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]"
              : "max-w-4xl"
          }
        >
          {filtered.length > 1 && (
            <nav
              aria-label="Välj checklista"
              className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1"
            >
              {filtered.map((instance) => {
                const steps = instance.items || [],
                  count = steps.filter((i) => i.completed_at).length;
                return (
                  <button
                    key={instance.id}
                    onClick={() => setSelected(instance.id)}
                    aria-pressed={instance.id === current.id}
                    className={`vihem-focus flex min-w-[200px] items-center gap-3 rounded-xl px-3 py-3 text-left lg:w-full ${instance.id === current.id ? "bg-vihem-soft text-vihem-navy" : "text-vihem-muted hover:bg-white"}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {instance.title}
                      </span>
                      <span className="mt-1 block text-xs">
                        {count} av {steps.length} klara
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  </button>
                );
              })}
            </nav>
          )}
          <section className="min-w-0 rounded-2xl bg-white p-4 sm:p-6">
            <div className="mb-5">
              <p className="text-xs font-medium uppercase tracking-wide text-vihem-muted">
                {current.status === "completed"
                  ? "Avslutad arbetschecklista"
                  : "Nästa steg i arbetet"}
              </p>
              <h2 className="mt-1 text-xl font-semibold text-vihem-navy">
                {current.title}
              </h2>
              <div className="mt-4 flex items-center gap-3">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-vihem-soft"
                  role="progressbar"
                  aria-label="Klara punkter"
                  aria-valuemin={0}
                  aria-valuemax={items.length || 1}
                  aria-valuenow={done}
                >
                  <div
                    className="h-full rounded-full bg-vihem-blue"
                    style={{
                      width: `${items.length ? (done / items.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="text-sm tabular-nums text-vihem-muted">
                  {done}/{items.length}
                </span>
              </div>
            </div>
            <div className="divide-y divide-vihem-line">
              {items.map((item, index) => (
                <div key={item.id} className="py-3">
                  <button
                    className="vihem-focus flex min-h-12 w-full items-start gap-3 rounded-lg py-2 text-left disabled:opacity-100"
                    disabled={Boolean(busy) || current.status === "completed"}
                    onClick={() => toggleItem(current, item)}
                    aria-pressed={Boolean(item.completed_at)}
                  >
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${item.completed_at ? "border-vihem-blue bg-vihem-blue text-white" : "border-vihem-line text-xs text-vihem-muted"}`}
                    >
                      {item.completed_at ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-relaxed text-vihem-navy">
                        {item.label}
                      </span>
                      {item.required && (
                        <span className="block text-xs text-vihem-muted">
                          Obligatorisk
                        </span>
                      )}
                      {busy === item.id && (
                        <span
                          role="status"
                          className="block text-xs text-vihem-blue"
                        >
                          Sparar…
                        </span>
                      )}
                    </span>
                  </button>
                  {item.comment && (
                    <p className="ml-9 whitespace-pre-wrap text-sm text-vihem-muted">
                      {item.comment}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {current.status === "completed" && (
              <p className="mt-5 text-sm text-vihem-muted">
                Alla punkter är sparade. Checklistan är avslutad.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
