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
const id = randomUUID();
try {
  assert.equal(
    (
      await clients.christofer
        .from("vihem_staff_absence_requests")
        .insert({
          id,
          organisation_id: c.org,
          user_id: c.users.christofer.id,
          absence_type: "vacation",
          start_date: "2026-10-10",
          end_date: "2026-10-11",
          comment: "Pass7 disposable absence review QA",
        })
    ).error,
    null,
  );
  for (const who of ["tenant", "outsider"]) {
    const r = await clients[who]
      .from("vihem_staff_absence_requests")
      .select("id")
      .eq("id", id);
    assert.equal(r.error, null);
    assert.equal(r.data.length, 0);
  }
  const denied = await clients.christofer
    .from("vihem_staff_absence_requests")
    .update({
      status: "approved",
      reviewed_by: c.users.christofer.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);
  assert.ok(denied.error);
  const reviews = await Promise.all(
    ["approved", "rejected"].map((status) =>
      clients.oscar
        .from("vihem_staff_absence_requests")
        .update({
          status,
          reviewed_by: c.users.oscar.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "submitted")
        .select("id"),
    ),
  );
  for (const r of reviews) assert.equal(r.error, null);
  assert.deepEqual(reviews.map((r) => r.data.length).sort(), [0, 1]);
  const saved = (
    await service
      .from("vihem_staff_absence_requests")
      .select("status,reviewed_by")
      .eq("id", id)
      .single()
  ).data;
  assert.ok(["approved", "rejected"].includes(saved.status));
  assert.equal(saved.reviewed_by, c.users.oscar.id);
  console.log(
    "PASS staff creates request; tenant/foreign cannot read; staff cannot approve; simultaneous conditional decisions have one winner and persisted reviewer.",
  );
} finally {
  assert.equal(
    (await service.from("vihem_staff_absence_requests").delete().eq("id", id))
      .error,
    null,
  );
}
