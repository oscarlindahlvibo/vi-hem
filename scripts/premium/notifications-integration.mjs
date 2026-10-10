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
  };
assert.equal(
  ok(
    await s.from("vihem_organisations").select("name").eq("id", c.org).single(),
  ).name,
  "VI-HEM Chat QA",
);
const ids = [],
  clients = {};
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
try {
  for (const who of Object.keys(clients)) {
    const id = randomUUID();
    ids.push(id);
    ok(
      await s
        .from("vihem_notifications")
        .insert({
          id,
          user_id: c.users[who].id,
          title: "Disposable owner notification QA",
          message: "ÅÄÖ",
          type: "info",
        }),
    );
    for (const reader of Object.keys(clients)) {
      const rows = ok(
        await clients[reader]
          .from("vihem_notifications")
          .select("id")
          .eq("id", id),
      );
      assert.equal(rows.length, reader === who ? 1 : 0);
      if (reader !== who) {
        assert.equal(
          ok(
            await clients[reader]
              .from("vihem_notifications")
              .update({ read_at: new Date().toISOString() })
              .eq("id", id)
              .select("id"),
          ).length,
          0,
        );
        assert.equal(
          ok(
            await clients[reader]
              .from("vihem_notifications")
              .delete()
              .eq("id", id)
              .select("id"),
          ).length,
          0,
        );
      }
    }
    ok(
      await clients[who]
        .from("vihem_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .select("id")
        .single(),
    );
    assert.ok(
      ok(
        await s
          .from("vihem_notifications")
          .select("read_at")
          .eq("id", id)
          .single(),
      ).read_at,
    );
  }
  const anonymous = createClient(url, c.anon, {
    auth: { persistSession: false },
  });
  const anonymousRead=await anonymous.from('vihem_notifications').select('id').in('id',ids);
  assert.ok(anonymousRead.error || anonymousRead.data.length===0);
  const history = Array.from({ length: 54 }, (_, i) => ({
    id: randomUUID(),
    user_id: c.users.tenant.id,
    title: "Page QA",
    message: "Older history",
    type: "info",
    created_at: i < 51 ? "2026-01-01T00:00:00Z" : null,
  }));
  ids.push(...history.map((r) => r.id));
  ok(await s.from("vihem_notifications").insert(history));
  const seen = new Set();
  let last = null,
    more = true;
  while (more) {
    let q = clients.tenant
      .from("vihem_notifications")
      .select("id,created_at")
      .in(
        "id",
        history.map((r) => r.id),
      )
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(51);
    if (last)
      q = last.created_at
        ? q.or(
            `created_at.lt.${last.created_at},created_at.is.null,and(created_at.eq.${last.created_at},id.lt.${last.id})`,
          )
        : q.is("created_at", null).lt("id", last.id);
    const rows = ok(await q);
    for (const r of rows.slice(0, 50)) {
      assert.ok(!seen.has(r.id));
      seen.add(r.id);
    }
    last = rows.slice(0, 50).at(-1);
    more = rows.length > 50;
  }
  assert.equal(seen.size, 54);
  console.log(
    "PASS notification owner read/update/delete isolation for admin/staff/tenant/foreign, anonymous denied, read persisted, keyset equal timestamps/null dates/older records preserved.",
  );
} finally {
  if (ids.length)
    ok(await s.from("vihem_notifications").delete().in("id", ids));
}
