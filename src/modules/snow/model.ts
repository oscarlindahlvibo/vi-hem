export type SnowMethod = "machine" | "hand";
export type SnowActivity = "snow_plowing" | "snow_sanding";
export type Geometry =
  | { type: "LineString"; coordinates: number[][] }
  | { type: "MultiLineString"; coordinates: number[][][] }
  | { type: "Polygon"; coordinates: number[][][] };
export interface SnowClient {
  id: string;
  name: string;
  active: boolean;
  revision: number;
}
export interface SnowRoute {
  id: string;
  client_id: string;
  name: string;
  method: SnowMethod;
  priority: number;
  instructions: string;
  geometry: Geometry;
  active: boolean;
  revision: number;
}
export const methodLabel = (method: SnowMethod) =>
  method === "machine" ? "Maskin" : "Handskottning";
export const activityLabel = (category: string) =>
  category === "snow_sanding"
    ? "Sandning"
    : category === "snow_plowing"
      ? "Snöröjning"
      : category;
export function routeGeometry(points: number[][], area: boolean): Geometry {
  if (points.length < (area ? 3 : 2))
    throw Error(
      area
        ? "Markera minst tre hörn för området."
        : "Markera minst två punkter för rutten.",
    );
  if (
    points.length > 2000 ||
    points.some(
      (p) =>
        p.length !== 2 ||
        !p.every(Number.isFinite) ||
        Math.abs(p[0]) > 180 ||
        Math.abs(p[1]) > 85,
    )
  )
    throw Error("Kontrollera kartans punkter.");
  return area
    ? { type: "Polygon", coordinates: [[...points, points[0]]] }
    : { type: "LineString", coordinates: points };
}
export function geometryPoints(geometry?: Geometry): number[][] {
  if (!geometry) return [];
  return geometry.type === "MultiLineString"
    ? geometry.coordinates[0] || []
    : geometry.type === "Polygon"
      ? geometry.coordinates[0].slice(0, -1)
      : geometry.coordinates;
}
export function sortRoutes(routes: SnowRoute[]) {
  return [...routes].sort(
    (a, b) => a.priority - b.priority || a.name.localeCompare(b.name, "sv"),
  );
}

export function geometrySegments(geometry?: Geometry): number[][][] {
  if (!geometry) return [[]];
  return geometry.type === "MultiLineString"
    ? geometry.coordinates.map((line) => line.map((point) => [...point]))
    : [geometryPoints(geometry)];
}
export function segmentedGeometry(
  segments: number[][][],
  area: boolean,
): Geometry {
  if (area && segments.length !== 1)
    throw Error(
      "Ett område kan inte ha flera sträckor. Använd en separat markering för området.",
    );
  if (
    !segments.length ||
    segments.length > 100 ||
    segments.reduce((sum, line) => sum + line.length, 0) > 2000
  )
    throw Error("Rutten får ha högst 100 sträckor och 2000 punkter.");
  const lines = segments.map((line) => routeGeometry(line, area));
  return lines.length === 1
    ? lines[0]
    : { type: "MultiLineString", coordinates: segments };
}

// Allocate from the complete customer set, never from the filtered route list.
// Resolve palette collisions so the first ten customers always have distinct colours.
const CLIENT_PALETTE = [
  "#2563eb",
  "#dc2626",
  "#0f766e",
  "#9333ea",
  "#c2410c",
  "#be185d",
  "#4338ca",
  "#4d7c0f",
  "#0e7490",
  "#a16207",
];
export function snowClientColors(ids: string[]): Record<string, string> {
  const colors: Record<string, string> = {};
  const used = new Set<number>();
  [...new Set(ids)].sort().forEach((id, index) => {
    let hash = 0;
    for (const char of id)
      hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
    let slot = hash % CLIENT_PALETTE.length;
    if (index < CLIENT_PALETTE.length) {
      while (used.has(slot)) slot = (slot + 1) % CLIENT_PALETTE.length;
      used.add(slot);
      colors[id] = CLIENT_PALETTE[slot];
    } else colors[id] = `hsl(${(index * 137.508) % 360} 65% 35%)`;
  });
  return colors;
}
