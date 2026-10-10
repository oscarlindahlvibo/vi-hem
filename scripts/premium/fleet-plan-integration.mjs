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
        name: "Disposable plan QA",
        asset_type: "van",
        current_odometer: 100,
      })
      .select("*")
      .single(),
  );
  const fields = {
    name: "Årlig service",
    interval_km: 1000,
    interval_hours: null,
    interval_months: 12,
    next_due_date: "2027-10-10",
    next_due_odometer: 1100,
    next_due_hours: null,
    notes: "ÅÄÖ",
    active: true,
  };
  const request = {
    p_operation: randomUUID(),
    p_vehicle: vehicle.id,
    p_plan: null,
    p_expected: null,
    p_fields: fields,
  };
  const results = await Promise.all([
    clients.oscar.rpc("vihem_save_fleet_service_plan", request),
    clients.oscar.rpc("vihem_save_fleet_service_plan", request),
  ]);
  plan = ok(results[0]);
  assert.equal(ok(results[1]), plan);
  assert.equal(
    ok(
      await s
        .from("vihem_fleet_service_schedules")
        .select("id")
        .eq("vehicle_id", vehicle.id),
    ).length,
    1,
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
  const original = ok(
    await s
      .from("vihem_fleet_service_schedules")
      .select("*")
      .eq("id", plan)
      .single(),
  );
  const edit = {
    ...request,
    p_plan: plan,
    p_expected: original.updated_at,
    p_fields: { ...fields, name: "Uppdaterad plan" },
  };
  const races = await Promise.all([
    clients.oscar.rpc("vihem_save_fleet_service_plan", {
      ...edit,
      p_operation: randomUUID(),
    }),
    clients.oscar.rpc("vihem_save_fleet_service_plan", {
      ...edit,
      p_operation: randomUUID(),
    }),
  ]);
  assert.equal(races.filter((r) => !r.error).length, 1);
  assert.equal(races.filter((r) => r.error).length, 1);
  for (const who of ["christofer", "tenant", "outsider"])
    assert.ok(
      (
        await clients[who].rpc("vihem_save_fleet_service_plan", {
          ...request,
          p_operation: randomUUID(),
        })
      ).error,
      who + " forbidden",
    );
  assert.ok(
    (
      await clients.oscar.rpc("vihem_save_fleet_service_plan", {
        ...request,
        p_operation: randomUUID(),
        p_fields: { ...fields, interval_km: -1 },
      })
    ).error,
  );
  assert.ok(
    (
      await clients.oscar.rpc("vihem_save_fleet_service_plan", {
        ...request,
        p_fields: { ...fields, name: "changed replay" },
      })
    ).error,
  );
  let current = ok(
    await s
      .from("vihem_fleet_service_schedules")
      .select("*")
      .eq("id", plan)
      .single(),
  );
  ok(
    await s
      .from("vihem_fleet_service_schedules")
      .update({ notes: "legacy client update" })
      .eq("id", plan),
  );
  assert.ok(
    (
      await clients.oscar.rpc("vihem_save_fleet_service_plan", {
        ...edit,
        p_operation: randomUUID(),
        p_expected: current.updated_at,
      })
    ).error,
    "legacy writer invalidates revision",
  );
  current = ok(
    await s
      .from("vihem_fleet_service_schedules")
      .select("*")
      .eq("id", plan)
      .single(),
  );
  ok(
    await clients.oscar.rpc("vihem_save_fleet_service_plan", {
      ...edit,
      p_operation: randomUUID(),
      p_expected: current.updated_at,
      p_fields: { ...fields, active: false },
    }),
  );
  assert.equal(
    ok(
      await s
        .from("vihem_fleet_service_schedules")
        .select("active")
        .eq("id", plan)
        .single(),
    ).active,
    false,
  );
  assert.equal(
    ok(
      await s
        .from("vihem_fleet_events")
        .select("id")
        .eq("vehicle_id", vehicle.id),
    ).length,
    3,
  );
  for(const bad of ['NaN','Infinity','-Infinity']) assert.ok((await clients.oscar.rpc('vihem_save_fleet_service_plan',{...request,p_operation:randomUUID(),p_fields:{...fields,interval_hours:bad}})).error,'non-numeric interval rejected');
  console.log(
    "PASS plan concurrent create/replay exactly one event; edit race/CAS; legacy writer; archive keeps history; invalid/reused request; staff/tenant/foreign denied.",
  );
} finally {
  if (vehicle) {
    if (plan)
      ok(
        await s
          .from("vihem_fleet_plan_operations")
          .delete()
          .eq("plan_id", plan),
      );
    ok(
      await s.from("vihem_fleet_events").delete().eq("vehicle_id", vehicle.id),
    );
    ok(
      await s
        .from("vihem_fleet_service_schedules")
        .delete()
        .eq("vehicle_id", vehicle.id),
    );
    ok(await s.from("vihem_fleet_vehicles").delete().eq("id", vehicle.id));
  }
  ok(
    await s
      .from("vihem_organisation_modules")
      .delete()
      .eq("organisation_id", c.org)
      .eq("module_key", "fleet_management"),
  );
  if (flags.length)
    ok(await s.from("vihem_organisation_modules").insert(flags));
  if (!registry.length)
    ok(
      await s
        .from("vihem_module_registry")
        .delete()
        .eq("module_key", "fleet_management"),
    );
}
