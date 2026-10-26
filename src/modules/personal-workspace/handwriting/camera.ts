export type XY = { x: number; y: number };
export type Camera = { x: number; y: number; scale: number };
export const MIN_ZOOM = 0.25,
  MAX_ZOOM = 3;
export function documentPoint(point: XY, camera: Camera): XY {
  return {
    x: (point.x - camera.x) / camera.scale,
    y: (point.y - camera.y) / camera.scale,
  };
}
export function zoomAt(camera: Camera, scale: number, anchor: XY): Camera {
  const p = documentPoint(anchor, camera);
  const s = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
  return { scale: s, x: anchor.x - p.x * s, y: anchor.y - p.y * s };
}
export function pinchCamera(
  camera: Camera,
  start: [XY, XY],
  next: [XY, XY],
): Camera {
  const mid = (p: [XY, XY]) => ({
    x: (p[0].x + p[1].x) / 2,
    y: (p[0].y + p[1].y) / 2,
  });
  const before = mid(start),
    after = mid(next),
    distance = (p: [XY, XY]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  const c = zoomAt(
    camera,
    (camera.scale * distance(next)) / Math.max(1, distance(start)),
    before,
  );
  return { ...c, x: c.x + after.x - before.x, y: c.y + after.y - before.y };
}
export function fitCamera(w: number, h: number, whole = false): Camera {
  const scale = Math.max(
    MIN_ZOOM,
    Math.min(MAX_ZOOM, (w - 24) / 794, ...(whole ? [(h - 24) / 1123] : [])),
  );
  return {
    scale,
    x: (w - 794 * scale) / 2,
    y: whole ? (h - 1123 * scale) / 2 : 12,
  };
}
/** Reads the real SVG CTM, including parent transforms, scrolling and camera. */
export function svgPoint(element: SVGGraphicsElement, point: XY): XY | null {
  const matrix = element.getScreenCTM();
  if (!matrix) return null;
  try {
    const inverse = matrix.inverse();
    const x = inverse.a * point.x + inverse.c * point.y + inverse.e,
      y = inverse.b * point.x + inverse.d * point.y + inverse.f;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  } catch {
    return null;
  }
}
