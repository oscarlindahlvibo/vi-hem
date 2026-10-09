import fs from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const c = JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG, "utf8"));
const url = c.url || "http://127.0.0.1:18880";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
  "Isolated QA only",
);
const clients = {};
for (const who of ["oscar", "christofer", "tenant", "outsider"]) {
  const client = createClient(url, c.anon, { auth: { persistSession: false } });
  assert.equal(
    (
      await client.auth.signInWithPassword({
        email: c.users[who].email,
        password: c.user_password,
      })
    ).error,
    null,
  );
  clients[who] = client;
}
assert.equal(
  (
    await clients.oscar
      .from("vihem_organisations")
      .select("name")
      .eq("id", c.org)
      .single()
  ).data?.name,
  "VI-HEM Chat QA",
);
async function makeOrder(who) {
  const profile = await clients[who]
    .from("vihem_profiles")
    .select("organisation_id")
    .eq("id", c.users[who].id)
    .single();
  assert.equal(profile.error, null);
  const r = await clients[who]
    .from("vihem_work_orders")
    .insert({
      title: `Comment isolation QA ${Date.now()}`,
      organisation_id: profile.data.organisation_id,
      created_by: c.users[who].id,
      category: "Övrigt",
      status: "new",
      priority: "normal",
    })
    .select("id")
    .single();
  assert.equal(r.error, null);
  return r.data.id;
}
const own = await makeOrder("oscar"),
  foreign = await makeOrder("outsider");
for (const internal of [true, false]) {
  const r = await clients.oscar
    .from("vihem_work_order_comments")
    .insert({
      work_order_id: own,
      user_id: c.users.oscar.id,
      comment: "Synthetic comment isolation QA",
      internal,
    })
    .select("id")
    .single();
  assert.equal(r.error, null);
  assert.equal(
    (
      await clients.christofer
        .from("vihem_work_order_comments")
        .select("id")
        .eq("id", r.data.id)
    ).data?.length,
    1,
    "same-org staff keep access",
  );
  for (const who of ["tenant", "outsider"]) {
    const read = await clients[who]
      .from("vihem_work_order_comments")
      .select("id")
      .eq("id", r.data.id);
    assert.equal(read.error, null);
    assert.deepEqual(read.data, [], `${who} must not read staff comments`);
    const insert = await clients[who].from("vihem_work_order_comments").insert({
      work_order_id: own,
      user_id: c.users[who].id,
      comment: "Must be denied QA",
      internal,
    });
    assert.equal(insert.error?.code, "42501");
  }
  const anon = createClient(url, c.anon, { auth: { persistSession: false } });
  const anonymousRead = await anon
    .from("vihem_work_order_comments")
    .select("id")
    .eq("id", r.data.id);
  if (anonymousRead.error) assert.equal(anonymousRead.error.code, "42501");
  else assert.deepEqual(anonymousRead.data, []);
}
for (const payload of [
  { work_order_id: foreign, user_id: c.users.oscar.id },
  { work_order_id: own, user_id: c.users.christofer.id },
]) {
  const r = await clients.oscar
    .from("vihem_work_order_comments")
    .insert({ ...payload, comment: "Must be denied QA", internal: true });
  assert.equal(
    r.error?.code,
    "42501",
    "foreign parent / impersonated author denied",
  );
}
console.log(
  "PASS: work-order comments preserve staff access; tenant, anonymous, foreign organisation and author spoofing denied.",
);
