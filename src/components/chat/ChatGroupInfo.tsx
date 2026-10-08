import { Button, Input, Modal } from "../ui";
import { chatRpc, Conversation } from "../../lib/chat";
import { uploadChatFile } from "../../lib/chatMedia";
import type { useChatActivity } from "../../hooks/useChatActivity";
type Props = {
  open: boolean;
  onClose: () => void;
  onLeave: () => void;
  current: Conversation | null;
  ownGroup: boolean;
  busy: boolean;
  activity: ReturnType<typeof useChatActivity>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  groupTitle: string;
  setGroupTitle: (title: string) => void;
  user: { id: string };
  people: { id: string; name: string; role: string }[];
};
export function ChatGroupInfo({
  open,
  onClose,
  onLeave,
  current,
  ownGroup,
  busy,
  activity,
  run,
  groupTitle,
  setGroupTitle,
  user,
  people,
}: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Konversationsinformation">
      {current && (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={activity.muteGroups}
              onChange={(e) =>
                void run(() => activity.groupsMuted(e.target.checked))
              }
            />
            Tysta notifikationer från alla gruppchattar
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={activity.showPresence}
              onChange={(e) =>
                void run(() => activity.presence(e.target.checked))
              }
            />
            Visa när jag är aktiv i chatten
          </label>
          {ownGroup && (
            <label className="block text-sm">
              Gruppbild
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file)
                    void run(async () => {
                      const uploaded = await uploadChatFile(current.id, file);
                      if (
                        !["image/jpeg", "image/png", "image/webp"].includes(
                          uploaded.mime,
                        )
                      )
                        throw new Error("Välj en bild.");
                      await chatRpc("vihem_chat_group", {
                        thread: current.id,
                        action: "image",
                        image_path: uploaded.path,
                      });
                    });
                }}
                className="mt-1 block w-full"
              />
            </label>
          )}
          {ownGroup && (
            <div className="flex gap-2">
              <Input
                value={groupTitle}
                maxLength={160}
                onChange={(e) => setGroupTitle(e.target.value)}
              />
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    chatRpc("vihem_chat_group", {
                      thread: current.id,
                      action: "rename",
                      title: groupTitle,
                    }),
                  )
                }
              >
                Byt namn
              </Button>
            </div>
          )}
          <ul className="space-y-2">
            {current.participants.map((p) => (
              <li
                key={p.user_id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span>
                  {p.name}
                  {p.user_id === user.id ? " (du)" : ""}
                </span>
                {ownGroup && p.user_id !== user.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        chatRpc("vihem_chat_group", {
                          thread: current.id,
                          action: "remove",
                          target_user: p.user_id,
                        }),
                      )
                    }
                  >
                    Ta bort
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {ownGroup && (
            <label className="block text-sm">
              Lägg till deltagare
              <select
                value=""
                disabled={busy}
                className="mt-1 w-full rounded-lg border p-3"
                onChange={(e) =>
                  void run(() =>
                    chatRpc("vihem_chat_group", {
                      thread: current.id,
                      action: "add",
                      target_user: e.target.value,
                    }),
                  )
                }
              >
                <option value="">Välj person</option>
                {people
                  .filter(
                    (p) =>
                      !current.participants.some(
                        (member) => member.user_id === p.id,
                      ),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {current.chat_type === "group" && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Lämna gruppen?"))
                  void run(async () => {
                    await chatRpc("vihem_chat_group", {
                      thread: current.id,
                      action: "leave",
                    });
                    onClose();
                    onLeave();
                  });
              }}
            >
              Lämna grupp
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}
