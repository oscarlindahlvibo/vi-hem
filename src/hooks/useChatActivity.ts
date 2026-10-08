import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { chatRpc } from "../lib/chat";
export function useChatActivity(thread: string | null, userId: string) {
  const [activity, setActivity] = useState<
      { user_id: string; typing_until: string; online_until: string }[]
    >([]),
    [showPresence, setShowPresence] = useState(true),
    [tick, setTick] = useState(Date.now());
  const [muteGroups, setMuteGroups] = useState(false);
  const throttle = useRef(0),
    stop = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    void supabase
      .from("vihem_chat_preferences")
      .select("show_presence,mute_groups")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setShowPresence(data.show_presence);
          setMuteGroups(data.mute_groups);
        }
      });
  }, [userId]);
  useEffect(() => {
    setActivity([]);
    if (!thread) return;
    let live = true;
    const fetch = () =>
      void supabase
        .from("vihem_chat_activity")
        .select("user_id,typing_until,online_until")
        .eq("thread_id", thread)
        .then(({ data }) => {
          if (live) setActivity(data || []);
        });
    const pulse = () => {
      if (document.visibilityState === "visible")
        void chatRpc("vihem_chat_activity_update", {
          thread,
          typing: false,
          online: true,
        }).catch(() => {});
    };
    const background = () => {
      if (document.visibilityState === "visible") {
        pulse();
        fetch();
      } else
        void chatRpc("vihem_chat_activity_update", {
          thread,
          typing: false,
          online: false,
        }).catch(() => {});
    };
    const channel = supabase
      .channel(`chat-activity:${thread}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "vihem_chat_activity",
          filter: `thread_id=eq.${thread}`,
        },
        fetch,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "vihem_chat_activity",
          filter: `thread_id=eq.${thread}`,
        },
        fetch,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") fetch();
      });
    fetch();
    pulse();
    const heartbeat = setInterval(pulse, 20000),
      clock = setInterval(() => setTick(Date.now()), 1000);
    document.addEventListener("visibilitychange", background);
    return () => {
      live = false;
      clearInterval(heartbeat);
      clearInterval(clock);
      clearTimeout(stop.current);
      document.removeEventListener("visibilitychange", background);
      void supabase.removeChannel(channel);
      void chatRpc("vihem_chat_activity_update", {
        thread,
        typing: false,
        online: false,
      }).catch(() => {});
    };
  }, [thread, userId]);
  function typing() {
    if (!thread) return;
    if (Date.now() - throttle.current > 2500) {
      throttle.current = Date.now();
      void chatRpc("vihem_chat_activity_update", {
        thread,
        typing: true,
        online: true,
      }).catch(() => {});
    }
    clearTimeout(stop.current);
    stop.current = setTimeout(
      () =>
        void chatRpc("vihem_chat_activity_update", {
          thread,
          typing: false,
          online: true,
        }).catch(() => {}),
      5000,
    );
  }
  async function presence(value: boolean) {
    if (!thread) return;
    await chatRpc("vihem_chat_activity_update", {
      thread,
      typing: false,
      online: true,
      show_presence: value,
    });
    setShowPresence(value);
  }
  async function groupsMuted(value: boolean) {
    await chatRpc("vihem_chat_preferences_save", { mute_groups_value: value });
    setMuteGroups(value);
  }
  function stopTyping() {
    clearTimeout(stop.current);
    if (thread)
      void chatRpc("vihem_chat_activity_update", {
        thread,
        typing: false,
        online: true,
      }).catch(() => {});
  }
  return {
    groupsMuted,
    muteGroups,
    stopTyping,
    typing,
    presence,
    showPresence,
    typingUsers: activity
      .filter((a) => a.user_id !== userId && Date.parse(a.typing_until) > tick)
      .map((a) => a.user_id),
    onlineUsers: activity
      .filter((a) => a.user_id !== userId && Date.parse(a.online_until) > tick)
      .map((a) => a.user_id),
  };
}
