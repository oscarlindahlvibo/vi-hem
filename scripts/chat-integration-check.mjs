import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(new URL("../package.json", import.meta.url)),
  { createClient } = require("@supabase/supabase-js");
const config = process.env.CHAT_QA_CONFIG;
if (!config)
  throw Error(
    "Set CHAT_QA_CONFIG to a protected synthetic QA configuration file.",
  );
const c = JSON.parse(fs.readFileSync(config)),
  url = c.url || "http://127.0.0.1:18880",
  clients = {};
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw Error("Integration tests are restricted to isolated localhost QA.");
for (const name of Object.keys(c.users)) {
  const client = createClient(url, c.anon, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({
    email: c.users[name].email,
    password: c.user_password,
  });
  assert.equal(error, null);
  await client.realtime.setAuth(data.session.access_token);
  clients[name] = client;
}
const { data: organisation } = await clients.oscar
  .from("vihem_organisations")
  .select("name")
  .eq("id", c.org)
  .single();
assert.equal(
  organisation?.name,
  "VI-HEM Chat QA",
  "Never run against a production organisation",
);
const rpc = async (who, name, body) => {
  const { data, error } = await clients[who].rpc(name, body);
  assert.equal(error, null, name + ": " + error?.message);
  return data;
};
const denied = async (who, name, body) => {
  const { error } = await clients[who].rpc(name, body);
  assert.ok(error, name + " must deny " + who);
};
const group = await rpc("oscar", "vihem_chat_create", {
  kind: "group",
  title: "Integration QA " + Date.now(),
  recipients: [c.users.christofer.id],
});
const other = await rpc("oscar", "vihem_chat_create", {
  kind: "group",
  title: "Other unread QA " + Date.now(),
  recipients: [c.users.christofer.id],
});
const received = [];
let cdcReady = false;
const channel = clients.christofer
  .channel("qa-integrated")
  .on("system", {}, (payload) => {
    if (payload.extension === "postgres_changes" && payload.status === "ok") cdcReady = true;
  })
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "vihem_chat_messages",
      filter: "thread_id=eq." + group,
    },
    () => received.push("message"),
  )
  .on(
    "postgres_changes",
    {
      event: "UPDATE",
      schema: "public",
      table: "vihem_chat_participants",
      filter: "thread_id=eq." + group,
    },
    () => received.push("read"),
  )
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "vihem_chat_reactions",
      filter: "thread_id=eq." + group,
    },
    () => received.push("reaction"),
  )
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "vihem_chat_activity",
      filter: "thread_id=eq." + group,
    },
    () => received.push("typing"),
  );
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error("QA RT timeout")), 45000);
  channel.subscribe((s) => {
    if (s === "SUBSCRIBED") {
      clearTimeout(timer);
      resolve();
    }
  });
});
// Socket subscription can precede CDC startup on a cold self-hosted stack.
// Test event delivery only after the database subscription is actually ready.
for (let i = 0; i < 300 && !cdcReady; i++)
  await new Promise(resolve => setTimeout(resolve, 100));
assert.ok(cdcReady, "postgres_changes subscription ready");
const a = crypto.randomUUID(),
  b = crypto.randomUUID();
