import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { chatRpc } from "../../lib/chat";
import { Button, Input, Modal } from "../ui";
export function ContextChatLauncher({
  type,
  id,
  name,
  suggestedIds = [],
  onNavigate,
}: {
  type: "property" | "project" | "workorder";
  id: string;
  name: string;
  suggestedIds?: string[];
  onNavigate: (path: string) => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false),
    [threads, setThreads] = useState<{ id: string; subject: string }[]>([]),
    [staff, setStaff] = useState<{ id: string; name: string }[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [title, setTitle] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const userId = user?.id,
    organisationId = user?.organisation_id,
    suggestedKey = JSON.stringify([...suggestedIds].sort());
  useEffect(() => {
    if (!open || !userId) return;
    let live = true;
    setError("");
    setTitle(
      `${name} – ${type === "property" ? "Drift" : "Grupp"}`.slice(0, 160),
    );
    setSelected(
      (JSON.parse(suggestedKey) as string[]).filter((id) => id !== userId),
    );
    void Promise.all([
      supabase
        .from("vihem_chat_threads")
        .select("id,subject")
        .eq(
          `${type === "property" ? "property" : type === "project" ? "project" : "work_order"}_id`,
          id,
        )
        .order("last_message_at", { ascending: false }),
      supabase
        .from("vihem_profiles")
        .select("id,name")
        .eq("organisation_id", organisationId)
        .eq("active", true)
        .in("role", ["staff", "admin", "superadmin"])
        .order("name"),
    ]).then(([a, b]) => {
      if (live) {
        setThreads(a.data || []);
        setStaff(b.data || []);
        if (a.error || b.error)
          setError("Konversationer eller deltagare kunde inte hämtas.");
      }
    });
    return () => {
      live = false;
    };
  }, [open, userId, organisationId, id, type, name, suggestedKey]);
  if (!user || !["admin", "superadmin", "staff"].includes(user.role))
    return null;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <MessageCircle size={16} />
        Chatt
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={`Chatt – ${name}`}
      >
        <div className="space-y-4">
          {!!threads.length && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Befintliga grupper</p>
              {threads.map((t) => (
                <Button
                  key={t.id}
                  className="w-full justify-start"
                  variant="secondary"
                  onClick={() => {
                    setOpen(false);
                    onNavigate(`chat/${t.id}`);
                  }}
                >
                  {t.subject}
                </Button>
              ))}
            </div>
          )}
          <p className="text-sm font-semibold">Skapa ny grupp</p>
          <Input
            label="Gruppnamn"
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <p className="text-xs text-slate-500">
            Granska deltagarna. Gruppen ger inte extra åtkomst till{" "}
            {type === "project"
              ? "projektets"
              : type === "workorder"
                ? "arbetsorderns"
                : "fastighetens"}{" "}
            uppgifter.
          </p>
          <div className="max-h-52 overflow-y-auto">
            {staff
              .filter((p) => p.id !== user.id)
              .map((p) => (
                <label key={p.id} className="flex items-center gap-3 p-3">
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={() =>
                      setSelected((ids) =>
                        ids.includes(p.id)
                          ? ids.filter((id) => id !== p.id)
                          : [...ids, p.id],
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button
            loading={busy}
            disabled={!selected.length || !title.trim()}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                const tid = await chatRpc<string>("vihem_chat_create", {
                  kind: "group",
                  recipients: selected,
                  title,
                  [type === "property"
                    ? "context_property"
                    : type === "project"
                      ? "context_project"
                      : "context_order"]: id,
                });
                setOpen(false);
                onNavigate(`chat/${tid}`);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Skapa och öppna
          </Button>
        </div>
      </Modal>
    </>
  );
}
export function TenantChatLauncher({
  tenantId,
  onNavigate,
}: {
  tenantId: string;
  onNavigate: (path: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [threads, setThreads] = useState<
      { id: string; subject: string; last_message_at: string }[]
    >([]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      const { data: members, error: memberError } = await supabase
        .from("vihem_chat_participants")
        .select("thread_id")
        .eq("user_id", tenantId)
        .is("left_at", null);
      if (memberError) throw memberError;
      const ids = (members || []).map((p) => p.thread_id);
      if (!ids.length) {
        if (live) setThreads([]);
        return;
      }
      const { data, error } = await supabase
        .from("vihem_chat_threads")
        .select("id,subject,last_message_at")
        .in("id", ids)
        .order("last_message_at", { ascending: false });
      if (error) throw error;
      if (live) setThreads(data || []);
    })().catch(() => {
      if (live) setError("Tidigare konversationer kunde inte hämtas.");
    });
    return () => {
      live = false;
    };
  }, [open, tenantId]);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <MessageCircle size={16} />
        Meddelanden
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Hyresgästens konversationer"
      >
        <div className="space-y-3">
          {threads.map((t) => (
            <Button
              key={t.id}
              variant="secondary"
              className="w-full"
              onClick={() => {
                setOpen(false);
                onNavigate(`chat/${t.id}`);
              }}
            >
              {t.subject} ·{" "}
              {new Date(t.last_message_at).toLocaleDateString("sv-SE")}
            </Button>
          ))}
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button
            loading={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              try {
                const id = await chatRpc<string>("vihem_chat_create", {
                  kind: "tenant_support",
                  recipients: [tenantId],
                });
                setOpen(false);
                onNavigate(`chat/${id}`);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Öppna eller starta dialog
          </Button>
        </div>
      </Modal>
    </>
  );
}
