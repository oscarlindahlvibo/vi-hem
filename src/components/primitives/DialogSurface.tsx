import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type Entry = { panel: HTMLElement; layer: HTMLElement; close: () => void };
const stack: Entry[] = [];
const background = new Map<
  HTMLElement,
  { inert: boolean; hidden: string | null }
>();
const focusable = (panel: HTMLElement) =>
  Array.from(
    panel.querySelectorAll<HTMLElement>(
      "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]",
    ),
  ).filter(
    (node) =>
      node.tabIndex >= 0 &&
      node.getClientRects().length &&
      !node.closest("[inert]"),
  );
function syncLayers() {
  const active = stack[stack.length - 1];
  for (const node of Array.from(document.body.children)) {
    if (!(node instanceof HTMLElement)) continue;
    if (!background.has(node))
      background.set(node, {
        inert: node.inert,
        hidden: node.getAttribute("aria-hidden"),
      });
    const enabled = node === active?.layer;
    node.inert = !enabled;
    if (enabled) node.removeAttribute("aria-hidden");
    else node.setAttribute("aria-hidden", "true");
  }
}
function restoreBackground() {
  for (const [node, before] of background) {
    node.inert = before.inert;
    if (before.hidden === null) node.removeAttribute("aria-hidden");
    else node.setAttribute("aria-hidden", before.hidden);
  }
  background.clear();
}

/** One dialog contract, including nested confirmation sheets. */
export function DialogSurface({
  title,
  children,
  footer,
  toolbar,
  onClose,
  size,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  toolbar?: ReactNode;
  onClose: () => void;
  size: "sm" | "md" | "lg" | "xl" | "xxl" | "fullscreen";
}) {
  const id = useId(),
    panel = useRef<HTMLDivElement>(null),
    layer = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const element = panel.current,
      container = layer.current;
    if (!element || !container) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const entry = {
      panel: element,
      layer: container,
      close: () => close.current(),
    };
    stack.push(entry);
    element.focus({ preventScroll: true });
    syncLayers();
    const observer = new MutationObserver(syncLayers);
    observer.observe(document.body, { childList: true });
    const key = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== entry) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        entry.close();
      }
      if (event.key === "Tab") {
        const targets = focusable(element),
          first = targets[0],
          last = targets[targets.length - 1];
        if (!first) {
          event.preventDefault();
          element.focus();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === element)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === element)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const focus = (event: FocusEvent) => {
      if (
        stack[stack.length - 1] === entry &&
        !element.contains(event.target as Node)
      )
        element.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", key);
    document.addEventListener("focusin", focus);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", key);
      document.removeEventListener("focusin", focus);
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      if (stack.length) syncLayers();
      else restoreBackground();
      if (previous?.isConnected && !previous.closest("[inert]"))
        previous.focus({ preventScroll: true });
      else stack[stack.length - 1]?.panel.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div ref={layer} data-vihem-dialog-layer className="vihem-dialog-layer">
      <div
        className="vihem-dialog-backdrop"
        aria-hidden="true"
        onClick={() => {
          if (stack[stack.length - 1]?.layer === layer.current) close.current();
        }}
      />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`vihem-dialog vihem-dialog-${size}`}
      >
        <div className="vihem-dialog-handle" aria-hidden="true" />
        <header className="vihem-dialog-header">
          <h2 id={id}>{title}</h2>
          <button
            type="button"
            aria-label="Stäng dialog"
            className="vihem-icon-button"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {toolbar && <div className="vihem-dialog-toolbar">{toolbar}</div>}
        <div className="vihem-dialog-body">{children}</div>
        {footer && <footer className="vihem-dialog-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
