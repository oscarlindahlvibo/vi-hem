import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { transformWithEsbuild } from "vite";
const code = await transformWithEsbuild(
  await fs.readFile("src/lib/staffResources.ts", "utf8"),
  "staffResources.ts",
  { loader: "ts", format: "esm" },
);
const { matchResourceCode, resourceRequest } = await import(
  "data:text/javascript;base64," + Buffer.from(code.code).toString("base64")
);
const catalog = {
  materials: [
    { id: "a", barcode: "00012345", qr: "shared", code: "A" },
    { id: "b", barcode: "other", qr: "shared", code: "B" },
  ],
  equipment: [{ id: "c", code: "M-1" }],
};
assert.deepEqual(
  matchResourceCode(catalog, " 00012345 ").materials.map((x) => x.id),
  ["a"],
);
assert.deepEqual(
  matchResourceCode(
    catalog,
    "https://app.example.invalid/inventory?item=b",
  ).materials.map((x) => x.id),
  ["b"],
);
assert.deepEqual(
  matchResourceCode(catalog, "vihem:equipment:c").equipment.map((x) => x.id),
  ["c"],
);
assert.equal(
  matchResourceCode(catalog, "shared").materials.length,
  2,
  "ambiguous labels must preserve all candidates",
);
assert.equal(matchResourceCode(catalog, "unknown").equipment.length, 0);
const source = [
  { item_id: "z", location_id: "s", quantity: 3 },
  { item_id: "a", location_id: "t", quantity: 1 },
];
assert.deepEqual(resourceRequest(source, [], "", "  work  "), {
  p_materials: [source[1], source[0]],
  p_equipment: [],
  p_work_order: null,
  p_notes: "work",
});
assert.equal(
  source[0].item_id,
  "z",
  "request normalization must not mutate basket",
);
console.log(
  "PASS resource code routing, ambiguity, leading zeros and stable retry payload",
);
