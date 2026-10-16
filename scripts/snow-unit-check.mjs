import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";
import { webcrypto } from "node:crypto";
const compile = (s) =>
  ts.transpileModule(s, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const {
  routeGeometry,
  geometryPoints,
  geometrySegments,
  segmentedGeometry,
  sortRoutes,
  snowClientColors,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compile(fs.readFileSync("src/modules/snow/model.ts", "utf8"))).toString("base64")}`
);
const points = [
  [15.58, 57.31],
  [15.59, 57.32],
  [15.6, 57.31],
];
assert.deepEqual(geometryPoints(routeGeometry(points, true)), points);
assert.equal(routeGeometry(points, false).type, "LineString");
assert.throws(() => routeGeometry(points.slice(0, 1), false));
assert.throws(() =>
  routeGeometry(
    [
      [999, 57],
      [16, 58],
    ],
    false,
  ),
);
assert.deepEqual(
  sortRoutes([
    { priority: 2, name: "B" },
    { priority: 1, name: "A" },
  ]).map((r) => r.name),
  ["A", "B"],
);
const branches = [
  points,
  [
    [15.8, 57.4],
    [15.9, 57.4],
  ],
];
assert.equal(segmentedGeometry(branches, false).type, "MultiLineString");
assert.deepEqual(
  geometrySegments(segmentedGeometry(branches, false)),
  branches,
);
assert.deepEqual(geometrySegments(routeGeometry(points, false)), [points]);
assert.deepEqual(geometrySegments(routeGeometry(points, true)), [points]);
assert.throws(() => segmentedGeometry([points, []], false));
assert.throws(() => segmentedGeometry(branches, true));
assert.throws(() =>
  segmentedGeometry(
    Array.from({ length: 101 }, () => points),
    false,
  ),
);
assert.throws(() =>
  segmentedGeometry(
    [
      Array.from({ length: 1500 }, () => points[0]),
      Array.from({ length: 501 }, () => points[0]),
    ],
    false,
  ),
);
const ids = ["customer-a", "customer-k", "customer-u"]; // deliberately collide in the ten-colour palette
const colors = snowClientColors(ids);
assert.equal(new Set(Object.values(colors)).size, 3);
assert.deepEqual(snowClientColors([...ids].reverse()), colors);
assert.deepEqual(snowClientColors([...ids, ids[0]]), colors);
assert.equal(
  Object.values(
    snowClientColors(Array.from({ length: 10 }, (_, i) => String(i))),
  ).length,
  10,
);
assert.equal(
  new Set(
    Object.values(
      snowClientColors(Array.from({ length: 10 }, (_, i) => String(i))),
    ),
  ).size,
  10,
);
const source = fs
  .readFileSync("supabase/functions/vihem-create-user/index.ts", "utf8")
  .replace(/^import .*;\s*$/gm, "");
async function create(
  callerRole,
  active,
  body,
  failProfile = false,
  ready = true,
) {
  let handler,
    upsert,
    deleted = false,
    created = false;
  const userClient = {
    rpc: async () => ({ data: ready, error: null }),
    auth: {
      getUser: async () => ({ data: { user: { id: "caller" } }, error: null }),
    },
  };
  const admin = {
    from(table) {
      if (table === "vihem_profiles")
        return {
          select(_s, opt) {
            if (opt?.head)
              return { eq: async () => ({ count: 0, error: null }) };
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: {
                      role: callerRole,
                      active,
                      organisation_id: "own-org",
                    },
                    error: null,
                  }),
                };
              },
            };
          },
          upsert: async (row) => {
            upsert = row;
            return {
              error: failProfile ? { message: "synthetic failure" } : null,
            };
          },
        };
      if (table === "vihem_organisations")
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: { max_users: 99 },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      throw Error("Unexpected table");
    },
    auth: {
      admin: {
        createUser: async () => {
          created = true;
          return { data: { user: { id: "new-user" } }, error: null };
        },
        deleteUser: async () => {
          deleted = true;
          return { error: null };
        },
        generateLink: async () => ({ data: {}, error: null }),
      },
    },
  };
  const code = compile(source);
  vm.runInNewContext(code, {
    Deno: {
      env: { get: () => "synthetic" },
      serve: (fn) => {
        handler = fn;
      },
    },
    createClient: (_a, _b, options) => (options ? userClient : admin),
    Request,
    Response,
    Headers,
    crypto: webcrypto,
    console: { error: () => {} },
  });
  const response = await handler(
    new Request("https://example.invalid/create", {
      method: "POST",
      headers: {
        Authorization: "Bearer synthetic",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, upsert, deleted, created };
}
const input = {
  name: "QA Snow",
  email: "qa@example.invalid",
  role: "snow",
  organisation_id: "foreign-org",
  snow_time_access: true,
};
const allowed = await create("admin", true, input);
assert.equal(allowed.status, 200);
assert.equal(allowed.upsert.organisation_id, "own-org");
assert.equal(allowed.upsert.snow_time_access, true);
assert.equal((await create("staff", true, input)).status, 403);
assert.equal((await create("admin", false, input)).status, 403);
assert.equal(
  (await create("admin", true, { ...input, role: "invented" })).status,
  400,
);
const failed = await create("admin", true, input, true);
assert.equal(failed.status, 500);
assert.equal(failed.deleted, true);
assert.equal(
  (await create("admin", true, { ...input, snow_time_access: false })).upsert
    .snow_time_access,
  false,
);
const gated = await create("admin", true, input, false, false);
assert.equal(gated.status, 409);
assert.equal(gated.created, false);
console.log(
  "PASS snow geometry/priority and create-user admin/inactive/role/org/cleanup tests (isolated transports)",
);
