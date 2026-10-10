import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const c = JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG, "utf8"));
const url = c.url || "http://127.0.0.1:18880";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const service = createClient(url, c.service, {
    auth: { persistSession: false },
  }),
  clients = {};
const ok = (r) => {
  assert.equal(r.error, null);
  return r.data;
};
assert.equal(
  ok(
    await service
      .from("vihem_organisations")
      .select("name")
      .eq("id", c.org)
      .single(),
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
const originalRegistry = ok(
  await service
    .from("vihem_module_registry")
    .select("*")
    .eq("module_key", "inventory_management"),
);
const originalModule = ok(
  await service
    .from("vihem_organisation_modules")
    .select("*")
    .eq("organisation_id", c.org)
    .eq("module_key", "inventory_management"),
);
const source = randomUUID(),
  destination = randomUUID(),
  foreign = randomUUID();
const items = [],
  operations = [];
try {
  if (!originalRegistry.length)
    ok(
      await service
        .from("vihem_module_registry")
        .insert({
          module_key: "inventory_management",
          name: "Inventory QA",
          category: "staff",
        }),
    );
  ok(
    await service
      .from("vihem_organisation_modules")
      .upsert({
        organisation_id: c.org,
        module_key: "inventory_management",
        enabled: true,
      }),
  );
  const foreignOrg = ok(
    await service
      .from("vihem_profiles")
      .select("organisation_id")
      .eq("id", c.users.outsider.id)
      .single(),
  ).organisation_id;
  ok(
    await service.from("vihem_inventory_locations").insert([
      {
        id: source,
        organisation_id: c.org,
        name: "Cart QA source",
        type: "warehouse",
      },
      {
        id: destination,
        organisation_id: c.org,
        name: "Cart QA van",
        type: "vehicle",
      },
      {
        id: foreign,
        organisation_id: foreignOrg,
        name: "Cart QA foreign",
        type: "vehicle",
      },
    ]),
  );
  for (const n of [1, 2])
    items.push(
      ok(
        await clients.oscar.rpc("vihem_create_inventory_item", {
          p_operation: randomUUID(),
          p_item: { name: "Cart QA " + n, article_number: randomUUID() },
          p_quantity: 10,
          p_location: source,
        }),
      ),
    );
  const lines = items.map((item_id) => ({ item_id, quantity: 2 }));
  const args = {
    p_operation: randomUUID(),
    p_lines: lines,
    p_source: source,
    p_destination: destination,
    p_project: null,
    p_apartment: null,
    p_notes: "Disposable cart QA",
  };
  const send = (who, p = args) => {
    operations.push(p.p_operation);
    return clients[who].rpc("vihem_checkout_inventory_cart", p);
  };
  const results = await Promise.all([send("christofer"), send("christofer")]);
  for (const r of results) ok(r);
  assert.deepEqual(results[0].data, results[1].data);
  assert.equal(results[0].data.length, 2);
  for (const item of items) {
    assert.equal(
      ok(
        await service
          .from("vihem_inventory_balances")
          .select("quantity")
          .eq("item_id", item)
          .eq("location_id", source)
          .single(),
      ).quantity,
      8,
    );
    assert.equal(
      ok(
        await service
          .from("vihem_inventory_transactions")
          .select("id")
          .eq("item_id", item),
      ).length,
      2,
    );
  }
  assert.ok(
    (await send("christofer", { ...args, p_notes: "Changed replay" })).error,
  );
  const sorted = [...items].sort();
  const fail = {
    ...args,
    p_operation: randomUUID(),
    p_lines: [
      { item_id: sorted[0], quantity: 1 },
      { item_id: sorted[1], quantity: 999 },
    ],
  };
  assert.ok((await send("oscar", fail)).error);
  for (const item of items)
    assert.equal(
      ok(
        await service
          .from("vihem_inventory_balances")
          .select("quantity")
          .eq("item_id", item)
          .eq("location_id", source)
          .single(),
      ).quantity,
      8,
    );
  assert.equal(
    ok(
      await service
        .from("vihem_inventory_cart_operations")
        .select("operation_id")
        .eq("operation_id", fail.p_operation),
    ).length,
    0,
  );
  for (const who of ["tenant", "outsider"])
    assert.ok((await send(who, { ...args, p_operation: randomUUID() })).error);
  assert.ok(
    (
      await send("oscar", {
        ...args,
        p_operation: randomUUID(),
        p_destination: foreign,
      })
    ).error,
  );
  for (const p_lines of [
    [],
    [lines[0], lines[0]],
    [{ item_id: items[0], quantity: 0 }],
    [{ ...lines[0], extra: true }],
  ])
    assert.ok(
      (await send("oscar", { ...args, p_operation: randomUUID(), p_lines }))
        .error,
    );
  const races = await Promise.all(
    [1, 2].map(() =>
      send("oscar", {
        ...args,
        p_operation: randomUUID(),
        p_lines: items.map((item_id) => ({ item_id, quantity: 5 })),
      }),
    ),
  );
  assert.equal(races.filter((r) => !r.error).length, 1);
  // More than the global 100-row preview, including equal timestamps, must remain reachable by article keyset.
  const history = Array.from({ length: 123 }, (_, i) => ({
    organisation_id: c.org,
    item_id: items[0],
    quantity: 1,
    transaction_type: "stock_in",
    destination_location_id: source,
    created_by: c.users.oscar.id,
    created_at: "2026-01-01T00:00:00Z",
    notes: "History QA " + i,
  }));
  ok(await service.from("vihem_inventory_transactions").insert(history));
  const seen = new Set();
  let last = null;
  let more = true;
  while (more) {
    let q = clients.christofer
      .from("vihem_inventory_transactions")
      .select("id,created_at")
      .eq("organisation_id", c.org)
      .eq("item_id", items[0])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(51);
    if (last)
      q = q.or(
        `created_at.lt.${last.created_at},and(created_at.eq.${last.created_at},id.lt.${last.id})`,
      );
    const rows = ok(await q);
    for (const r of rows.slice(0, 50)) {
      assert.ok(!seen.has(r.id));
      seen.add(r.id);
    }
    last = rows.slice(0, 50).at(-1);
    more = rows.length > 50;
  }
  assert.equal(seen.size, 126);
  console.log(
    "PASS cart atomic rollback, duplicate/replay, concurrent carts, references/roles/input, complete article keyset 126 rows with equal timestamps.",
  );
} finally {
  for (const id of items) {
    ok(
      await service
        .from("vihem_inventory_transactions")
        .delete()
        .eq("item_id", id),
    );
    ok(await service.from("vihem_inventory_stock_items").delete().eq("id", id));
  }
  if (operations.length)
    ok(
      await service
        .from("vihem_inventory_cart_operations")
        .delete()
        .in("operation_id", operations),
    );
  ok(
    await service
      .from("vihem_inventory_locations")
      .delete()
      .in("id", [source, destination, foreign]),
  );
  if (originalModule.length)
    ok(await service.from("vihem_organisation_modules").upsert(originalModule));
  else
    ok(
      await service
        .from("vihem_organisation_modules")
        .delete()
        .eq("organisation_id", c.org)
        .eq("module_key", "inventory_management"),
    );
  if (!originalRegistry.length)
    ok(
      await service
        .from("vihem_module_registry")
        .delete()
        .eq("module_key", "inventory_management"),
    );
}
