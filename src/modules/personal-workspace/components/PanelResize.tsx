import React, { useRef } from "react";
export function PanelResize({ panel }: { panel: "sidebar" | "list" }) {
  const origin = useRef<{ x: number; w: number; root: HTMLElement } | null>(
    null,
  );
  const variable =
    panel === "sidebar" ? "--pw-sidebar-width" : "--pw-list-width";
  const min = panel === "sidebar" ? 170 : 230,
    max = panel === "sidebar" ? 300 : 420;
  function apply(root: HTMLElement, value: number) {
    root.style.setProperty(
      variable,
      `${Math.max(min, Math.min(max, value))}px`,
    );
  }
  return (
    <button
      type="button"
      role="separator"
      aria-orientation="vertical"
      aria-label={
        panel === "sidebar"
          ? "Bredd på biblioteket"
          : "Bredd på anteckningslistan"
      }
      aria-valuemin={min}
      aria-valuemax={max}
      className="pw-resizer"
      onPointerDown={(e) => {
        const root = e.currentTarget.closest(".pw-panels") as HTMLElement;
        origin.current = {
          x: e.clientX,
          w: e.currentTarget.parentElement!.getBoundingClientRect().width,
          root,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (origin.current)
          apply(
            origin.current.root,
            origin.current.w + e.clientX - origin.current.x,
          );
      }}
      onPointerUp={() => {
        origin.current = null;
      }}
      onPointerCancel={() => {
        origin.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const root = e.currentTarget.closest(".pw-panels") as HTMLElement;
          apply(
            root,
            e.currentTarget.parentElement!.getBoundingClientRect().width +
              (e.key === "ArrowRight" ? 20 : -20),
          );
        }
      }}
    />
  );
}
