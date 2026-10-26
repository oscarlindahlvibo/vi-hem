import { messageOf } from "./services/errors";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  Bell,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Folder,
  Menu,
  Plus,
  Search,
  Star,
  StickyNote,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { Button, Input, Modal } from "../../components/ui";
import { supabase } from "../../lib/supabase";
import {
  collections as fetchCollections,
  listNotes,
  loadNote,
  saveDraft,
  syncWorkspace,
  tags as fetchTags,
} from "./services/repository";
import { records } from "./services/local";
import type { Collection, Draft, Summary, Tag } from "./types";
import { newNote } from "./types";
import { PanelResize } from "./components/PanelResize";
import { NoteEditor } from "./components/NoteEditor";
import { SharingDialog } from "./components/SharingDialog";
import { CollectionDialog } from "./components/CollectionDialog";
import { Reminders } from "./reminders/Reminders";
import { useWorkspaceViewport } from "./hooks/useWorkspaceViewport";
import "./workspace.css";
export function WorkspacePage({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (page: string) => void;
}) {
  const viewport = useWorkspaceViewport();
  const { user } = useAuth();
  const owner = user!.id;
  const parts = path.split("/");
  const selected = parts[1] === "notes" ? parts[2] : undefined;
  const context =
    parts[1] === "context"
      ? decodeURIComponent(parts.slice(2).join("/"))
      : null;
  const [view, setView] = useState(
      parts[1] === "reminders" ? "reminders" : "all",
    ),
    [collection, setCollection] = useState<string | null>(null),
    [tag, setTag] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [items, setItems] = useState<Summary[]>([]),
    [books, setBooks] = useState<Collection[]>([]),
    [tags, setTags] = useState<Tag[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [hasMore, setHasMore] = useState(false),
    [showNav, setShowNav] = useState(false),
    [offset, setOffset] = useState(0);
  const [sharing, setSharing] = useState<Collection | null>(null);
  const [collectionForm, setCollectionForm] = useState<{
      kind: "notebook" | "folder";
      existing?: Collection;
    } | null>(null),
    [tagForm, setTagForm] = useState(false),
    [tagTitle, setTagTitle] = useState(""),
    [busy, setBusy] = useState(false),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const searchInput = useRef<HTMLInputElement>(null),
    listGeneration = useRef(0);
  const load = useCallback(
    async (append = false) => {
      const g = ++listGeneration.current;
      try {
        const data = await listNotes(
          owner,
          query,
          view,
          collection,
          append ? offset : 0,
          tag,
          context,
        );
        if (g !== listGeneration.current) return;
        const local = (await records<Draft>("notes", owner)).filter(
          (d) =>
            d.dirty &&
            d.note.owner_id === owner &&
            view !== "shared" &&
            (!collection || d.note.collection_id === collection) &&
            (!query ||
              (d.note.title + " " + d.note.plain_text)
                .toLowerCase()
                .includes(query.toLowerCase())) &&
            (view === "trash" ? !!d.note.deleted_at : !d.note.deleted_at) &&
            (view === "trash" || d.note.archived === (view === "archive")) &&
            (view !== "favorites" || d.note.favorite) &&
            (view !== "quick" || !d.note.collection_id),
        );
        const merged = new Map<string, Summary>(
          [...(append ? items : []), ...data].map((x) => [x.id, x]),
        );
        if (!tag && !context) {
          for (const draft of await records<Draft>("notes", owner, true))
            merged.delete(draft.note.id);
          for (const d of local) merged.set(d.note.id, d.note);
        }
        setItems(
          [...merged.values()].sort(
            (a, b) =>
              Number(b.pinned) - Number(a.pinned) ||
              b.updated_at.localeCompare(a.updated_at),
          ),
        );
        setOffset((append ? offset : 0) + 50);
        setHasMore(data.length === 50);
        setError("");
      } catch (e) {
        if (g !== listGeneration.current) return;
        setError(
          "Hämtningen misslyckades. Lokalt sparade anteckningar visas. " +
            messageOf(e),
        );
        const local = await records<Draft>("notes", owner);
        setItems(
          tag || context
            ? []
            : local
                .map((x) => x.note)
                .filter((n) => n.owner_id === owner)
                .filter(
                  (n) =>
                    (view === "trash"
                      ? !!n.deleted_at
                      : !n.deleted_at && n.archived === (view === "archive")) &&
                    (!collection || n.collection_id === collection) &&
                    (view !== "favorites" || n.favorite) &&
                    (view !== "quick" || !n.collection_id) &&
                    (!query ||
                      (n.title + " " + n.plain_text)
                        .toLowerCase()
                        .includes(query.toLowerCase())),
                ),
        );
      } finally {
        if (g === listGeneration.current) setLoading(false);
      }
    },
    [owner, query, view, collection, tag, context, offset, items],
  );
  const loader = useRef(load);
  loader.current = load;
  const refresh = useCallback(() => {
    void loader.current();
  }, []);
  async function loadStructure() {
    try {
      const [c, t] = await Promise.all([fetchCollections(), fetchTags()]);
      setBooks(c);
      setTags(t);
    } catch (e) {
      setError(messageOf(e));
    }
  }
  useEffect(() => {
    void loadStructure();
  }, [owner]);
  useEffect(() => {
    let live = true;
    const flush = async () => {
      if (!navigator.onLine) return;
      try {
        const pending = await records<Draft>("notes", owner, true);
        if (!pending.length) return;
        await syncWorkspace(owner);
        if (live) refresh();
      } catch {
        /* Editor and list display actionable sync errors. */
      }
    };
    const timer = setInterval(() => void flush(), 10000);
    window.addEventListener("online", flush);
    void flush();
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("online", flush);
    };
  }, [owner, refresh]);
  useEffect(() => {
    setLoading(true);
    void loader.current();
  }, [owner, query, view, collection, tag, context]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    const section = path.split("/")[1];
    if (section === "reminders") setView("reminders");
    else if (section === "notes")
      setView((v) => (v === "reminders" ? "all" : v));
  }, [path]);
  const create = useCallback(async () => {
    try {
      if (
        collection &&
        books.find((c) => c.id === collection)?.owner_id !== owner
      ) {
        const { data, error } = await supabase.rpc(
          "vihem_personal_collection_access",
          { p_id: collection, p_write: true },
        );
        if (error || !data)
          throw Error(
            "Du behöver anslutning och redigeringsrätt för att skapa i den delade mappen.",
          );
      }
      const n = newNote(owner, collection);
      await saveDraft(n);
      setView("all");
      setShowNav(false);
      onNavigate("personal-workspace/notes/" + n.id);
      refresh();
    } catch (e) {
      setError(messageOf(e));
    }
  }, [owner, collection, books, onNavigate, refresh]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault();
        void create();
      }
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowNav(false);
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [create]);
  function choose(v: string, c: string | null = null, t: string | null = null) {
    setView(v);
    setCollection(c);
    setTag(t);
    setShowNav(false);
    if (v === "reminders") onNavigate("personal-workspace/reminders");
    else onNavigate("personal-workspace");
  }
  async function move(id: string, target: string) {
    try {
      const n = await loadNote(owner, id);
      if (n.owner_id !== owner)
        throw Error("Bara ägaren får flytta anteckningen.");
      const { data: allowed, error: accessError } = await supabase.rpc(
        "vihem_personal_collection_access",
        { p_id: target, p_write: true },
      );
      if (accessError || !allowed)
        throw Error("Mappen kräver redigeringsrätt och anslutning.");
      await saveDraft({ ...n, collection_id: target });
      await syncWorkspace(owner);
      refresh();
    } catch (e) {
      setError(messageOf(e));
    }
  }
  function tree(parent: string | null, depth = 0): React.ReactNode {
    if (depth > 30) return null;
    return books
      .filter(
        (x) =>
          x.parent_id === parent ||
          (parent === null &&
            x.parent_id &&
            !books.some((b) => b.id === x.parent_id)),
      )
      .map((c) => (
        <div key={c.id}>
          <div
            className="pw-tree-row"
            style={{ paddingLeft: depth * 12 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/vihem-note");
              if (id) void move(id, c.id);
            }}
          >
            <button
              aria-label={(collapsed.has(c.id) ? "Visa " : "Dölj ") + c.title}
              onClick={() =>
                setCollapsed((s) => {
                  const n = new Set(s);
                  if (n.has(c.id)) n.delete(c.id);
                  else n.add(c.id);
                  return n;
                })
              }
            >
              {collapsed.has(c.id) ? (
                <ChevronRight size={14} />
              ) : (
                <ChevronLeft
                  size={14}
                  style={{ transform: "rotate(-90deg)" }}
                />
              )}
            </button>
            <button
              aria-pressed={collection === c.id}
              className="pw-tree-title"
              onClick={() => choose("all", c.id)}
            >
              {c.kind === "notebook" ? (
                <BookOpen size={16} style={{ color: c.color }} />
              ) : (
                <Folder size={16} style={{ color: c.color }} />
              )}
              <span>{c.title}</span>
            </button>
            {c.owner_id === owner && (
              <button
                aria-label={"Dela " + c.title}
                onClick={() => setSharing(c)}
              >
                Dela
              </button>
            )}
            <button
              disabled={c.owner_id !== owner}
              aria-label={"Redigera " + c.title}
              onClick={() => setCollectionForm({ kind: c.kind, existing: c })}
            >
              •••
            </button>
          </div>
          {!collapsed.has(c.id) && tree(c.id, depth + 1)}
        </div>
      ));
  }
  const views: [string, string, React.ReactNode][] = [
    ["all", "Alla anteckningar", <FileText size={17} />],
    ["shared", "Delat med mig", <Folder size={17} />],
    ["quick", "Snabbanteckningar", <StickyNote size={17} />],
    ["favorites", "Favoriter", <Star size={17} />],
    ["recent", "Senaste", <Clock size={17} />],
    ["archive", "Arkiv", <Archive size={17} />],
    ["trash", "Papperskorg", <Trash2 size={17} />],
  ];
  return (
    <div ref={viewport} className="pw-root" data-viewport-bound="true">
      <div className="pw-top">
        <div>
          <span className="pw-eyebrow">DITT EGET UTRYMME</span>
          <h1>Min arbetsyta</h1>
        </div>
        <div className="pw-tabs">
          <button
            aria-pressed={view !== "reminders"}
            onClick={() => choose("all")}
          >
            <BookOpen size={17} /> Anteckningar
          </button>
          <button
            aria-pressed={view === "reminders"}
            onClick={() => choose("reminders")}
          >
            <Bell size={17} /> Påminnelser
          </button>
        </div>
      </div>
      {view === "reminders" ? (
        <Reminders
          owner={owner}
          initialId={parts[2]}
          openNote={(id, blockId) =>
            onNavigate(
              "personal-workspace/notes/" + id + (blockId ? "/" + blockId : ""),
            )
          }
        />
      ) : (
        <div
          className={
            "pw-panels" +
            (selected ? " pw-has-editor" : "") +
            (showNav ? " pw-show-nav" : "")
          }
        >
          <aside className="pw-sidebar" aria-label="Anteckningsnavigation">
            <div className="pw-side-heading">
              <strong>Mitt bibliotek</strong>
              <button
                aria-label="Stäng bibliotek"
                className="pw-mobile"
                onClick={() => setShowNav(false)}
              >
                ×
              </button>
            </div>
            {views.map(([v, label, icon]) => (
              <button
                className="pw-nav-item"
                key={v}
                aria-pressed={view === v && !collection && !tag}
                onClick={() => choose(v)}
              >
                {icon}
                {label}
              </button>
            ))}
            <div className="pw-side-heading">
              <span>ANTECKNINGSBÖCKER</span>
              <button
                aria-label="Ny anteckningsbok"
                onClick={() => setCollectionForm({ kind: "notebook" })}
              >
                <Plus size={16} />
              </button>
            </div>
            {tree(null)}
            <button
              className="pw-nav-item pw-muted"
              onClick={() => setCollectionForm({ kind: "folder" })}
            >
              <Plus size={16} /> Ny mapp
            </button>
            <div className="pw-side-heading">
              <span>ETIKETTER</span>
              <button aria-label="Ny etikett" onClick={() => setTagForm(true)}>
                <Plus size={16} />
              </button>
            </div>
            {tags.map((t) => (
              <button
                key={t.id}
                className="pw-nav-item"
                aria-pressed={tag === t.id}
                onClick={() => choose("all", null, t.id)}
              >
                <TagIcon size={15} />
                {t.title}
              </button>
            ))}
            <p className="pw-private">
              Privat som standard · delning väljs av ägaren
            </p>
            <PanelResize panel="sidebar" />
          </aside>
          <section className="pw-note-list" aria-label="Anteckningslista">
            <div className="pw-list-title">
              <button
                className="pw-library-button"
                aria-label="Visa bibliotek"
                onClick={() => setShowNav(!showNav)}
              >
                <Menu size={19} />
              </button>
              <h2>
                {context
                  ? "Om den här sidan"
                  : books.find((c) => c.id === collection)?.title ||
                    tags.find((t) => t.id === tag)?.title ||
                    views.find((v) => v[0] === view)?.[1]}
              </h2>
              <button aria-label="Ny anteckning" onClick={() => void create()}>
                <Plus size={21} />
              </button>
            </div>
            <label className="pw-search">
              <Search size={17} />
              <input
                ref={searchInput}
                aria-label="Sök anteckningar"
                placeholder="Sök i dina anteckningar…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>⌘ K</kbd>
            </label>
            {error && (
              <p role="alert" className="pw-error">
                {error}
                <button onClick={refresh}>Försök igen</button>
              </p>
            )}
            <div className="pw-note-scroll">
              {loading ? (
                <div role="status" className="pw-skeleton">
                  Hämtar anteckningar…
                </div>
              ) : !items.length ? (
                <div className="pw-empty">
                  <BookOpen size={30} />
                  <h3>Plats för dina tankar</h3>
                  <p>Samla idéer, mötesanteckningar och nästa steg.</p>
                  <Button onClick={() => void create()}>
                    Skriv din första anteckning
                  </Button>
                </div>
              ) : (
                items.map((n) => (
                  <button
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/vihem-note", n.id)
                    }
                    className="pw-note-preview"
                    key={n.id}
                    aria-current={selected === n.id ? "page" : undefined}
                    onClick={() => {
                      setShowNav(false);
                      onNavigate("personal-workspace/notes/" + n.id);
                    }}
                  >
                    <span className="pw-preview-title">
                      {n.pinned && "⌖ "}
                      {n.title || "Utan titel"}
                      {n.favorite && <Star size={14} fill="currentColor" />}
                    </span>
                    <span className="pw-preview-text">
                      {n.plain_text.slice(0, 110) ||
                        (n.mode === "ink"
                          ? "Handskriven anteckning"
                          : "En ny tanke börjar här…")}
                    </span>
                    <span className="pw-preview-date">
                      {new Date(n.updated_at).toLocaleDateString("sv-SE", {
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      ·{" "}
                      {n.mode === "text"
                        ? "Text"
                        : n.mode === "ink"
                          ? "Handskrift"
                          : "Text & handskrift"}
                    </span>
                  </button>
                ))
              )}
              {hasMore && (
                <button
                  className="pw-load-more"
                  onClick={() => void load(true)}
                >
                  Visa fler anteckningar
                </button>
              )}
            </div>
            <PanelResize panel="list" />
          </section>
          {selected ? (
            <NoteEditor
              key={owner + selected}
              owner={owner}
              id={selected}
              initialBlock={parts[3]}
              collections={books}
              tags={tags}
              onSaved={refresh}
              onBack={() => onNavigate("personal-workspace")}
              selectNote={(id) => onNavigate("personal-workspace/notes/" + id)}
            />
          ) : (
            <div className="pw-editor-empty">
              <div className="pw-empty-orbit">
                <PenGlyph />
              </div>
              <h2>Gör plats för nästa idé.</h2>
              <p>
                Skriv, skissa och samla det du vill komma ihåg.
                <br />
                Din arbetsyta följer med mellan dina enheter.
              </p>
              <Button onClick={() => void create()}>
                <Plus size={17} /> Ny anteckning
              </Button>
              <small>⌘ / Ctrl + N för att börja skriva</small>
            </div>
          )}
        </div>
      )}
      {sharing && (
        <SharingDialog
          collectionId={sharing.id}
          title={sharing.title}
          onClose={() => setSharing(null)}
        />
      )}
      {collectionForm && (
        <CollectionDialog
          owner={owner}
          items={books.filter((c) => c.owner_id === owner)}
          {...collectionForm}
          onClose={() => setCollectionForm(null)}
          onSaved={() => void loadStructure()}
        />
      )}
      {tagForm && (
        <Modal
          open
          title="Ny etikett"
          onClose={() => setTagForm(false)}
          footer={
            <Button
              loading={busy}
              disabled={!tagTitle.trim()}
              onClick={() => {
                setBusy(true);
                void supabase
                  .from("vihem_personal_tags")
                  .insert({ owner_id: owner, title: tagTitle.trim() })
                  .then(({ error }) => {
                    setBusy(false);
                    if (error) setError(error.message);
                    else {
                      setTagForm(false);
                      setTagTitle("");
                      void loadStructure();
                    }
                  });
              }}
            >
              Skapa etikett
            </Button>
          }
        >
          <Input
            label="Namn"
            maxLength={100}
            value={tagTitle}
            onChange={(e) => setTagTitle(e.target.value)}
          />
        </Modal>
      )}
    </div>
  );
}
function PenGlyph() {
  return <BookOpen size={40} strokeWidth={1.3} />;
}
