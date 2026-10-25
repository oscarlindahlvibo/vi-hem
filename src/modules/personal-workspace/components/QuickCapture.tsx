import { messageOf } from "../services/errors";
import React, { useState } from "react";
import { StickyNote } from "lucide-react";
import { Button, Input, Modal, Textarea } from "../../../components/ui";
import { newNote } from "../types";
import {
  requireSession,
  saveDraft,
  syncWorkspace,
} from "../services/repository";
import { supabase } from "../../../lib/supabase";
export function QuickCapture({
  owner,
  page,
  onNavigate,
}: {
  owner: string;
  page: string;
  onNavigate: (page: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError("");
    try {
      let id = saved;
      if (!id) {
        const n = newNote(owner);
        n.title = title;
        n.plain_text = text;
        n.content = {
          type: "doc",
          content: [
            ...text.split("\n").map((line) => ({
              type: "paragraph",
              ...(line ? { content: [{ type: "text", text: line }] } : {}),
            })),
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Tillbaka till ursprungssidan",
                  marks: [
                    {
                      type: "link",
                      attrs: { href: location.origin + "/#" + page },
                    },
                  ],
                },
              ],
            },
          ],
        };
        await saveDraft(n);
        id = n.id;
        setSaved(id);
      }
      if (navigator.onLine) {
        await syncWorkspace(owner);
        await requireSession(owner);
        const { error } = await supabase
          .from("vihem_personal_object_links")
          .upsert(
            {
              owner_id: owner,
              note_id: id,
              object_type: "page",
              object_id: page,
              label: page,
            },
            { onConflict: "note_id,object_type,object_id" },
          );
        if (error) throw error;
      }
      setOpen(false);
      setText("");
      setTitle("");
      setSaved(null);
    } catch (e) {
      setError(
        "Anteckningen finns kvar lokalt om den redan sparats. " + messageOf(e),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        aria-label="Snabbanteckning"
        title="Snabbanteckning"
        className="vihem-icon-button"
        onClick={() => setOpen(true)}
      >
        <StickyNote size={19} />
      </button>
      <Modal
        open={open}
        title="Fånga en tanke"
        onClose={() => {
          if (
            !busy &&
            (!text || saved || confirm("Stäng utan att spara utkastet?"))
          )
            setOpen(false);
        }}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                onNavigate(
                  "personal-workspace/context/" + encodeURIComponent(page),
                );
              }}
            >
              Mina anteckningar om sidan
            </Button>
            <Button
              loading={busy}
              disabled={!title.trim() && !text.trim()}
              onClick={() => void save()}
            >
              {navigator.onLine ? "Spara anteckning" : "Spara lokalt"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Sparas i dina privata snabbanteckningar med länk till sidan du
            arbetar på.
          </p>
          <Input
            label="Titel"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={500}
            disabled={!!saved}
          />
          <Textarea
            label="Din anteckning"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            disabled={!!saved}
          />
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
