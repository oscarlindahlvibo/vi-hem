import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const c = JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG, "utf8")),
  url = c.url || "http://127.0.0.1:18880";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const service = createClient(url, c.service, {
    auth: { persistSession: false },
  }),
  clients = {};
for (const who of ["oscar", "christofer", "tenant", "outsider"]) {
  const cl = createClient(url, c.anon, { auth: { persistSession: false } });
  assert.equal(
    (
      await cl.auth.signInWithPassword({
        email: c.users[who].email,
        password: c.user_password,
      })
    ).error,
    null,
  );
  clients[who] = cl;
}
assert.equal(
  (
    await service
      .from("vihem_organisations")
      .select("name")
      .eq("id", c.org)
      .single()
  ).data.name,
  "VI-HEM Chat QA",
);
let id;
const p = {
  p_operation: randomUUID(),
  p_vehicle: null,
  p_expected: null,
  p_fields: {
    name: "Atomic fleet QA",
    asset_type: "implement",
    status: "in_service",
  },
  p_inspection: {
    last_inspection_date: "2026-01-01",
    next_inspection_date: "2027-01-01",
  },
  p_source: {
    url: "https://qa.example.invalid/asset",
    extracted: { make: "QA" },
    last_inspection_date: "2026-01-01",
    next_inspection_date: "2027-01-01",
  },
};
const send = (who, r) => clients[who].rpc("vihem_save_fleet_editor", r);
try {
  const dup = await Promise.all([send("oscar", p), send("oscar", p)]);
  for (const r of dup) assert.equal(r.error, null);
  assert.equal(dup[0].data, dup[1].data);
  id = dup[0].data;
  assert.equal(
    (await service.from("vihem_fleet_events").select("id").eq("vehicle_id", id))
      .data.length,
    1,
  );
  assert.equal(
    (
      await service
        .from("vihem_fleet_inspections")
        .select("id")
        .eq("vehicle_id", id)
    ).data.length,
    1,
  );
  assert.equal(
    (
      await service
        .from("vihem_fleet_vehicle_sources")
        .select("id")
        .eq("vehicle_id", id)
    ).data.length,
    1,
  );
  const original = (
    await service
      .from("vihem_fleet_vehicles")
      .select("updated_at")
      .eq("id", id)
      .single()
  ).data.updated_at;
  const edit = {
    ...p,
    p_operation: randomUUID(),
    p_vehicle: id,
    p_expected: original,
    p_fields: { ...p.p_fields, status: "workshop" },
    p_inspection: null,
  };
  assert.equal((await send("oscar", edit)).error, null);
  assert.equal((await send("oscar", edit)).error, null);
  assert.equal(
    (await service.from("vihem_fleet_events").select("id").eq("vehicle_id", id))
      .data.length,
    2,
  );
  const stale = await send("oscar", {
    ...edit,
    p_operation: randomUUID(),
    p_fields: { ...edit.p_fields, name: "stale" },
  });
  assert.equal(stale.error?.code, "P0001", JSON.stringify(stale.error));
  const current = (
    await service
      .from("vihem_fleet_vehicles")
      .select("updated_at")
      .eq("id", id)
      .single()
  ).data.updated_at;
  const bad = {
    ...edit,
    p_operation: randomUUID(),
    p_expected: current,
    p_fields: { ...edit.p_fields, status: "in_service" },
    p_inspection: {
      last_inspection_date: "invalid-date",
      next_inspection_date: null,
    },
  };
  assert.ok((await send("oscar", bad)).error);
  assert.equal(
    (
      await service
        .from("vihem_fleet_vehicles")
        .select("status,updated_at")
        .eq("id", id)
        .single()
    ).data.status,
    "workshop",
  );
  assert.equal(
    (await service.from("vihem_fleet_events").select("id").eq("vehicle_id", id))
      .data.length,
    2,
  );
  for (const who of ["christofer", "tenant", "outsider"])
    assert.ok(
      (
        await send(who, {
          ...edit,
          p_operation: randomUUID(),
          p_expected: current,
        })
      ).error,
    );
  assert.ok(
    (
      await send("oscar", {
        ...edit,
        p_operation: randomUUID(),
        p_expected: current,
        p_fields: { ...edit.p_fields, organisation_id: c.org },
      })
    ).error,
  );
  console.log(
    "PASS create with inspection and one history event, concurrent retry once, status+history atomic, stale editor denied, later inspection error rolls back vehicle/history, staff/tenant/foreign and injected org rejected.",
  );
} finally {
  if (id)
    assert.equal(
      (await service.from("vihem_fleet_vehicles").delete().eq("id", id)).error,
      null,
    );
}
