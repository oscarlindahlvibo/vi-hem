// Disposable synthetic QA user only. Does not run against production URLs.
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
let id;
const password = randomUUID() + randomUUID();
try {
  const created = await service.auth.admin.createUser({
    email: `security-${randomUUID()}@qa.vihem.invalid`,
    password,
    email_confirm: true,
  });
  assert.equal(created.error, null);
  id = created.data.user.id;
  assert.equal(
    (
      await service
        .from("vihem_profiles")
        .upsert({
          id,
          organisation_id: c.org,
          name: "Disposable security QA",
          email: created.data.user.email,
          role: "tenant",
          active: true,
        })
    ).error,
    null,
  );
  const cl = createClient(url, c.anon, { auth: { persistSession: false } });
  assert.equal(
    (
      await cl.auth.signInWithPassword({
        email: created.data.user.email,
        password,
      })
    ).error,
    null,
  );
  const escalation = await cl
    .from("vihem_profiles")
    .update({ role: "admin" })
    .eq("id", id)
    .select("role")
    .single();
  assert.equal(escalation.error?.code, '42501');
  assert.equal((await service.from('vihem_profiles').select('role').eq('id', id).single()).data.role, 'tenant');
  console.log('PASS QA own-profile role escalation blocked by the existing server guard. Production trigger presence is not verified.');

} finally {
  if (id) {
    assert.equal(
      (await service.from("vihem_profiles").delete().eq("id", id)).error,
      null,
    );
    assert.equal((await service.auth.admin.deleteUser(id)).error, null);
  }
}
