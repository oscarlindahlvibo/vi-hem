import { fromLocal, localInput } from "../reminders/time";
import { supabase } from "../../../lib/supabase";
import type {
  Collection,
  Draft,
  InkDraft,
  Note,
  Reminder,
  Stroke,
  Summary,
  Tag,
} from "../types";
import { records, store, updateLocal, removeLocal } from "./local";
export const summaries =
  "id,owner_id,collection_id,title,plain_text:preview,mode,favorite,pinned,archived,deleted_at,revision,updated_at,created_at";
export async function requireSession(owner: string) {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== owner)
    throw Error("Sessionen har ändrats. Logga in igen.");
}
export async function listNotes(
  owner: string,
  search = "",
  view = "all",
  collection: string | null = null,
  offset = 0,
  tag: string | null = null,
  context: string | null = null,
): Promise<Summary[]> {
  await requireSession(owner);
  let q = supabase
    .from("vihem_personal_notes")
    .select(
      summaries +
        (tag ? ",vihem_personal_note_tags!inner(tag_id)" : "") +
        (context
          ? ",vihem_personal_object_links!inner(object_id,object_type)"
          : ""),
    );
  if (view === "shared") q = q.neq("owner_id", owner);
  if (["trash", "archive", "favorites", "quick"].includes(view))
    q = q.eq("owner_id", owner);
  q =
    view === "trash"
      ? q.not("deleted_at", "is", null)
      : q.is("deleted_at", null).eq("archived", view === "archive");
  if (view === "favorites") q = q.eq("favorite", true);
  if (view === "quick") q = q.is("collection_id", null);
  if (collection) q = q.eq("collection_id", collection);
  if (tag) q = q.eq("vihem_personal_note_tags.tag_id", tag);
  if (context)
    q = q
      .eq("vihem_personal_object_links.object_type", "page")
      .eq("vihem_personal_object_links.object_id", context);
  if (search.trim())
    q = q.textSearch("search_document", search, {
      type: "websearch",
      config: "swedish",
    });
  const { data, error } = await q
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .order("id")
    .range(offset, offset + 49);
  if (error) throw error;
  return data as unknown as Summary[];
}
export async function loadNote(owner: string, id: string): Promise<Note> {
  await requireSession(owner);
  const local = (await records<Draft>("notes", owner)).find(
    (x) => x.note.id === id,
  );
  if (local && local.note.owner_id !== owner) {
    const { data, error } = await supabase.rpc("vihem_personal_note_access", {
      p_id: id,
      p_write: false,
    });
    if (error || !data) {
      await purgeSharedNote(owner, id);
      throw Error("Delad anteckning kräver anslutning och aktuell åtkomst.");
    }
  }
  if (local?.dirty) return local.note;
  const { data, error } = await supabase
    .from("vihem_personal_notes")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    if (
      local &&
      local.note.owner_id === owner &&
      !["PGRST116", "42501"].includes(error.code)
    )
      return local.note;
    throw error;
  }
  const note = data as Note;
  const cached = await updateLocal<Draft>(
    "notes",
    owner + ":" + id,
    (current) =>
      current && (current.dirty || current.note.revision > note.revision)
        ? current
        : {
            key: owner + ":" + id,
            owner,
            note,
            dirty: false,
            mutation: crypto.randomUUID(),
          },
  );
  return cached?.note || note;
}
export async function saveDraft(note: Note, actor = note.owner_id) {
  const key = actor + ":" + note.id;
  return updateLocal<Draft>("notes", key, (existing) => ({
    key,
    owner: actor,
    note: {
      ...note,
      revision: Math.max(note.revision, existing?.note.revision || 0),
    },
    dirty: true,
    mutation: crypto.randomUUID(),
    conflict: existing?.conflict,
  }));
}
const syncing = new Map<string, Promise<{ conflicts: string[] }>>();
export function syncWorkspace(owner: string) {
  const running = syncing.get(owner);
  if (running) return running;
  const promise = sync(owner).finally(() => syncing.delete(owner));
  syncing.set(owner, promise);
  return promise;
}
async function sync(owner: string) {
  await requireSession(owner);
  const conflicts: string[] = [];
  for (const draft of await records<Draft>("notes", owner, true)) {
    if (!draft.dirty) continue;
    if (draft.conflict) {
      conflicts.push(draft.note.id);
      continue;
    }
    await requireSession(owner);
    const { data, error } = await supabase.rpc("vihem_personal_save_note", {
      p_id: draft.note.id,
      p_expected: draft.note.revision,
      p_mutation: draft.mutation,
      p_data: draft.note,
    });
    if (error) {
      if (error.code === "40001") {
        await updateLocal<Draft>("notes", draft.key, (current) =>
          current ? { ...current, conflict: true } : undefined,
        );
        conflicts.push(draft.note.id);
        continue;
      }
      throw error;
    }
    const ack = data as Pick<Note, "revision" | "created_at" | "updated_at">;
    await updateLocal<Draft>("notes", draft.key, (current) =>
      current
        ? current.mutation === draft.mutation
          ? {
              ...current,
              note: {
                ...current.note,
                ...ack,
                revision: Math.max(current.note.revision, ack.revision),
              },
              dirty: false,
            }
          : {
              ...current,
              note: {
                ...current.note,
                revision: Math.max(current.note.revision, ack.revision),
              },
            }
        : undefined,
    );
  }
  for (const draft of await records<InkDraft>("ink", owner, true)) {
    if (!draft.dirty) continue;
    await requireSession(owner);
    const { id, note_id, page_id, stroke, deleted, revision } = draft.value;
    if (conflicts.includes(note_id)) continue;
    const { data, error } = await supabase.rpc("vihem_personal_save_stroke", {
      p_id: id,
      p_note: note_id,
      p_page: page_id,
      p_expected: revision,
      p_stroke: stroke,
      p_deleted: deleted,
    });
    if (error) {
      if (error.code === "40001") {
        conflicts.push(note_id);
        continue;
      }
      throw error;
    }
    await updateLocal<InkDraft>("ink", draft.key, (current) =>
      current
        ? {
            ...current,
            dirty:
              JSON.stringify(current.value) !== JSON.stringify(draft.value),
            value: {
              ...current.value,
              revision: Math.max(current.value.revision, data as number),
            },
          }
        : undefined,
    );
  }
  return { conflicts };
}
export async function loadInk(owner: string, note: string): Promise<Stroke[]> {
  const local = (await records<InkDraft>("ink", owner)).filter(
    (x) => x.value.note_id === note,
  );
  const data: Stroke[] = [];
  try {
    await requireSession(owner);
    for (let offset = 0; ; offset += 500) {
      const { data: page, error } = await supabase
        .from("vihem_personal_ink_strokes")
        .select("*")
        .eq("note_id", note)
        .order("created_at")
        .order("id")
        .range(offset, offset + 499);
      if (error) throw error;
      data.push(...(page as Stroke[]));
      if (page.length < 500) break;
    }
  } catch (error) {
    if (!local.length) throw error;
  }
  const merged = new Map<string, Stroke>(
    ((data as Stroke[]) || []).map((x) => [x.id, x]),
  );
  for (const x of local)
    if (x.dirty || !merged.has(x.value.id)) merged.set(x.value.id, x.value);
  for (const value of merged.values()) {
    const cached = await updateLocal<InkDraft>(
      "ink",
      owner + ":" + value.id,
      (current) =>
        current && (current.dirty || current.value.revision > value.revision)
          ? current
          : { key: owner + ":" + value.id, owner, value, dirty: false },
    );
    if (cached) merged.set(value.id, cached.value);
  }
  return [...merged.values()];
}
export async function saveInk(owner: string, value: Stroke) {
  await updateLocal<InkDraft>("ink", owner + ":" + value.id, (existing) => ({
    key: owner + ":" + value.id,
    owner,
    value: {
      ...value,
      revision: Math.max(value.revision, existing?.value.revision || 0),
    },
    dirty: true,
  }));
}
export async function collections(): Promise<Collection[]> {
  const { data, error } = await supabase
    .from("vihem_personal_collections")
    .select("*")
    .order("position")
    .order("title");
  if (error) throw error;
  return data || [];
}
export async function tags(): Promise<Tag[]> {
  const { data, error } = await supabase
    .from("vihem_personal_tags")
    .select("id,title")
    .order("title");
  if (error) throw error;
  return data || [];
}
export async function reminders(view = "all", offset = 0): Promise<Reminder[]> {
  let query = supabase
    .from("vihem_personal_reminders")
    .select("*")
    .is("cancelled_at", null);
  query =
    view === "done"
      ? query.not("completed_at", "is", null)
      : query.is("completed_at", null);
  const day = localInput(new Date().toISOString()).slice(0, 10),
    tomorrow = new Date(day + "T12:00:00Z");
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const start = fromLocal(day + "T00:00"),
    end = fromLocal(tomorrow.toISOString().slice(0, 10) + "T00:00");
  if (view === "today") query = query.gte("due_at", start).lt("due_at", end);
  if (view === "upcoming") query = query.gte("due_at", end);
  if (view === "late") query = query.lt("due_at", new Date().toISOString());
  const { data, error } = await query
    .order("due_at")
    .order("id")
    .range(offset, offset + 99);
  if (error) throw error;
  return data || [];
}
export async function saveReminder(r: Reminder) {
  const { error } = await supabase.rpc("vihem_personal_save_reminder", {
    p_id: r.id,
    p_expected: r.revision,
    p_data: r,
  });
  if (error) throw error;
}

export async function purgeSharedNote(actor: string, id: string) {
  await removeLocal("notes", actor + ":" + id);
  for (const ink of await records<InkDraft>("ink", actor))
    if (ink.value.note_id === id) await removeLocal("ink", ink.key);
}