await Promise.all([
  rpc("oscar", "vihem_chat_send", {
    thread: group,
    client_id: a,
    body: "Concurrent Oscar QA",
  }),
  rpc("christofer", "vihem_chat_send", {
    thread: group,
    client_id: b,
    body: "Concurrent Christofer QA",
  }),
]);
const otherId = crypto.randomUUID();
await rpc("oscar", "vihem_chat_send", {
  thread: other,
  client_id: otherId,
  body: "Must stay unread QA",
});
await rpc("christofer", "vihem_chat_read", {
  thread: group,
  through_message: a,
});
assert.ok(
  (await rpc("christofer", "vihem_chat_inbox", { thread_filter: other }))[0]
    .unread_count > 0,
  "other thread remains unread",
);
await rpc("oscar", "vihem_chat_message_action", {
  message_id: a,
  action: "reaction",
  text_value: "👍",
});
await rpc("oscar", "vihem_chat_activity_update", {
  thread: group,
  typing: true,
});
await rpc("oscar", "vihem_chat_message_action", {
  message_id: a,
  action: "edit",
  text_value: "Edited synthetic QA",
});
assert.equal(
  (
    await rpc("oscar", "vihem_chat_send", {
      thread: group,
      client_id: a,
      body: "Concurrent Oscar QA",
    })
  ).message,
  "Edited synthetic QA",
  "retry after edit returns persisted row",
);
await denied("christofer", "vihem_chat_message_action", {
  message_id: a,
  action: "edit",
  text_value: "Forbidden edit",
});
await rpc("oscar", "vihem_chat_group", {
  thread: group,
  action: "add",
  target_user: c.users.tenant.id,
});
assert.equal(
  (await rpc("tenant", "vihem_chat_inbox", { thread_filter: group })).length,
  1,
  "invited tenant group",
);
await denied("tenant", "vihem_chat_group", {
  thread: group,
  action: "add",
  target_user: c.users.tenant_two.id,
});
await denied("oscar", "vihem_chat_group", {
  thread: group,
  action: "add",
  target_user: c.users.outsider.id,
});
await rpc("oscar", "vihem_chat_settings", {
  thread: group,
  notification_value: "mentions",
});
await rpc("christofer", "vihem_chat_send", {
  thread: group,
  client_id: crypto.randomUUID(),
  body: "@Oscar QA synthetic mention",
  mention_ids: [c.users.oscar.id],
});
const { data: mentions } = await clients.oscar
  .from("vihem_notifications")
  .select("id,type,title,link")
  .like("link", "chat/" + group + "/%");
assert.ok(
  mentions.some((n) => n.title === "Du har blivit omnämnd"),
  "structured mention notification",
);
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const form = new FormData();
form.append("thread", group);
form.append("file", new Blob([bytes], { type: "image/png" }), "synthetic.png");
const { data: upload, error: uploadError } =
  await clients.oscar.functions.invoke("vihem-chat-upload", { body: form });
assert.equal(uploadError, null, "real edge upload " + uploadError?.message);
assert.ok(upload?.path);
const fileMessage = await rpc("oscar", "vihem_chat_send", {
  thread: group,
  client_id: crypto.randomUUID(),
  body: "Synthetic attachment",
  file_path: upload.path,
  file_name: upload.name,
  file_mime: upload.mime,
  file_size: upload.size,
});
const tenantFile = await clients.tenant.storage
  .from("vihem-chat-private")
  .download(upload.path);
if (tenantFile.error) {
  throw Error("Authorized tenant download failed");
}
for (const name of ["outsider", "tenant_two", "other_staff"])
  assert.ok(
    (
      await clients[name].storage
        .from("vihem-chat-private")
        .download(upload.path)
    ).error,
    "unauthorized file " + name,
  );
assert.ok(
  (
    await clients.oscar.storage
      .from("vihem-chat-private")
      .upload(
        c.org + "/" + group + "/" + c.users.oscar.id + "/bypass.png",
        bytes,
        { contentType: "image/png" },
      )
  ).error,
  "no bypass of byte validation",
);
const bad = new FormData();
bad.append("thread", group);
bad.append(
  "file",
  new Blob(["<script>unsafe</script>"], { type: "image/png" }),
  "fake.png",
);
assert.ok(
  (await clients.oscar.functions.invoke("vihem-chat-upload", { body: bad }))
    .error,
  "fake image rejected",
);
const orderId = crypto.randomUUID();
const { error: orderError } = await clients.oscar
  .from("vihem_work_orders")
  .insert({
    id: orderId,
    title: "Synthetic chat QA order",
    created_by: c.users.oscar.id,
    organisation_id: c.org,
    status: "new",
    priority: "normal",
    category: "Övrigt",
  });
