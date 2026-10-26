import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Point, Stroke } from "../types";
import { strokePath } from "./geometry";
import {
  documentPoint,
  fitCamera,
  pinchCamera,
  svgPoint,
  zoomAt,
  type Camera,
  type XY,
} from "./camera";
import { PaperBackground } from "./PaperBackground";
import { paperSettings, type PaperSettings } from "./paper";
import { InkHistory, InkInteraction, type Tool } from "./interaction";
import { InkControls, type FavoritePen } from "./InkControls";
export const InkContext = createContext<{
  noteId: string;
  strokes: Stroke[];
  change: (strokes: Stroke[]) => void;
  readOnly?: boolean;
  preferencesKey?: string;
  fullScreen?: boolean;
}>({ noteId: "", strokes: [], change: () => {} });
const RenderedStroke = React.memo(function RenderedStroke({
  value,
  selected,
}: {
  value: Stroke;
  selected: boolean;
}) {
  return (
    <path
      data-stroke-id={value.id}
      d={strokePath(value.stroke)}
      fill={value.stroke.color}
      opacity={value.stroke.tool === "highlight" ? 0.3 : 1}
      stroke={selected ? "#2563eb" : undefined}
      strokeWidth={selected ? 1 : 0}
    />
  );
});
const initialPens: FavoritePen[] = [
  { color: "#172b49", width: 3 },
  { color: "#2563eb", width: 2 },
  { color: "#dc2626", width: 3 },
];
function readPens(key?: string): FavoritePen[] {
  try {
    const pens = JSON.parse(
      localStorage.getItem("vihem-ink-pens:" + key) || "null",
    );
    if (
      key &&
      Array.isArray(pens) &&
      pens.length === 3 &&
      pens.every(
        (p) =>
          /^#[0-9a-f]{6}$/i.test(p.color) && [1, 2, 3, 5, 8].includes(p.width),
      )
    )
      return pens;
  } catch {
    /* Optional preference; never note data. */
  }
  return initialPens;
}
export function InkPaper({
  pageId,
  settings: input,
  setSettings,
}: {
  pageId: string;
  settings?: Partial<PaperSettings>;
  setSettings?: (v: Partial<PaperSettings>) => void;
}) {
  const {
    noteId,
    strokes: all,
    change,
    readOnly,
    preferencesKey,
    fullScreen,
  } = useContext(InkContext);
  const { paper, spacing, lineColor, lineOpacity } = paperSettings(input || {});
  const settings = useMemo(
    () => ({ paper, spacing, lineColor, lineOpacity }),
    [paper, spacing, lineColor, lineOpacity],
  );
  const strokes = all.filter((s) => s.page_id === pageId && !s.deleted);
  const [tool, setTool] = useState<Tool>("pen"),
    [color, setColor] = useState("#172b49"),
    [width, setWidth] = useState(3),
    [finger, setFinger] = useState(false),
    [camera, setCamera] = useState<Camera>({ x: 12, y: 12, scale: 1 }),
    [size, setSize] = useState({ w: 794, h: 500 }),
    [preview, setPreview] = useState<Stroke | null>(null),
    [erasing, setErasing] = useState<string[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [favorites, setFavorites] = useState<FavoritePen[]>(() =>
      readPens(preferencesKey),
    ),
    [, redrawHistory] = useState(0);
  const viewport = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null),
    layer = useRef<SVGGElement>(null),
    cameraRef = useRef(camera),
    sizeRef = useRef(size),
    engine = useRef(new InkInteraction()),
    history = useRef(new InkHistory()),
    writer = useRef<{ id: number; type: string } | null>(null),
    touches = useRef(new Map<number, XY>()),
    gesture = useRef<{ view: Camera; points: XY[] } | null>(null),
    mousePan = useRef<{ id: number; start: XY; view: Camera } | null>(null),
    frame = useRef<number | null>(null),
    snapshot = useRef<Stroke | null>(null);
  const model = useRef({ all, strokes, change, readOnly });
  model.current = { all, strokes, change, readOnly };
  function view(c: Camera) {
    cameraRef.current = c;
    setCamera(c);
  }
  function resetGesture() {
    gesture.current = {
      view: cameraRef.current,
      points: [...touches.current.values()].slice(0, 2),
    };
  }
  function clearPreview() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    snapshot.current = null;
    setPreview(null);
    setErasing([]);
  }
  function paint() {
    snapshot.current = engine.current.active?.working || null;
    if (frame.current === null)
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setPreview(snapshot.current);
        setErasing(engine.current.active?.erase?.map((s) => s.id) || []);
      });
  }
  function commit(changes: Stroke[]) {
    if (!changes.length || model.current.readOnly) return;
    history.current.record(changes, model.current.all);
    model.current.change(changes);
    redrawHistory((n) => n + 1);
  }
  function cancel(id?: number) {
    const a = engine.current.active;
    if (a && (id === undefined || id === a.pointer)) {
      engine.current.finish(a.pointer, true);
      writer.current = null;
      clearPreview();
      setNotice(
        "Strecket avbröts och sparades inte. Lyft pennan och fortsätt.",
      );
    }
    if (id === undefined) {
      touches.current.clear();
      gesture.current = null;
      mousePan.current = null;
    }
  }
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    if (readOnly) cancelRef.current();
  }, [readOnly]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let first = true;
    const resize = () => {
      const r = el.getBoundingClientRect(),
        w = el.clientWidth,
        h = el.clientHeight;
      if (!r.width || !w || !h) return;
      const old = sizeRef.current;
      sizeRef.current = { w, h };
      setSize({ w, h });
      if (first) {
        view(fitCamera(w, h));
        first = false;
      } else if (!writer.current) {
        const c = cameraRef.current,
          p = documentPoint({ x: old.w / 2, y: old.h / 2 }, c);
        view({ ...c, x: w / 2 - p.x * c.scale, y: h / 2 - p.y * c.scale });
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!fullScreen || !viewport.current) return;
    cancelRef.current();
    const el = viewport.current;
    view(fitCamera(el.clientWidth, el.clientHeight));
  }, [fullScreen]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const point =
        svg.current && svgPoint(svg.current, { x: e.clientX, y: e.clientY });
      if (!point) return;
      const unit =
        e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? sizeRef.current.h : 1;
      if (e.ctrlKey || e.metaKey)
        view(
          zoomAt(
            cameraRef.current,
            cameraRef.current.scale * Math.exp(-e.deltaY * unit * 0.002),
            point,
          ),
        );
      else
        view({
          ...cameraRef.current,
          x: cameraRef.current.x - (e.shiftKey ? e.deltaY : e.deltaX) * unit,
          y: cameraRef.current.y - (e.shiftKey ? 0 : e.deltaY) * unit,
        });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    const blur = () => cancelRef.current();
    const hidden = () => {
      if (document.hidden) cancelRef.current();
    };
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      el.removeEventListener("wheel", wheel);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", hidden);
      cancelRef.current();
    };
  }, []);
  function capture(e: React.PointerEvent) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* Synthetic tests or a pointer already released by the OS. */
    }
  }
  function local(e: { clientX: number; clientY: number }) {
    return svg.current
      ? svgPoint(svg.current, { x: e.clientX, y: e.clientY })
      : null;
  }
  function point(e: {
    clientX: number;
    clientY: number;
    pressure: number;
  }): Point | null {
    const p =
      layer.current && svgPoint(layer.current, { x: e.clientX, y: e.clientY });
    return p
      ? {
          ...p,
          p:
            e.pressure > 0
              ? e.pressure
              : (engine.current.active?.working.stroke.points[
                  engine.current.active.working.stroke.points.length - 1
                ]?.p ?? 0.5),
        }
      : null;
  }
  function down(e: React.PointerEvent<SVGSVGElement>) {
    e.preventDefault();
    e.stopPropagation();
    const p = local(e);
    if (!p) return;
    setNotice("");
    if (e.pointerType === "touch") {
      if (writer.current?.type === "pen") return; // Palm contact cannot steal a live pencil.
      touches.current.set(e.pointerId, p);
      capture(e);
      if (touches.current.size > 1) {
        if (writer.current) cancel(writer.current.id);
        resetGesture();
        return;
      }
      resetGesture();
      if (!finger || tool === "pan" || readOnly) return;
    } else {
      if (writer.current) return;
      if (e.pointerType === "pen") {
        touches.current.clear();
        gesture.current = null;
      }
      capture(e);
      if (tool === "pan") {
        mousePan.current = {
          id: e.pointerId,
          start: p,
          view: cameraRef.current,
        };
        return;
      }
    }
    if (readOnly) return;
    // No editable ancestor exists; dismiss a previous text-field focus as well.
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    const at = point(e);
    if (!at || at.x < 0 || at.x > 794 || at.y < 0 || at.y > 1123) return;
    const fresh: Stroke = {
      id: crypto.randomUUID(),
      note_id: noteId,
      page_id: pageId,
      stroke: {
        points: [at],
        color,
        width: tool === "highlight" ? width * 5 : width,
        tool:
          tool === "highlight" ? "highlight" : tool === "line" ? "line" : "pen",
      },
      deleted: false,
      revision: 0,
    };
    if (engine.current.begin(e.pointerId, at, tool, strokes, fresh)) {
      writer.current = { id: e.pointerId, type: e.pointerType };
      setSelected(tool === "move" ? engine.current.active!.original.id : null);
      paint();
    }
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    e.preventDefault();
    e.stopPropagation();
    const p = local(e);
    if (!p) return;
    if (writer.current?.id === e.pointerId) {
      const raw = e.nativeEvent.getCoalescedEvents?.();
      const events = raw?.length ? raw : [e.nativeEvent];
      const points = events.map(point).filter((p): p is Point => !!p);
      engine.current.move(e.pointerId, points, strokes);
      paint();
      return;
    }
    if (writer.current?.type === "pen") return;
    if (touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, p);
      const base = gesture.current,
        now = [...touches.current.values()].slice(0, 2);
      if (!base) return;
      if (now.length >= 2 && base.points.length >= 2)
        view(
          pinchCamera(
            base.view,
            base.points.slice(0, 2) as [XY, XY],
            now as [XY, XY],
          ),
        );
      else if (now.length === 1 && base.points.length === 1)
        view({
          ...base.view,
          x: base.view.x + p.x - base.points[0].x,
          y: base.view.y + p.y - base.points[0].y,
        });
      return;
    }
    const pan = mousePan.current;
    if (pan?.id === e.pointerId)
      view({
        ...pan.view,
        x: pan.view.x + p.x - pan.start.x,
        y: pan.view.y + p.y - pan.start.y,
      });
  }
  function finish(e: React.PointerEvent<SVGSVGElement>, aborted = false) {
    e.stopPropagation();
    if (engine.current.active?.pointer === e.pointerId) {
      if (aborted) cancel(e.pointerId);
      else {
        const p = point(e);
        if (p) engine.current.move(e.pointerId, [p], strokes);
        const changes = engine.current.finish(e.pointerId);
        writer.current = null;
        clearPreview();
        commit(changes);
      }
    }
    if (touches.current.delete(e.pointerId)) resetGesture();
    if (mousePan.current?.id === e.pointerId) mousePan.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* OS cancellation may already release capture. */
    }
  }
  function zoom(scale: number) {
    const { w, h } = sizeRef.current;
    view(zoomAt(cameraRef.current, scale, { x: w / 2, y: h / 2 }));
  }
  function step(direction: "undo" | "redo") {
    cancel();
    const changes = history.current.step(direction, all);
    if (changes.length) change(changes);
    redrawHistory((n) => n + 1);
    setSelected(null);
  }
  function saveFavorite(i: number) {
    const next = favorites.map((p, j) => (j === i ? { color, width } : p));
    setFavorites(next);
    if (preferencesKey)
      try {
        localStorage.setItem(
          "vihem-ink-pens:" + preferencesKey,
          JSON.stringify(next),
        );
      } catch {
        setNotice(
          "Favoritpennan används nu, men kunde inte sparas på enheten.",
        );
      }
  }
  return (
    <section
      className="pw-ink"
      data-ink-surface={pageId}
      aria-label="Handskriven sektion"
      contentEditable={false}
    >
      <InkControls
        readOnly={readOnly}
        tool={tool}
        setTool={(t) => {
          cancel();
          setTool(t);
        }}
        color={color}
        setColor={setColor}
        width={width}
        setWidth={setWidth}
        canUndo={history.current.undo.length > 0}
        canRedo={history.current.redo.length > 0}
        history={step}
        finger={finger}
        setFinger={setFinger}
        settings={settings}
        setSettings={setSettings}
        zoom={camera.scale}
        setZoom={zoom}
        fit={(whole) => {
          cancel();
          view(fitCamera(size.w, size.h, whole));
        }}
        favorites={favorites}
        applyFavorite={(i) => {
          setColor(favorites[i].color);
          setWidth(favorites[i].width);
          setTool("pen");
        }}
        saveFavorite={saveFavorite}
      />
      <div
        ref={viewport}
        className="pw-ink-viewport"
        tabIndex={0}
        role="group"
        aria-label="Rityta. Penna ritar, ett finger flyttar, två fingrar zoomar."
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (["+", "=", "-", "0"].includes(e.key)) {
            e.preventDefault();
            zoom(
              e.key === "0"
                ? 1
                : cameraRef.current.scale * (e.key === "-" ? 1 / 1.15 : 1.15),
            );
          }
          if (e.key === "Escape") {
            cancel();
            viewport.current?.blur();
          }
        }}
      >
        <svg
          ref={svg}
          viewBox={`0 0 ${size.w} ${size.h}`}
          className="pw-paper"
          aria-label="A4 skrivpapper"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={(e) => finish(e)}
          onPointerCancel={(e) => finish(e, true)}
          onLostPointerCapture={(e) => finish(e, true)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <g
            ref={layer}
            data-ink-camera="true"
            transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}
          >
            <svg
              width="794"
              height="1123"
              viewBox="0 0 794 1123"
              overflow="hidden"
            >
              <PaperBackground settings={settings} />
              <g data-ink-strokes="true">
                {strokes
                  .filter(
                    (s) => s.id !== preview?.id && !erasing.includes(s.id),
                  )
                  .map((s) => (
                    <RenderedStroke
                      key={s.id}
                      value={s}
                      selected={s.id === selected}
                    />
                  ))}
                {preview && !engine.current.active?.erase && (
                  <path
                    data-ink-preview="true"
                    d={strokePath(preview.stroke)}
                    fill={preview.stroke.color}
                    opacity={preview.stroke.tool === "highlight" ? 0.3 : 1}
                  />
                )}
              </g>
            </svg>
          </g>
        </svg>
      </div>
      <p className="pw-hint">
        {notice ||
          "Penna skriver · ett finger flyttar · två fingrar zoomar. + / − och 0 zoomar när ritytan har tangentbordsfokus."}
      </p>
    </section>
  );
}
