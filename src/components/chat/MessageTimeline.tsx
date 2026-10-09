import { useEffect, useRef, useCallback } from "react";
import {
  CommunicationMessage,
  ChatMember,
  messageReceipt,
  Reaction,
} from "../../lib/chat";
import { Avatar, Button } from "../ui";
import { ChatEntityCard } from "./ChatEntityCard";
import { ChatAttachment } from "./ChatAttachment";
function dayLabel(date: string) {
  const day = new Date(date).toDateString(),
    today = new Date(),
    yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  return day === today.toDateString()
    ? "Idag"
    : day === yesterday.toDateString()
      ? "Igår"
      : new Date(date).toLocaleDateString("sv-SE", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
}
export function MessageTimeline({
  messages,
  members,
  reactions,
  userId,
  group,
  older,
  hasOlder,
  loading,
  retry,
  action,
  openLink,
  reportVisible,
  replyTo,
  seek,
}: {
  messages: CommunicationMessage[];
  members: ChatMember[];
  reactions: Reaction[];
  userId: string;
  group: boolean;
  older: () => void;
  hasOlder: boolean;
  loading: boolean;
  retry: (m: CommunicationMessage) => void;
  action: (m: CommunicationMessage) => void;
  openLink: (type: "workorder" | "project", id: string) => void;
  reportVisible: (id: string) => void;
  replyTo: (m: CommunicationMessage) => void;
  seek: (id: string) => Promise<void>;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    previous = useRef({ last: "", count: 0, height: 0 });
  const report = useCallback(() => {
    const node = viewport.current;
    if (!node || document.visibilityState !== "visible") return;
    const area = node.getBoundingClientRect();
    const visible = [
      ...node.querySelectorAll<HTMLElement>("[data-message-id]"),
    ].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > area.top && r.bottom <= area.bottom + 2;
    });
    const last = visible[visible.length - 1];
    if (last) reportVisible(last.dataset.messageId!);
  }, [reportVisible]);
  const held = useRef(false);
  const press = useRef<ReturnType<typeof setTimeout>>(),
    touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const last = messages[messages.length - 1]?.id || "";
    if (previous.current.last !== last) {
      if (
        node.scrollHeight - node.scrollTop - node.clientHeight < 220 ||
        messages[messages.length - 1]?.sender_id === userId ||
        previous.current.count === 0
      )
        node.scrollTop = node.scrollHeight;
    } else if (messages.length > previous.current.count)
      node.scrollTop += node.scrollHeight - previous.current.height;
    previous.current = {
      last,
      count: messages.length,
      height: node.scrollHeight,
    };
    const frame = requestAnimationFrame(report);
    return () => cancelAnimationFrame(frame);
  }, [messages, userId, report]);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    let oldHeight = node.clientHeight;
    const resize = new ResizeObserver(() => {
      const nearBottom = node.scrollHeight - node.scrollTop - oldHeight < 220;
      oldHeight = node.clientHeight;
      if (nearBottom) node.scrollTop = node.scrollHeight;
      report();
    });
    resize.observe(node);
    return () => resize.disconnect();
  }, [report]);
  useEffect(() => () => clearTimeout(press.current), []);
  async function jump(id: string) {
    if (!document.getElementById(`chat-message-${id}`)) await seek(id);
    requestAnimationFrame(() => {
      const node = document.getElementById(`chat-message-${id}`);
      if (node) {
        const reduced = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        node.scrollIntoView({
          block: "center",
          behavior: reduced ? "instant" : "smooth",
        });
        if (!reduced)
          node.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 600 });
      }
    });
  }
  return (
    <div
      ref={viewport}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-vihem-canvas px-3 py-4 sm:px-5"
      onScroll={() => {
        if (viewport.current)
          previous.current.height = viewport.current.scrollHeight;
        report();
      }}
    >
      {hasOlder && (
        <div className="text-center">
          <Button
            size="sm"
            variant="secondary"
            onClick={older}
            loading={loading}
          >
            Äldre meddelanden
          </Button>
        </div>
      )}
      {!messages.length && (
        <p className="py-12 text-center text-sm text-slate-500">
          {loading ? "Hämtar meddelanden…" : "Skriv det första meddelandet."}
        </p>
      )}
      {messages.map((m, index) => {
        const own = m.sender_id === userId,
          prior = messages[index - 1],
          sameDay =
            prior &&
            new Date(prior.created_at).toDateString() ===
              new Date(m.created_at).toDateString();
        const grouped =
          sameDay &&
          prior.sender_id === m.sender_id &&
          Date.parse(m.created_at) - Date.parse(prior.created_at) < 120000;
        const readers = messageReceipt(m, members),
          reference = messages.find((value) => value.id === m.reply_to),
          emojis = reactions.filter((r) => r.message_id === m.id && r.active);
        return (
          <div
            className="mx-auto max-w-3xl"
            key={m.id}
            id={`chat-message-${m.id}`}
            data-message-id={m.id}
          >
            {!sameDay && (
              <div className="py-3 text-center text-xs font-medium text-vihem-muted">
                {dayLabel(m.created_at)}
              </div>
            )}
            <div
              className={`group flex items-end gap-2 ${own ? "justify-end" : "justify-start"} ${grouped ? "mt-1" : "mt-3"}`}
            >
              {group && !own && (
                <div className="w-8 shrink-0">
                  {!grouped && (
                    <Avatar
                      name={
                        members.find((p) => p.user_id === m.sender_id)?.name ||
                        "Tidigare deltagare"
                      }
                      userId={m.sender_id}
                      size="sm"
                    />
                  )}
                </div>
              )}
              <div
                className={`relative ${group && !own ? "max-w-[calc(100%-84px)]" : "max-w-[82%]"} rounded-2xl px-3 py-2 text-sm sm:max-w-[75%] ${own ? "bg-vihem-blue text-white rounded-br-md" : "bg-white text-vihem-ink rounded-bl-md"}`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  action(m);
                }}
                onClickCapture={(e) => {
                  if (held.current) {
                    e.preventDefault();
                    e.stopPropagation();
                    held.current = false;
                  }
                }}
                onTouchStart={(e) => {
                  held.current = false;
                  touch.current = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY,
                  };
                  press.current = setTimeout(() => {
                    held.current = true;
                    action(m);
                  }, 550);
                }}
                onTouchMove={(e) => {
                  if (
                    touch.current &&
                    Math.hypot(
                      e.touches[0].clientX - touch.current.x,
                      e.touches[0].clientY - touch.current.y,
                    ) > 10
                  )
                    clearTimeout(press.current);
                }}
                onTouchEnd={(e) => {
                  clearTimeout(press.current);
                  if (touch.current) {
                    const dx = e.changedTouches[0].clientX - touch.current.x,
                      dy = e.changedTouches[0].clientY - touch.current.y;
                    if (dx > 65 && Math.abs(dy) < 25 && !m.deleted_at)
                      replyTo(m);
                  }
                  touch.current = null;
                }}
                onTouchCancel={() => {
                  clearTimeout(press.current);
                  touch.current = null;
                }}
              >
                {group && !own && !grouped && (
                  <p className="mb-1 text-xs font-semibold text-blue-600">
                    {members.find((p) => p.user_id === m.sender_id)?.name ||
                      "Tidigare deltagare"}
                  </p>
                )}
                {m.reply_to && (
                  <button
                    className={`mb-2 block w-full rounded-lg border-l-2 p-2 text-left text-xs ${own ? "border-blue-200 bg-white/10" : "border-blue-500 bg-slate-100"}`}
                    onClick={() => jump(m.reply_to!)}
                  >
                    {reference?.deleted_at
                      ? "Meddelandet har raderats"
                      : reference?.message ||
                        reference?.attachment_name ||
                        "Svar på tidigare meddelande · hämta äldre för att visa"}
                  </button>
                )}
                {m.deleted_at ? (
                  <p className="italic opacity-70">Meddelandet har raderats</p>
                ) : (
                  <>
                    <ChatAttachment message={m} />
                    <p className="whitespace-pre-wrap break-words leading-relaxed">
                      {m.message.split(/(@[^@\n]+)/g).map((part, i) => {
                        const mentioned = members.find(
                          (p) =>
                            m.mentions.includes(p.user_id) &&
                            part.startsWith("@" + p.name),
                        );
                        return mentioned ? (
                          <span key={i}>
                            <strong className="rounded bg-blue-300/30 px-0.5">
                              @{mentioned.name}
                            </strong>
                            {part.slice(mentioned.name.length + 1)}
                          </span>
                        ) : (
                          part
                        );
                      })}
                    </p>
                    {m.linked_work_order_id && (
                      <ChatEntityCard
                        type="workorder"
                        id={m.linked_work_order_id}
                        open={() =>
                          openLink("workorder", m.linked_work_order_id!)
                        }
                      />
                    )}
                    {m.linked_project_id && (
                      <ChatEntityCard
                        type="project"
                        id={m.linked_project_id}
                        open={() => openLink("project", m.linked_project_id!)}
                      />
                    )}
                  </>
                )}
                <div
                  className={`mt-1 flex items-center justify-end gap-2 text-xs ${own ? "text-white" : "text-vihem-muted"}`}
                >
                  <time>
                    {new Date(m.created_at).toLocaleTimeString("sv-SE", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  {m.edited_at && <span>Redigerat</span>}
                  {own && (
                    <span title={readers.map((p) => p.name).join(", ")}>
                      {m.local_status === "sending"
                        ? "Skickar…"
                        : m.local_status === "failed"
                          ? "Kunde inte skickas"
                          : readers.length
                            ? `Läst${group ? ` av ${readers.length}` : ""}`
                            : "Skickat"}
                    </span>
                  )}
                </div>
                {!m.deleted_at && (
                  <button
                    aria-label="Meddelandeåtgärder"
                    className={`vihem-icon-button absolute top-0 ${own ? "-left-10" : "-right-10"} text-vihem-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100`}
                    onClick={() => action(m)}
                  >
                    ⋯
                  </button>
                )}
              </div>
            </div>
            {!!emojis.length && (
              <div
                className={`mt-1 flex gap-1 ${own ? "justify-end" : "justify-start"}`}
              >
                {[...new Set(emojis.map((r) => r.emoji))].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => action(m)}
                    title={emojis
                      .filter((r) => r.emoji === emoji)
                      .map(
                        (r) =>
                          members.find((p) => p.user_id === r.user_id)?.name ||
                          "Deltagare",
                      )
                      .join(", ")}
                    className="rounded-full border bg-white px-2 py-0.5 text-xs"
                  >
                    {emoji} {emojis.filter((r) => r.emoji === emoji).length}
                  </button>
                ))}
              </div>
            )}
            {m.local_status === "failed" && (
              <div className="mt-1 text-right">
                <p className="text-xs text-red-600">{m.local_error}</p>
                <button
                  className="py-2 text-sm font-semibold text-blue-600"
                  onClick={() => retry(m)}
                >
                  Försök igen
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
