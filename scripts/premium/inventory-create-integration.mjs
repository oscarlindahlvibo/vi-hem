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
const prefix = `Atomic-QA-${randomUUID()}`,
  op = randomUUID(),
  loc = randomUUID();
let itemId;
const p = {
  p_operation: op,
  p_item: {
    article_number: prefix,
    name: "Atomiskt startsaldo QA",
    unit: "st",
    purchase_price: 12.5,
  },
  p_quantity: 7,
  p_location: loc,
};
try {
  assert.equal(
    (
      await service
        .from("vihem_inventory_locations")
        .insert({
          id: loc,
          organisation_id: c.org,
          name: prefix,
          type: "warehouse",
        })
    ).error,
    null,
  );
  const results = await Promise.all([
    clients.oscar.rpc("vihem_create_inventory_item", p),
    clients.oscar.rpc("vihem_create_inventory_item", p),
  ]);
  for (const r of results) assert.equal(r.error, null);
  assert.equal(results[0].data, results[1].data);
  itemId = results[0].data;
  assert.equal(
    (
      await service
        .from("vihem_inventory_balances")
        .select("quantity")
        .eq("item_id", itemId)
        .single()
    ).data.quantity,
    7,
  );
  const tx = (
    await service
      .from("vihem_inventory_transactions")
      .select("quantity,unit_cost_snapshot,other_reference")
      .eq("item_id", itemId)
  ).data;
  assert.equal(tx.length, 1);
  assert.equal(tx[0].unit_cost_snapshot, 12.5);
  assert.equal(tx[0].other_reference, "opening_balance");
  assert.ok(
    (
      await clients.oscar.rpc("vihem_create_inventory_item", {
        ...p,
        p_quantity: 8,
      })
    ).error,
  );
  for (const who of ["christofer", "tenant", "outsider"])
    assert.ok(
      (
        await clients[who].rpc("vihem_create_inventory_item", {
          ...p,
          p_operation: randomUUID(),
        })
      ).error,
    );
  const anon = createClient(url, c.anon, { auth: { persistSession: false } });
  assert.ok((await anon.rpc("vihem_create_inventory_item", p)).error);
  assert.ok(
    (
      await clients.oscar.rpc("vihem_create_inventory_item", {
        ...p,
        p_operation: randomUUID(),
        p_location: randomUUID(),
        p_item: { ...p.p_item, article_number: prefix + "-bad" },
      })
    ).error,
  );
  // Positive numeric exceeds balance precision AFTER article insert: transaction must roll back.
  const failure = {
    ...p,
    p_operation: randomUUID(),
    p_quantity: 1e20,
    p_item: { ...p.p_item, article_number: prefix + "-rollback" },
  };
  assert.ok(
    (await clients.oscar.rpc("vihem_create_inventory_item", failure)).error,
  );
  assert.equal(
    (
      await service
        .from("vihem_inventory_stock_items")
        .select("id")
        .eq("article_number", prefix + "-rollback")
    ).data.length,
    0,
  );
  assert.equal(
    (
      await service
        .from("vihem_inventory_create_operations")
        .select("item_id")
        .eq("operation_id", failure.p_operation)
    ).data.length,
    0,
  );
  assert.ok(
    (
      await clients.oscar.rpc("vihem_create_inventory_item", {
        ...p,
        p_operation: randomUUID(),
        p_item: { ...p.p_item, organisation_id: c.org },
      })
    ).error,
  );
  console.log(
    "PASS concurrent duplicate creates exactly one article, balance and movement; altered retry rejected; post-insert overflow rolls back; missing location/unknown keys/roles/anonymous rejected.",
  );
} finally {
  if (itemId) {
    assert.equal(
      (
        await service
          .from("vihem_inventory_transactions")
          .delete()
          .eq("item_id", itemId)
      ).error,
      null,
    );
    assert.equal(
      (
        await service
          .from("vihem_inventory_stock_items")
          .delete()
          .eq("id", itemId)
      ).error,
      null,
    );
  }
  assert.equal(
    (await service.from("vihem_inventory_locations").delete().eq("id", loc))
      .error,
    null,
  );
}
