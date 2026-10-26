import type { Paper } from "../types";
export const PAGE_WIDTH = 794,
  PAGE_HEIGHT = 1123;
export type PaperSettings = {
  paper: Paper;
  spacing: number;
  lineColor: string;
  lineOpacity: number;
};
const papers: Paper[] = ["blank", "lined", "grid", "dots", "dark"];
/** Legacy defaults preserve the exact original document grid. Never transform ink. */
export function paperSettings(attrs: Record<string, unknown>): PaperSettings {
  const paper = papers.includes(attrs.paper as Paper)
    ? (attrs.paper as Paper)
    : "lined";
  const number = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.min(max, Math.max(min, v))
      : fallback;
  return {
    paper,
    spacing: number(attrs.spacing, paper === "lined" ? 32 : 24, 16, 60),
    lineColor:
      typeof attrs.lineColor === "string" &&
      /^#[0-9a-f]{6}$/i.test(attrs.lineColor)
        ? attrs.lineColor
        : paper === "dark"
          ? "#8293ab"
          : "#b4c0d0",
    lineOpacity: number(attrs.lineOpacity, 0.45, 0.1, 1),
  };
}
