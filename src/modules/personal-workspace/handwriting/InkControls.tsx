import React from "react";
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
import type { Tool } from "./interaction";
import type { PaperSettings } from "./paper";
export type FavoritePen = { color: string; width: number };
export function InkControls({
  readOnly,
  tool,
  setTool,
  color,
  setColor,
  width,
  setWidth,
  canUndo,
  canRedo,
  history,
  finger,
  setFinger,
  settings,
  setSettings,
  zoom,
  setZoom,
  fit,
  favorites,
  applyFavorite,
  saveFavorite,
}: {
  readOnly?: boolean;
  tool: Tool;
  setTool: (v: Tool) => void;
  color: string;
  setColor: (v: string) => void;
  width: number;
  setWidth: (v: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  history: (v: "undo" | "redo") => void;
  finger: boolean;
  setFinger: (v: boolean) => void;
  settings: PaperSettings;
  setSettings?: (v: Partial<PaperSettings>) => void;
  zoom: number;
  setZoom: (v: number) => void;
  fit: (whole: boolean) => void;
  favorites: FavoritePen[];
  applyFavorite: (i: number) => void;
  saveFavorite: (i: number) => void;
}) {
  const tools: [Tool, string, React.ReactNode][] = [
    ["pen", "Penna", <PenLine size={19} />],
    ["highlight", "Överstrykningspenna", <Highlighter size={19} />],
    ["erase", "Sudda streck", <Eraser size={19} />],
    ["move", "Markera och flytta streck", <Move size={19} />],
    ["line", "Rak linje", <Minus size={19} />],
    ["pan", "Navigering", <Hand size={19} />],
  ];
  return (
    <div className="pw-ink-controls">
      <fieldset
        disabled={readOnly}
        className="pw-ink-tools"
        role="toolbar"
        aria-label="Pennverktyg"
      >
        {tools.map(([value, label, icon]) => (
          <button
            type="button"
            key={value}
            aria-label={label}
            title={label}
            aria-pressed={tool === value}
            onClick={() => setTool(value)}
          >
            {icon}
          </button>
        ))}
        <span className="pw-tool-divider" />
        <input
          aria-label="Pennfärg"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <label className="pw-pen-width">
          Tjocklek{" "}
          <select
            aria-label="Penntjocklek"
            value={width}
            onChange={(e) => setWidth(+e.target.value)}
          >
            {[1, 2, 3, 5, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label="Ångra pennstreck"
          disabled={!canUndo}
          onClick={() => history("undo")}
        >
          <Undo2 size={19} />
        </button>
        <button
          type="button"
          aria-label="Gör om pennstreck"
          disabled={!canRedo}
          onClick={() => history("redo")}
        >
          <Redo2 size={19} />
        </button>
        {favorites.map((pen, i) => (
          <button
            type="button"
            key={i}
            aria-label={"Favoritpenna " + (i + 1)}
            title={"Favoritpenna " + (i + 1)}
            onClick={() => applyFavorite(i)}
          >
            <span
              className="pw-favorite-pen"
              style={{
                background: pen.color,
                width: Math.max(8, pen.width * 2),
                height: Math.max(8, pen.width * 2),
              }}
            />
          </button>
        ))}
      </fieldset>
      <div
        className="pw-ink-navigation"
        role="group"
        aria-label="Papper och dokumentzoom"
      >
        <details className="pw-paper-options">
          <summary>Papper</summary>
          <fieldset
            disabled={readOnly || !setSettings}
            className="pw-paper-options-body"
          >
            <label>
              Pappersmall
              <select
                aria-label="Pappersmall"
                value={settings.paper}
                onChange={(e) =>
                  setSettings?.({
                    paper: e.target.value as PaperSettings["paper"],
                  })
                }
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
            </label>
            <label>
              Avstånd · {settings.spacing}
              <input
                aria-label="Linje- eller rutavstånd"
                type="range"
                min="16"
                max="60"
                step="1"
                value={settings.spacing}
                onChange={(e) => setSettings?.({ spacing: +e.target.value })}
              />
            </label>
            <div className="pw-paper-presets">
              {[
                ["Smalt", 24],
                ["Normalt", 32],
                ["Brett", 48],
              ].map(([label, value]) => (
                <button
                  type="button"
                  key={label}
                  onClick={() => setSettings?.({ spacing: Number(value) })}
                >
                  {label}
                </button>
              ))}
            </div>
            <label>
              Linjefärg
              <input
                aria-label="Linjefärg"
                type="color"
                value={settings.lineColor}
                onChange={(e) => setSettings?.({ lineColor: e.target.value })}
              />
            </label>
            <label>
              Linjestyrka · {Math.round(settings.lineOpacity * 100)} %
              <input
                aria-label="Linjestyrka"
                type="range"
                min="10"
                max="100"
                value={Math.round(settings.lineOpacity * 100)}
                onChange={(e) =>
                  setSettings?.({ lineOpacity: +e.target.value / 100 })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={finger}
                onChange={(e) => setFinger(e.target.checked)}
              />{" "}
              Rita med fingret
            </label>
            <div>
              Favoritpennor
              {favorites.map((_, i) => (
                <button key={i} type="button" onClick={() => saveFavorite(i)}>
                  Spara aktuell penna som {i + 1}
                </button>
              ))}
            </div>
          </fieldset>
        </details>
        <label className="pw-zoom-control">
          Zoom{" "}
          <input
            aria-label="Dokumentzoom"
            type="range"
            min="25"
            max="300"
            step="1"
            value={Math.round(zoom * 100)}
            onChange={(e) => setZoom(+e.target.value / 100)}
          />
          <output>{Math.round(zoom * 100)} %</output>
        </label>
        <button type="button" onClick={() => setZoom(1)}>
          100 %
        </button>
        <button type="button" onClick={() => fit(false)}>
          Anpassa bredd
        </button>
        <button type="button" onClick={() => fit(true)}>
          Hela sidan
        </button>
      </div>
    </div>
  );
}
