export interface ChatMember {
  user_id: string;
  name: string;
  role: string;
  last_read_at: string | null;
  left_at: string | null;
}
export interface Conversation {
  id: string;
  subject: string;
  chat_type: "direct" | "group" | "tenant_support";
  organisation_id: string;
  status: string;
  created_by: string;
  tenant_id: string | null;
  property_id: string | null;
  project_id: string | null;
  work_order_id: string | null;
  last_message_at: string;
  archived: boolean;
  pinned: boolean;
  manual_unread: boolean;
  unread_count: number;
  notification_mode: string;
  group_image_path: string | null;
  participants: ChatMember[];
  search_excerpt: string | null;
  latest: {
    id: string;
    message: string;
    sender_id: string;
    attachment_name: string | null;
    created_at: string;
  } | null;
}
export interface CommunicationMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  message: string;
  created_at: string;
  reply_to: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  attachment_path: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
  audio_duration: number | null;
  mentions: string[];
  linked_work_order_id: string | null;
  linked_project_id: string | null;
  forwarded_from: string | null;
  local_status?: "sending" | "failed";
  local_error?: string;
}
export interface Reaction {
  message_id: string;
  thread_id: string;
  user_id: string;
  emoji: string;
  active: boolean;
}
export function mergeChatMessages(
  current: CommunicationMessage[],
  incoming: CommunicationMessage[],
) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(
    (a, b) =>
      Date.parse(a.created_at) - Date.parse(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}
export function chatTitle(
  thread: Conversation,
  userId: string,
  tenant: boolean,
) {
  if (thread.chat_type === "group") return thread.subject;
  if (thread.chat_type === "tenant_support" && tenant)
    return "Fastighetskontoret";
  return (
    thread.participants.find(
      (p) =>
        p.user_id !== userId &&
        (thread.chat_type !== "tenant_support" || p.role === "tenant"),
    )?.name ||
    thread.subject ||
    "Konversation"
  );
}
export function messageReceipt(
  message: CommunicationMessage,
  members: ChatMember[],
) {
  return members.filter(
    (p) =>
      p.user_id !== message.sender_id &&
      p.last_read_at &&
      Date.parse(p.last_read_at) >= Date.parse(message.created_at),
  );
}
export const chatFileTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/mpeg",
  "audio/wav",
];
export const maxChatFileSize = 50 * 1024 * 1024;
export function validateChatFile(file: {
  size: number;
  type: string;
  name: string;
}) {
  if (file.size < 1 || file.size > maxChatFileSize)
    throw new Error("Bilagan får vara högst 50 MB.");
  if (!chatFileTypes.includes(file.type.split(";")[0]))
    throw new Error(
      "Filtypen stöds inte. Välj bild, video, ljud, PDF, Word, Excel eller text.",
    );
  if (file.name.length > 240) throw new Error("Filnamnet är för långt.");
}
export function draftKey(org: string, user: string, thread: string) {
  return `vihem-chat:${org}:${user}:${thread}`;
}
export function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage can be unavailable or full. */
  }
}
