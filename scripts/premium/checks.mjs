import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = fs.readFileSync(
  new URL(
    "../../supabase/functions/vihem-profile-photo/jpeg.ts",
    import.meta.url,
  ),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const { validProfileJpeg } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const jpeg = new Uint8Array(
  fs.readFileSync(new URL("./fixtures/profile.jpg", import.meta.url)),
);
assert.equal(validProfileJpeg(jpeg), true);
assert.equal(
  validProfileJpeg(new Uint8Array([255, 216, 255, 217])),
  false,
  "magic bytes alone are insufficient",
);
assert.equal(validProfileJpeg(jpeg.slice(0, -2)), false, "truncation rejected");
const oversized = new Uint8Array(jpeg);
let frame = -1;
for (let i = 2; i < oversized.length - 8; i++)
  if (oversized[i] === 255 && [192, 193, 194].includes(oversized[i + 1])) {
    frame = i;
    break;
  }
assert.ok(frame > 0);
oversized[frame + 7] = 255;
oversized[frame + 8] = 255;
assert.equal(
  validProfileJpeg(oversized),
  false,
  "huge dimension headers rejected",
);
const invalidLength = new Uint8Array(jpeg);
invalidLength[4] = 255;
invalidLength[5] = 255;
assert.equal(
  validProfileJpeg(invalidLength),
  false,
  "out-of-bounds segments rejected",
);
assert.equal(
  validProfileJpeg(new TextEncoder().encode('<svg onload="alert(1)"></svg>')),
  false,
  "active content rejected",
);
console.log(
  "PASS: profile JPEG header bounds, dimensions, truncation and active-content rejection.",
);

const registrySource = fs.readFileSync(
  new URL("../../src/lib/unsavedForms.ts", import.meta.url),
  "utf8",
);
const registryCode = ts.transpileModule(registrySource, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const registry = await import(
  "data:text/javascript;base64," + Buffer.from(registryCode).toString("base64")
);
assert.equal(registry.hasUnsavedForms(), false);
const closeFirst = registry.registerUnsavedForm();
const closeSecond = registry.registerUnsavedForm();
closeFirst();
assert.equal(
  registry.hasUnsavedForms(),
  true,
  "closing one dirty form must preserve another",
);
closeFirst();
assert.equal(registry.hasUnsavedForms(), true, "cleanup is idempotent");
closeSecond();
assert.equal(registry.hasUnsavedForms(), false);
console.log("PASS: independent dirty forms and idempotent cleanup.");
