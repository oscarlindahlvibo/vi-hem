import { messageOf } from "../services/errors";
import React, { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  BellPlus,
  Download,
  History,
  Link,
  Maximize2,
  Minimize2,
  Star,
  Trash2,
  Pin,
  Archive,
  ArrowLeft,
} from "lucide-react";
import { Button, Modal, Select } from "../../../components/ui";
import { supabase } from "../../../lib/supabase";
import type { Collection, Note, Tag } from "../types";
import { useDocument } from "../services/useDocument";
import { newNote } from "../types";
import { exportPortable, printNote } from "../services/export";
import { insertInk } from "../editor/commands";
import { RichEditor } from "../editor/RichEditor";
import { InkContext } from "../handwriting/InkPaper";
import { saveDraft, saveInk } from "../services/repository";
import { records, removeLocal } from "../services/local";
import { ReminderForm } from "../reminders/Reminders";
import { SharingDialog } from "./SharingDialog";
import { Attachments } from "./Attachments";
export function NoteEditor({
  owner,
  id,
  collections,
  tags,
  onSaved,
  onBack,
  selectNote,
  initialBlock,
}: {
  owner: string;
  id: string;
  initialBlock?: string;
  collections: Collection[];
  tags: Tag[];
  onSaved: () => void;
  onBack: () => void;
  selectNote: (id: string) => void;
}) {
  const {
    note,
    strokes,
    status,
    error,
    conflict,
    readOnly,
    update,
    changeInk,
  } = useDocument(owner, id, onSaved);
  const [sharing, setSharing] = useState(false);
  const [full, setFull] = useState(false),
    [reminder, setReminder] = useState<{
      title: string;
      blockId?: string;
    } | null>(null),
    [versions, setVersions] = useState<
      { revision: number; created_at: string; snapshot: Note }[] | null
    >(null),
    [message, setMessage] = useState(""),
    [noteTags, setNoteTags] = useState<string[]>([]);
  const editor = useRef<Editor | null>(null),
    article = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    void supabase
      .from("vihem_personal_note_tags")
      .select("tag_id")
      .eq("note_id", id)
      .then(({ data, error }) => {
        if (alive) {
          setNoteTags((data || []).map((x) => x.tag_id));
          if (error) setMessage(error.message);
        }
      });
    return () => {
      alive = false;
    };
  }, [id]);
  async function history() {
    const { data, error } = await supabase
      .from("vihem_personal_revisions")
      .select("revision,created_at,snapshot")
      .eq("note_id", id)
      .order("revision", { ascending: false })
      .limit(50);
    if (error) setMessage(error.message);
    else setVersions(data || []);
  }
  async function toggleTag(tag: string) {
    const assigned = noteTags.includes(tag);
    const { error } = assigned
      ? await supabase
          .from("vihem_personal_note_tags")
          .delete()
          .eq("note_id", id)
          .eq("tag_id", tag)
      : await supabase
          .from("vihem_personal_note_tags")
          .insert({ owner_id: owner, note_id: id, tag_id: tag });
    if (error) setMessage(error.message);
    else
      setNoteTags(
        assigned ? noteTags.filter((t) => t !== tag) : [...noteTags, tag],
      );
  }
  async function copyConflict() {
    if (!note) return;
    try {
      const copy = {
        ...newNote(owner),
        ...note,
        id: crypto.randomUUID(),
        owner_id: owner,
        collection_id: null,
        revision: 0,
        title: (note.title || "Anteckning") + " – konfliktkopia",
        deleted_at: null,
      };
      await saveDraft(copy);
      for (const s of strokes)
        await saveInk(owner, {
          ...s,
          id: crypto.randomUUID(),
          note_id: copy.id,
          revision: 0,
        });
      await removeLocal("notes", owner + ":" + note.id);
      for (const d of await records("ink", owner))
        if ("value" in d && d.value.note_id === note.id)
          await removeLocal("ink", d.key);
      selectNote(copy.id);
      onSaved();
    } catch (e) {
      setMessage(messageOf(e));
    }
  }
  if (!note)
    return (
      <div className="pw-empty" role="status">
        {error || "Hämtar din anteckning…"}
        <button onClick={onBack}>Tillbaka till listan</button>
      </div>
    );
  return (
    <section
      className={"pw-editor" + (full ? " pw-editor-full" : "")}
      aria-label="Anteckningseditor"
    >
      <header className="pw-editor-header">
        <button aria-label="Till anteckningslistan" onClick={onBack}>
          <ArrowLeft size={19} />
        </button>
        <span role="status" className="pw-save">
          {status}
        </span>
        <div className="pw-editor-actions">
          {note.owner_id === owner && (
            <button
              onClick={() => setSharing(true)}
              aria-label="Dela anteckning"
            >
              Dela
            </button>
          )}
          <button
            disabled={readOnly || note.owner_id !== owner}
            aria-label="Favorit"
            aria-pressed={note.favorite}
            onClick={() => update({ favorite: !note.favorite })}
          >
            <Star size={18} fill={note.favorite ? "currentColor" : "none"} />
          </button>
          <button
            disabled={readOnly || note.owner_id !== owner}
            aria-label="Fäst anteckning"
            aria-pressed={note.pinned}
            onClick={() => update({ pinned: !note.pinned })}
          >
            <Pin size={18} />
          </button>
          <button
            disabled={note.owner_id !== owner}
            aria-label="Skapa påminnelse"
            onClick={() => setReminder({ title: note.title })}
          >
            <BellPlus size={18} />
          </button>
          <button
            disabled={note.owner_id !== owner}
            aria-label="Versionshistorik"
            onClick={() => void history()}
          >
            <History size={18} />
          </button>
          <button
            aria-label={full ? "Lämna helskärm" : "Helskärm"}
            onClick={() => setFull(!full)}
          >
            {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <details className="pw-actions-menu">
            <summary aria-label="Fler dokumentåtgärder">•••</summary>
            <div>
              <button
                onClick={() => {
                  try {
                    if (article.current) printNote(note.title, article.current);
                  } catch (e) {
                    setMessage(messageOf(e));
                  }
                }}
              >
                <Download size={16} /> Skriv ut / spara PDF
              </button>
              <button onClick={() => exportPortable(note, strokes)}>
                Exportera redigerbart innehåll
              </button>
              <button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(
                      `${location.origin}/#personal-workspace/notes/${id}`,
                    )
                    .then(
                      () => setMessage("Länken har kopierats."),
                      () => setMessage("Kunde inte kopiera länken."),
                    )
                }
              >
                <Link size={16} /> Kopiera länk
              </button>
              <button
                disabled={note.owner_id !== owner || readOnly}
                onClick={() => update({ archived: !note.archived })}
              >
                <Archive size={16} />
                {note.archived ? "Avarkivera" : "Arkivera"}
              </button>
              <button
                disabled={note.owner_id !== owner || readOnly}
                onClick={() => {
                  if (
                    note.deleted_at ||
                    confirm("Flytta anteckningen till papperskorgen?")
                  )
                    update({
                      deleted_at: note.deleted_at
                        ? null
                        : new Date().toISOString(),
                    });
                }}
              >
                <Trash2 size={16} />
                {note.deleted_at ? "Återställ" : "Till papperskorgen"}
              </button>
            </div>
          </details>
        </div>
      </header>
      {error && (
        <p role="alert" className="pw-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="pw-info">
          {message}
        </p>
      )}
      {readOnly && (
        <p className="pw-info" role="status">
          Skrivskyddad vy. Du kan ha läsbehörighet, sakna anslutning eller ha
          dokumentet öppet i en annan flik.
        </p>
      )}
      {conflict && (
        <div className="pw-conflict" role="alert">
          <strong>En annan version finns på servern.</strong>
          <p>
            Dina lokala ändringar är bevarade. Skapa en separat kopia för att
            behålla båda versionerna.
          </p>
          <Button onClick={() => void copyConflict()}>
            Behåll mina ändringar som kopia
          </Button>
          <button onClick={() => exportPortable(note, strokes)}>
            Ladda ner lokal säkerhetskopia
          </button>
        </div>
      )}
      {sharing && (
        <SharingDialog
          noteId={id}
          title={note.title}
          onClose={() => setSharing(false)}
        />
      )}
      {note.owner_id !== owner && (
        <p className="pw-info">
          Delad med dig · text och handskrift kan redigeras med rätt behörighet
          och anslutning. Organisering och bilagor hanteras av ägaren.
        </p>
      )}
      <div className="pw-document-scroll">
        <div className="pw-document-meta">
          <select
            disabled={readOnly || note.owner_id !== owner}
            aria-label="Flytta till mapp"
            value={note.collection_id || ""}
            onChange={(e) => update({ collection_id: e.target.value || null })}
          >
            <option value="">Snabbanteckningar</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.kind === "notebook" ? "▣ " : ""}
                {c.title}
              </option>
            ))}
          </select>
          <select
            disabled={readOnly}
            aria-label="Arbetsläge"
            value={note.mode}
            onChange={(e) => {
              const mode = e.target.value as Note["mode"];
              const hasInk = note.content.content?.some(
                (n) => n.type === "ink",
              );
              update({ mode });
              if (mode !== "text" && !hasInk)
                if (editor.current)
                  insertInk(
                    editor.current,
                    editor.current.state.doc.content.size,
                  );
            }}
          >
            <option value="text">Text</option>
            <option value="ink">Handskrift</option>
            <option value="mixed">Text & handskrift</option>
          </select>
        </div>
        <input
          readOnly={readOnly}
          className="pw-title"
          aria-label="Dokumenttitel"
          placeholder="Utan titel"
          value={note.title}
          maxLength={500}
          onChange={(e) => update({ title: e.target.value })}
        />
        <div className="pw-tags">
          {tags.map((t) => (
            <button
              key={t.id}
              disabled={
                note.revision === 0 || readOnly || note.owner_id !== owner
              }
              aria-pressed={noteTags.includes(t.id)}
              onClick={() => void toggleTag(t.id)}
            >
              # {t.title}
            </button>
          ))}
        </div>
        <InkContext.Provider
          value={{ noteId: id, strokes, change: changeInk, readOnly }}
        >
          <div ref={article}>
            <RichEditor
              textTools={note.mode !== "ink"}
              readOnly={readOnly}
              key={id}
              content={note.content}
              onChange={(content, plain_text) =>
                update({
                  content,
                  plain_text,
                  ...(note.mode === "text" &&
                  content.content?.some((n) => n.type === "ink")
                    ? {
                        mode: plain_text.trim()
                          ? ("mixed" as const)
                          : ("ink" as const),
                      }
                    : {}),
                })
              }
              onRemind={(title, blockId) =>
                note.owner_id === owner
                  ? setReminder({ title, blockId })
                  : setMessage(
                      "Skapa din personliga påminnelse i fliken Påminnelser. Ägarens påminnelser delas inte.",
                    )
              }
              initialBlock={initialBlock}
              editorRef={editor}
            />
          </div>
        </InkContext.Provider>
        <Attachments
          key={id}
          owner={owner}
          noteId={id}
          ready={note.revision > 0 && !readOnly && note.owner_id === owner}
          onImage={(attachmentId, name) =>
            editor.current
              ?.chain()
              .focus()
              .insertContentAt(editor.current.state.doc.content.size, [
                { type: "privateImage", attrs: { attachmentId, name } },
                { type: "paragraph" },
              ])
              .run()
          }
        />
      </div>
      {reminder !== null && (
        <ReminderForm
          owner={owner}
          noteId={id}
          title={reminder.title}
          blockId={reminder.blockId}
          onClose={() => setReminder(null)}
          onSaved={() => setMessage("Påminnelsen är sparad.")}
        />
      )}
      {versions && (
        <Modal open title="Versionshistorik" onClose={() => setVersions(null)}>
          <p className="pw-hint">
            De senaste 50 sparade versionerna. Återställning skapar en ny
            version och behåller den nuvarande.
          </p>
          {!versions.length && <p>Inga tidigare versioner ännu.</p>}
          {versions.map((v) => (
            <div className="pw-version" key={v.revision}>
              <span>
                Version {v.revision} ·{" "}
                {new Date(v.created_at).toLocaleString("sv-SE")}
              </span>
              <Button
                variant="secondary"
                onClick={() => {
                  if (
                    confirm(
                      "Återställ denna textversion? Pennstreck påverkas inte.",
                    )
                  ) {
                    update({
                      title: v.snapshot.title,
                      content: v.snapshot.content,
                      plain_text: v.snapshot.plain_text,
                    });
                    editor.current?.commands.setContent(v.snapshot.content);
                    setVersions(null);
                  }
                }}
              >
                Återställ text
              </Button>
            </div>
          ))}
        </Modal>
      )}
    </section>
  );
}
