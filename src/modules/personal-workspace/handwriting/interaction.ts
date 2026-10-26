import type { Point, Stroke } from "../types";
import { nearStroke, translate } from "./geometry";
export type Tool = "pen" | "highlight" | "erase" | "move" | "line" | "pan";
type Active = {
  tool: Tool;
  pointer: number;
  start: Point;
  original: Stroke;
  working: Stroke;
  erase?: Stroke[];
};
/** Pointer identity is independent of touch navigation. Only pointerup commits. */
export class InkInteraction {
  active: Active | null = null;
  begin(
    pointer: number,
    p: Point,
    tool: Tool,
    strokes: Stroke[],
    fresh: Stroke,
  ): boolean {
    if (this.active) return false;
    const hit = [...strokes].reverse().find((s) => nearStroke(p, s));
    if (tool === "pan") return false;
    if (tool === "move" && !hit) return false;
    this.active = {
      tool,
      pointer,
      start: p,
      original: tool === "move" ? hit! : fresh,
      working: tool === "move" ? hit! : fresh,
      ...(tool === "erase"
        ? { erase: strokes.filter((s) => nearStroke(p, s)) }
        : {}),
    };
    return true;
  }
  move(pointer: number, points: Point[], strokes: Stroke[]) {
    const a = this.active;
    if (!a || a.pointer !== pointer || !points.length) return;
    const last = points[points.length - 1];
    if (a.erase) {
      for (const s of strokes)
        if (
          !a.erase.some((x) => x.id === s.id) &&
          points.some((p) => nearStroke(p, s))
        )
          a.erase.push(s);
      return;
    }
    if (a.tool === "move") {
      a.working = translate(a.original, last.x - a.start.x, last.y - a.start.y);
      return;
    }
    let next = [...a.working.stroke.points, ...points];
    if (next.length > 12000)
      next = next.filter((_, i) => i % 2 === 0 || i === next.length - 1);
    a.working = { ...a.working, stroke: { ...a.working.stroke, points: next } };
  }
  finish(pointer: number, cancel = false): Stroke[] {
    const a = this.active;
    if (!a || a.pointer !== pointer) return [];
    this.active = null;
    return cancel
      ? []
      : a.erase
        ? a.erase.map((s) => ({ ...s, deleted: true }))
        : [a.working];
  }
}
export class InkHistory {
  undo: Stroke[][] = [];
  redo: Stroke[][] = [];
  record(changes: Stroke[], all: Stroke[]) {
    this.undo.push(
      changes.map(
        (s) => all.find((a) => a.id === s.id) || { ...s, deleted: true },
      ),
    );
    if (this.undo.length > 100) this.undo.shift();
    this.redo = [];
  }
  step(direction: "undo" | "redo", all: Stroke[]): Stroke[] {
    const from = this[direction],
      to = this[direction === "undo" ? "redo" : "undo"];
    const changes = from.pop() || [];
    if (changes.length)
      to.push(changes.map((s) => all.find((a) => a.id === s.id) || s));
    return changes;
  }
}
