import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  chatRpc,
  CommunicationMessage,
  Conversation,
  draftKey,
  mergeChatMessages,
  mergeChatReactions,
  reactionKey,
  Reaction,
  readLocal,
  writeLocal,
} from "../lib/chat";

export function useChat(userId: string, org: string, initialThread?: string) {
  const [current, setCurrent] = useState<Conversation | null>(null);
  const threadsRef = useRef<Conversation[]>([]);
  const [threads, setThreads] = useState<Conversation[]>([]),
    [selected, setSelected] = useState<string | null>(initialThread || null);
  const [messages, setMessages] = useState<CommunicationMessage[]>([]),
    [reactions, setReactions] = useState<Reaction[]>([]);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [hasThreads, setHasThreads] = useState(false);
  const [loading, setLoading] = useState(true),
    [loadingMessages, setLoadingMessages] = useState(false),
    [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState(""),
    [connection, setConnection] = useState("connecting"),
    [online, setOnline] = useState(navigator.onLine);
  const [draft, setDraftState] = useState("");
  const selectedRef = useRef(selected),
    messagesRef = useRef(messages),
    inboxEpoch = useRef(0),
    threadEpoch = useRef(0),
    sending = useRef(new Set<string>()),
    confirmed = useRef(new Map<string, CommunicationMessage>());
  const filterRef = useRef(filter),
    queryRef = useRef(query),
    readBoundary = useRef("");
  threadsRef.current = threads;
  selectedRef.current = selected;
  messagesRef.current = messages;
  queryRef.current = query;
  filterRef.current = filter;
  const [visibleMessage, setVisibleMessage] = useState<{
    thread: string;
    id: string;
  } | null>(null);
  const reportVisible = useCallback((id: string) => {
    const thread = selectedRef.current;
    if (thread)
      setVisibleMessage((previous) =>
        previous?.thread === thread && previous.id === id
          ? previous
          : { thread, id },
      );
  }, []);
  const inboxFlight = useRef<Promise<void> | null>(null),
    inboxQueued = useRef(false),
    loadingMoreThreads = useRef(false);
  const lastSubmission = useRef({ signature: "", time: 0 });
  const reactionRevision = useRef(0),
    reactionChanged = useRef(new Map<string, number>());
  const key = useCallback(
    (thread: string) => draftKey(org, userId, thread),
    [org, userId],
  );
  const setDraft = (value: string) => {
    setDraftState(value);
    if (selectedRef.current)
      writeLocal(key(selectedRef.current) + ":draft", value);
  };
  const fetchInbox = useCallback(async () => {
    const epoch = ++inboxEpoch.current;
    try {
      const data = await chatRpc<Conversation[]>("vihem_chat_inbox", {
        query: queryRef.current,
        filter_value: filterRef.current,
        batch: 101,
      });
      if (epoch !== inboxEpoch.current) return;
      setThreads((previous) => {
        const merged =
          queryRef.current || previous.length <= 100
            ? data.slice(0, 100)
            : [
                ...new Map(
                  [...previous, ...data.slice(0, 100)].map((t) => [t.id, t]),
                ).values(),
              ];
        return merged.sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            b.last_message_at.localeCompare(a.last_message_at),
        );
      });
      setHasThreads((previous) =>
        threadsRef.current.length > 100 ? previous : data.length > 100,
      );
      setError("");
      if (selectedRef.current) {
        const thread = selectedRef.current;
        const details = await chatRpc<Conversation[]>("vihem_chat_inbox", {
          thread_filter: thread,
          batch: 1,
        });
        if (epoch === inboxEpoch.current && selectedRef.current === thread) {
          setCurrent(details[0] || null);
          if (!details.length) {
            setSelected(null);
            setMessages([]);
          }
        }
      }
      // A revoked/deleted conversation must not leave already loaded content visible.
      if (
        selectedRef.current &&
        !data.some((t) => t.id === selectedRef.current)
      ) {
        const checkedThread = selectedRef.current;
        const { data: allowed, error: accessError } = await supabase
          .from("vihem_chat_threads")
          .select("id")
          .eq("id", checkedThread)
          .maybeSingle();
        if (
          epoch === inboxEpoch.current &&
          selectedRef.current === checkedThread &&
          !accessError &&
          !allowed
        ) {
          setSelected(null);
          setMessages([]);
          setError("Du har inte längre åtkomst till konversationen.");
        }
      }
    } catch (err) {
      if (epoch === inboxEpoch.current) setError((err as Error).message);
    } finally {
      if (epoch === inboxEpoch.current) setLoading(false);
    }
  }, []);
  const refreshInbox = useCallback(() => {
    inboxQueued.current = true;
    if (inboxFlight.current) return inboxFlight.current;
    const promise = (async () => {
      do {
        inboxQueued.current = false;
        await fetchInbox();
      } while (inboxQueued.current);
    })();
    inboxFlight.current = promise;
    void promise.finally(() => {
      inboxFlight.current = null;
    });
    return promise;
  }, [fetchInbox]);
  const fetchReactions = useCallback(
    async (thread: string, ids: string[], replace = false) => {
      const epoch = threadEpoch.current,
        startRevision = reactionRevision.current,
        unique = [...new Set(ids)],
        rows: Reaction[] = [];
      for (let offset = 0; offset < unique.length; offset += 200) {
        const result = await supabase
          .from("vihem_chat_reactions")
          .select("*")
          .eq("thread_id", thread)
          .in("message_id", unique.slice(offset, offset + 200))
          .eq("active", true);
        if (result.error)
          throw new Error("Reaktionerna kunde inte synkroniseras.");
        rows.push(...(result.data || []));
      }
      if (selectedRef.current !== thread || threadEpoch.current !== epoch)
        return;
      const fetched = new Set(unique);
      setReactions((previous) =>
        mergeChatReactions(
          previous,
          rows,
          fetched,
          reactionChanged.current,
          startRevision,
          replace,
        ),
      );
    },
    [],
  );
  const fetchRecent = useCallback(
    async (thread: string, replace = false) => {
      const epoch = threadEpoch.current;
      try {
        const data = await chatRpc<CommunicationMessage[]>(
          "vihem_chat_history",
          { thread, batch: 51 },
        );
        if (selectedRef.current !== thread || threadEpoch.current !== epoch)
          return;
        const pending = readLocal<CommunicationMessage[]>(
          draftKey(org, userId, thread) + ":outbox",
          [],
        ).map((row) =>
          sending.current.has(row.id)
            ? row
            : {
                ...row,
                local_status: "failed" as const,
                local_error:
                  row.local_error ||
                  "Kontrollera utskicket genom att försöka igen.",
              },
        );
        setMessages((current) =>
          mergeChatMessages(replace ? pending : current, data.slice(0, 50)),
        );
        if (replace) setHasOlder(data.length > 50);
        await fetchReactions(
          thread,
          [
            ...(replace ? [] : messagesRef.current.map((row) => row.id)),
            ...data.slice(0, 50).map((row) => row.id),
          ],
          replace,
        );
      } catch (err) {
        if (selectedRef.current === thread) setError((err as Error).message);
      } finally {
        if (selectedRef.current === thread) setLoadingMessages(false);
      }
    },
    [org, userId, fetchReactions],
  );
  useEffect(() => {
    inboxEpoch.current++;
    setThreads([]);
    const timer = window.setTimeout(() => void refreshInbox(), 200);
    return () => clearTimeout(timer);
  }, [query, filter, refreshInbox]);
  useEffect(() => {
    if (initialThread) setSelected(initialThread);
  }, [initialThread]);
  useEffect(() => {
    const epoch = ++threadEpoch.current;
    readBoundary.current = "";
    setVisibleMessage(null);
    setMessages([]);
    setReactions([]);
    reactionChanged.current.clear();
    reactionRevision.current = 0;
    setCurrent(threadsRef.current.find((t) => t.id === selected) || null);
    if (selected)
      void chatRpc<Conversation[]>("vihem_chat_inbox", {
        thread_filter: selected,
        batch: 1,
      })
        .then((data) => {
          if (selectedRef.current === selected) {
            setCurrent(data[0] || null);
            if (!data.length) setSelected(null);
          }
        })
        .catch((err) => setError(err.message));
    if (!selected) {
      setDraftState("");
      return;
    }
    setDraftState(readLocal(key(selected) + ":draft", ""));
    setLoadingMessages(true);
    void fetchRecent(selected, true);
    return () => {
      threadEpoch.current = epoch + 1;
    };
  }, [selected, fetchRecent, key]);
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      supabase.realtime.connect();
      void refreshInbox();
      if (selectedRef.current) void fetchRecent(selectedRef.current);
    };
    const channel = supabase
      .channel(`chat-inbox:${org}:${userId}`)
      .on("system", {}, (payload) => {
        if (
          payload.extension === "postgres_changes" &&
          payload.status === "error"
        ) {
          setConnection("reconnecting");
          setError(
            "Realtidsanslutningen kunde inte startas. Meddelanden synkroniseras vid återanslutning.",
          );
        } else if (
          payload.extension === "postgres_changes" &&
          payload.status === "ok"
        )
          setConnection("connected");
      })
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "vihem_chat_threads",
          filter: `organisation_id=eq.${org}`,
        },
        () => void refreshInbox(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "vihem_chat_participants" },
        (payload) => {
          const member = payload.new as {
            user_id: string;
            thread_id: string;
            left_at: string | null;
          };
          if (member.user_id === userId && member.left_at) {
            setThreads((rows) => rows.filter((t) => t.id !== member.thread_id));
            if (selectedRef.current === member.thread_id) {
              setSelected(null);
              setCurrent(null);
              setMessages([]);
            }
          }
          void refreshInbox();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "vihem_chat_participants" },
        () => void refreshInbox(),
      )
      .subscribe((status) => {
        if (disposed) return;
        if (status !== "SUBSCRIBED") setConnection("reconnecting");
        if (status === "SUBSCRIBED") refresh();
      });
    // The SDK ignores connect() while its last socket is still closing (up to 100 ms).
    const connectionRecovery = window.setTimeout(() => {
      if (!disposed) supabase.realtime.connect();
    }, 200);
    const foreground = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const network = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) refresh();
    };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("focus", foreground);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    // Catch missed events, permission revocation and browser/native background reconnects.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) refresh();
    }, 30000);
    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
      clearInterval(timer);
      clearTimeout(connectionRecovery);
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, [org, userId, refreshInbox, fetchRecent]);
  useEffect(() => {
    if (!selected) return;
    let disposed = false;
    const thread = selected;
    const receive = (message: CommunicationMessage) => {
      if (disposed || selectedRef.current !== thread) return;
      if (message.sender_id === userId) {
        if (sending.current.has(message.id))
          confirmed.current.set(message.id, message);
        const queueKey = draftKey(org, userId, thread) + ":outbox";
        writeLocal(
          queueKey,
          readLocal<CommunicationMessage[]>(queueKey, []).filter(
            (row) => row.id !== message.id,
          ),
        );
      }
      setMessages((current) => mergeChatMessages(current, [message]));
      void refreshInbox();
    };
    const channel = supabase
      .channel(`chat-thread:${thread}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "vihem_chat_messages",
          filter: `thread_id=eq.${thread}`,
        },
        (payload) => receive(payload.new as CommunicationMessage),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "vihem_chat_messages",
          filter: `thread_id=eq.${thread}`,
        },
        (payload) => receive(payload.new as CommunicationMessage),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "vihem_chat_reactions",
          filter: `thread_id=eq.${thread}`,
        },
        (payload) => {
          if (
            disposed ||
            selectedRef.current !== thread ||
            payload.eventType === "DELETE"
          )
            return;
          const changed = payload.new as Reaction;
          reactionChanged.current.set(
            reactionKey(changed),
            ++reactionRevision.current,
          );
          setReactions((current) => [
            ...current.filter(
              (row) =>
                !(
                  row.message_id === changed.message_id &&
                  row.user_id === changed.user_id &&
                  row.emoji === changed.emoji
                ),
            ),
            ...(changed.active ? [changed] : []),
          ]);
        },
      )
      .subscribe((status) => {
        if (!disposed && status === "SUBSCRIBED") void fetchRecent(thread);
      });
    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
  }, [selected, org, userId, fetchRecent, refreshInbox]);
  useEffect(() => {
    const last =
      visibleMessage?.thread === selected
        ? messages.find((m) => m.id === visibleMessage.id && !m.local_status)
        : undefined;
    if (
      !selected ||
      !last ||
      document.visibilityState !== "visible" ||
      readBoundary.current === last.id
    )
      return;
    const thread = selected;
    const timer = setTimeout(() => {
      void chatRpc("vihem_chat_read", { thread, through_message: last.id })
        .then(() => {
          if (selectedRef.current === thread) {
            readBoundary.current = last.id;
            void refreshInbox();
            window.dispatchEvent(new Event("vihem-chat-unread"));
          }
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [messages, selected, visibleMessage, refreshInbox]);
  async function older() {
    if (!selected || loadingMessages) return;
    const first = messages.find((m) => !m.local_status);
    if (!first) return;
    const thread = selected;
    setLoadingMessages(true);
    try {
      const data = await chatRpc<CommunicationMessage[]>("vihem_chat_history", {
        thread,
        before_time: first.created_at,
        before_id: first.id,
        batch: 51,
      });
      if (selectedRef.current === thread) {
        setMessages((current) => mergeChatMessages(current, data.slice(0, 50)));
        setHasOlder(data.length > 50);
        await fetchReactions(
          thread,
          data.slice(0, 50).map((row) => row.id),
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (selectedRef.current === thread) setLoadingMessages(false);
    }
  }
  const seek = useCallback(
    async (id: string) => {
      const thread = selectedRef.current;
      if (!thread || messagesRef.current.some((m) => m.id === id)) return;
      const { data: target, error: failure } = await supabase
        .from("vihem_chat_messages")
        .select("id,created_at")
        .eq("thread_id", thread)
        .eq("id", id)
        .maybeSingle();
      if (failure || !target) {
        setError("Det ursprungliga meddelandet är inte tillgängligt.");
        return;
      }
      let first = messagesRef.current.find((m) => !m.local_status);
      if (!first) return;
      setLoadingMessages(true);
      try {
        while (selectedRef.current === thread && first) {
          const data: CommunicationMessage[] = await chatRpc<
            CommunicationMessage[]
          >("vihem_chat_history", {
            thread,
            before_time: first.created_at,
            before_id: first.id,
            batch: 100,
          });
          if (selectedRef.current !== thread) return;
          setMessages((current) => mergeChatMessages(current, data));
          await fetchReactions(
            thread,
            data.map((row) => row.id),
          );
          if (data.some((m) => m.id === id) || data.length < 100) {
            setHasOlder(data.length === 100);
            break;
          }
          first = data[data.length - 1];
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        if (selectedRef.current === thread) setLoadingMessages(false);
      }
    },
    [fetchReactions],
  );
  function storeOutbox(
    thread: string,
    row: CommunicationMessage | null,
    id: string,
  ) {
    const rows = readLocal<CommunicationMessage[]>(
      key(thread) + ":outbox",
      [],
    ).filter((m) => m.id !== id);
    if (row) rows.push(row);
    writeLocal(key(thread) + ":outbox", rows);
  }
  async function deliver(row: CommunicationMessage) {
    if (sending.current.has(row.id)) return;
    sending.current.add(row.id);
    const pending = {
      ...row,
      local_status: "sending" as const,
      local_error: undefined,
    };
    storeOutbox(row.thread_id, pending, row.id);
    if (selectedRef.current === row.thread_id)
      setMessages((current) => mergeChatMessages(current, [pending]));
    try {
      const saved = await chatRpc<CommunicationMessage>("vihem_chat_send", {
        thread: row.thread_id,
        client_id: row.id,
        body: row.message,
        reply: row.reply_to,
        file_path: row.attachment_path,
        file_name: row.attachment_name,
        file_mime: row.attachment_mime,
        file_size: row.attachment_size,
        duration: row.audio_duration,
        mention_ids: row.mentions,
        order_link: row.linked_work_order_id,
        project_link: row.linked_project_id,
        forward_id: row.forwarded_from,
      });
      storeOutbox(row.thread_id, null, row.id);
      if (selectedRef.current === row.thread_id)
        setMessages((current) => mergeChatMessages(current, [saved]));
      void refreshInbox();
    } catch (err) {
      const acknowledged = confirmed.current.get(row.id);
      if (acknowledged) {
        storeOutbox(row.thread_id, null, row.id);
        if (selectedRef.current === row.thread_id)
          setMessages((current) => mergeChatMessages(current, [acknowledged]));
        return;
      }
      const failed = {
        ...row,
        local_status: "failed" as const,
        local_error: navigator.onLine
          ? (err as Error).message
          : "Ingen anslutning. Försök igen när du är online.",
      };
      storeOutbox(row.thread_id, failed, row.id);
      if (selectedRef.current === row.thread_id)
        setMessages((current) => mergeChatMessages(current, [failed]));
    } finally {
      sending.current.delete(row.id);
      confirmed.current.delete(row.id);
    }
  }
  function send(extra: Partial<CommunicationMessage> = {}) {
    if (
      !selected ||
      (!draft.trim() &&
        !extra.attachment_path &&
        !extra.linked_work_order_id &&
        !extra.linked_project_id)
    )
      return;
    const signature = JSON.stringify([selected, draft, extra]);
    if (
      lastSubmission.current.signature === signature &&
      Date.now() - lastSubmission.current.time < 750
    )
      return;
    lastSubmission.current = { signature, time: Date.now() };
    const row: CommunicationMessage = {
      id: crypto.randomUUID(),
      thread_id: selected,
      sender_id: userId,
      message: draft.trim(),
      created_at: new Date().toISOString(),
      reply_to: null,
      edited_at: null,
      deleted_at: null,
      attachment_path: null,
      attachment_url: null,
      attachment_name: null,
      attachment_mime: null,
      attachment_type: null,
      attachment_size: null,
      audio_duration: null,
      mentions: [],
      linked_work_order_id: null,
      linked_project_id: null,
      forwarded_from: null,
      ...extra,
    };
    setDraft("");
    void deliver(row);
  }
  function forward(thread: string, source: CommunicationMessage) {
    const row: CommunicationMessage = {
      ...source,
      id: crypto.randomUUID(),
      thread_id: thread,
      sender_id: userId,
      created_at: new Date().toISOString(),
      reply_to: null,
      attachment_url: null,
      attachment_path: null,
      attachment_type: null,
      attachment_name: null,
      attachment_mime: null,
      attachment_size: null,
      audio_duration: null,
      mentions: [],
      edited_at: null,
      deleted_at: null,
      linked_work_order_id: null,
      linked_project_id: null,
      forwarded_from: source.id,
    };
    setSelected(thread);
    void deliver(row);
  }
  async function moreThreads() {
    if (loadingMoreThreads.current) return;
    loadingMoreThreads.current = true;
    const requestedQuery = queryRef.current,
      requestedFilter = filterRef.current,
      epoch = inboxEpoch.current;
    try {
      const next = await chatRpc<Conversation[]>("vihem_chat_inbox", {
        query: queryRef.current,
        filter_value: filterRef.current,
        batch: 101,
        offset_rows: threadsRef.current.length,
      });
      if (
        epoch !== inboxEpoch.current ||
        requestedQuery !== queryRef.current ||
        requestedFilter !== filterRef.current
      )
        return;
      setThreads((current) => [
        ...new Map(
          [...current, ...next.slice(0, 100)].map((t) => [t.id, t]),
        ).values(),
      ]);
      setHasThreads(next.length > 100);
    } catch (err) {
      if (epoch === inboxEpoch.current) setError((err as Error).message);
    } finally {
      loadingMoreThreads.current = false;
    }
  }
  return {
    forward,
    seek,
    reportVisible,
    current,
    threads,
    selected,
    setSelected,
    messages,
    reactions,
    query,
    setQuery,
    filter,
    setFilter,
    loading,
    loadingMessages,
    hasOlder,
    older,
    hasThreads,
    moreThreads: () => void moreThreads(),
    error,
    setError,
    connection,
    online,
    draft,
    setDraft,
    send,
    retry: deliver,
    refreshInbox,
    refresh: () => selected && fetchRecent(selected),
  };
}
