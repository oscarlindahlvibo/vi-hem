import { getStroke } from "perfect-freehand";
import type { Point, Stroke } from "../types";
export function strokePath(s: Stroke["stroke"]) {
  const points =
    s.tool === "line" && s.points.length > 1
      ? [s.points[0], s.points[s.points.length - 1]]
      : s.points;
  const outline = getStroke(
    points.map((p) => [p.x, p.y, p.p]),
    {
      size: s.width,
      thinning: s.tool === "highlight" ? 0 : 0.45,
      smoothing: 0.65,
      streamline: 0.4,
      simulatePressure: false,
    },
  );
  return outline.length
    ? "M " + outline.map((p) => p.join(",")).join(" L ") + " Z"
    : "";
}
export function nearStroke(p: Point, s: Stroke, tolerance = 12) {
  return s.stroke.points.some((q, i, all) => {
    if (!i) return Math.hypot(q.x - p.x, q.y - p.y) < tolerance;
    const a = all[i - 1],
      dx = q.x - a.x,
      dy = q.y - a.y;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
    return (
      Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) <
      tolerance + s.stroke.width / 2
    );
  });
}
export function translate(s: Stroke, dx: number, dy: number): Stroke {
  return {
    ...s,
    stroke: {
      ...s.stroke,
      points: s.stroke.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    },
  };
}
