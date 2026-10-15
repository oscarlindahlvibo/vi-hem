import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { Feature } from "geojson";
import "leaflet/dist/leaflet.css";
import type { SnowRoute } from "./model";
import { Button } from "../../components/ui";

export function SnowMap({
  routes,
  selected,
  onSelect,
  points,
  area = false,
  onPoints,
}: {
  routes: SnowRoute[];
  selected?: string;
  onSelect?: (id: string) => void;
  points?: number[][];
  area?: boolean;
  onPoints?: (points: number[][]) => void;
}) {
  const node = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    drawn = useRef<L.LayerGroup | null>(null);
  const edit = useRef({ points, onPoints });
  edit.current = { points, onPoints };
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
    m.on("click", (event: L.LeafletMouseEvent) => {
      const state = edit.current;
      if (state.onPoints)
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
      const color = route.method === "machine" ? "#2563eb" : "#9333ea";
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
    if (points?.length) {
      const latLngs = points.map((p) => L.latLng(p[1], p[0]));
      (area && points.length >= 3
        ? L.polygon(latLngs, { color: "#0f766e" })
        : L.polyline(latLngs, { color: "#0f766e", weight: 5 })
      ).addTo(group);
      points.forEach((point, index) => {
        L.marker([point[1], point[0]], {
          draggable: true,
          icon: L.divIcon({
            className: "",
            html: '<span style="display:block;width:20px;height:20px;border:3px solid white;border-radius:50%;background:#0f766e;box-shadow:0 0 0 2px #0f766e"></span>',
            iconSize: [20, 20],
            iconAnchor: [10, 10],
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
  }, [routes, selected, onSelect, points, onPoints, area]);
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
      <div
        ref={node}
        role="region"
        aria-label={
          onPoints
            ? "Rita rutt eller område på kartan"
            : "Snörutter och områden"
        }
        className="h-80 w-full sm:h-[420px]"
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
            Tryck för punkter. Dra punkterna för att justera.
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
