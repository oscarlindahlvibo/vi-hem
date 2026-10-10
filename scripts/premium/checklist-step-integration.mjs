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
const id = randomUUID(),
  a = randomUUID(),
  b = randomUUID();
const call = (who, item, completed = true, expected = false) =>
  clients[who].rpc("vihem_set_checklist_step", {
    p_instance: id,
    p_item: item,
    p_completed: completed,
    p_expected: expected,
  });
try {
  assert.equal(
    (
      await service
        .from("vihem_checklist_instances")
        .insert({ id, organisation_id: c.org, title: "Atomic checklist QA" })
    ).error,
    null,
  );
  assert.equal(
    (
      await service.from("vihem_checklist_instance_items").insert([
        { id: a, instance_id: id, label: "Första", required: true },
        { id: b, instance_id: id, label: "Andra", required: false },
      ])
    ).error,
    null,
  );
  for (const who of ["tenant", "outsider"])
    assert.ok((await call(who, a)).error);
  assert.equal((await call("oscar", a, true, true)).error?.code, "P0001");
  assert.equal((await call("christofer", a)).error, null);
  assert.equal(
    (
      await service
        .from("vihem_checklist_instances")
        .select("status")
        .eq("id", id)
        .single()
    ).data.status,
    "in_progress",
  );
  const original = (
    await service
      .from("vihem_checklist_instance_items")
      .select("completed_at,completed_by")
      .eq("id", a)
      .single()
  ).data;
  const repeated = await Promise.all([call("oscar", a), call("christofer", a)]);
  for (const r of repeated) assert.equal(r.error, null);
  assert.deepEqual(
    (
      await service
        .from("vihem_checklist_instance_items")
        .select("completed_at,completed_by")
        .eq("id", a)
        .single()
    ).data,
    original,
  );
  const last = await Promise.all([call("christofer", b), call("oscar", b)]);
  for (const r of last) assert.equal(r.error, null);
  assert.equal(
    (
      await service
        .from("vihem_checklist_instances")
        .select("status")
        .eq("id", id)
        .single()
    ).data.status,
    "completed",
  );
  assert.ok((await call("oscar", a, false, true)).error);
  console.log(
    "PASS staff step, preserved author/time on concurrent retry, last step finalizes, tenant/foreign denied and completed instance cannot reopen.",
  );
} finally {
  assert.equal(
    (await service.from("vihem_checklist_instances").delete().eq("id", id))
      .error,
    null,
  );
}
