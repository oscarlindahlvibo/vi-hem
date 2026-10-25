import React, { useCallback, useEffect, useState } from "react";
import { Button, Modal, Select } from "../../../components/ui";
import { supabase } from "../../../lib/supabase";
import { messageOf } from "../services/errors";
export function SharingDialog({
  noteId,
  collectionId,
  title,
  onClose,
}: {
  noteId?: string;
  collectionId?: string;
  title: string;
  onClose: () => void;
}) {
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]),
    [members, setMembers] = useState<
      { user_id: string; name: string; permission: string }[]
    >([]),
    [user, setUser] = useState(""),
    [permission, setPermission] = useState("read"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const target = { p_note: noteId || null, p_collection: collectionId || null };
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("vihem_personal_share_members", {
      p_note: noteId || null,
      p_collection: collectionId || null,
    });
    if (error) throw error;
    setMembers(data || []);
  }, [noteId, collectionId]);
  useEffect(() => {
    void (async () => {
      try {
        await load();
        const { data, error } = await supabase.rpc(
          "vihem_personal_share_people",
        );
        if (error) throw error;
        setPeople(data || []);
      } catch (e) {
        setError(messageOf(e));
      }
    })();
  }, [load]);
  async function change(id: string, value: string | null) {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("vihem_personal_set_share", {
        ...target,
        p_user: id,
        p_permission: value,
      });
      if (error) throw error;
      await load();
      setUser("");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={
        "Dela " + (collectionId ? "mapp eller anteckningsbok" : "anteckning")
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Button onClick={onClose} disabled={busy}>
          Klart
        </Button>
      }
    >
      <div className="space-y-4">
        <p>
          <strong>{title || "Utan titel"}</strong>
        </p>
        <p className="text-sm text-vihem-muted">
          Bara du och de personer du väljer får åtkomst.{" "}
          {collectionId
            ? "Delningen gäller innehållet och undermappar, även nya anteckningar."
            : "Eventuell delning genom mappen gäller också."}{" "}
          Personliga påminnelser och historik delas inte.
        </p>
        <Select
          label="Person"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          options={[
            { value: "", label: "Välj kollega…" },
            ...people.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <Select
          label="Behörighet"
          value={permission}
          onChange={(e) => setPermission(e.target.value)}
          options={[
            { value: "read", label: "Kan läsa" },
            { value: "edit", label: "Kan redigera text och handskrift" },
          ]}
        />
        <Button
          disabled={!user || busy}
          loading={busy}
          onClick={() => void change(user, permission)}
        >
          Lägg till eller uppdatera
        </Button>
        <ul className="space-y-3">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">
                {m.name} ·{" "}
                {m.permission === "edit" ? "Kan redigera" : "Kan läsa"}
              </span>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void change(m.user_id, null)}
              >
                Ta bort åtkomst
              </Button>
            </li>
          ))}
        </ul>
        {!members.length && (
          <p className="text-sm text-vihem-muted">
            Inga direkta delningar. En överordnad mapp kan fortfarande ge
            åtkomst.
          </p>
        )}
        <p className="text-xs text-vihem-muted">
          Redigering kräver anslutning för mottagare. Endast ägaren flyttar,
          raderar och hanterar bilagor. Återkallad delning stoppar nya
          serveranrop; redan nedladdade filer och signerade länkar kan inte
          återtas omedelbart.
        </p>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
