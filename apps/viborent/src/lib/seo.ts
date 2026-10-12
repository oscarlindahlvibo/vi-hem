import { useEffect } from "react";

function setMeta(selector: string, attr: string, value: string, create: () => HTMLElement) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) { el = create(); document.head.appendChild(el); }
  el.setAttribute(attr, value);
}

export function useSeo({ title, description, image, jsonLd, noindex }: { title: string; description?: string; image?: string; jsonLd?: unknown; noindex?: boolean }) {
  useEffect(() => {
    document.title = title;
    const mk = (name: string, prop = false) => () => { const m = document.createElement("meta"); m.setAttribute(prop ? "property" : "name", name); return m; };
    if (description) {
      setMeta('meta[name="description"]', "content", description, mk("description"));
      setMeta('meta[property="og:description"]', "content", description, mk("og:description", true));
    }
    setMeta('meta[property="og:title"]', "content", title, mk("og:title", true));
    setMeta('meta[property="og:type"]', "content", "website", mk("og:type", true));
    setMeta('meta[property="og:url"]', "content", window.location.href.split("#")[0], mk("og:url", true));
    if (image) setMeta('meta[property="og:image"]', "content", image.startsWith("http") ? image : `${window.location.origin}${image}`, mk("og:image", true));
    setMeta('meta[name="robots"]', "content", noindex ? "noindex,nofollow" : "index,follow", mk("robots"));
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.appendChild(link); }
    link.href = `${window.location.origin}${window.location.pathname}`;
    let script = document.getElementById("jsonld") as HTMLScriptElement | null;
    if (jsonLd) {
      if (!script) { script = document.createElement("script"); script.id = "jsonld"; script.type = "application/ld+json"; document.head.appendChild(script); }
      script.textContent = JSON.stringify(jsonLd);
    } else script?.remove();
  }, [title, description, image, noindex, JSON.stringify(jsonLd ?? null)]);
}
