import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import {
  Button,
  PageHeader,
  EmptyState,
  LoadingPage,
  Modal,
  Input,
} from "../components/ui";
import { formatDateTime } from "../lib/utils";
import type { Notification } from "../types";
import {
  Bell,
  Check,
  CheckCheck,
  MessageCircle,
  FileText,
  Wrench,
  ArrowUpRight,
  Trash2,
} from "lucide-react";

const resolveLink = (n: Notification) =>
  n.link === "mail" ||
  `${n.title} ${n.message}`.toLowerCase().match(/fakturamatch|e-postmatchning/)
    ? "mail-watchers"
    : n.link;
export function NotificationsPage({
  onNavigate,
}: {
  onNavigate: (page: string) => void;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Notification[]>([]),
    [loading, setLoading] = useState(true),
    [more, setMore] = useState(false);
  const [error, setError] = useState(""),
    [actionError, setActionError] = useState(""),
    [filter, setFilter] = useState<"all" | "unread">("all"),
    [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null),
    [remove, setRemove] = useState<Notification | null>(null);
  const generation = useRef(0),
    fetching = useRef(false),
    acting = useRef(false),
    cursor = useRef<Notification | null>(null);
  const fetchRows = useCallback(
    async (reset = false) => {
      if (!user?.id || fetching.current) return;
      fetching.current = true;
      const epoch = generation.current;
      setLoading(true);
      setError("");
      try {
        let q = supabase
          .from("vihem_notifications")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: false })
          .limit(51);
        if (filter === "unread") q = q.is("read_at", null);
        const last = reset ? null : cursor.current;
        if (last)
          q = last.created_at
            ? q.or(
                `created_at.lt.${last.created_at},created_at.is.null,and(created_at.eq.${last.created_at},id.lt.${last.id})`,
              )
            : q.is("created_at", null).lt("id", last.id);
        const result = await q;
        if (epoch !== generation.current) return;
        if (result.error) throw result.error;
        const fetched = (result.data || []) as Notification[],
          page = fetched.slice(0, 50);
        cursor.current = page[page.length - 1] || last;
        setRows((old) =>
          reset
            ? page
            : [...old, ...page.filter((r) => !old.some((n) => n.id === r.id))],
        );
        setMore(fetched.length > 50);
      } catch {
        if (epoch === generation.current)
          setError("Aviseringarna kunde inte hämtas. Försök igen.");
      } finally {
        if (epoch === generation.current) {
          fetching.current = false;
          setLoading(false);
        }
      }
    },
    [user?.id, filter],
  );
  useEffect(() => {
    generation.current++;
    const epoch = generation.current;
    fetching.current = false;
    cursor.current = null;
    setRows([]);
    setMore(false);
    setActionError("");
    void fetchRows(true);
    return () => {
      generation.current = epoch + 1;
      fetching.current = false;
    };
  }, [fetchRows]);
  // New arrivals are shown on demand; don't jump the user's scroll or discard older pages.
  const [newActivity, setNewActivity] = useState(false);
  useEffect(() => {
    setNewActivity(false);
    if (!user?.id) return;
    const channel = supabase
      .channel(`notifications-inbox:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "vihem_notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => setNewActivity(true),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);
  async function act(id: string, kind: "read" | "all" | "delete") {
    if (!user?.id || acting.current) return false;
    acting.current = true;
    setPending(id);
    setActionError("");
    try {
      if (kind === "delete") {
        const result = await supabase
          .from("vihem_notifications")
          .delete()
          .eq("user_id", user.id)
          .eq("id", id)
          .select("id")
          .single();
        if (result.error) throw result.error;
        setRows((old) => old.filter((r) => r.id !== id));
        setRemove(null);
      } else {
        const now = new Date().toISOString();
        let q = supabase
          .from("vihem_notifications")
          .update({ read_at: now })
          .eq("user_id", user.id)
          .is("read_at", null);
        if (kind === "read") q = q.eq("id", id);
        const result = await q.select("id");
        if (result.error) throw result.error;
        const ids = new Set((result.data || []).map((r) => r.id));
        if (kind === "read" && !ids.size) {
          const current = await supabase
            .from("vihem_notifications")
            .select("id,read_at")
            .eq("id", id)
            .eq("user_id", user.id)
            .single();
          if (current.error || !current.data?.read_at)
            throw current.error || new Error("Not read");
          ids.add(id);
        }
        setRows((old) =>
          filter === "unread"
            ? old.filter((r) => !ids.has(r.id))
            : old.map((r) => (ids.has(r.id) ? { ...r, read_at: now } : r)),
        );
      }
      if (kind === "all") void fetchRows(true);
      return true;
    } catch {
      setActionError(
        "Åtgärden kunde inte sparas. Aviseringarna finns kvar. Försök igen.",
      );
      return false;
    } finally {
      acting.current = false;
      setPending(null);
    }
  }
  const unread = rows.filter((r) => !r.read_at).length,
    visible = rows.filter((r) =>
      `${r.title} ${r.message}`
        .toLocaleLowerCase("sv")
        .includes(query.toLocaleLowerCase("sv")),
    );
  if (loading && !rows.length) return <LoadingPage />;
  return (
    <div className="mx-auto w-full max-w-5xl pb-5">
      <PageHeader
        title="Aviseringar"
        subtitle="Händelser som berör dig, samlade på ett ställe."
        icon={Bell}
        action={
          <Button
            variant="secondary"
            disabled={!!pending}
            loading={pending === "all"}
            onClick={() => void act("all", "all")}
          >
            <CheckCheck className="h-4 w-4" />
            Markera alla som lästa
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button
            variant={filter === "all" ? "primary" : "ghost"}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            Alla
          </Button>
          <Button
            variant={filter === "unread" ? "primary" : "ghost"}
            aria-pressed={filter === "unread"}
            onClick={() => setFilter("unread")}
          >
            Olästa{unread ? ` (${unread}${more ? "+" : ""})` : ""}
          </Button>
        </div>
        <div className="w-full sm:w-80"><Input
          aria-label="Sök i hämtade aviseringar"
          placeholder="Sök i hämtade aviseringar"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        /></div>
      </div>
      {newActivity && (
        <Button
          className="mb-4"
          variant="secondary"
          onClick={() => {
            setNewActivity(false);
            void fetchRows(true);
          }}
        >
          Uppdatera aviseringar
        </Button>
      )}
      {actionError && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"
        >
          {actionError}
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-red-50 p-3 text-sm text-red-700"
        >
          <p>{error}</p>
          <Button
            variant="secondary"
            onClick={() => void fetchRows(rows.length === 0)}
          >
            Försök igen
          </Button>
        </div>
      )}
      <div className="divide-y divide-slate-200 rounded-2xl bg-white px-4 sm:px-6">
        {visible.map((n) => {
          const Icon =
            n.type === "chat" || n.type === "message"
              ? MessageCircle
              : n.type === "document"
                ? FileText
                : n.type === "work_order" || n.type === "maintenance"
                  ? Wrench
                  : Bell;
          return (
            <article
              key={n.id}
              className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 py-5 sm:grid-cols-[40px_minmax(0,1fr)_auto]"
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl ${n.read_at ? "bg-slate-50 text-vihem-muted" : "bg-blue-50 text-vihem-blue"}`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex items-start gap-2">
                  <h2
                    className={`text-base text-vihem-navy ${n.read_at ? "font-medium" : "font-semibold"}`}
                  >
                    {n.title}
                  </h2>
                  {!n.read_at && (
                    <span
                      className="mt-2 h-2 w-2 shrink-0 rounded-full bg-vihem-blue"
                      aria-label="Oläst"
                    />
                  )}
                </div>
                <p className="mt-1 max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed text-vihem-muted">
                  {n.message}
                </p>
                <time className="mt-2 block text-xs text-vihem-muted">
                  {n.created_at ? formatDateTime(n.created_at) : "Datum saknas"}
                </time>
                {n.link && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={async () => {
                      if (!n.read_at && !(await act(n.id, "read"))) return;
                      const link = resolveLink(n);
                      if (link) onNavigate(link);
                    }}
                    disabled={!!pending}
                  >
                    <ArrowUpRight className="h-4 w-4" />
                    Öppna
                  </Button>
                )}
              </div>
              <div className="col-start-2 flex items-center gap-2 sm:col-start-3 sm:row-start-1 sm:self-start">
                {!n.read_at && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Markera ${n.title} som läst`}
                    loading={pending === n.id}
                    disabled={!!pending}
                    onClick={() => void act(n.id, "read")}
                  >
                    <Check className="h-4 w-4" />
                    Läst
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Ta bort ${n.title}`}
                  disabled={!!pending}
                  onClick={() => setRemove(n)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      {!visible.length && !error && (
        <EmptyState
          icon={Bell}
          title={
            query
              ? "Inga träffar"
              : filter === "unread"
                ? "Du är ikapp"
                : "Inga aviseringar"
          }
          description={
            query
              ? "Sökningen gäller de aviseringar du har hämtat."
              : "Nya händelser visas här."
          }
        />
      )}
      {more && (
        <Button
          variant="secondary"
          className="mt-5"
          loading={loading}
          onClick={() => void fetchRows()}
        >
          Visa äldre aviseringar
        </Button>
      )}
      <Modal
        open={!!remove}
        onClose={() => {
          if (!acting.current) setRemove(null);
        }}
        title="Ta bort aviseringen?"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={!!pending}
              onClick={() => setRemove(null)}
            >
              Avbryt
            </Button>
            <Button
              variant="danger"
              loading={pending === remove?.id}
              onClick={() => {
                if (remove) void act(remove.id, "delete");
              }}
            >
              Ta bort
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {remove?.title}. Aviseringen tas bort permanent. Den kopplade
          informationen påverkas inte.
        </p>
        {actionError && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {actionError}
          </p>
        )}
      </Modal>
    </div>
  );
}
