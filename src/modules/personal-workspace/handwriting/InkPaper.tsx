import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Eraser,
  Hand,
  Highlighter,
  Minus,
  Move,
  PenLine,
  Redo2,
  Undo2,
} from "lucide-react";
import type { Paper, Point, Stroke } from "../types";
import { nearStroke, strokePath, translate } from "./geometry";
const RenderedStroke = React.memo(function RenderedStroke({
  value,
  selected,
}: {
  value: Stroke;
  selected: boolean;
}) {
  return (
    <path
      d={strokePath(value.stroke)}
      fill={value.stroke.color}
      opacity={value.stroke.tool === "highlight" ? 0.3 : 1}
      stroke={selected ? "#2563eb" : undefined}
      strokeWidth={selected ? 1 : 0}
    />
  );
});
export const InkContext = createContext<{
  noteId: string;
  strokes: Stroke[];
  change: (strokes: Stroke[]) => void;
  readOnly?: boolean;
}>({ noteId: "", strokes: [], change: () => {} });
type Tool = "pen" | "highlight" | "erase" | "move" | "line" | "pan";
export function InkPaper({
  pageId,
  paper = "lined",
  setPaper,
}: {
  pageId: string;
  paper?: Paper;
  setPaper?: (p: Paper) => void;
}) {
  const { noteId, strokes: all, change, readOnly } = useContext(InkContext);
  const strokes = all.filter((s) => s.page_id === pageId && !s.deleted);
  const [tool, setTool] = useState<Tool>("pen"),
    [color, setColor] = useState("#172b49"),
    [width, setWidth] = useState(3),
    [finger, setFinger] = useState(false),
    [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState<Stroke | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null),
    active = useRef<{
      id: number;
      start: Point;
      stroke: Stroke;
      moving?: boolean;
    } | null>(null);
  const frame = useRef<number | null>(null),
    pendingPreview = useRef<Stroke | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  function paint(s: Stroke) {
    pendingPreview.current = s;
    if (frame.current === null)
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setPreview(pendingPreview.current);
      });
  }
  const undo = useRef<Stroke[][]>([]),
    redo = useRef<Stroke[][]>([]);
  function commit(changes: Stroke[]) {
    undo.current.push(
      changes.map(
        (s) => all.find((a) => a.id === s.id) || { ...s, deleted: true },
      ),
    );
    redo.current = [];
    change(changes);
  }
  function history(
    from: React.MutableRefObject<Stroke[][]>,
    to: React.MutableRefObject<Stroke[][]>,
  ) {
    const changes = from.current.pop();
    if (!changes) return;
    to.current.push(changes.map((s) => all.find((a) => a.id === s.id) || s));
    change(changes);
    setSelected(null);
  }
  function point(e: {
    clientX: number;
    clientY: number;
    pressure: number;
  }): Point {
    const rect = svg.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * 794) / rect.width,
      y: ((e.clientY - rect.top) * 1123) / rect.height,
      p: e.pressure || 0.5,
    };
  }
  function down(e: React.PointerEvent<SVGSVGElement>) {
    if (readOnly || tool === "pan" || (e.pointerType === "touch" && !finger))
      return;
    if (active.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    if (tool === "erase") {
      const hit = strokes.filter((s) => nearStroke(p, s));
      if (hit.length) commit(hit.map((s) => ({ ...s, deleted: true })));
      return;
    }
    if (tool === "move") {
      const hit = [...strokes].reverse().find((s) => nearStroke(p, s));
      setSelected(hit?.id || null);
      if (hit)
        active.current = {
          id: e.pointerId,
          start: p,
          stroke: hit,
          moving: true,
        };
      return;
    }
    const s: Stroke = {
      id: crypto.randomUUID(),
      note_id: noteId,
      page_id: pageId,
      stroke: {
        points: [p],
        color,
        width: tool === "highlight" ? width * 5 : width,
        tool:
          tool === "highlight" ? "highlight" : tool === "line" ? "line" : "pen",
      },
      deleted: false,
      revision: 0,
    };
    active.current = { id: e.pointerId, start: p, stroke: s };
    setPreview(s);
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    e.preventDefault();
    if (a.moving) {
      const p = point(e);
      paint(translate(a.stroke, p.x - a.start.x, p.y - a.start.y));
      return;
    }
    const events = e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent];
    a.stroke = {
      ...a.stroke,
      stroke: {
        ...a.stroke.stroke,
        points: [...a.stroke.stroke.points, ...events.map(point)],
      },
    };
    if (a.stroke.stroke.points.length > 12000)
      a.stroke = {
        ...a.stroke,
        stroke: {
          ...a.stroke.stroke,
          points: a.stroke.stroke.points.filter(
            (_, i, points) => i % 2 === 0 || i === points.length - 1,
          ),
        },
      };
    paint(a.stroke);
  }
  function finish(e: React.PointerEvent<SVGSVGElement>, cancel = false) {
    if (active.current?.id !== e.pointerId) return;
    const a = active.current;
    active.current = null;
    if (!cancel) {
      const s = a.moving
        ? translate(a.stroke, point(e).x - a.start.x, point(e).y - a.start.y)
        : a.stroke;
      if (s) commit([s]);
    }
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pendingPreview.current = null;
    setPreview(null);
  }
  const tools: [Tool, string, React.ReactNode][] = [
    ["pen", "Penna", <PenLine size={18} />],
    ["highlight", "Överstrykningspenna", <Highlighter size={18} />],
    ["erase", "Sudda streck", <Eraser size={18} />],
    ["move", "Markera och flytta streck", <Move size={18} />],
    ["line", "Rak linje", <Minus size={18} />],
    ["pan", "Navigera med fingret", <Hand size={18} />],
  ];
  return (
    <section
      className="pw-ink"
      aria-label="Handskriven sektion"
      contentEditable={false}
    >
      <fieldset
        disabled={readOnly}
        className="pw-ink-tools"
        role="toolbar"
        aria-label="Pennverktyg"
      >
        {tools.map(([t, l, i]) => (
          <button
            type="button"
            key={t}
            title={l}
            aria-label={l}
            aria-pressed={tool === t}
            onClick={() => setTool(t)}
          >
            {i}
          </button>
        ))}
        <input
          aria-label="Pennfärg"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <select
          aria-label="Linjetjocklek"
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
        >
          {[2, 3, 5, 8].map((w) => (
            <option value={w} key={w}>
              {w} px
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Ångra pennstreck"
          disabled={!undo.current.length}
          onClick={() => history(undo, redo)}
        >
          <Undo2 size={18} />
        </button>
        <button
          type="button"
          aria-label="Gör om pennstreck"
          disabled={!redo.current.length}
          onClick={() => history(redo, undo)}
        >
          <Redo2 size={18} />
        </button>
        <select
          aria-label="Pappersmall"
          value={paper}
          onChange={(e) => setPaper?.(e.target.value as Paper)}
        >
          {Object.entries({
            blank: "Blankt",
            lined: "Linjerat",
            grid: "Rutigt",
            dots: "Prickat",
            dark: "Mörkt",
          }).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="Zoom"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        >
          {[0.75, 1, 1.5, 2].map((z) => (
            <option key={z} value={z}>
              {z * 100}%
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={finger}
            onChange={(e) => setFinger(e.target.checked)}
          />{" "}
          Rita med fingret
        </label>
      </fieldset>
      <div className="pw-paper-scroll">
        <svg
          ref={svg}
          viewBox="0 0 794 1123"
          className={`pw-paper pw-paper-${paper}`}
          style={{
            width: `${zoom * 100}%`,
            minWidth: `${zoom * 100}%`,
            touchAction: tool === "pan" || !finger ? "pan-x pan-y" : "none",
          }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={(e) => finish(e)}
          onPointerCancel={(e) => finish(e)}
          aria-label="A4 skrivpapper"
        >
          <defs>
            <pattern
              id={"paper-" + pageId}
              width={paper === "lined" ? 794 : 24}
              height={paper === "lined" ? 32 : 24}
              patternUnits="userSpaceOnUse"
            >
              {paper === "lined" ? (
                <path d="M0 31.5H794" stroke="#dce4ef" />
              ) : paper === "grid" ? (
                <path d="M24 0H0V24" fill="none" stroke="#e4e9f1" />
              ) : paper === "dots" ? (
                <circle cx="12" cy="12" r="1" fill="#b4c0d0" />
              ) : null}
            </pattern>
          </defs>
          <rect
            width="794"
            height="1123"
            fill={paper === "dark" ? "#172b49" : "white"}
          />
          <rect width="794" height="1123" fill={`url(#paper-${pageId})`} />
          {strokes
            .filter((s) => s.id !== preview?.id)
            .map((s) => (
              <RenderedStroke
                key={s.id}
                value={s}
                selected={s.id === selected}
              />
            ))}
          {preview && (
            <path
              d={strokePath(preview.stroke)}
              fill={preview.stroke.color}
              opacity={preview.stroke.tool === "highlight" ? 0.3 : 1}
            />
          )}
        </svg>
      </div>
      <p className="pw-hint">
        Penna skriver · fingret navigerar. Markera ett streck med flyttverktyget
        för att flytta det.
      </p>
    </section>
  );
}