assert.equal(orderError, null, "work order create " + orderError?.message);
assert.equal(
  (
    await clients.oscar.functions.invoke("vihem-chat-to-workorder", {
      body: { work_order_id: orderId, message_id: fileMessage.id },
    })
  ).error,
  null,
  "private file copy",
);
const { data: copies } = await clients.christofer
  .from("vihem_chat_workorder_files")
  .select("path")
  .eq("work_order_id", orderId);
assert.equal(copies.length, 1);
assert.equal(
  (
    await clients.christofer.storage
      .from("vihem-chat-workorder-private")
      .download(copies[0].path)
  ).error,
  null,
);
assert.ok(
  (
    await clients.tenant.storage
      .from("vihem-chat-workorder-private")
      .download(copies[0].path)
  ).error,
  "work-order file does not broaden tenant permissions",
);
await rpc("oscar", "vihem_chat_group", {
  thread: group,
  action: "remove",
  target_user: c.users.tenant.id,
});
assert.ok(
  (
    await clients.tenant.storage
      .from("vihem-chat-private")
      .download(upload.path)
  ).error,
  "file revocation",
);
await rpc("oscar", "vihem_chat_send", {
  thread: group,
  client_id: crypto.randomUUID(),
  body: "Shared work order",
  order_link: orderId,
});
for (
  let i = 0;
  i < 30 && (!received.includes("reaction") || !received.includes("typing"));
  i++
)
  await new Promise((r) => setTimeout(r, 100));
assert.ok(received.includes("read"), "read receipt realtime");
assert.ok(received.includes("message"), "new message realtime");
assert.ok(received.includes("reaction"), "reaction realtime");
assert.ok(received.includes("typing"), "typing realtime");

// Both concurrent identical requests and an uncertain transport retry must produce one row.
const duplicate = crypto.randomUUID();
await Promise.all([
  rpc("oscar", "vihem_chat_send", {
    thread: group,
    client_id: duplicate,
    body: "Same id concurrent QA",
  }),
  rpc("oscar", "vihem_chat_send", {
    thread: group,
    client_id: duplicate,
    body: "Same id concurrent QA",
  }),
]);
assert.equal(
  (await rpc("oscar", "vihem_chat_history", { thread: group })).filter(
    (m) => m.id === duplicate,
  ).length,
  1,
);
let simulate = true;
const lost = createClient(url, c.anon, {
  auth: { persistSession: false },
  global: {
    fetch: async (...args) => {
      const response = await fetch(...args);
      if (simulate && String(args[0]).includes("/rpc/vihem_chat_send")) {
        simulate = false;
        throw new TypeError("Synthetic network loss after commit");
      }
      return response;
    },
  },
});
await lost.auth.signInWithPassword({
  email: c.users.oscar.email,
  password: c.user_password,
});
const uncertain = crypto.randomUUID(),
  payload = {
    thread: group,
    client_id: uncertain,
    body: "Uncertain transport QA",
  };
assert.ok((await lost.rpc("vihem_chat_send", payload)).error);
await rpc("oscar", "vihem_chat_send", payload);
assert.equal(
  (await rpc("oscar", "vihem_chat_history", { thread: group })).filter(
    (m) => m.id === uncertain,
  ).length,
  1,
);
const { data: notices } = await clients.christofer
  .from("vihem_notifications")
  .select("id")
  .eq("link", "chat/" + group + "/" + uncertain);
assert.equal(notices.length, 1, "no duplicate notification");
await lost.auth.signOut();
await Promise.all(
  Array.from({ length: 110 }, (_, i) =>
    rpc("oscar", "vihem_chat_send", {
      thread: group,
      client_id: crypto.randomUUID(),
      body: "Page QA " + i,
    }),
  ),
);
const page1 = await rpc("oscar", "vihem_chat_history", {
    thread: group,
    batch: 50,
  }),
  last = page1[page1.length - 1],
  page2 = await rpc("oscar", "vihem_chat_history", {
    thread: group,
    batch: 50,
    before_time: last.created_at,
    before_id: last.id,
  });
