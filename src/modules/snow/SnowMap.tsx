import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { Feature } from "geojson";
import "leaflet/dist/leaflet.css";
import type { SnowRoute, SnowMethod } from "./model";
import { Button } from "../../components/ui";

export function SnowMap({
  routes,
  clientColors,
  drawingColor = "#2563eb",
  drawingMethod = "machine",
  selected,
  onSelect,
  points,
  segments,
  activeSegment = 0,
  area = false,
  onPoints,
}: {
  routes: SnowRoute[];
  clientColors: Record<string, string>;
  drawingColor?: string;
  drawingMethod?: SnowMethod;
  selected?: string;
  onSelect?: (id: string) => void;
  points?: number[][];
  segments?: number[][][];
  activeSegment?: number;
  area?: boolean;
  onPoints?: (points: number[][]) => void;
}) {
  const node = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    drawn = useRef<L.LayerGroup | null>(null);
  const [mode, setMode] = useState<"draw" | "pan" | "adjust">("draw");
  const edit = useRef({ points, onPoints, mode });
  edit.current = { points, onPoints, mode };
  useEffect(() => {
    setMode("draw");
  }, [activeSegment]);
  const initialGeometry = useRef(segments || (points?.length ? [points] : []));
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    if (!node.current) return;
    const m = L.map(node.current, { scrollWheelZoom: false }).setView(
      [57.317, 15.583],
      13,
    );
    map.current = m;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    })
      .on("tileerror", () => setTileError(true))
      .addTo(m);
    drawn.current = L.layerGroup().addTo(m);
    const initial = initialGeometry.current.flat();
    if (initial.length > 1)
      m.fitBounds(L.latLngBounds(initial.map((p) => L.latLng(p[1], p[0]))), {
        padding: [28, 28],
        maxZoom: 17,
      });
    m.on("click", (event: L.LeafletMouseEvent) => {
      const state = edit.current;
      if (state.onPoints && state.mode === "draw")
        state.onPoints([
          ...(state.points || []),
          [event.latlng.lng, event.latlng.lat],
        ]);
    });
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(node.current);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const group = drawn.current,
      m = map.current;
    if (!group || !m) return;
    group.clearLayers();
    for (const route of routes) {
      const color = clientColors[route.client_id] || "#2563eb";
      const layer = L.geoJSON(
        {
          type: "Feature",
          properties: {},
          geometry: route.geometry,
        } as Feature,
        {
          style: {
            color,
            weight: route.id === selected ? 7 : 4,
            fillOpacity: 0.16,
            dashArray: route.method === "hand" ? "7 5" : undefined,
          },
        },
      ).addTo(group);
      const label = document.createElement("span");
      label.textContent = `Prio ${route.priority} · ${route.name}`;
      layer.bindTooltip(label, { sticky: true });
      layer.on("click", () => onSelect?.(route.id));
    }
    (segments || []).forEach((line, index) => {
      if (index !== activeSegment && line.length > 1)
        L.polyline(
          line.map((p) => L.latLng(p[1], p[0])),
          {
            color: drawingColor,
            weight: 4,
            opacity: 0.45,
            interactive: false,
            dashArray: drawingMethod === "hand" ? "7 5" : undefined,
          },
        ).addTo(group);
    });
    if (points?.length) {
      const latLngs = points.map((p) => L.latLng(p[1], p[0]));
      (area && points.length >= 3
        ? L.polygon(latLngs, {
            color: drawingColor,
            interactive: false,
            dashArray: drawingMethod === "hand" ? "7 5" : undefined,
          })
        : L.polyline(latLngs, {
            color: drawingColor,
            weight: 4,
            dashArray: drawingMethod === "hand" ? "7 5" : undefined,
            interactive: false,
          })
      ).addTo(group);
      if (mode === "draw")
        L.circleMarker(latLngs[latLngs.length - 1], {
          radius: 4,
          color: "white",
          weight: 2,
          fillColor: drawingColor,
          fillOpacity: 1,
          interactive: false,
        }).addTo(group);
      if (mode === "adjust")
        points.forEach((point, index) => {
          L.marker([point[1], point[0]], {
            draggable: true,
            icon: L.divIcon({
              className: "",
              html:
                '<span style="display:block;margin:7px;width:10px;height:10px;border:2px solid white;border-radius:50%;background:currentColor;box-shadow:0 0 0 1px currentColor;color:' +
                drawingColor +
                '"></span>',
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            }),
          })
            .on("dragend", (event) => {
              const p = (event.target as L.Marker).getLatLng();
              const changed = [...points];
              changed[index] = [p.lng, p.lat];
              onPoints?.(changed);
            })
            .addTo(group);
        });
    }
  }, [
    routes,
    clientColors,
    drawingColor,
    drawingMethod,
    selected,
    onSelect,
    points,
    onPoints,
    area,
    segments,
    activeSegment,
    mode,
  ]);
  useEffect(() => {
    const route = routes.find((r) => r.id === selected);
    if (route && map.current)
      map.current.fitBounds(
        L.geoJSON({
          type: "Feature",
          properties: {},
          geometry: route.geometry,
        } as Feature).getBounds(),
        { padding: [30, 30], maxZoom: 17 },
      );
  }, [selected, routes]);
  return (
    <div className="relative isolate overflow-hidden rounded-2xl border border-slate-200">
      {onPoints && (
        <div
          className="flex flex-wrap gap-1 border-b bg-white p-2"
          role="group"
          aria-label="Kartverktyg"
        >
          {(
            [
              ["draw", "Rita"],
              ["pan", "Flytta karta"],
              ["adjust", "Justera punkter"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={mode === value ? "primary" : "secondary"}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
      <div
        ref={node}
        role="region"
        aria-label={
          onPoints
            ? "Rita rutt eller område på kartan"
            : "Snörutter och områden"
        }
        className={
          onPoints
            ? "h-80 w-full sm:h-[min(55dvh,560px)]"
            : "h-80 w-full sm:h-[420px]"
        }
      />
      {tileError && (
        <p
          role="status"
          className="absolute left-12 right-2 top-2 z-[500] rounded-lg bg-white p-2 text-xs text-slate-700"
        >
          Bakgrundskartan kunde inte laddas. Rutter och jobblista finns kvar.
          Kontrollera anslutningen.
        </p>
      )}
      {onPoints && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3">
          <span className="text-sm text-slate-600">
            {mode === "draw"
              ? "Klicka längs vägen. Välj Ny sträcka för en förgrening."
              : mode === "pan"
                ? "Flytta och zooma utan att lägga till punkter."
                : "Dra de små punkterna för att justera. Välj Rita när du är klar."}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={!points?.length}
            onClick={() => onPoints(points?.slice(0, -1) || [])}
          >
            Ångra punkt
          </Button>
        </div>
      )}
    </div>
  );
}
