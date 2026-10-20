import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FleetPosition } from "./telematics";
export function FleetGpsMap({
  positions,
  labels = {},
  onOpen,
}: {
  positions: FleetPosition[];
  labels?: Record<string, string>;
  onOpen?: (id: string) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    if (!node.current) return;
    const map = L.map(node.current, { scrollWheelZoom: false }).setView(
      [57.317, 15.583],
      12,
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    })
      .on("tileerror", () => setTileError(true))
      .addTo(map);
    const valid = positions.filter(
      (p) => p.gps_valid && p.latitude !== null && p.longitude !== null,
    );
    const latest = new Map<string, FleetPosition>();
    for (const p of valid)
      if (
        !latest.has(p.vehicle_id) ||
        Date.parse(p.recorded_at) >
          Date.parse(latest.get(p.vehicle_id)!.recorded_at)
      )
        latest.set(p.vehicle_id, p);
    for (const p of latest.values()) {
      const popup = document.createElement("div");
      const text = document.createElement("p");
      text.textContent =
        (labels[p.vehicle_id] || "Fordon") +
        " · " +
        new Date(p.recorded_at).toLocaleString("sv-SE", {
          timeZone: "Europe/Stockholm",
        });
      popup.append(text);
      if (onOpen) {
        const button = document.createElement("button");
        button.textContent = "Öppna fordon";
        button.className = "text-blue-700 underline min-h-11";
        button.onclick = () => onOpen(p.vehicle_id);
        popup.append(button);
      }
      L.circleMarker([p.latitude!, p.longitude!], {
        radius: 7,
        color: "#2563eb",
        fillOpacity: 0.9,
      })
        .bindPopup(popup)
        .addTo(map);
    }
    if (!onOpen) {
      let segment: L.LatLngExpression[] = [];
      let previous: FleetPosition | undefined;
      for (const p of [...valid].sort(
        (a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at),
      )) {
        if (
          previous &&
          (p.vehicle_id !== previous.vehicle_id ||
            Date.parse(p.recorded_at) - Date.parse(previous.recorded_at) >
              300000)
        ) {
          if (segment.length > 1)
            L.polyline(segment, { color: "#2563eb", weight: 4 }).addTo(map);
          segment = [];
        }
        segment.push([p.latitude!, p.longitude!]);
        previous = p;
      }
      if (segment.length > 1)
        L.polyline(segment, { color: "#2563eb", weight: 4 }).addTo(map);
    }
    if (valid.length)
      map.fitBounds(
        L.latLngBounds(valid.map((p) => [p.latitude!, p.longitude!])),
        { padding: [30, 30], maxZoom: 16 },
      );
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(node.current);
    return () => {
      observer.disconnect();
      map.remove();
    };
  }, [positions, labels, onOpen]);
  return (
    <div>
      <div
        ref={node}
        className="relative z-0 h-80 w-full rounded-xl border border-slate-200"
        aria-label="Fordonspositioner på karta"
      />
      {tileError && (
        <p role="status" className="mt-2 text-sm text-amber-800">
          Kartbakgrunden kunde inte laddas. Positionernas koordinater finns i
          text nedan.
        </p>
      )}
    </div>
  );
}