assert.equal(page1.length, 50);
assert.equal(page2.length, 50);
assert.equal(
  new Set([...page1, ...page2].map((m) => m.id)).size,
  100,
  "stable keyset pagination",
);
await rpc("oscar", "vihem_chat_preferences_save", { mute_groups_value: true });
const muted = crypto.randomUUID();
await rpc("christofer", "vihem_chat_send", {
  thread: group,
  client_id: muted,
  body: "Muted group QA",
});
assert.equal(
  (
    await clients.oscar
      .from("vihem_notifications")
      .select("id")
      .eq("link", "chat/" + group + "/" + muted)
  ).data.length,
  0,
);
await rpc("oscar", "vihem_chat_preferences_save", {
  mute_groups_value: false,
  presence_value: false,
});
await rpc("oscar", "vihem_chat_activity_update", {
  thread: group,
  typing: true,
  online: true,
});
const { data: hidden } = await clients.christofer
  .from("vihem_chat_activity")
  .select("user_id")
  .eq("thread_id", group)
  .eq("user_id", c.users.oscar.id);
assert.equal(hidden.length, 0, "presence opt-out includes typing");
await rpc("oscar", "vihem_chat_preferences_save", { presence_value: true });
await rpc("oscar", "vihem_chat_group", {
  thread: group,
  action: "add",
  target_user: c.users.tenant.id,
});
await rpc("oscar", "vihem_chat_group", {
  thread: group,
  action: "add",
  target_user: c.users.tenant_two.id,
});
assert.equal(
  (await rpc("tenant_two", "vihem_chat_inbox", { thread_filter: group }))
    .length,
  1,
  "second explicitly invited tenant",
);
await denied("tenant", "vihem_chat_create", {
  kind: "direct",
  recipients: [c.users.tenant_two.id],
});
await denied("tenant", "vihem_chat_create", {
  kind: "group",
  title: "Unauthorized",
  recipients: [c.users.oscar.id],
});
await rpc("oscar", "vihem_chat_group", {
  thread: group,
  action: "remove",
  target_user: c.users.tenant.id,
});
await rpc("oscar", "vihem_chat_group", {
  thread: group,
  action: "remove",
  target_user: c.users.tenant_two.id,
});
await rpc("oscar", "vihem_chat_settings", {
  thread: other,
  archived_value: true,
});
assert.equal(
  (await rpc("oscar", "vihem_chat_inbox", { filter_value: "archived" })).some(
    (t) => t.id === other,
  ),
  true,
);
assert.equal(
  (await rpc("oscar", "vihem_chat_inbox", { filter_value: "all" })).some(
    (t) => t.id === other,
  ),
  false,
);
const propertyId = crypto.randomUUID();
assert.equal(
  (
    await clients.oscar.from("vihem_properties").insert({
      id: propertyId,
      name: "QA property",
      address: "QA address",
      organisation_id: c.org,
    })
  ).error,
  null,
);
const propertyChat = await rpc("oscar", "vihem_chat_create", {
  kind: "group",
  title: "QA property drift",
  recipients: [c.users.christofer.id],
  context_property: propertyId,
});
assert.equal(
  (await rpc("oscar", "vihem_chat_inbox", { thread_filter: propertyChat }))[0]
    .property_id,
  propertyId,
);
const projectId = crypto.randomUUID();
assert.equal(
  (
    await clients.oscar.from("vihem_customer_projects").insert({
      id: projectId,
      title: "QA project",
      organisation_id: c.org,
      created_by: c.users.oscar.id,
      status: "draft",
    })
  ).error,
  null,
);
const projectChat = await rpc("oscar", "vihem_chat_create", {
  kind: "group",
  title: "QA project chat",
  recipients: [c.users.christofer.id],
  context_project: projectId,
});
assert.equal(
  (await rpc("oscar", "vihem_chat_inbox", { thread_filter: projectChat }))[0]
    .project_id,
  projectId,
);
await rpc("oscar", "vihem_chat_send", {
  thread: projectChat,
  client_id: crypto.randomUUID(),
  body: "Shared QA project",
  project_link: projectId,
});
await rpc("oscar", "vihem_chat_group", {
  thread: projectChat,
  action: "add",
  target_user: c.users.tenant.id,
});
assert.equal(
  (
    await clients.tenant
      .from("vihem_customer_projects")
      .select("id")
      .eq("id", projectId)
  ).data.length,
  0,
  "group does not grant project access",
);
await rpc("oscar", "vihem_chat_message_action", {
  message_id: a,
  action: "delete",
});
assert.ok(
  (
    await rpc("oscar", "vihem_chat_send", {
      thread: group,
      client_id: a,
      body: "Concurrent Oscar QA",
    })
  ).deleted_at,
  "retry after delete retains tombstone",
);
await denied("oscar", "vihem_chat_message_action", {
  message_id: a,
  action: "edit",
  text_value: "Cannot restore deleted message",
});
console.log(
  "PASS: uncertain transport after commit, duplicate concurrent request, single notification, keyset pages, server filters/archive, muted groups, presence opt-out, multiple explicit tenant invitations, forbidden tenant creation, property/project contexts, project isolation and soft-delete retry.",
);

