import fs from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
if (!process.env.VIHEM_QA_CREDENTIALS)
  throw new Error("Set VIHEM_QA_CREDENTIALS to isolated QA credentials.");
const c = JSON.parse(fs.readFileSync(process.env.VIHEM_QA_CREDENTIALS));
const url = "http://127.0.0.1:18880";
const service = createClient(url, c.service, {
  auth: { persistSession: false },
});
const admin = createClient(url, c.anon, { auth: { persistSession: false } });
const auth = await admin.auth.signInWithPassword({
  email: c.users.oscar.email,
  password: c.user_password,
});
if (auth.error) throw auth.error;
const org = await service
  .from("vihem_organisations")
  .select("name,settings")
  .eq("id", c.org)
  .single();
if (org.error) throw org.error;
assert.equal(org.data.name, "VI-HEM Chat QA");
const old = await service
  .from("vihem_screen_settings")
  .select("*")
  .eq("organisation_id", c.org);
if (old.error) throw old.error;
const foreignProfile = await service.from("vihem_profiles").select("organisation_id").eq("id", c.users.outsider.id).single();
if (foreignProfile.error) throw foreignProfile.error;
const foreignOrgId = foreignProfile.data.organisation_id;
assert.notEqual(foreignOrgId, c.org);
const foreignOrg = await service.from("vihem_organisations").select("name,settings").eq("id", foreignOrgId).single();
if (foreignOrg.error) throw foreignOrg.error;
assert.equal(foreignOrg.data.name, "Isolated other organisation QA");
const foreignScreens = await service.from("vihem_screen_settings").select("*").eq("organisation_id", foreignOrgId);
if (foreignScreens.error) throw foreignScreens.error;
const snapshots = [
  { organisation: c.org, settings: org.data.settings, screens: old.data },
  { organisation: foreignOrgId, settings: foreignOrg.data.settings, screens: foreignScreens.data },
];
const backupPath = `${process.env.VIHEM_QA_CREDENTIALS}.screen-backup.json`;
if (fs.existsSync(backupPath)) throw new Error('Unrestored screen QA backup exists; inspect it before continuing.');
fs.writeFileSync(backupPath, JSON.stringify(snapshots), { mode: 0o600 });
const expected = org.data.settings?.screen_settings || null;
const make = (name) => ({
  screens: [
    {
      screen_key: "pass12-race",
      name,
      screen_view: "presentation",
      presentation_settings: {},
      meeting_part: "full",
    },
  ],
});
try {
  const results = await Promise.all(
    ["QA A", "QA B"].map((name) =>
      admin.rpc("vihem_save_screen_settings", {
        p_settings: make(name),
        p_expected: expected,
      }),
    ),
  );
  console.log(
    "Concurrent result codes:",
    results.map((r) =>
      r.error ? { code: r.error.code, message: r.error.message } : "success",
    ),
  );
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(results.filter((r) => r.error?.code === "PT409").length, 1);
  const winner = results.find((r) => !r.error).data.screen_settings;
  const retry = await admin.rpc("vihem_save_screen_settings", {
    p_settings: winner,
    p_expected: expected,
  });
  if (retry.error) throw retry.error;
  assert.deepEqual(retry.data.screen_settings, winner);
  const rows = await service
    .from("vihem_screen_settings")
    .select("screen_key,presentation_settings")
    .eq("organisation_id", c.org);
  assert.equal(rows.data.length, 1);
  assert.equal(
    rows.data[0].presentation_settings.screen_name,
    winner.screens[0].name,
  );
  for (const name of ["christofer", "tenant"]) {
    const client = createClient(url, c.anon, {
      auth: { persistSession: false },
    });
    const a = await client.auth.signInWithPassword({
      email: c.users[name].email,
      password: c.user_password,
    });
    if (a.error) throw a.error;
    const r = await client.rpc("vihem_save_screen_settings", {
      p_settings: make("Denied"),
      p_expected: expected,
    });
    assert.equal(r.error?.code, "42501", name);
    await client.auth.signOut();
  }
  const foreign = createClient(url, c.anon, {
    auth: { persistSession: false },
  });
  const fa = await foreign.auth.signInWithPassword({
    email: c.users.outsider.email,
    password: c.user_password,
  });
  if (fa.error) throw fa.error;
  const ownSave = await foreign.rpc("vihem_save_screen_settings", {
    p_settings: make("Foreign"),
    p_expected: foreignOrg.data.settings?.screen_settings || null,
  });
  if (ownSave.error) throw ownSave.error;
  const afterForeign = await foreign
    .from("vihem_organisations")
    .select("settings")
    .single();
  if (afterForeign.error) throw afterForeign.error;
  assert.equal(afterForeign.data.settings.screen_settings.screens[0].name, "Foreign");
  const unchanged = await service
    .from("vihem_organisations")
    .select("settings")
    .eq("id", c.org)
    .single();
  assert.deepEqual(unchanged.data.settings.screen_settings, winner);
  await foreign.auth.signOut();
  console.log(
    "PASS: authenticated parallel saves have exactly one winner; lost-response retry is read-only; actual records agree; staff/tenant denied; foreign admin writes only its own organisation and leaves QA organisation unchanged.",
  );
} finally {
  for (const snapshot of snapshots) {
    const del = await service.from("vihem_screen_settings").delete().eq("organisation_id", snapshot.organisation);
    if (del.error) throw del.error;
    if (snapshot.screens.length) {
      const restore = await service.from("vihem_screen_settings").insert(snapshot.screens);
      if (restore.error) throw restore.error;
    }
    const restore = await service.from("vihem_organisations").update({ settings: snapshot.settings }).eq("id", snapshot.organisation);
    if (restore.error) throw restore.error;
  }
  await admin.auth.signOut();
  fs.unlinkSync(backupPath);
  console.log("QA original configuration restored.");
}
