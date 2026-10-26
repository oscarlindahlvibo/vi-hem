import React, {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { InkPaper } from "../handwriting/InkPaper";
import { paperSettings } from "../handwriting/paper";
export const InkPortalHost = createContext<HTMLDivElement | null>(null);
function InkView({ node, updateAttributes, editor }: NodeViewProps) {
  const host = useContext(InkPortalHost),
    anchor = useRef<HTMLDivElement>(null),
    instance = useId();
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!host || !anchor.current) return;
    const el = document.createElement("div");
    el.className = "pw-ink-overlay";
    el.dataset.inkOverlay = instance;
    host.append(el);
    let frame = 0,
      disposed = false;
    const position = () => {
      frame = 0;
      if (disposed || !anchor.current) return;
      const a = anchor.current,
        r = a.getBoundingClientRect(),
        h = host.getBoundingClientRect(),
        sx = h.width / (host.offsetWidth || 1) || 1,
        sy = h.height / (host.offsetHeight || 1) || 1;
      el.style.left = (r.left - h.left) / sx + "px";
      el.style.top = (r.top - h.top) / sy + "px";
      el.style.width = r.width / sx + "px";
      const height = el.offsetHeight;
      if (height && Math.abs(a.offsetHeight - height) > 1)
        a.style.height = height + "px";
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(position);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    if (host.parentElement) observer.observe(host.parentElement);
    editor.on("transaction", schedule);
    window.addEventListener("resize", schedule);
    position();
    setPortal(el);
    schedule();
    return () => {
      disposed = true;
      observer.disconnect();
      editor.off("transaction", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
      el.remove();
    };
  }, [host, editor, instance]);
  return (
    <>
      <NodeViewWrapper
        ref={anchor}
        data-ink-slot={instance}
        data-ink-page={node.attrs.pageId}
        contentEditable={false}
        className="pw-ink-slot"
        aria-label="Handskriven sida"
      />
      {portal &&
        createPortal(
          <InkPaper
            pageId={node.attrs.pageId}
            settings={paperSettings(node.attrs)}
            setSettings={(attrs) => updateAttributes(attrs)}
          />,
          portal,
        )}
    </>
  );
}
export const Ink = Node.create({
  name: "ink",
  group: "block",
  atom: true,
  draggable: false,
  addAttributes() {
    return {
      pageId: { default: null },
      paper: { default: "lined" },
      spacing: {
        default: null,
        parseHTML: (el) => Number(el.getAttribute("spacing")) || null,
      },
      lineColor: { default: null },
      lineOpacity: {
        default: null,
        parseHTML: (el) =>
          el.hasAttribute("lineopacity")
            ? Number(el.getAttribute("lineopacity"))
            : null,
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-ink]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-ink": "true" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(InkView, {
      stopEvent: () => true,
      ignoreMutation: () => true,
    });
  },
});
