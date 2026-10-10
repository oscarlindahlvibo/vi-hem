import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const c = JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG, "utf8")),
  url = c.url || "http://127.0.0.1:18880";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const s = createClient(url, c.service, { auth: { persistSession: false } }),
  ok = (r) => {
    assert.equal(r.error, null);
    return r.data;
  },
  clients = {};
assert.equal(
  ok(
    await s.from("vihem_organisations").select("name").eq("id", c.org).single(),
  ).name,
  "VI-HEM Chat QA",
);
for (const who of ["oscar", "christofer", "tenant", "outsider"]) {
  const cl = createClient(url, c.anon, { auth: { persistSession: false } });
  ok(
    await cl.auth.signInWithPassword({
      email: c.users[who].email,
      password: c.user_password,
    }),
  );
  clients[who] = cl;
}
const flags = ok(
    await s
      .from("vihem_organisation_modules")
      .select("*")
      .eq("organisation_id", c.org)
      .eq("module_key", "fleet_management"),
  ),
  registry = ok(
    await s
      .from("vihem_module_registry")
      .select("*")
      .eq("module_key", "fleet_management"),
  );
let vehicle, plan;
try {
  if (!registry.length)
    ok(
      await s
        .from("vihem_module_registry")
        .insert({
          module_key: "fleet_management",
          name: "Fleet QA",
          category: "staff",
        }),
    );
  ok(
    await s
      .from("vihem_organisation_modules")
      .upsert({
        organisation_id: c.org,
        module_key: "fleet_management",
        enabled: true,
      }),
  );
  vehicle = ok(
    await s
      .from("vihem_fleet_vehicles")
      .insert({
        organisation_id: c.org,
        name: "Disposable service QA",
        asset_type: "van",
        current_odometer: 100,
        created_by: c.users.oscar.id,
      })
      .select("*")
      .single(),
  );
  plan = ok(
    await s
      .from("vihem_fleet_service_schedules")
      .insert({
        organisation_id: c.org,
        vehicle_id: vehicle.id,
        name: "Motorservice QA",
        interval_months: 2,
        interval_km: 1000,
        created_by: c.users.oscar.id,
      })
      .select("*")
      .single(),
  );
  const args = {
    p_operation: randomUUID(),
    p_vehicle: vehicle.id,
    p_revision: vehicle.updated_at,
    p_schedule: plan.id,
    p_schedule_revision: plan.updated_at,
    p_date: "2026-10-10",
    p_odometer: 200,
    p_performer: "QA verkstad ÅÄÖ",
    p_cost: 1250,
    p_description: "Service QA",
  };
  const send = (who, p = args) =>
    clients[who].rpc("vihem_record_fleet_service", p);
  const duplicate = await Promise.all([send("oscar"), send("oscar")]);
  duplicate.forEach(ok);
  assert.equal(duplicate[0].data, duplicate[1].data);
  assert.equal(
    ok(
      await s
        .from("vihem_fleet_service_records")
        .select("id")
        .eq("vehicle_id", vehicle.id),
    ).length,
    1,
  );
  assert.equal(
    ok(
      await s
        .from("vihem_fleet_costs")
        .select("amount")
        .eq("vehicle_id", vehicle.id)
        .single(),
    ).amount,
    1250,
  );
  assert.equal(
    ok(
      await s
        .from("vihem_fleet_events")
        .select("id")
        .eq("vehicle_id", vehicle.id),
    ).length,
    1,
  );
  const saved = ok(
    await s
      .from("vihem_fleet_service_schedules")
      .select("*")
      .eq("id", plan.id)
      .single(),
  );
  assert.equal(saved.next_due_date, "2026-12-09");
  assert.equal(saved.next_due_odometer, 1200);
  vehicle = ok(
    await s
      .from("vihem_fleet_vehicles")
      .select("*")
      .eq("id", vehicle.id)
      .single(),
  );
  assert.equal(vehicle.current_odometer, 200);
  assert.ok(
    (await send("oscar", { ...args, p_description: "Changed replay" })).error,
  );
  assert.ok(
    (await send("oscar", { ...args, p_operation: randomUUID() })).error,
  );
  for (const who of ["tenant", "outsider", "christofer"])
    assert.ok(
      (
        await send(who, {
          ...args,
          p_operation: randomUUID(),
          p_revision: vehicle.updated_at,
          p_schedule_revision: saved.updated_at,
        })
      ).error,
    );
  const adhoc = {
    ...args,
    p_operation: randomUUID(),
    p_revision: vehicle.updated_at,
    p_schedule: null,
    p_schedule_revision: null,
    p_odometer: 100,
    p_cost: null,
  };
  ok(await send("christofer", adhoc));
  assert.ok(
    (
      await send("christofer", {
        ...adhoc,
        p_operation: randomUUID(),
        p_odometer: 250,
      })
    ).error,
  );
  const failure = {
    ...args,
    p_operation: randomUUID(),
    p_revision: vehicle.updated_at,
    p_schedule_revision: saved.updated_at,
    p_odometer: 300,
    p_description: "Pass8 service rollback",
  };
  if (process.env.QA_SERVICE_FAILURE_TRIGGER === "1") {
    assert.ok((await send("oscar", failure)).error);
    assert.equal(
      ok(
        await s
          .from("vihem_fleet_vehicles")
          .select("current_odometer")
          .eq("id", vehicle.id)
          .single(),
      ).current_odometer,
      200,
    );
    assert.equal(
      ok(
        await s
          .from("vihem_fleet_service_records")
          .select("id")
          .eq("vehicle_id", vehicle.id),
      ).length,
      2,
    );
    assert.equal(
      ok(
        await s
          .from("vihem_fleet_costs")
          .select("id")
          .eq("vehicle_id", vehicle.id),
      ).length,
      1,
    );
    assert.equal(
      ok(
        await s
          .from("vihem_fleet_service_schedules")
          .select("next_due_odometer")
          .eq("id", plan.id)
          .single(),
      ).next_due_odometer,
      1200,
    );
    console.log(
      "PASS post-cost/history failure rolls back service record, schedule, meter and cost.",
    );
  }
  console.log(
    "PASS service atomic record/plan/meter/cost/history, exact duplicate/replay, stale revision, roles/orgs and staff ad-hoc without administrative changes.",
  );
} finally {
  if (vehicle)
    ok(await s.from("vihem_fleet_vehicles").delete().eq("id", vehicle.id));
  if (flags.length)
    ok(await s.from("vihem_organisation_modules").upsert(flags));
  else
    ok(
      await s
        .from("vihem_organisation_modules")
        .delete()
        .eq("organisation_id", c.org)
        .eq("module_key", "fleet_management"),
    );
  if (!registry.length)
    ok(
      await s
        .from("vihem_module_registry")
        .delete()
        .eq("module_key", "fleet_management"),
    );
}
