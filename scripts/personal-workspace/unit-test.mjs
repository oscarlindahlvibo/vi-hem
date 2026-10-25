import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const temporary = await mkdtemp(join(tmpdir(), "vihem-workspace-tests-"));
try {
  const compile = async (name, path) => {
    const out = join(temporary, name + ".mjs");
    await build({
      entryPoints: [path],
      outfile: out,
      bundle: true,
      platform: "node",
      format: "esm",
    });
    return import(pathToFileURL(out).href);
  };
  const { fromLocal, localInput, parseQuick, snoozeAt } = await compile(
    "time",
    "src/modules/personal-workspace/reminders/time.ts",
  );
  assert.equal(fromLocal("2026-10-26T09:00"), "2026-10-26T08:00:00.000Z");
  assert.equal(fromLocal("2026-07-10T09:00"), "2026-07-10T07:00:00.000Z");
  assert.throws(() => fromLocal("2026-03-29T02:30"), /sommartid/);
  assert.equal(fromLocal("2026-10-25T02:30"), "2026-10-25T00:30:00.000Z");
  assert.equal(localInput("2026-10-25T01:30:00Z"), "2026-10-25T02:30");
  assert.deepEqual(
    parseQuick(
      "Påminn mig imorgon kl 09 att ringa banken",
      new Date("2026-10-24T23:30Z"),
    ),
    { title: "ringa banken", local: "2026-10-26T09:00" },
  );
  assert.equal(parseQuick("imorgon kl 29 att ringa"), null);
  assert.equal(parseQuick("någon gång snart"), null);
  assert.equal(
    snoozeAt("tomorrow", new Date("2026-10-24T22:30:00Z")),
    "2026-10-26T08:00:00.000Z",
  );
  assert.equal(
    snoozeAt("hour", new Date("2026-10-25T00:30:00Z")),
    "2026-10-25T01:30:00.000Z",
  );
  const { strokePath, nearStroke, translate } = await compile(
    "geometry",
    "src/modules/personal-workspace/handwriting/geometry.ts",
  );
  const s = {
    id: "one",
    page_id: "page",
    note_id: "note",
    deleted: false,
    revision: 0,
    stroke: {
      points: [
        { x: 10, y: 10, p: 0.5 },
        { x: 100, y: 10, p: 0.7 },
      ],
      color: "#172b49",
      width: 3,
      tool: "pen",
    },
  };
  assert.match(strokePath(s.stroke), /^M /);
  assert.equal(nearStroke({ x: 50, y: 10, p: 0 }, s), true);
  assert.equal(nearStroke({ x: 500, y: 500, p: 0 }, s), false);
  const moved = translate(s, 20, 40);
  assert.equal(moved.stroke.points[0].x, 30);
  assert.equal(s.stroke.points[0].x, 10);
  const line = strokePath({ ...s.stroke, tool: "line" });
  assert.ok(line.length > 0);
  console.log(
    "PASS: Stockholm winter/summer/ambiguous/nonexistent time, Swedish quick capture, vector pressure outline, eraser hit testing, immutable movement",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
