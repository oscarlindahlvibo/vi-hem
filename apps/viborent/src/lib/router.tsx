import React, { useEffect, useState } from "react";

// Minimal router: riktiga länkar (<a href>) som hanteras utan sidladdning. Fungerar med SPA-fallback i nginx.
const listeners = new Set<() => void>();
const current = () => window.location.pathname + window.location.search;

export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (to === current()) { window.scrollTo(0, 0); return; }
  if (options.replace) window.history.replaceState({}, "", to); else window.history.pushState({}, "", to);
  listeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

export function useLocation() {
  const [loc, setLoc] = useState(current);
  useEffect(() => {
    const update = () => setLoc(current());
    window.addEventListener("popstate", update);
    listeners.add(update);
    return () => { window.removeEventListener("popstate", update); listeners.delete(update); };
  }, []);
  const [path, search = ""] = loc.split("?");
  return { path, search: new URLSearchParams(search) };
}

export function Link({ to, children, onClick, ...rest }: { to: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || rest.target === "_blank") return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
