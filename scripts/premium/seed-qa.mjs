import fs from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const c = JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG, "utf8")),
  url = c.url || "http://127.0.0.1:18880";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname));
const clients = {};
for (const name of ["oscar", "christofer"]) {
  const client = createClient(url, c.anon, { auth: { persistSession: false } });
  assert.equal(
    (
      await client.auth.signInWithPassword({
        email: c.users[name].email,
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
const property = "d369fc43-9163-4b1d-a427-5da9cbfafca1",
  apartment = "d369fc43-9163-4b1d-a427-5da9cbfafca2";
assert.equal(
  (
    await clients.oscar
      .from("vihem_properties")
      .upsert({
        id: property,
        organisation_id: c.org,
        name: "QA – Parkgården",
        address: "Testgatan 1 (syntetisk QA)",
      })
  ).error,
  null,
);
assert.equal(
  (
    await clients.oscar
      .from("vihem_apartments")
      .upsert({
        id: apartment,
        organisation_id: c.org,
        property_id: property,
        apartment_number: "1001",
        size: 82,
        rooms: 3,
        rent: 7200,
        status: "vacant",
      })
  ).error,
  null,
);
const { data: existing, error } = await clients.oscar
  .from("vihem_chat_threads")
  .select("id")
  .eq("organisation_id", c.org)
  .eq("subject", "Parkgården · Drift (QA)");
assert.equal(error, null);
let thread = existing?.[0]?.id;
if (!thread) {
  const result = await clients.oscar.rpc("vihem_chat_create", {
    kind: "group",
    title: "Parkgården · Drift (QA)",
    recipients: [c.users.christofer.id],
    context_property: property,
  });
  assert.equal(result.error, null);
  thread = result.data;
}
for (const [sender, id, body] of [
  [
    "oscar",
    "d369fc43-9163-4b1d-a427-5da9cbfafca3",
    "Kan du kontrollera ventilationen i lägenhet 1001 idag?",
  ],
  [
    "christofer",
    "d369fc43-9163-4b1d-a427-5da9cbfafca4",
    "Absolut, jag är på plats efter lunch.",
  ],
  [
    "christofer",
    "d369fc43-9163-4b1d-a427-5da9cbfafca5",
    "Jag tar några bilder och lägger till dem i arbetsordern.",
  ],
  [
    "oscar",
    "d369fc43-9163-4b1d-a427-5da9cbfafca6",
    "Tack! Hör av dig om något behöver beställas.",
  ],
]) {
  assert.equal(
    (
      await clients[sender].rpc("vihem_chat_send", {
        thread,
        client_id: id,
        body,
      })
    ).error,
    null,
  );
}
console.log(
  "Synthetic premium QA property, apartment and drift conversation ready.",
);
