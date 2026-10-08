import { useEffect, useRef, useState } from "react";
import { Mic, Paperclip, Send, Square, X } from "lucide-react";
import { Button } from "../ui";
import { CommunicationMessage } from "../../lib/chat";
export function ChatComposer({
  text,
  setText,
  disabled,
  hasAttachment,
  reply,
  clearReply,
  send,
  attach,
  onTyping,
  members,
  onMention,
}: {
  text: string;
  setText: (text: string) => void;
  disabled: boolean;
  hasAttachment: boolean;
  reply: CommunicationMessage | null;
  clearReply: () => void;
  send: () => void;
  attach: (file: File, duration?: number) => Promise<void>;
  onTyping: () => void;
  members: { user_id: string; name: string }[];
  onMention: (id: string) => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null),
    file = useRef<HTMLInputElement>(null),
    recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    start = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout>>();
  const [recording, setRecording] = useState(false),
    [error, setError] = useState(""),
    [seconds, setSeconds] = useState(0),
    [uploading, setUploading] = useState(false);
  useEffect(() => {
    const node = textarea.current;
    if (node) {
      node.style.height = "auto";
      node.style.height = Math.min(node.scrollHeight, 140) + "px";
    }
  }, [text]);
  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(
      () => setSeconds(Math.round((Date.now() - start.current) / 1000)),
      500,
    );
    return () => clearInterval(interval);
  }, [recording]);
  useEffect(
    () => () => {
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state === "recording") recorder.current.stop();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
      clearTimeout(timer.current);
    },
    [],
  );
  async function upload(value: File, duration?: number) {
    setUploading(true);
    setError("");
    try {
      await attach(value, duration);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function voice() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error("Röstinspelning stöds inte i den här appversionen.");
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const mime = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      recorder.current = new MediaRecorder(
        stream.current,
        mime ? { mimeType: mime } : {},
      );
      const chunks: Blob[] = [];
      recorder.current.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.current.onstop = () => {
        const duration = Math.min(300, (Date.now() - start.current) / 1000);
        const type = (recorder.current?.mimeType || "audio/webm").split(";")[0];
        stream.current?.getTracks().forEach((track) => track.stop());
        setRecording(false);
        clearTimeout(timer.current);
        const blob = new Blob(chunks, { type });
        if (blob.size)
          void upload(
            new File(
              [blob],
              `Röstmeddelande.${type === "audio/mp4" ? "m4a" : type === "audio/ogg" ? "ogg" : "webm"}`,
              { type },
            ),
            duration,
          );
      };
      start.current = Date.now();
      setSeconds(0);
      setRecording(true);
      recorder.current.start();
      timer.current = setTimeout(() => recorder.current?.stop(), 300000);
    } catch (err) {
      stream.current?.getTracks().forEach((track) => track.stop());
      setError((err as Error).message || "Mikrofonåtkomst nekades.");
    }
  }
  const mentionQuery = text.match(/(?:^|\s)@([^@\n]*)$/)?.[1];
  const matches =
    mentionQuery === undefined
      ? []
      : members
          .filter((member) =>
            member.name.toLowerCase().includes(mentionQuery.toLowerCase()),
          )
          .slice(0, 8);
  return (
    <div
      className="shrink-0 border-t bg-white px-3 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!disabled && e.dataTransfer.files[0])
          void upload(e.dataTransfer.files[0]);
      }}
    >
      {reply && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border-l-4 border-blue-500 bg-blue-50 p-2 text-xs">
          <span className="min-w-0 flex-1 truncate">
            Svarar på: {reply.message || reply.attachment_name}
          </span>
          <button aria-label="Avbryt svar" onClick={clearReply}>
            <X size={16} />
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="pb-2 text-sm text-red-600">
          {error}
        </p>
      )}
      {recording && (
        <div className="flex items-center justify-between pb-2 text-sm text-red-600">
          <p role="status">Spelar in · {seconds}s</p>
          <button
            type="button"
            className="min-h-11 px-2 underline"
            onClick={() => {
              if (recorder.current) {
                recorder.current.onstop = null;
                recorder.current.stop();
              }
              stream.current?.getTracks().forEach((track) => track.stop());
              clearTimeout(timer.current);
              setRecording(false);
            }}
          >
            Avbryt inspelning
          </button>
        </div>
      )}
      {!!matches.length && (
        <div
          className="mb-2 max-h-40 overflow-y-auto rounded-xl border bg-white shadow-sm"
          role="listbox"
          aria-label="Omnämn deltagare"
        >
          {matches.map((member) => (
            <button
              key={member.user_id}
              type="button"
              role="option"
              aria-selected="false"
              className="block w-full p-3 text-left text-sm hover:bg-blue-50"
              onClick={() => {
                setText(
                  text.slice(0, text.lastIndexOf("@")) +
                    "@" +
                    member.name +
                    " ",
                );
                onMention(member.user_id);
                textarea.current?.focus();
              }}
            >
              {member.name}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled && !uploading && !recording) send();
        }}
      >
        <input
          ref={file}
          hidden
          type="file"
          onChange={(e) => {
            const value = e.target.files?.[0];
            e.target.value = "";
            if (value) void upload(value);
          }}
        />
        <button
          type="button"
          aria-label="Bifoga fil"
          disabled={disabled || uploading || recording}
          onClick={() => file.current?.click()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-vihem-blue disabled:opacity-40"
        >
          <Paperclip size={22} />
        </button>
        <textarea
          ref={textarea}
          aria-label="Meddelande"
          rows={1}
          maxLength={10000}
          value={text}
          disabled={disabled || recording}
          placeholder={
            disabled ? "Konversationen är stängd" : "Skriv ett meddelande…"
          }
          onChange={(e) => {
            setText(e.target.value);
            onTyping();
          }}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              window.matchMedia("(hover:hover)").matches
            ) {
              e.preventDefault();
              if (!disabled && !uploading && !recording) send();
            }
          }}
          className="max-h-36 min-h-11 min-w-0 flex-1 resize-none rounded-3xl bg-slate-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          aria-label={
            recording ? "Stoppa inspelning" : "Spela in röstmeddelande"
          }
          disabled={disabled || uploading}
          onClick={() => void voice()}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${recording ? "bg-red-100 text-red-600" : "text-slate-500"}`}
        >
          {recording ? <Square size={20} /> : <Mic size={22} />}
        </button>
        <Button
          type="submit"
          aria-label="Skicka meddelande"
          disabled={
            disabled ||
            (!text.trim() && !hasAttachment) ||
            uploading ||
            recording
          }
          className="h-11 w-11 shrink-0 rounded-full !p-0"
        >
          <Send size={20} />
        </Button>
      </form>
      {uploading && (
        <p role="status" className="pt-1 text-xs text-slate-500">
          Laddar upp bilaga…
        </p>
      )}
    </div>
  );
}
