import { useState, useRef, useEffect } from "react";
import { Avatar, Button, Input } from "../ui";
import { ChatAvatar } from "./ChatAvatar";
import { chatTitle, Conversation } from "../../lib/chat";
const filters = [
  ["all", "Alla"],
  ["unread", "Olästa"],
  ["staff", "Personal"],
  ["tenant", "Hyresgäster"],
  ["group", "Grupper"],
  ["archived", "Arkiverade"],
];
export function ConversationList({
  threads,
  userId,
  tenant,
  selected,
  select,
  filter,
  setFilter,
  query,
  setQuery,
  hasMore,
  more,
  onAction,
}: {
  threads: Conversation[];
  userId: string;
  tenant: boolean;
  selected: string | null;
  filter: string;
  setFilter: (filter: string) => void;
  select: (id: string) => void;
  query: string;
  setQuery: (q: string) => void;
  hasMore: boolean;
  more: () => void;
  onAction: (thread: Conversation) => void;
}) {
  const press = useRef<ReturnType<typeof setTimeout>>(),
    touch = useRef<{ x: number; y: number; held: boolean } | null>(null);
  useEffect(() => () => clearTimeout(press.current), []);
  const visible = threads.filter((t) =>
    filter === "archived"
      ? t.archived
      : !t.archived &&
        (filter === "all" ||
          (filter === "unread" && (t.unread_count > 0 || t.manual_unread)) ||
          (filter === "staff" && t.chat_type === "direct") ||
          (filter === "tenant" && t.chat_type === "tenant_support") ||
          (filter === "group" && t.chat_type === "group")),
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-3">
        <Input
          aria-label="Sök i konversationer och meddelanden"
          placeholder="Sök personer, grupper och meddelanden"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {filters.map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`shrink-0 rounded-full px-3 py-2 text-sm ${filter === value ? "bg-vihem-blue text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto py-2">
        {!visible.length ? (
          <p className="p-6 text-center text-sm text-slate-500">
            Inga konversationer här.
          </p>
        ) : (
          visible.map((t) => {
            const title = chatTitle(t, userId, tenant),
              unread = t.unread_count > 0 || t.manual_unread;
            const stamp = new Date(t.last_message_at);
            const today = stamp.toDateString() === new Date().toDateString();
            return (
              <div
                key={t.id}
                className={`group relative mx-2 rounded-xl transition-colors ${selected === t.id ? "bg-blue-50" : "hover:bg-slate-50"}`}
              >
                <button
                  className="flex w-full items-center gap-3 px-3 py-3 pr-10 text-left"
                  onClick={() => {
                    if (!touch.current?.held) select(t.id);
                    touch.current = null;
                  }}
                  onTouchStart={(e) => {
                    touch.current = {
                      x: e.touches[0].clientX,
                      y: e.touches[0].clientY,
                      held: false,
                    };
                    press.current = setTimeout(() => {
                      if (touch.current) touch.current.held = true;
                      onAction(t);
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
                    if (
                      touch.current &&
                      Math.abs(e.changedTouches[0].clientX - touch.current.x) >
                        65 &&
                      Math.abs(e.changedTouches[0].clientY - touch.current.y) <
                        25
                    ) {
                      touch.current.held = true;
                      onAction(t);
                    }
                  }}
                  onTouchCancel={() => {
                    clearTimeout(press.current);
                    touch.current = null;
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onAction(t);
                  }}
                >
                  <ChatAvatar
                    name={title}
                    path={t.group_image_path}
                    userId={
                      t.chat_type === "direct"
                        ? t.participants.find((p) => p.user_id !== userId)
                            ?.user_id
                        : undefined
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-sm text-vihem-ink ${unread ? "font-bold" : "font-medium"}`}
                      >
                        {t.pinned ? "📌 " : ""}
                        {title}
                      </span>
                      <time
                        className={`shrink-0 text-xs ${unread ? "font-semibold text-blue-600" : "text-slate-400"}`}
                      >
                        {stamp.toLocaleString(
                          "sv-SE",
                          today
                            ? { hour: "2-digit", minute: "2-digit" }
                            : { day: "numeric", month: "short" },
                        )}
                      </time>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <p
                        className={`min-w-0 flex-1 truncate text-sm ${unread ? "font-medium text-slate-800" : "text-slate-500"}`}
                      >
                        {t.search_excerpt ||
                          (t.latest?.sender_id === userId ? "Du: " : "") +
                            (t.latest?.message ||
                              t.latest?.attachment_name ||
                              "Börja skriva")}
                      </p>
                      {unread && (
                        <span className="rounded-full bg-vihem-blue px-1.5 text-xs font-semibold text-white">
                          {t.unread_count || "•"}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                <button
                  aria-label={`Åtgärder för ${title}`}
                  className="vihem-icon-button absolute right-0 top-4 text-slate-500 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"
                  onClick={() => onAction(t)}
                >
                  ⋯
                </button>
              </div>
            );
          })
        )}
        {hasMore && (
          <div className="p-3">
            <Button variant="secondary" onClick={more}>
              Visa fler konversationer
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
