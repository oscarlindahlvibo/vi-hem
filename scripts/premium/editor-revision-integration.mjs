import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const c = JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG, "utf8")),
  url = c.url || "http://127.0.0.1:18880";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const service = createClient(url, c.service, {
  auth: { persistSession: false },
});
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
const admin = createClient(url, c.anon, { auth: { persistSession: false } });
assert.equal(
  (
    await admin.auth.signInWithPassword({
      email: c.users.oscar.email,
      password: c.user_password,
    })
  ).error,
  null,
);
const ids = {
  vihem_inventory_stock_items: randomUUID(),
  vihem_schedule_entries: randomUUID(),
};
try {
  assert.equal(
    (
      await service
        .from("vihem_inventory_stock_items")
        .insert({
          id: ids.vihem_inventory_stock_items,
          organisation_id: c.org,
          name: "Revision QA",
        })
    ).error,
    null,
  );
  assert.equal(
    (
      await service
        .from("vihem_schedule_entries")
        .insert({
          id: ids.vihem_schedule_entries,
          organisation_id: c.org,
          user_id: c.users.christofer.id,
          title: "Revision QA",
          start_date: "2026-10-10",
          end_date: "2026-10-10",
          entry_type: "note",
          created_by: c.users.oscar.id,
        })
    ).error,
    null,
  );
  for (const [table, id] of Object.entries(ids)) {
    const field = table === "vihem_schedule_entries" ? "title" : "name";
    const expected = (
      await service.from(table).select("updated_at").eq("id", id).single()
    ).data.updated_at;
    const updates = await Promise.all(
      ["A", "B"].map((value) =>
        admin
          .from(table)
          .update({ [field]: "Revision QA " + value })
          .eq("id", id)
          .eq("updated_at", expected)
          .select("id"),
      ),
    );
    for (const response of updates) assert.equal(response.error, null);
    assert.deepEqual(updates.map((r) => r.data.length).sort(), [0, 1]);
    const changed = (
      await service.from(table).select("updated_at").eq("id", id).single()
    ).data.updated_at;
    assert.notEqual(changed, expected);
    assert.equal(
      (
        await admin
          .from(table)
          .update({ [field]: "Revision QA legacy writer" })
          .eq("id", id)
      ).error,
      null,
    );
    assert.notEqual(
      (await service.from(table).select("updated_at").eq("id", id).single())
        .data.updated_at,
      changed,
    );
  }
  console.log(
    "PASS simultaneous editors: exactly one update accepted for inventory/schedule; old writer also advances revision.",
  );
} finally {
  for (const [table, id] of Object.entries(ids))
    assert.equal((await service.from(table).delete().eq("id", id)).error, null);
}
