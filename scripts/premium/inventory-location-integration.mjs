import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const c = JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG, "utf8")),
  url = c.url || "http://127.0.0.1:18880";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const s = createClient(url, c.service, { auth: { persistSession: false } }),
  clients = {},
  ok = (r) => {
    assert.equal(r.error, null);
    return r.data;
  };
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
const ids = [];
let item;
const create = {
  p_operation: randomUUID(),
  p_id: null,
  p_revision: null,
  p_name: "Disposable location QA",
  p_type: "warehouse",
  p_parent: null,
  p_code: "ÅÄÖ",
};
try {
  const replay = await Promise.all([
    clients.oscar.rpc("vihem_save_inventory_location", create),
    clients.oscar.rpc("vihem_save_inventory_location", create),
  ]);
  replay.forEach(ok);
  assert.equal(replay[0].data, replay[1].data);
  const parent = replay[0].data;
  ids.push(parent);
  const child = ok(
    await clients.oscar.rpc("vihem_save_inventory_location", {
      ...create,
      p_operation: randomUUID(),
      p_name: "Child QA",
      p_parent: parent,
      p_type: "shelf",
    }),
  );
  ids.push(child);
  const get = async (id) =>
    ok(
      await s
        .from("vihem_inventory_locations")
        .select("*")
        .eq("id", id)
        .single(),
    );
  let p = await get(parent);
  assert.ok(
    (
      await clients.oscar.rpc("vihem_save_inventory_location", {
        ...create,
        p_operation: randomUUID(),
        p_id: parent,
        p_revision: p.updated_at,
        p_parent: child,
      })
    ).error,
  );
  assert.ok(
    (
      await clients.oscar.rpc("vihem_archive_inventory_location", {
        p_id: parent,
        p_revision: p.updated_at,
      })
    ).error,
  );
  const edit = {
    ...create,
    p_id: parent,
    p_revision: p.updated_at,
    p_name: "Edited QA",
  };
  const race = await Promise.all(
    [1, 2].map(() =>
      clients.oscar.rpc("vihem_save_inventory_location", {
        ...edit,
        p_operation: randomUUID(),
      }),
    ),
  );
  assert.equal(race.filter((r) => !r.error).length, 1);
  for (const who of ["christofer", "tenant"])
    assert.ok(
      (
        await clients[who].rpc("vihem_save_inventory_location", {
          ...create,
          p_operation: randomUUID(),
        })
      ).error,
    );
  assert.ok(
    (
      await clients.outsider.rpc("vihem_save_inventory_location", {
        ...edit,
        p_operation: randomUUID(),
      })
    ).error,
  );
  item = ok(
    await clients.oscar.rpc("vihem_create_inventory_item", {
      p_operation: randomUUID(),
      p_item: { name: "Location balance QA", article_number: randomUUID() },
      p_quantity: 1,
      p_location: child,
    }),
  );
  let ch = await get(child);
  assert.ok(
    (
      await clients.oscar.rpc("vihem_archive_inventory_location", {
        p_id: child,
        p_revision: ch.updated_at,
      })
    ).error,
  );
  ok(
    await clients.oscar.rpc("vihem_save_inventory_movement", {
      p_operation: randomUUID(),
      p_item: item,
      p_quantity: 1,
      p_type: "stock_out",
      p_source: child,
      p_destination: null,
      p_project: null,
      p_work_order: null,
      p_notes: "Empty before archive",
    }),
  );
  ok(
    await clients.oscar.rpc("vihem_archive_inventory_location", {
      p_id: child,
      p_revision: ch.updated_at,
    }),
  );
  assert.equal((await get(child)).active, false);
  assert.ok(
    (
      await s
        .from("vihem_inventory_balances")
        .update({ quantity: 2 })
        .eq("item_id", item)
    ).error,
    "balance trigger blocks stale write to archived location",
  );
  p = await get(parent);
  ok(
    await clients.oscar.rpc("vihem_archive_inventory_location", {
      p_id: parent,
      p_revision: p.updated_at,
    }),
  );
  assert.equal(
    ok(
      await s
        .from("vihem_inventory_transactions")
        .select("destination_location_id")
        .eq("item_id", item)
        .eq("transaction_type", "stock_in")
        .single(),
    ).destination_location_id,
    child,
  );
  console.log(
    "PASS location create/replay, cycles/children, revision race, role guards, balance refusal, archive after withdrawal, stale balance blocked and history reference retained.",
  );
} finally {
  if (item) {
    ok(
      await s.from("vihem_inventory_transactions").delete().eq("item_id", item),
    );
    ok(await s.from("vihem_inventory_stock_items").delete().eq("id", item));
  }
  for (const id of ids.reverse())
    ok(await s.from("vihem_inventory_locations").delete().eq("id", id));
}
