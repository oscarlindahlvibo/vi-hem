import { messageOf } from "../services/errors";
import React, { useState } from "react";
import { Button, Input, Modal, Select } from "../../../components/ui";
import { supabase } from "../../../lib/supabase";
import type { Collection } from "../types";
export function CollectionDialog({
  owner,
  items,
  existing,
  kind,
  onClose,
  onSaved,
}: {
  owner: string;
  items: Collection[];
  existing?: Collection;
  kind: "notebook" | "folder";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title || ""),
    [parent, setParent] = useState(existing?.parent_id || ""),
    [color, setColor] = useState(existing?.color || "#2563eb"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save() {
    setBusy(true);
    try {
      const data = {
        owner_id: owner,
        title: title.trim(),
        parent_id: parent || null,
        kind,
        color,
      };
      const { error } = existing
        ? await supabase
            .from("vihem_personal_collections")
            .update(data)
            .eq("id", existing.id)
        : await supabase.from("vihem_personal_collections").insert(data);
      if (error) throw error;
      onSaved();
      onClose();
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
        existing
          ? "Redigera och flytta"
          : kind === "notebook"
            ? "Ny anteckningsbok"
            : "Ny mapp"
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Button
          loading={busy}
          disabled={!title.trim()}
          onClick={() => void save()}
        >
          Spara
        </Button>
      }
    >
      <div className="space-y-4">
        <Input
          label="Namn"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
        {kind === "folder" && (
          <Select
            label="Överordnad bok eller mapp"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            options={[
              { value: "", label: "Ingen" },
              ...items
                .filter((x) => x.id !== existing?.id)
                .map((x) => ({ value: x.id, label: x.title })),
            ]}
          />
        )}
        <Input
          label="Färg"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        {error && (
          <p role="alert" className="pw-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
