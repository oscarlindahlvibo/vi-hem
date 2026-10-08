import { useEffect, useRef, useState } from "react";
import { Download, FileText, X, ZoomIn, ZoomOut } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { CommunicationMessage } from "../../lib/chat";

export function ChatAttachment({ message }: { message: CommunicationMessage }) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [zoom, setZoom] = useState(1),
    [visible, setVisible] = useState(false),
    [playing, setPlaying] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "240px" },
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const loadFile = visible || open || playing;
  useEffect(() => {
    if (
      !loadFile ||
      message.deleted_at ||
      (!message.attachment_path && !message.attachment_url)
    )
      return;
    let live = true,
      objectUrl = "";
    async function load() {
      let bucket = "vihem-chat-private",
        path = message.attachment_path;
      if (!path && message.attachment_url) {
        // Never follow arbitrary legacy URLs or load public files directly.
        const parsed = new URL(message.attachment_url);
        const base = new URL(import.meta.env.VITE_SUPABASE_URL);
        const prefix = "/storage/v1/object/public/vihem-chat-attachments/";
        if (
          parsed.origin !== base.origin ||
          !parsed.pathname.startsWith(prefix)
        )
          throw new Error("Bilagans adress stöds inte.");
        bucket = "vihem-chat-attachments";
        path = decodeURIComponent(parsed.pathname.slice(prefix.length));
      }
      if (!path) throw new Error("Bilagan saknas.");
      const { data, error } = await supabase.storage
        .from(bucket)
        .download(path);
      if (error || !data)
        throw new Error(
          "Bilagan kunde inte hämtas eller åtkomsten har ändrats.",
        );
      objectUrl = URL.createObjectURL(data);
      if (live) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }
    void load().catch((err) => {
      if (live) setError(err.message);
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl("");
    };
  }, [
    loadFile,
    message.id,
    message.attachment_path,
    message.attachment_url,
    message.deleted_at,
  ]);
  if (
    message.deleted_at ||
    (!message.attachment_path && !message.attachment_url)
  )
    return null;
  if (error && !url)
    return (
      <div ref={container} role="alert" className="text-xs">
        {error}
      </div>
    );
  if (!url)
    return (
      <div ref={container} className="min-h-20 text-xs opacity-70">
        {visible ? "Hämtar bilaga…" : message.attachment_name || "Bilaga"}
      </div>
    );
  const type = message.attachment_type;
  const download = (
    <a
      href={url}
      download={message.attachment_name || "bilaga"}
      className="mt-1 flex items-center gap-1 text-xs underline"
    >
      <Download size={14} />
      Ladda ner{" "}
      {message.attachment_size
        ? `(${(message.attachment_size / 1024 / 1024).toFixed(1)} MB)`
        : ""}
    </a>
  );
  return (
    <div ref={container} className="mb-1">
      {error ? (
        <p role="alert" className="text-xs">
          {error}
        </p>
      ) : type === "image" ? (
        <button
          onClick={() => {
            setOpen(true);
            setZoom(1);
          }}
          aria-label="Visa bild i helskärm"
        >
          <img
            src={url}
            alt={message.attachment_name || "Bifogad bild"}
            className="max-h-64 max-w-full rounded-xl object-contain"
            onError={() =>
              setError(
                "Bilden kan inte förhandsvisas på den här enheten. Du kan ladda ner den nedan.",
              )
            }
          />
        </button>
      ) : type === "audio" ? (
        <div>
          <audio
            controls
            preload="metadata"
            src={url}
            className="max-w-full"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
          {message.audio_duration && (
            <span className="text-xs">
              {Math.round(message.audio_duration)} sekunder
            </span>
          )}
        </div>
      ) : type === "video" ? (
        <video
          controls
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          preload="metadata"
          src={url}
          className="max-h-64 max-w-full rounded-lg"
        />
      ) : (
        <a
          href={url}
          download={message.attachment_name || "bilaga"}
          className="flex items-center gap-2 rounded-lg bg-black/5 p-3"
        >
          <FileText size={24} />
          <span className="break-all text-sm">
            {message.attachment_name || "Dokument"}
          </span>
        </a>
      )}
      {download}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Bildvisare"
          className="fixed inset-0 z-[80] flex flex-col bg-slate-950 text-white"
        >
          <div className="flex shrink-0 items-center justify-end gap-4 p-4 pt-[max(env(safe-area-inset-top),1rem)]">
            <button
              aria-label="Zooma ut"
              onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
            >
              <ZoomOut />
            </button>
            <button
              aria-label="Zooma in"
              onClick={() => setZoom((value) => Math.min(5, value + 0.5))}
            >
              <ZoomIn />
            </button>
            <a
              href={url}
              download={message.attachment_name || "bild"}
              aria-label="Ladda ner bild"
            >
              <Download />
            </a>
            <button
              aria-label="Stäng bildvisare"
              onClick={() => setOpen(false)}
            >
              <X />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <img
              src={url}
              alt={message.attachment_name || "Bild"}
              className="mx-auto origin-top"
              style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
