import fs from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const config = process.env.CHAT_QA_CONFIG;
assert.ok(config, "Use a protected synthetic QA config");
const c = JSON.parse(fs.readFileSync(config, "utf8")),
  url = c.url || "http://127.0.0.1:18880";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
  "Isolated QA only",
);
const clients = {};
for (const [name, user] of Object.entries(c.users)) {
  const client = createClient(url, c.anon, { auth: { persistSession: false } });
  assert.equal(
    (
      await client.auth.signInWithPassword({
        email: user.email,
        password: c.user_password,
      })
    ).error,
    null,
  );
  clients[name] = client;
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
const rpc = async (who, name, args) => {
  const r = await clients[who].rpc(name, args);
  assert.equal(r.error, null, name);
  return r.data;
};
const before = (
  await clients.oscar
    .from("vihem_profiles")
    .select("role,organisation_id,name,email")
    .eq("id", c.users.oscar.id)
    .single()
).data;
const bytes = fs.readFileSync(
  new URL("./fixtures/profile.jpg", import.meta.url),
);
async function upload(who) {
  const body = new FormData();
  body.append("file", new File([bytes], "profile.jpg", { type: "image/jpeg" }));
  const r = await clients[who].functions.invoke("vihem-profile-photo", {
    body,
  });
  assert.equal(r.error, null, "real Edge upload: " + who);
  return r.data.path;
}
const path = await upload("oscar");
assert.ok(path.startsWith(c.org + "/" + c.users.oscar.id + "/"));
assert.equal(
  (await clients.oscar.storage.from("vihem-profile-photos").download(path))
    .error,
  null,
);
assert.equal(
  (await clients.christofer.storage.from("vihem-profile-photos").download(path))
    .error,
  null,
  "same-org staff",
);
assert.ok(
  (await clients.outsider.storage.from("vihem-profile-photos").download(path))
    .error,
  "other org denied",
);
assert.deepEqual(
  await rpc("outsider", "vihem_avatar_paths", { ids: [c.users.oscar.id] }),
  [],
);
const otherPath = await upload("outsider");
const invalidBody = new FormData();
invalidBody.append(
  "file",
  new File([new Uint8Array([255, 216, 255, 217])], "invalid.jpg", {
    type: "image/jpeg",
  }),
);
assert.ok(
  (
    await clients.oscar.functions.invoke("vihem-profile-photo", {
      body: invalidBody,
    })
  ).error,
  "spoofed JPEG rejected by real Edge",
);
const insertion = await clients.oscar
  .from("vihem_profiles")
  .insert({
    id: c.users.oscar.id,
    organisation_id: c.org,
    name: "Synthetic duplicate",
    email: c.users.oscar.email,
    role: "admin",
    avatar_path: otherPath,
  });
assert.equal(
  insertion.error?.code,
  "42501",
  "insert branch blocks avatar references before duplicate constraints",
);

assert.ok(
  (await clients.oscar.rpc("vihem_set_profile_photo", { path: otherPath }))
    .error,
  "cannot use another owner photo",
);
assert.ok(
  (
    await clients.oscar
      .from("vihem_profiles")
      .update({ avatar_path: otherPath })
      .eq("id", c.users.oscar.id)
  ).error,
  "direct update denied",
);
assert.ok(
  (
    await clients.oscar.storage
      .from("vihem-profile-photos")
      .upload(path + "-new", bytes, { contentType: "image/jpeg" })
  ).error,
  "direct upload denied",
);
assert.ok(
  (
    await clients.oscar.storage
      .from("vihem-profile-photos")
      .update(path, bytes, { contentType: "image/jpeg" })
  ).error,
  "direct overwrite denied",
);
await clients.christofer.storage.from("vihem-profile-photos").remove([path]);
assert.equal(
  (await clients.oscar.storage.from("vihem-profile-photos").download(path))
    .error,
  null,
  "client removal cannot delete photo",
);
const anonymous = createClient(url, c.anon, {
  auth: { persistSession: false },
});
assert.ok(
  (await anonymous.storage.from("vihem-profile-photos").download(path)).error,
);
assert.ok(
  (await fetch(url + "/storage/v1/object/public/vihem-profile-photos/" + path))
    .status >= 400,
  "public endpoint denied",
);
// Outsider is isolated even if metadata RPC is attempted directly.
assert.equal(
  (
    await clients.oscar
      .from("vihem_profiles")
      .select("role,organisation_id,name,email")
      .eq("id", c.users.oscar.id)
      .single()
  ).data.role,
  before.role,
);
assert.deepEqual(
  (
    await clients.oscar
      .from("vihem_profiles")
      .select("role,organisation_id,name,email")
      .eq("id", c.users.oscar.id)
      .single()
  ).data,
  before,
  "identity and permissions preserved",
);
// Tenant photo access only through explicit common membership; use the other org fixture to avoid prior QA groups.
const tenantPath = await upload("tenant_two");
assert.ok(
  (
    await clients.outsider.storage
      .from("vihem-profile-photos")
      .download(tenantPath)
  ).error,
);
const group = await rpc("oscar", "vihem_chat_create", {
  kind: "group",
  title: "Avatar membership QA " + Date.now(),
  recipients: [c.users.tenant_two.id],
});
assert.equal(
  (await clients.tenant_two.storage.from("vihem-profile-photos").download(path))
    .error,
  null,
  "explicit tenant group membership",
);
await rpc("oscar", "vihem_chat_group", {
  thread: group,
  action: "remove",
  target_user: c.users.tenant_two.id,
});
// Prior integration groups may grant tenant_two access independently: verify against a fresh staff member with no other tenant membership.
const staffPath = await upload("other_staff");
assert.ok(
  (
    await clients.tenant_two.storage
      .from("vihem-profile-photos")
      .download(staffPath)
  ).error,
  "uninvited tenant access denied",
);
await rpc("oscar", "vihem_chat_group", {
  thread: group,
  action: "add",
  target_user: c.users.tenant_two.id,
});
await rpc("oscar", "vihem_chat_group", {
  thread: group,
  action: "add",
  target_user: c.users.other_staff.id,
});
assert.equal(
  (
    await clients.tenant_two.storage
      .from("vihem-profile-photos")
      .download(staffPath)
  ).error,
  null,
  "photo allowed after invitation",
);
await rpc("oscar", "vihem_chat_group", {
  thread: group,
  action: "remove",
  target_user: c.users.tenant_two.id,
});
assert.ok(
  (
    await clients.tenant_two.storage
      .from("vihem-profile-photos")
      .download(staffPath)
  ).error,
  "membership removal revokes download",
);
await rpc("oscar", "vihem_set_profile_photo", { path: null });
assert.ok(
  (await clients.oscar.storage.from("vihem-profile-photos").download(path))
    .error,
  "removed reference stops access",
);
await upload("oscar");
await upload("christofer");
console.log(
  "PASS: own photo upload/removal, private storage, staff/tenant membership, cross-org denial, direct mutation denial, identity preserved.",
);
