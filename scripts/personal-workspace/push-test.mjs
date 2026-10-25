// Real local PostgREST + PostgreSQL fixtures; never APNs/FCM or production data.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dbName = "vihem-personal-qa-test";
const sql = (q) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      dbName,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-At",
    ],
    { input: q, encoding: "utf8" },
  ).trim();
const enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
let jwt =
  enc({ alg: "HS256", typ: "JWT" }) +
  "." +
  enc({ role: "service_role", exp: Math.floor(Date.now() / 1000) + 3600 });
jwt +=
  "." +
  createHmac("sha256", "workspace-local-test-secret-at-least-32-characters")
    .update(jwt)
    .digest("base64url");
const db = createClient("http://127.0.0.1:5187", jwt, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const owner = "10000000-0000-0000-0000-000000000001",
  note = randomUUID(),
  r = randomUUID();
sql(
  `INSERT INTO vihem_personal_notes(id,owner_id,title) VALUES('${note}','${owner}','Push-test');INSERT INTO vihem_personal_reminders(id,owner_id,note_id,title,due_at) VALUES('${r}','${owner}','${note}','Private title',now()-interval '1 minute');SELECT vihem_personal_dispatch_reminders();`,
);
const nid = sql(
  `SELECT notification_id FROM vihem_personal_reminder_deliveries WHERE reminder_id='${r}';`,
);
const tmp = await mkdtemp(join(tmpdir(), "vihem-reminder-push-"));
try {
  const out = join(tmp, "guard.mjs");
  await build({
    entryPoints: ["supabase/functions/_shared/personal-reminder-push.ts"],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "esm",
  });
  const { personalReminderPush } = await import(pathToFileURL(out).href);
  const n = {
    id: nid,
    user_id: owner,
    link: "personal-workspace/reminders/" + r,
  };
  assert.deepEqual(await personalReminderPush(db, n), {
    skip: false,
    message: "Du har en personlig påminnelse.",
  });
  sql(`UPDATE vihem_personal_reminders SET preview=true WHERE id='${r}'`);
  assert.deepEqual(await personalReminderPush(db, n), {
    skip: false,
    message: "Private title",
  });
  sql(`UPDATE vihem_personal_reminders SET cancelled_at=now() WHERE id='${r}'`);
  assert.equal((await personalReminderPush(db, n)).skip, true);
  sql(
    `UPDATE vihem_personal_reminders SET cancelled_at=null,due_at=now()+interval '1 day' WHERE id='${r}'`,
  );
  assert.equal((await personalReminderPush(db, n)).skip, true);
  sql(
    `UPDATE vihem_personal_reminders SET due_at=(SELECT due_at FROM vihem_personal_reminder_deliveries WHERE reminder_id='${r}') WHERE id='${r}';UPDATE vihem_personal_notes SET deleted_at=now() WHERE id='${note}'`,
  );
  assert.equal((await personalReminderPush(db, n)).skip, true);
  assert.equal(
    (
      await personalReminderPush(db, {
        ...n,
        user_id: "10000000-0000-0000-0000-000000000002",
      })
    ).skip,
    true,
  );
  assert.equal(
    await personalReminderPush(db, { ...n, link: "calendar" }),
    null,
  );
  // Exercise paged ink reads above PostgREST's customary 1,000-row boundary.
  sql(
    `INSERT INTO vihem_personal_ink_strokes(id,owner_id,note_id,page_id,stroke) SELECT gen_random_uuid(),'${owner}','${note}','${randomUUID()}','{"points":[{"x":2,"y":3,"p":0.5}],"tool":"pen","color":"#172b49","width":3}'::jsonb FROM generate_series(1,1501);`,
  );
  let userJwt =
    enc({ alg: "HS256", typ: "JWT" }) +
    "." +
    enc({
      role: "authenticated",
      sub: owner,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  userJwt +=
    "." +
    createHmac("sha256", "workspace-local-test-secret-at-least-32-characters")
      .update(userJwt)
      .digest("base64url");
  const userDb = createClient("http://127.0.0.1:5187", userJwt, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const collected = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await userDb
      .from("vihem_personal_ink_strokes")
      .select("*")
      .eq("note_id", note)
      .order("created_at")
      .order("id")
      .range(offset, offset + 499);
    assert.equal(error, null);
    collected.push(...data);
    if (data.length < 500) break;
  }
  assert.equal(collected.length, 1501);
  assert.equal(new Set(collected.map((s) => s.id)).size, 1501);
  const { data: preview, error: previewError } = await userDb
    .from("vihem_personal_notes")
    .select("id,title,plain_text:preview")
    .eq("id", note)
    .single();
  assert.equal(previewError, null);
  assert.equal("content" in preview, false);
  assert.equal(typeof preview.plain_text, "string");
  console.log(
    "PASS: real REST private push guard, redaction, explicit preview, cancellation, snooze, trash, wrong owner, unrelated notifications",
  );
} finally {
  await rm(tmp, { recursive: true, force: true });
}
