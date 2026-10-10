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
const loc = randomUUID(),
  foreign = randomUUID();
let item;
const otherOrg = (
  await service
    .from("vihem_profiles")
    .select("organisation_id")
    .eq("id", c.users.outsider.id)
    .single()
).data.organisation_id;
try {
  assert.equal(
    (
      await service.from("vihem_inventory_locations").insert([
        {
          id: loc,
          organisation_id: c.org,
          name: "Movement QA",
          type: "warehouse",
        },
        {
          id: foreign,
          organisation_id: otherOrg,
          name: "Foreign movement QA",
          type: "warehouse",
        },
      ])
    ).error,
    null,
  );
  const created = await clients.oscar.rpc("vihem_create_inventory_item", {
    p_operation: randomUUID(),
    p_item: { name: "Movement QA", article_number: randomUUID() },
    p_quantity: 7,
    p_location: loc,
  });
  assert.equal(created.error, null);
  item = created.data;
  const probe = await clients.oscar.rpc("vihem_inventory_apply_transaction", {
    p_item_id: item,
    p_quantity: 1,
    p_transaction_type: "stock_in",
    p_destination_location_id: foreign,
  });
  assert.equal(probe.error?.code, "42501");
  const own = await clients.oscar.rpc("vihem_inventory_apply_transaction", {
    p_item_id: item,
    p_quantity: 1,
    p_transaction_type: "stock_in",
    p_destination_location_id: loc,
  });
  assert.equal(own.error, null);
  assert.equal(
    (
      await service
        .from("vihem_inventory_balances")
        .select("quantity")
        .eq("item_id", item)
        .single()
    ).data.quantity,
    8,
  );
  console.log(
    "PASS legacy RPC foreign destination denied; own-organisation stock-in preserved.",
  );
} finally {
  if (item) {
    assert.equal(
      (
        await service
          .from("vihem_inventory_transactions")
          .delete()
          .eq("item_id", item)
      ).error,
      null,
    );
    assert.equal(
      (
        await service
          .from("vihem_inventory_stock_items")
          .delete()
          .eq("id", item)
      ).error,
      null,
    );
  }
  assert.equal(
    (
      await service
        .from("vihem_inventory_locations")
        .delete()
        .in("id", [loc, foreign])
    ).error,
    null,
  );
}
