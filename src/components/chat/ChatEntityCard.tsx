import { useEffect, useState } from "react";
import { ClipboardList, FolderKanban } from "lucide-react";
import {
  formatDate,
  WO_STATUS_LABELS,
  CUSTOMER_PROJECT_STATUS_LABELS,
} from "../../lib/utils";
import type { WOStatus, CustomerProjectStatus } from "../../types";
import { supabase } from "../../lib/supabase";
export function ChatEntityCard({
  type,
  id,
  open,
}: {
  type: "workorder" | "project";
  id: string;
  open: () => void;
}) {
  const [row, setRow] = useState<{
      title: string;
      status: string;
      due_date?: string;
      property?: { name: string } | null;
    } | null>(null),
    [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setRow(null);
    setFailed(false);
    const query =
      type === "workorder"
        ? supabase
            .from("vihem_work_orders")
            .select("title,status,due_date,property:vihem_properties(name)")
            .eq("id", id)
        : supabase
            .from("vihem_customer_projects")
            .select("title,status")
            .eq("id", id);
    void query.maybeSingle().then(({ data, error }) => {
      if (live) {
        setFailed(!!error);
        setRow(error ? null : (data as unknown as typeof row));
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [type, id]);
  if (loading) return <p className="mt-2 text-xs opacity-70">Hämtar länk…</p>;
  if (!row)
    return (
      <p className="mt-2 text-xs opacity-70">
        {failed
          ? "Kunde inte hämta länken. Öppna konversationen igen för att försöka på nytt."
          : "Det delade objektet är inte tillgängligt för dig."}
      </p>
    );
  return (
    <button
      type="button"
      onClick={open}
      className="mt-2 flex w-full items-start gap-2 rounded-xl border border-current/20 bg-black/5 p-3 text-left"
    >
      {type === "workorder" ? (
        <ClipboardList size={20} className="shrink-0" />
      ) : (
        <FolderKanban size={20} className="shrink-0" />
      )}
      <span className="min-w-0">
        <span className="block font-semibold">{row.title}</span>
        <span className="block text-xs opacity-75">
          {row.property?.name}
          {row.property?.name ? " · " : ""}
          {type === "workorder"
            ? WO_STATUS_LABELS[row.status as WOStatus] || row.status
            : CUSTOMER_PROJECT_STATUS_LABELS[row.status as CustomerProjectStatus] || row.status}
          {row.due_date ? ` · ${formatDate(row.due_date)}` : ""}
        </span>
      </span>
    </button>
  );
}
