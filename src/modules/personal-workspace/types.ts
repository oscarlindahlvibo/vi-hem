import type { JSONContent } from "@tiptap/core";
export type Note = {
  id: string;
  owner_id: string;
  collection_id: string | null;
  title: string;
  content: JSONContent;
  plain_text: string;
  mode: "text" | "ink" | "mixed";
  favorite: boolean;
  pinned: boolean;
  archived: boolean;
  deleted_at: string | null;
  revision: number;
  updated_at: string;
  created_at: string;
};
export type Summary = Omit<Note, "content">;
export type Collection = {
  id: string;
  owner_id: string;
  parent_id: string | null;
  kind: "notebook" | "folder";
  title: string;
  color: string;
  position: number;
};
export type Tag = { id: string; title: string };
export type Point = { x: number; y: number; p: number };
export type Stroke = {
  id: string;
  note_id: string;
  page_id: string;
  stroke: {
    points: Point[];
    color: string;
    width: number;
    tool: "pen" | "highlight" | "line";
  };
  deleted: boolean;
  revision: number;
};
export type Draft = {
  key: string;
  owner: string;
  note: Note;
  dirty: boolean;
  mutation: string;
  conflict?: boolean;
};
export type InkDraft = {
  key: string;
  owner: string;
  value: Stroke;
  dirty: boolean;
};
export type Reminder = {
  id: string;
  owner_id: string;
  note_id: string | null;
  block_id: string | null;
  title: string;
  description: string;
  due_at: string;
  timezone: string;
  priority: number;
  recurrence: "none" | "daily" | "weekly" | "monthly" | "weekdays" | "interval";
  repeat_every?: number;
  weekdays?: number[];
  completed_at: string | null;
  cancelled_at: string | null;
  preview: boolean;
  revision: number;
};
export type Paper = "blank" | "lined" | "grid" | "dots" | "dark";
export const emptyContent: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};
export function newNote(
  owner: string,
  collection_id: string | null = null,
): Note {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    owner_id: owner,
    collection_id,
    title: "",
    content: emptyContent,
    plain_text: "",
    mode: "text",
    favorite: false,
    pinned: false,
    archived: false,
    deleted_at: null,
    revision: 0,
    updated_at: now,
    created_at: now,
  };
}
