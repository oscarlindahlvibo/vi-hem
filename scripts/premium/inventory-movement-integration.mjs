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
  const p = {
    p_operation: randomUUID(),
    p_item: item,
    p_quantity: 2,
    p_type: "stock_out",
    p_source: loc,
    p_destination: null,
    p_project: null,
    p_work_order: null,
    p_notes: "QA withdrawal",
  };
  const send = (who, req = p) =>
    clients[who].rpc("vihem_save_inventory_movement", req);
  const duplicate = await Promise.all([send("christofer"), send("christofer")]);
  for (const r of duplicate) assert.equal(r.error, null);
  assert.equal(duplicate[0].data, duplicate[1].data);
  assert.equal(
    (
      await service
        .from("vihem_inventory_balances")
        .select("quantity")
        .eq("item_id", item)
        .single()
    ).data.quantity,
    5,
  );
  assert.ok((await send("christofer", { ...p, p_quantity: 3 })).error);
  for (const who of ["tenant", "outsider"])
    assert.ok((await send(who, { ...p, p_operation: randomUUID() })).error);
  assert.ok(
    (
      await send("oscar", {
        ...p,
        p_operation: randomUUID(),
        p_type: "transfer",
        p_destination: foreign,
      })
    ).error,
  );
  assert.ok(
    (
      await send("oscar", {
        ...p,
        p_operation: randomUUID(),
        p_type: "transfer",
        p_destination: loc,
      })
    ).error,
  );
  const race = await Promise.all([
    send("oscar", { ...p, p_operation: randomUUID(), p_quantity: 4 }),
    send("christofer", { ...p, p_operation: randomUUID(), p_quantity: 4 }),
  ]);
  assert.equal(race.filter((r) => !r.error).length, 1);
  assert.equal(
    (
      await service
        .from("vihem_inventory_balances")
        .select("quantity")
        .eq("item_id", item)
        .single()
    ).data.quantity,
    1,
  );
  assert.equal(
    (
      await service
        .from("vihem_inventory_transactions")
        .select("id")
        .eq("item_id", item)
    ).data.length,
    3,
  );
  console.log(
    "PASS simultaneous duplicate withdrawal once; unchanged replay; changed retry denied; competing withdrawals cannot overdraw; foreign/self-transfer and tenant/foreign actors rejected.",
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