// Rejoin after an outage: catch missed history once, then receive new inserts.
await clients.christofer.removeChannel(channel);
// The SDK closes its socket asynchronously when its last channel leaves.
await new Promise((r) => setTimeout(r, 200));
clients.christofer.realtime.connect();
const missed = crypto.randomUUID();
await rpc("oscar", "vihem_chat_send", {
  thread: group,
  client_id: missed,
  body: "Sent during disconnected QA",
});
assert.equal(
  (await rpc("christofer", "vihem_chat_history", { thread: group })).filter(
    (m) => m.id === missed,
  ).length,
  1,
);
let rejoinedId;
const rejoined = clients.christofer.channel("qa-rejoined").on(
  "postgres_changes",
  {
    event: "INSERT",
    schema: "public",
    table: "vihem_chat_messages",
    filter: "thread_id=eq." + group,
  },
  (event) => {
    rejoinedId = event.new.id;
  },
);
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(Error("rejoin timeout")), 10000);
  rejoined.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      clearTimeout(timeout);
      resolve();
    }
  });
});
const resumed = crypto.randomUUID();
await rpc("oscar", "vihem_chat_send", {
  thread: group,
  client_id: resumed,
  body: "After rejoin QA",
});
for (let i = 0; i < 50 && rejoinedId !== resumed; i++)
  await new Promise((r) => setTimeout(r, 100));
assert.equal(rejoinedId, resumed);
await clients.christofer.removeChannel(rejoined);
const service = createClient(url, c.service, {
  auth: { persistSession: false },
});
const notification = (
  await clients.christofer
    .from("vihem_notifications")
    .select("id")
    .eq("link", "chat/" + group + "/" + resumed)
    .single()
).data.id;
const device = crypto.randomUUID();
assert.equal(
  (
    await service.from("vihem_push_tokens").insert({
      id: device,
      user_id: c.users.christofer.id,
      organisation_id: c.org,
      platform: "android",
      token: "synthetic-qa-" + device,
    })
  ).error,
  null,
);
const claims = await Promise.all([
  service.rpc("vihem_push_claim", { notification, device }),
  service.rpc("vihem_push_claim", { notification, device }),
]);
assert.equal(claims.filter((r) => r.data === true).length, 1);
assert.ok(
  (await clients.christofer.rpc("vihem_push_claim", { notification, device }))
    .error,
  "claim is service only",
);
await service
  .from("vihem_push_deliveries")
  .update({ status: "failed" })
  .eq("notification_id", notification)
  .eq("token_id", device);
