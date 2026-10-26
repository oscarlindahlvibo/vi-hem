import React from "react";
import { PAGE_HEIGHT, PAGE_WIDTH, type PaperSettings } from "./paper";
/** Explicit geometry: no document-global pattern IDs, URL fragments or CSS backgrounds. */
export const PaperBackground = React.memo(function PaperBackground({
  settings,
}: {
  settings: PaperSettings;
}) {
  const { paper, spacing, lineColor, lineOpacity } = settings;
  const rows = Array.from(
    { length: Math.ceil(PAGE_HEIGHT / spacing) },
    (_, i) =>
      (i + 1) * spacing - (paper === "lined" || paper === "dark" ? 0.5 : 0),
  );
  const cols = Array.from(
    { length: Math.ceil(PAGE_WIDTH / spacing) },
    (_, i) =>
      (i + 1) * spacing - (paper === "lined" || paper === "dark" ? 0.5 : 0),
  );
  return (
    <g data-ink-background="stable" pointerEvents="none" aria-hidden="true">
      <rect
        width={PAGE_WIDTH}
        height={PAGE_HEIGHT}
        fill={paper === "dark" ? "#172b49" : "#ffffff"}
      />
      {["lined", "grid", "dark"].includes(paper) && (
        <g stroke={lineColor} opacity={lineOpacity} strokeWidth="1">
          {rows.map((y) => (
            <line key={"h" + y} x1="0" x2={PAGE_WIDTH} y1={y} y2={y} />
          ))}
          {paper === "grid" &&
            cols.map((x) => (
              <line key={"v" + x} y1="0" y2={PAGE_HEIGHT} x1={x} x2={x} />
            ))}
        </g>
      )}
      {paper === "dots" && (
        <g fill={lineColor} opacity={lineOpacity}>
          {rows.flatMap((y, i) =>
            cols.map((x, j) => (
              <circle
                key={i + ":" + j}
                cx={x - spacing / 2}
                cy={y - spacing / 2}
                r="1"
              />
            )),
          )}
        </g>
      )}
    </g>
  );
});
