import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const dir = await mkdtemp(join(tmpdir(), "vihem-ink-"));
try {
  const compile = async (name, path) => {
    const out = join(dir, name + ".mjs");
    await build({
      entryPoints: [path],
      outfile: out,
      bundle: true,
      platform: "node",
      format: "esm",
    });
    return import(pathToFileURL(out).href);
  };
  const { paperSettings } = await compile(
    "paper",
    "src/modules/personal-workspace/handwriting/paper.ts",
  );
  assert.equal(paperSettings({ paper: "lined" }).spacing, 32);
  assert.equal(paperSettings({ paper: "grid" }).spacing, 24);
  assert.equal(paperSettings({ paper: "dots" }).spacing, 24);
  assert.equal(
    paperSettings({
      paper: "lined",
      spacing: 48,
      lineColor: "#345678",
      lineOpacity: 0.8,
    }).spacing,
    48,
  );
  assert.equal(paperSettings({ spacing: Infinity }).spacing, 32);
  assert.equal(paperSettings({ spacing: 300 }).spacing, 60);
  assert.equal(paperSettings({ spacing: 3 }).spacing, 16);
  assert.equal(
    paperSettings({ lineColor: "url(https://invalid)" }).lineColor,
    "#b4c0d0",
  );
  const { documentPoint, zoomAt, pinchCamera, fitCamera } = await compile(
    "camera",
    "src/modules/personal-workspace/handwriting/camera.ts",
  );
  for (const scale of [0.5, 1, 2, 3]) {
    const c = { scale, x: -47, y: 129 },
      p = { x: 260, y: 300 },
      anchor = { x: p.x * scale + c.x, y: p.y * scale + c.y };
    assert.deepEqual(documentPoint(anchor, c), p);
    const next = zoomAt(c, 2.4, anchor);
    assert.ok(Math.abs(documentPoint(anchor, next).x - p.x) < 1e-8);
    assert.ok(Math.abs(documentPoint(anchor, next).y - p.y) < 1e-8);
  }
  const c = { x: 20, y: 40, scale: 1 },
    start = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ],
    end = [
      { x: 80, y: 120 },
      { x: 280, y: 120 },
    ],
    next = pinchCamera(c, start, end);
  assert.equal(next.scale, 2);
  assert.deepEqual(
    documentPoint({ x: 180, y: 120 }, next),
    documentPoint({ x: 150, y: 100 }, c),
  );
  assert.ok(fitCamera(800, 600, true).scale < fitCamera(800, 600, false).scale);
  const { InkInteraction, InkHistory } = await compile(
    "interaction",
    "src/modules/personal-workspace/handwriting/interaction.ts",
  );
  const fresh = (id = "new") => ({
    id,
    note_id: "note",
    page_id: "page",
    stroke: {
      points: [{ x: 10, y: 10, p: 0.4 }],
      width: 3,
      color: "#172b49",
      tool: "pen",
    },
    revision: 0,
    deleted: false,
  });
  const engine = new InkInteraction();
  assert.equal(
    engine.begin(1, { x: 10, y: 10, p: 0.4 }, "pen", [], fresh()),
    true,
  );
  assert.equal(
    engine.begin(2, { x: 20, y: 20, p: 0.5 }, "pen", [], fresh("other")),
    false,
  );
  engine.move(2, [{ x: 90, y: 90, p: 0.5 }], []);
  assert.equal(engine.active.working.stroke.points.length, 1);
  engine.move(1, [{ x: 30, y: 30, p: 0.7 }], []);
  assert.equal(engine.finish(2).length, 0);
  assert.equal(engine.finish(1, true).length, 0);
  const old = fresh("legacy");
  engine.begin(1, { x: 10, y: 10, p: 0.4 }, "erase", [old], fresh());
  assert.equal(engine.finish(1, true).length, 0);
  engine.begin(1, { x: 10, y: 10, p: 0.4 }, "erase", [old], fresh());
  const erased = engine.finish(1);
  assert.equal(erased[0].deleted, true);
  assert.equal(old.deleted, false);
  const history = new InkHistory();
  history.record(erased, [old]);
  assert.equal(history.step("undo", erased)[0].deleted, false);
  assert.equal(history.step("redo", [old])[0].deleted, true);
  engine.begin(3, { x: 10, y: 10, p: 0.4 }, "move", [old], fresh());
  engine.move(3, [{ x: 30, y: 40, p: 0.5 }], [old]);
  const moved = engine.finish(3)[0];
  assert.equal(moved.stroke.points[0].x, 30);
  assert.equal(old.stroke.points[0].x, 10);
  engine.begin(4, { x: 10, y: 10, p: 0.4 }, "pen", [], fresh());
  engine.move(4, [{ x: 20, y: 20, p: 0.7 }], []);
  const stroke = engine.finish(4)[0];
  assert.equal(stroke.stroke.points[1].p, 0.7);
  assert.deepEqual(JSON.parse(JSON.stringify(stroke)), stroke);
  console.log(
    "PASS: legacy paper defaults, spacing/color validation, camera anchor/pinch/fit, pointer identity/cancel, immutable erase/move, ink undo/redo and vector roundtrip",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