assert.equal(
  (await service.rpc("vihem_push_claim", { notification, device })).data,
  true,
);
await service
  .from("vihem_push_deliveries")
  .update({ status: "unknown" })
  .eq("notification_id", notification)
  .eq("token_id", device);
assert.equal(
  (await service.rpc("vihem_push_claim", { notification, device })).data,
  false,
);
// Safe legacy migration end-to-end, exclusively in this isolated QA database.
const legacyBuckets = await service.storage.listBuckets();
assert.equal(legacyBuckets.error, null);
if (!legacyBuckets.data.some((b) => b.id === "vihem-chat-attachments"))
  assert.equal(
    (
      await service.storage.createBucket("vihem-chat-attachments", {
        public: true,
      })
    ).error,
    null,
  );
assert.equal(
  (
    await service.storage.updateBucket("vihem-chat-attachments", {
      public: true,
    })
  ).error,
  null,
);
const legacyId = crypto.randomUUID(),
  legacyName = "qa-" + legacyId + ".png";
const legacyBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWl8AAAAASUVORK5CYII=",
  "base64",
);
assert.equal(
  (
    await service.storage
      .from("vihem-chat-attachments")
      .upload(legacyName, legacyBytes, { contentType: "image/png" })
  ).error,
  null,
);
const legacyURL =
  url + "/storage/v1/object/public/vihem-chat-attachments/" + legacyName;
assert.equal(
  (
    await service.from("vihem_chat_messages").insert({
      id: legacyId,
      thread_id: group,
      sender_id: c.users.oscar.id,
      message: "Synthetic legacy image QA",
      attachment_url: legacyURL,
      attachment_type: "image",
      attachment_name: "QA legacy.png",
    })
  ).error,
  null,
);
const backup = path.join(
  os.tmpdir(),
  "vihem-chat-qa-cutover-" + crypto.randomUUID() + ".json",
);
for (const args of [[], ["--apply"]]) {
  const run = spawnSync(
    process.execPath,
    ["scripts/migrate-chat-attachments.mjs", ...args],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        SUPABASE_URL: url,
        SUPABASE_SERVICE_ROLE_KEY: c.service,
        CHAT_MIGRATION_BACKUP: backup,
      },
    },
  );
  assert.equal(run.status, 0, run.stderr);
}
const migrated = (
  await clients.christofer
    .from("vihem_chat_messages")
    .select("attachment_path")
    .eq("id", legacyId)
    .single()
).data;
const migratedFile = await clients.christofer.storage
  .from("vihem-chat-private")
  .download(migrated.attachment_path);
assert.equal(migratedFile.error, null);
assert.deepEqual(
  Buffer.from(await migratedFile.data.arrayBuffer()),
  legacyBytes,
);
assert.ok(
  (
    await clients.outsider.storage
      .from("vihem-chat-private")
      .download(migrated.attachment_path)
  ).error,
);
assert.ok(!(await fetch(legacyURL)).ok, "legacy public URL disabled");
assert.equal(
  (await service.storage.from("vihem-chat-attachments").download(legacyName))
    .error,
  null,
  "original file retained",
);
fs.unlinkSync(backup);
console.log(
  "PASS: disconnected catch-up and realtime rejoin, atomic push claims, ambiguous delivery protection, SHA-256 legacy migration, preserved originals, private references and disabled public legacy URL.",
);

for (const client of Object.values(clients)) await client.auth.signOut();
console.log(
  "PASS: concurrent send, independent unread status, edit/retry/ownership, group invitation and revocation, cross-org denial, mentions, real edge file validation, private file isolation, private work-order copy, work-order sharing, realtime reactions and typing.",
);
