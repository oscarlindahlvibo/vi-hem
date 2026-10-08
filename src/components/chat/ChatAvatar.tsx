import { useEffect, useState } from "react";
import { Avatar } from "../ui";
import { supabase } from "../../lib/supabase";
export function ChatAvatar({
  name,
  path,
}: {
  name: string;
  path?: string | null;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    if (!path) return;
    let active = true,
      object = "";
    void supabase.storage
      .from("vihem-chat-private")
      .download(path)
      .then(({ data, error }) => {
        if (!active || error || !data) return;
        object = URL.createObjectURL(data);
        setUrl(object);
      });
    return () => {
      active = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [path]);
  return url ? (
    <img
      src={url}
      alt={name}
      className="h-10 w-10 shrink-0 rounded-full object-cover"
      onError={() => setUrl("")}
    />
  ) : (
    <Avatar name={name} />
  );
}
