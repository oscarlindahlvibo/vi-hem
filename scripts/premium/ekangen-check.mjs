import fs from "node:fs";
import ts from "typescript";
import assert from "node:assert/strict";
const source = fs.readFileSync(
  new URL("../../src/modules/ekangen/imageUploads.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { uploadImageBatch } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
const calls = [];
const result = await uploadImageBatch(
  ["first", "bad", "last"],
  async (file) => {
    calls.push(file);
    if (file === "bad") throw new Error("QA timeout");
    return `https://example.invalid/${file}`;
  },
);
assert.deepEqual(result.uploaded, [
  "https://example.invalid/first",
  "https://example.invalid/last",
]);
assert.deepEqual(result.failed, ["bad"]);
assert.deepEqual(calls, ["first", "bad", "last"]);
assert.deepEqual(
  await uploadImageBatch([], async () => {
    throw new Error("not called");
  }),
  { uploaded: [], failed: [] },
);
console.log(
  "PASS: partial image failures retain successful files; remaining images still upload; retry list contains only failed files.",
);
