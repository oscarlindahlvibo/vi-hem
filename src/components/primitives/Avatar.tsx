import { useEffect, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { getAvatarPhoto } from "../../lib/avatarPhotos";
import { supabaseUrl } from "../../lib/supabase";
export function Avatar({
  name,
  size = "md",
  className = "",
  userId,
  src,
}: {
  name?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  userId?: string | null;
  src?: string | null;
}) {
  const { user } = useAuth();
  const [photo, setPhoto] = useState({identity:"",url:""}),
    [revision, setRevision] = useState(0);
  const scope = user?.id + ":" + user?.organisation_id;
  const identity = scope + ":" + userId;
  useEffect(() => {
    const update = () => setRevision((n) => n + 1);
    window.addEventListener("vihem-avatar-changed", update);
    const timer = window.setInterval(update, 300000);
    return () => {
      window.removeEventListener("vihem-avatar-changed", update);
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (userId && user?.id)
      void getAvatarPhoto(scope, userId)
        .then((url) => {
          if (active) setPhoto({identity,url});
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [userId, scope, user?.id, revision, identity]);
  let legacy = "";
  try {
    if (
      src &&
      new URL(src).origin === new URL(supabaseUrl).origin &&
      new URL(src).protocol === "https:"
    )
      legacy = src;
  } catch {
    /* Fall back to initials, never load untrusted third-party URLs. */
  }
  const [failed, setFailed] = useState("");
  const url = (photo.identity === identity ? photo.url : "") || legacy;
  const initials =
    (name || "?")
      .trim()
      .split(/\s+/)
      .filter(word=>/[\p{L}\p{N}]/u.test(word))
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || "")
      .join("") || "?";
  const dims = {
    xs: "h-6 w-6 text-[11px]",
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-14 w-14 text-lg",
    xl: "h-24 w-24 text-2xl",
  }[size];
  return (
    <span
      title={name || undefined}
      className={`vihem-avatar inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ${dims} ${className}`}
    >
      {url && failed !== url ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(url)}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}
