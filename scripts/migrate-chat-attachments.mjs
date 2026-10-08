// Service key supplied by the operator's environment, never embedded in a file.
// Default is read-only. --apply copies+hash-checks before an atomic cutover.
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key)
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const client = createClient(url, key, { auth: { persistSession: false } }),
  apply = process.argv.includes("--apply");
const sha = async (blob) =>
  crypto
    .createHash("sha256")
    .update(Buffer.from(await blob.arrayBuffer()))
    .digest("hex");
const { data: rows, error } = await client
  .from("vihem_chat_messages")
  .select(
    "id,thread_id,sender_id,attachment_url,attachment_path,thread:vihem_chat_threads(organisation_id)",
  )
  .is("deleted_at", null)
  .not("attachment_url", "is", null);
if (error) throw new Error("Could not inventory attachments.");
const mapping = [];
for (const row of rows) {
  const source = new URL(row.attachment_url),
    base = new URL(url),
    prefix = "/storage/v1/object/public/vihem-chat-attachments/";
  if (source.origin !== base.origin || !source.pathname.startsWith(prefix))
    throw new Error("Unknown legacy origin; manual review required.");
  const thread = Array.isArray(row.thread) ? row.thread[0] : row.thread;
  if (!thread?.organisation_id)
    throw new Error("Attachment has no organisation.");
  const path = `${thread.organisation_id}/${row.thread_id}/${row.sender_id}/legacy-${row.id}`;
  const { data: file, error: readError } = await client.storage
    .from("vihem-chat-attachments")
    .download(decodeURIComponent(source.pathname.slice(prefix.length)));
  if (readError || !file)
    throw new Error("Legacy file could not be read; no cutover performed.");
  if (apply) {
    const { data: existing } = await client.storage
      .from("vihem-chat-private")
      .download(path);
    if (!existing) {
      const { error: copyError } = await client.storage
        .from("vihem-chat-private")
        .upload(path, file, {
          contentType: file.type || "image/jpeg",
          upsert: false,
          metadata: { chat_uploader: row.sender_id },
        });
      if (copyError) throw new Error("Could not copy legacy file.");
    }
    const { data: copy, error: copyReadError } = await client.storage
      .from("vihem-chat-private")
      .download(path);
    if (copyReadError || !copy || (await sha(file)) !== (await sha(copy)))
      throw new Error("SHA-256 mismatch; no cutover performed.");
  }
  mapping.push({
    id: row.id,
    old_url: row.attachment_url,
    path,
    size: file.size,
    mime: file.type || "image/jpeg",
    sha256: await sha(file),
  });
}
console.log(
  `Verified inventory: ${mapping.length} references. No old files will be deleted.`,
);
if (apply) {
  const backup = process.env.CHAT_MIGRATION_BACKUP;
  if (!backup)
    throw new Error(
      "CHAT_MIGRATION_BACKUP must name a protected backup file before cutover.",
    );
  fs.writeFileSync(
    backup,
    JSON.stringify({ created_at: new Date().toISOString(), mapping }, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  const { error: cutoverError } = await client.rpc(
    "vihem_chat_legacy_cutover",
    { mapping },
  );
  if (cutoverError)
    throw new Error(
      "Atomic cutover failed; old references/public bucket retained. Inspect protected backup.",
    );
  console.log(
    "PASS: every referenced byte copied and hashed; references updated; legacy public access disabled.",
  );
} else
  console.log(
    "Read-only dry run. Use --apply with a protected CHAT_MIGRATION_BACKUP path after frontend and RPC rollout.",
  );
