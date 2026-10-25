import { messageOf } from "../services/errors";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Trash2, Upload } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { requireSession } from "../services/repository";
type Attachment = {
  id: string;
  name: string;
  storage_path: string;
  mime: string;
  bytes: number;
};
const types = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "audio/mpeg",
  "audio/mp4",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
export function Attachments({
  owner,
  noteId,
  ready,
  onImage,
}: {
  owner: string;
  noteId: string;
  ready: boolean;
  onImage?: (id: string, name: string) => void;
}) {
  const [items, setItems] = useState<Attachment[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("vihem_personal_attachments")
      .select("id,name,storage_path,mime,bytes")
      .eq("note_id", noteId);
    if (error) setError(error.message);
    else setItems(data || []);
  }, [noteId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function upload(files: FileList | null) {
    if (!files) return;
    setBusy(true);
    setError("");
    try {
      await requireSession(owner);
      for (const file of Array.from(files)) {
        if (
          !types.includes(file.type) ||
          !file.size ||
          file.size > 20 * 1024 * 1024
        )
          throw Error(
            "Tillåtna filer: JPG, PNG, WebP, PDF, text, ljud, Word och Excel. Högst 20 MB per fil.",
          );
        const id = crypto.randomUUID(),
          path = `${owner}/${noteId}/${id}`;
        const { error } = await supabase.storage
          .from("vihem-personal")
          .upload(path, file, { contentType: file.type });
        if (error) throw error;
        const { error: rowError } = await supabase
          .from("vihem_personal_attachments")
          .insert({
            id,
            owner_id: owner,
            note_id: noteId,
            name: file.name,
            mime: file.type,
            bytes: file.size,
            storage_path: path,
          });
        if (rowError) {
          await supabase.storage.from("vihem-personal").remove([path]);
          throw rowError;
        }
        if (file.type.startsWith("image/")) onImage?.(id, file.name);
      }
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  async function open(a: Attachment) {
    try {
      await requireSession(owner);
      const { data, error } = await supabase.storage
        .from("vihem-personal")
        .createSignedUrl(a.storage_path, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(messageOf(e));
    }
  }
  async function remove(a: Attachment) {
    if (!confirm("Ta bort bilagan permanent?")) return;
    setBusy(true);
    try {
      await requireSession(owner);
      const { error } = await supabase.storage
        .from("vihem-personal")
        .remove([a.storage_path]);
      if (error) throw error;
      const { error: rowError } = await supabase
        .from("vihem_personal_attachments")
        .delete()
        .eq("id", a.id);
      if (rowError) throw rowError;
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="pw-attachments"
      onDragOver={(e) => {
        if (ready) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (ready) void upload(e.dataTransfer.files);
      }}
    >
      <div className="pw-section-caption">
        <Paperclip size={15} /> Bilagor{" "}
        <button
          disabled={busy || !ready}
          onClick={() => input.current?.click()}
        >
          <Upload size={16} /> {busy ? "Laddar upp…" : "Lägg till"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        accept={types.join(",")}
        onChange={(e) => {
          void upload(e.target.files);
          e.target.value = "";
        }}
      />
      {!ready && (
        <p className="pw-hint">
          Synkronisera anteckningen innan du bifogar filer.
        </p>
      )}
      {items.map((a) => (
        <div className="pw-file" key={a.id}>
          <button onClick={() => void open(a)}>
            {a.name}
            <small>{Math.ceil(a.bytes / 1024)} kB</small>
          </button>
          <button
            disabled={busy}
            aria-label={"Ta bort " + a.name}
            onClick={() => void remove(a)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      {error && (
        <p className="pw-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
