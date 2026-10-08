import { CreateChatDialog } from "../components/chat/CreateChatDialog";
import { ChatGroupInfo } from "../components/chat/ChatGroupInfo";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Plus, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { Avatar, Button, Input, Modal, PageHeader } from "../components/ui";
import {
  chatRpc,
  chatTitle,
  CommunicationMessage,
  Conversation,
  messageReceipt,
} from "../lib/chat";
import { uploadChatFile, discardChatFile } from "../lib/chatMedia";
import { useChat } from "../hooks/useChat";
import { useChatComposerDraft } from "../hooks/useChatComposerDraft";
import { useChatActivity } from "../hooks/useChatActivity";
import { ConversationList } from "../components/chat/ConversationList";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { ChatAvatar } from "../components/chat/ChatAvatar";
import { ChatComposer } from "../components/chat/ChatComposer";

type Person = { id: string; name: string; role: string };
export function ChatPage({
  onNavigate,
  initialThreadId,
  initialMessageId,
}: {
  onNavigate: (page: string) => void;
  initialThreadId?: string;
  initialMessageId?: string;
}) {
  const { user } = useAuth();
  if (!user?.organisation_id)
    return <p>Du behöver vara inloggad i en organisation.</p>;
  return (
    <ChatWorkspace
      key={`${user.organisation_id}:${user.id}`}
      user={user}
      onNavigate={onNavigate}
      initialThreadId={initialThreadId}
      initialMessageId={initialMessageId}
    />
  );
}
function ChatWorkspace({
  user,
  onNavigate,
  initialThreadId,
  initialMessageId,
}: {
  user: { id: string; organisation_id: string | null; role: string };
  onNavigate: (page: string) => void;
  initialThreadId?: string;
  initialMessageId?: string;
}) {
  const chat = useChat(user.id, user.organisation_id!, initialThreadId),
    activity = useChatActivity(chat.selected, user.id);
  const { messages, selected, loadingMessages, seek, setError } = chat;
  const handledMessage = useRef("");
  const current = chat.current,
    staff = ["admin", "superadmin", "staff"].includes(user.role);
  const {
    mentionIds,
    setMentionIds,
    link,
    setLink,
    reply,
    setReply,
    attachment,
    setAttachment,
  } = useChatComposerDraft(user.organisation_id!, user.id, chat.selected);
  const [shareOpen, setShareOpen] = useState(false),
    [shareType, setShareType] = useState<"workorder" | "project">("workorder"),
    [entities, setEntities] = useState<{ id: string; title: string }[]>([]),
    [forwardOpen, setForwardOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false),
    [people, setPeople] = useState<Person[]>([]),
    [peopleSearch, setPeopleSearch] = useState("");
  const [kind, setKind] = useState("direct"),
    [recipients, setRecipients] = useState<string[]>([]),
    [title, setTitle] = useState(""),
    [busy, setBusy] = useState(false);
  const [threadMenu, setThreadMenu] = useState<Conversation | null>(null),
    [messageMenu, setMessageMenu] = useState<CommunicationMessage | null>(null);
  const [editText, setEditText] = useState(""),
    [editOpen, setEditOpen] = useState(false),
    [infoOpen, setInfoOpen] = useState(false),
    [groupTitle, setGroupTitle] = useState("");
  const [viewport, setViewport] = useState({
    height: window.visualViewport?.height || window.innerHeight,
    top: window.visualViewport?.offsetTop || 0,
  });
  const generation = useRef(0),
    mounted = useRef(true),
    runLock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    generation.current++;
    setMessageMenu(null);
    setThreadMenu(null);
  }, [chat.selected]);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("vihem-chat-focus", { detail: !!chat.selected }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("vihem-chat-focus", { detail: false }),
      );
    };
  }, [chat.selected]);
  useEffect(() => {
    const update = () =>
      setViewport({
        height: window.visualViewport?.height || window.innerHeight,
        top: window.visualViewport?.offsetTop || 0,
      });
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);
  useEffect(() => {
    if (
      !initialMessageId ||
      selected !== initialThreadId ||
      loadingMessages ||
      !messages.length ||
      handledMessage.current === initialMessageId
    )
      return;
    handledMessage.current = initialMessageId;
    void seek(initialMessageId).then(() =>
      requestAnimationFrame(() =>
        document
          .getElementById(`chat-message-${initialMessageId}`)
          ?.scrollIntoView({ block: "center" }),
      ),
    );
  }, [
    initialMessageId,
    initialThreadId,
    selected,
    loadingMessages,
    messages,
    seek,
  ]);
  useEffect(() => {
    if ((!createOpen && !infoOpen) || !staff) return;
    let live = true;
    void supabase
      .from("vihem_profiles")
      .select("id,name,role")
      .eq("organisation_id", user.organisation_id)
      .eq("active", true)
      .in("role", ["staff", "admin", "superadmin", "tenant"])
      .order("name")
      .then(({ data, error }) => {
        if (live) {
          if (error) setError("Mottagare kunde inte hämtas.");
          else setPeople(data || []);
        }
      });
    return () => {
      live = false;
    };
  }, [createOpen, infoOpen, staff, user.organisation_id, setError]);
  useEffect(() => {
    if (!shareOpen) return;
    let live = true;
    void supabase
      .from(
        shareType === "workorder"
          ? "vihem_work_orders"
          : "vihem_customer_projects",
      )
      .select("id,title")
      .eq("organisation_id", user.organisation_id)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (live) {
          setEntities(data || []);
          if (error) setError("Delbara objekt kunde inte hämtas.");
        }
      });
    return () => {
      live = false;
    };
  }, [shareOpen, shareType, user.organisation_id, setError]);
  async function run(action: () => Promise<unknown>) {
    if (runLock.current) return;
    runLock.current = true;
    setBusy(true);
    chat.setError("");
    try {
      await action();
      await chat.refreshInbox();
    } catch (err) {
      chat.setError((err as Error).message);
    } finally {
      runLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function create() {
    await run(async () => {
      const id = await chatRpc<string>("vihem_chat_create", {
        kind: staff ? kind : "tenant_support",
        recipients: staff ? recipients : [],
        title,
      });
      setCreateOpen(false);
      setRecipients([]);
      setTitle("");
      setPeopleSearch("");
      await chat.refreshInbox();
      chat.setSelected(id);
    });
  }
  async function upload(file: File, duration?: number) {
    if (!current) return;
    const epoch = generation.current;
    const data = await uploadChatFile(current.id, file);
    if (epoch !== generation.current)
      throw new Error(
        "Du bytte konversation. Bilagan har inte lagts in i den nya chatten.",
      );
    if (attachment?.attachment_path)
      await discardChatFile(current.id, attachment.attachment_path);
    setAttachment({
      attachment_path: data.path,
      attachment_name: data.name,
      attachment_mime: data.mime,
      attachment_size: data.size,
      attachment_type: data.mime.startsWith("image/")
        ? "image"
        : data.mime.startsWith("audio/")
          ? "audio"
          : data.mime.startsWith("video/")
            ? "video"
            : "document",
      audio_duration: duration || null,
    });
  }
  function send() {
    activity.stopTyping();
    chat.send({
      ...attachment,
      ...link,
      reply_to: reply?.id || null,
      mentions: mentionIds.filter((id) =>
        chat.draft.includes(
          "@" + current?.participants.find((p) => p.user_id === id)?.name,
        ),
      ),
    });
    setAttachment(null);
    setLink(null);
    setReply(null);
    setMentionIds([]);
  }
  const filteredPeople = people.filter(
    (p) =>
      p.id !== user.id &&
      p.name.toLowerCase().includes(peopleSearch.toLowerCase()) &&
      (kind === "tenant_support"
        ? p.role === "tenant"
        : kind === "direct"
          ? p.role !== "tenant"
          : true),
  );
  const ownGroup =
    current?.chat_type === "group" &&
    (current.created_by === user.id ||
      ["admin", "superadmin"].includes(user.role));
  return (
    <div className={`space-y-4 ${chat.selected ? "chat-mobile-active" : ""}`}>
      <div className={chat.selected ? "hidden md:block" : ""}>
        <PageHeader
          title="Meddelanden"
          subtitle={
            staff
              ? "Kollegor, grupper och fastighetskontoret"
              : "Kontakta fastighetskontoret"
          }
          icon={MessageCircle}
          action={
            <Button
              onClick={() => {
                setKind(staff ? "direct" : "tenant_support");
                setCreateOpen(true);
              }}
            >
              <Plus size={18} />
              Ny chatt
            </Button>
          }
        />
      </div>
      {chat.error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {chat.error}
        </p>
      )}
      <div
        className={`chat-workspace flex min-h-0 overflow-hidden rounded-card border bg-white shadow-sm ${chat.selected ? "chat-workspace-active" : ""}`}
        style={
          {
            "--chat-height": `${viewport.height}px`,
            "--chat-top": `${viewport.top}px`,
          } as React.CSSProperties
        }
      >
        <aside
          className={`${chat.selected ? "hidden md:block" : "block"} h-full w-full shrink-0 border-r md:w-80 xl:w-96`}
        >
          <ConversationList
            threads={chat.threads}
            userId={user.id}
            tenant={!staff}
            selected={chat.selected}
            select={chat.setSelected}
            filter={chat.filter}
            setFilter={chat.setFilter}
            query={chat.query}
            setQuery={chat.setQuery}
            hasMore={chat.hasThreads}
            more={chat.moreThreads}
            onAction={setThreadMenu}
          />
        </aside>
        <section
          className={`${chat.selected ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-1 flex-col`}
        >
          {current ? (
            <>
              <header className="flex shrink-0 items-center gap-3 border-b bg-white p-3 pt-[max(env(safe-area-inset-top),0.75rem)] md:pt-3">
                <button
                  aria-label="Tillbaka till konversationer"
                  className="rounded-full p-2 md:hidden"
                  onClick={() => chat.setSelected(null)}
                >
                  <ArrowLeft />
                </button>
                <ChatAvatar
                  name={chatTitle(current, user.id, !staff)}
                  path={current.group_image_path}
                />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold text-vihem-ink">
                    {chatTitle(current, user.id, !staff)}
                  </h2>
                  <p className="truncate text-xs text-slate-500">
                    {!chat.online
                      ? "Offline"
                      : chat.connection !== "connected"
                        ? "Återansluter…"
                        : activity.onlineUsers.length
                          ? "Aktiv i chatten"
                          : current.chat_type === "group"
                            ? `${current.participants.length} deltagare`
                            : "VI-HEM"}
                  </p>
                </div>
                <button
                  aria-label="Konversationsinställningar"
                  className="p-2 text-xl"
                  onClick={() => setThreadMenu(current)}
                >
                  ⋯
                </button>
              </header>
              {chat.error && (
                <p
                  role="alert"
                  className="shrink-0 bg-red-50 p-3 text-sm text-red-700"
                >
                  {chat.error}
                </p>
              )}
              <MessageTimeline
                messages={chat.messages}
                members={current.participants}
                reactions={chat.reactions}
                userId={user.id}
                group={current.chat_type === "group"}
                older={() => void chat.older()}
                hasOlder={chat.hasOlder}
                loading={chat.loadingMessages}
                retry={(m) => void chat.retry(m)}
                action={setMessageMenu}
                reportVisible={chat.reportVisible}
                replyTo={setReply}
                seek={chat.seek}
                openLink={(type, id) =>
                  onNavigate(
                    `${type === "workorder" ? "workorder" : "customer-project"}/${id}`,
                  )
                }
              />
              {!!activity.typingUsers.length && (
                <p className="bg-slate-50 px-4 py-1 text-xs text-slate-500">
                  {activity.typingUsers
                    .map(
                      (id) =>
                        current.participants.find((p) => p.user_id === id)
                          ?.name || "Deltagare",
                    )
                    .join(", ")}{" "}
                  skriver…
                </p>
              )}
              {staff && (
                <div className="flex gap-2 bg-white px-3 pt-1">
                  <button
                    className="py-1 text-xs text-blue-600"
                    onClick={() => {
                      setShareType("workorder");
                      setShareOpen(true);
                    }}
                  >
                    Dela arbetsorder
                  </button>
                  <button
                    className="py-1 text-xs text-blue-600"
                    onClick={() => {
                      setShareType("project");
                      setShareOpen(true);
                    }}
                  >
                    Dela projekt
                  </button>
                </div>
              )}
              {link && (
                <div className="flex items-center justify-between px-3 py-2 text-xs text-blue-600">
                  <span>
                    {link.linked_work_order_id ? "Arbetsorder" : "Projekt"}{" "}
                    bifogat · granskas vid öppning
                  </span>
                  <button
                    aria-label="Ta bort länk"
                    onClick={() => setLink(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              {attachment && (
                <div className="flex items-center gap-2 border-t px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {attachment.attachment_name}
                  </span>
                  <button
                    aria-label="Ta bort bilaga"
                    onClick={() =>
                      void run(async () => {
                        if (attachment.attachment_path)
                          await discardChatFile(
                            current.id,
                            attachment.attachment_path,
                          );
                        setAttachment(null);
                      })
                    }
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
              <ChatComposer
                text={chat.draft}
                setText={chat.setDraft}
                disabled={current.status !== "open"}
                hasAttachment={!!attachment || !!link}
                reply={reply}
                clearReply={() => setReply(null)}
                send={send}
                attach={upload}
                onTyping={activity.typing}
                members={current.participants.filter(
                  (p) => p.user_id !== user.id,
                )}
                onMention={(id) =>
                  setMentionIds((ids) => [...new Set([...ids, id])])
                }
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-slate-500">
              {chat.selected
                ? "Hämtar konversation…"
                : "Välj en konversation eller starta en ny chatt."}
            </div>
          )}
        </section>
      </div>
      <CreateChatDialog
        open={createOpen}
        onClose={() => !busy && setCreateOpen(false)}
        staff={staff}
        busy={busy}
        kind={kind}
        setKind={setKind}
        recipients={recipients}
        setRecipients={setRecipients}
        peopleSearch={peopleSearch}
        setPeopleSearch={setPeopleSearch}
        filteredPeople={filteredPeople}
        title={title}
        setTitle={setTitle}
        create={create}
      />
      <Modal
        open={!!threadMenu}
        onClose={() => setThreadMenu(null)}
        title="Konversation"
      >
        {threadMenu && (
          <div className="space-y-2">
            {[
              [
                "pinned",
                threadMenu.pinned ? "Lossa från toppen" : "Fäst överst",
              ],
              [
                "manual_unread",
                threadMenu.manual_unread
                  ? "Ta bort oläst markering"
                  : "Markera som oläst",
              ],
              [
                "archived",
                threadMenu.archived ? "Återställ från arkiv" : "Arkivera",
              ],
            ].map(([field, label]) => (
              <Button
                key={field}
                variant="secondary"
                className="w-full"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const param =
                      field === "pinned"
                        ? "pinned_value"
                        : field === "archived"
                          ? "archived_value"
                          : "unread_value";
                    await chatRpc("vihem_chat_settings", {
                      thread: threadMenu.id,
                      [param]:
                        !threadMenu[
                          field as "pinned" | "archived" | "manual_unread"
                        ],
                    });
                    if (
                      field === "manual_unread" &&
                      !threadMenu.manual_unread &&
                      chat.selected === threadMenu.id
                    )
                      chat.setSelected(null);
                    setThreadMenu(null);
                  })
                }
              >
                {label}
              </Button>
            ))}
            {staff && (
              <Button
                variant="secondary"
                className="w-full"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await chatRpc("vihem_chat_status", {
                      thread: threadMenu.id,
                      new_status:
                        threadMenu.status === "open" ? "closed" : "open",
                    });
                    setThreadMenu(null);
                  })
                }
              >
                {threadMenu.status === "open"
                  ? "Stäng konversation"
                  : "Öppna konversation igen"}
              </Button>
            )}
            <label className="block text-sm">
              Notifikationer
              <select
                className="mt-1 block w-full rounded-lg border p-3"
                value={threadMenu.notification_mode}
                disabled={busy}
                onChange={(e) =>
                  void run(async () => {
                    await chatRpc("vihem_chat_settings", {
                      thread: threadMenu.id,
                      notification_value: e.target.value,
                    });
                    setThreadMenu(null);
                  })
                }
              >
                <option value="all">Alla meddelanden</option>
                <option value="mentions">Endast omnämnanden</option>
                <option value="none">Tyst</option>
              </select>
            </label>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                chat.setSelected(threadMenu.id);
                setGroupTitle(threadMenu.subject);
                setThreadMenu(null);
                setInfoOpen(true);
              }}
            >
              Visa information och deltagare
            </Button>
          </div>
        )}
      </Modal>
      <Modal
        open={!!messageMenu}
        onClose={() => setMessageMenu(null)}
        title="Meddelande"
      >
        {messageMenu && (
          <div className="space-y-3">
            {current?.chat_type === "group" &&
              messageMenu.sender_id === user.id && (
                <p className="text-sm text-slate-500">
                  Läst av:{" "}
                  {messageReceipt(messageMenu, current.participants)
                    .map((p) => p.name)
                    .join(", ") || "Ingen ännu"}
                </p>
              )}
            <div className="flex gap-2">
              {["👍", "❤️", "😂", "✅"].map((emoji) => (
                <Button
                  variant="secondary"
                  key={emoji}
                  disabled={busy || !!messageMenu.local_status}
                  onClick={() =>
                    void run(async () => {
                      await chatRpc("vihem_chat_message_action", {
                        message_id: messageMenu.id,
                        action: "reaction",
                        text_value: emoji,
                      });
                      setMessageMenu(null);
                    })
                  }
                >
                  {emoji}
                </Button>
              ))}
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setReply(messageMenu);
                setMessageMenu(null);
              }}
            >
              Svara
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(messageMenu.message);
                  setMessageMenu(null);
                })
              }
            >
              Kopiera
            </Button>
            {staff && !messageMenu.local_status && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setForwardOpen(true)}
                >
                  Vidarebefordra internt
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const source = messageMenu.id;
                    setMessageMenu(null);
                    onNavigate(`workorder-new/${source}`);
                  }}
                >
                  Skapa arbetsorder
                </Button>
              </>
            )}
            {messageMenu.sender_id === user.id &&
              !messageMenu.local_status &&
              Date.now() - Date.parse(messageMenu.created_at) < 900000 && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditText(messageMenu.message);
                      setEditOpen(true);
                    }}
                  >
                    Redigera
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Radera meddelandet?"))
                        void run(async () => {
                          await chatRpc("vihem_chat_message_action", {
                            message_id: messageMenu.id,
                            action: "delete",
                          });
                          setMessageMenu(null);
                          void chat.refresh();
                        });
                    }}
                  >
                    Radera
                  </Button>
                </>
              )}
          </div>
        )}
      </Modal>
      <Modal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title={shareType === "workorder" ? "Dela arbetsorder" : "Dela projekt"}
      >
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {!entities.length && (
            <p className="text-sm text-slate-500">
              Inga objekt med åtkomst hittades.
            </p>
          )}
          {entities.map((entity) => (
            <Button
              key={entity.id}
              className="w-full justify-start"
              variant="secondary"
              onClick={() => {
                setLink(
                  shareType === "workorder"
                    ? { linked_work_order_id: entity.id }
                    : { linked_project_id: entity.id },
                );
                setShareOpen(false);
              }}
            >
              {entity.title}
            </Button>
          ))}
        </div>
      </Modal>
      <Modal
        open={forwardOpen}
        onClose={() => setForwardOpen(false)}
        title="Vidarebefordra till intern chatt"
      >
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {chat.threads
            .filter(
              (t) =>
                t.id !== chat.selected &&
                !t.participants.some((p) => p.role === "tenant") &&
                t.status === "open",
            )
            .map((t) => (
              <Button
                key={t.id}
                className="w-full"
                variant="secondary"
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    chat.forward(t.id, messageMenu!);
                    setForwardOpen(false);
                    setMessageMenu(null);
                  })
                }
              >
                {chatTitle(t, user.id, false)}
              </Button>
            ))}
        </div>
      </Modal>
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Redigera meddelande"
      >
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          maxLength={10000}
          rows={5}
          className="w-full rounded-lg border p-3 text-base"
        />
        <Button
          loading={busy}
          onClick={() =>
            void run(async () => {
              await chatRpc("vihem_chat_message_action", {
                message_id: messageMenu!.id,
                action: "edit",
                text_value: editText,
              });
              setEditOpen(false);
              setMessageMenu(null);
              void chat.refresh();
            })
          }
        >
          Spara
        </Button>
      </Modal>
      <ChatGroupInfo
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        onLeave={() => chat.setSelected(null)}
        current={current}
        ownGroup={!!ownGroup}
        busy={busy}
        activity={activity}
        run={run}
        groupTitle={groupTitle}
        setGroupTitle={setGroupTitle}
        user={user}
        people={people}
      />
    </div>
  );
}
