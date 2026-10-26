import { useLayoutEffect, useRef } from "react";
import { scrollAppTo } from "../../../lib/utils";

/** Keep the app shell fixed; each workspace panel owns its scrolling. */
export function useWorkspaceViewport() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const html = document.documentElement;
    const previous = html.getAttribute("data-workspace-viewport");
    scrollAppTo(0);
    html.setAttribute("data-workspace-viewport", "true");
    let frame = 0;
    const measure = () => {
      frame = 0;
      const viewport = window.visualViewport;
      let bottom = viewport
        ? viewport.offsetTop + viewport.height
        : window.innerHeight;
      const nav = document.querySelector<HTMLElement>(".vihem-floating-nav");
      if (nav) {
        const style = getComputedStyle(nav);
        const bounds = nav.getBoundingClientRect();
        if (style.display !== "none" && style.visibility !== "hidden" && bounds.height > 0)
          bottom = Math.min(bottom, bounds.top);
      }
      element.style.setProperty(
        "--pw-available-height",
        Math.max(0, bottom - element.getBoundingClientRect().top - 12) + "px",
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    const nav = document.querySelector(".vihem-floating-nav");
    if (nav) observer.observe(nav);
    if (element.parentElement) observer.observe(element.parentElement);
    const attributes = new MutationObserver(schedule);
    attributes.observe(html, {
      attributes: true,
      attributeFilter: ["data-workspace-writing", "data-overlay-open"],
    });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    measure();
    return () => {
      observer.disconnect();
      attributes.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      if (previous === null) html.removeAttribute("data-workspace-viewport");
      else html.setAttribute("data-workspace-viewport", previous);
    };
  }, []);
  return ref;
}
