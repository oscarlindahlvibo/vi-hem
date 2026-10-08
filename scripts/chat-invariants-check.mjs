import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
async function load(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ES2020,
    },
  }).outputText;
  return import(
    "data:text/javascript;base64," + Buffer.from(js).toString("base64")
  );
}
const {
  mergeChatMessages,
  mergeChatReactions,
  reactionKey,
  messageReceipt,
  chatTitle,
  validateChatFile,
  draftKey,
} = await load("../src/lib/chatCore.ts");
const { validateChatBytes } = await load(
  "../supabase/functions/_shared/chat-files.ts",
);
const row = {
  id: "a",
  sender_id: "one",
  created_at: "2026-10-09T08:00:00Z",
  message: "old",
  local_status: "sending",
};
const saved = { ...row, message: "confirmed", local_status: undefined };
assert.deepEqual(
  mergeChatMessages([row], [saved, saved]),
  [saved],
  "realtime + RPC must deduplicate",
);
assert.equal(
  mergeChatMessages(
    [row],
    [{ ...row, id: "b", created_at: "2026-10-09T09:59:59+02:00" }],
  )[0].id,
  "b",
  "timestamps normalized chronologically",
);
assert.deepEqual(
  messageReceipt(row, [
    { user_id: "one", last_read_at: "2026-10-09T10:00:00Z" },
    { user_id: "two", last_read_at: "2026-10-09T09:59:59+02:00" },
    { user_id: "three", last_read_at: "2026-10-09T10:00:00+02:00" },
  ]).map((p) => p.user_id),
  ["three"],
  "per recipient receipt and timezone",
);
assert.equal(
  chatTitle({ chat_type: "tenant_support" }, "tenant", true),
  "Fastighetskontoret",
);
assert.notEqual(
  draftKey("orgA", "user", "thread"),
  draftKey("orgB", "user", "thread"),
);
for (const mime of ["text/html", "image/svg+xml", "application/javascript"])
  assert.throws(() =>
    validateChatFile({ type: mime, size: 10, name: "unsafe" }),
  );
assert.throws(() =>
  validateChatFile({ type: "image/jpeg", size: 52428801, name: "large" }),
);
validateChatBytes(
  new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  "image/png",
);
validateChatBytes(
  new TextEncoder().encode("%PDF-1.7\nsynthetic test"),
  "application/pdf",
);
validateChatBytes(new TextEncoder().encode("ordinary note"), "text/plain");
for (const mime of ["image/png", "application/pdf", "text/plain"])
  assert.throws(() =>
    validateChatBytes(
      new TextEncoder().encode("<script>alert(1)</script>"),
      mime,
    ),
  );
assert.throws(() =>
  validateChatBytes(
    new TextEncoder().encode("PK fake archive"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ),
);
console.log(
  "PASS: deduplication, chronological merge, per-recipient receipts, organisation-scoped drafts, safe file allowlist/limits and server file signatures.",
);
const { parseFcmConfig, sendFcmPush } = await load(
  "../supabase/functions/_shared/fcm.ts",
);
assert.equal(parseFcmConfig(undefined), null);
assert.equal(parseFcmConfig("{bad"), null);
const keys = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const private_key =
  "-----BEGIN PRIVATE KEY-----\n" +
  Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey)).toString(
    "base64",
  ) +
  "\n-----END PRIVATE KEY-----";
let requestCount = 0;
const mock = async (url, options) => {
  requestCount++;
  if (url.includes("oauth2"))
    return new Response(
      JSON.stringify({ access_token: "synthetic-token", expires_in: 3600 }),
    );
  const body = JSON.parse(options.body);
  assert.equal(body.message.data.link, "chat/thread/message");
  assert.equal(body.message.android.notification.tag, "notice");
  return new Response(
    JSON.stringify({ error: { details: [{ errorCode: "UNREGISTERED" }] } }),
    { status: 404 },
  );
};
const fcm = await sendFcmPush(
  "test-device",
  {
    title: "QA",
    body: "QA",
    data: { link: "chat/thread/message", notification_id: "notice" },
  },
  {
    project_id: "test-project",
    client_email: "qa@example.invalid",
    private_key,
  },
  mock,
);
assert.equal(requestCount, 2);
assert.equal(fcm.tokenInvalid, true);
assert.equal(fcm.reason, "UNREGISTERED");
console.log(
  "PASS: FCM service account parsing, signed OAuth exchange, conversation deep link, notification deduplication tag and invalid token handling (mocked provider).",
);

const reaction = {
  message_id: "message",
  user_id: "recipient",
  emoji: "👍",
  active: true,
};
const revisions = new Map([[reactionKey(reaction), 2]]);
assert.deepEqual(
  mergeChatReactions([], [reaction], new Set(["message"]), revisions, 1),
  [],
  "late snapshot cannot restore a realtime-removed reaction",
);
assert.deepEqual(
  mergeChatReactions([reaction], [], new Set(["message"]), revisions, 1, true),
  [reaction],
  "new realtime reaction survives an initial history response",
);
assert.deepEqual(
  mergeChatReactions([reaction], [], new Set(["message"]), revisions, 2),
  [],
  "current snapshot removes stale reaction",
);
console.log(
  "PASS: delayed reaction snapshots preserve newer realtime adds and removals.",
);

const earlier = { ...row, id: "z", created_at: "2026-10-09T08:00:00.123456Z" };
const later = { ...row, id: "a", created_at: "2026-10-09T08:00:00.123789Z" };
assert.deepEqual(
  mergeChatMessages([later], [earlier]).map((m) => m.id),
  ["z", "a"],
  "simultaneous messages retain PostgreSQL microsecond order",
);
assert.equal(
  messageReceipt(later, [{ user_id: "two", last_read_at: earlier.created_at }])
    .length,
  0,
  "an earlier read boundary in the same millisecond is not a receipt",
);
console.log(
  "PASS: PostgreSQL microseconds preserved in ordering and read receipts.",
);
