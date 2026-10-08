import { useEffect, useState } from "react";
import {
  CommunicationMessage,
  draftKey,
  readLocal,
  writeLocal,
} from "../lib/chat";
type Extras = {
  reply: CommunicationMessage | null;
  attachment: Partial<CommunicationMessage> | null;
  link: Partial<CommunicationMessage> | null;
  mentionIds: string[];
};
const empty = (): Extras => ({
  reply: null,
  attachment: null,
  link: null,
  mentionIds: [],
});
export function useChatComposerDraft(
  org: string,
  user: string,
  thread: string | null,
) {
  const [state, setState] = useState<{ thread: string | null; data: Extras }>({
    thread: null,
    data: empty(),
  });
  useEffect(() => {
    setState({
      thread,
      data: thread
        ? readLocal(draftKey(org, user, thread) + ":composer", empty())
        : empty(),
    });
  }, [org, user, thread]);
  useEffect(() => {
    if (state.thread && state.thread === thread)
      writeLocal(draftKey(org, user, thread) + ":composer", state.data);
  }, [state, org, user, thread]);
  const data = state.thread === thread ? state.data : empty();
  function setter<K extends keyof Extras>(field: K) {
    return (value: Extras[K] | ((before: Extras[K]) => Extras[K])) =>
      setState((before) => {
        const current = before.thread === thread ? before.data : empty();
        return {
          thread,
          data: {
            ...current,
            [field]:
              typeof value === "function"
                ? (value as (before: Extras[K]) => Extras[K])(current[field])
                : value,
          },
        };
      });
  }
  return {
    ...data,
    setReply: setter("reply"),
    setAttachment: setter("attachment"),
    setLink: setter("link"),
    setMentionIds: setter("mentionIds"),
  };
}
