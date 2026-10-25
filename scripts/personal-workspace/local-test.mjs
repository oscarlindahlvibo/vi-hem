import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
// Begin with a real older cache schema to test an upgrade with unsynced data.
const old = await new Promise((resolve, reject) => {
  const r = indexedDB.open("vihem-personal-workspace", 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore("notes", { keyPath: "key" });
    r.result.createObjectStore("ink", { keyPath: "key" });
  };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
await new Promise((resolve) => {
  const tx = old.transaction("notes", "readwrite");
  tx.objectStore("notes").put({
    key: "A:n1",
    owner: "A",
    note: { id: "n1" },
    mutation: "old",
    dirty: true,
  });
  tx.oncomplete = resolve;
});
old.close();
const tmp = await mkdtemp(join(tmpdir(), "vihem-workspace-local-"));
try {
  const out = join(tmp, "local.mjs");
  await build({
    entryPoints: ["src/modules/personal-workspace/services/local.ts"],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "esm",
  });
  const { records, store, getLocal, purgeCleanCache, updateLocal } =
    await import(pathToFileURL(out).href);
  assert.equal((await records("notes", "A", true)).length, 1); // v1 pending data survives upgrade
  await store("notes", {
    key: "B:n2",
    owner: "B",
    note: { id: "n2", title: "B privat" },
    mutation: "b",
    dirty: true,
  });
  await store("notes", {
    key: "A:n3",
    owner: "A",
    note: { id: "n3", title: "A ren" },
    mutation: "a",
    dirty: false,
  });
  assert.equal((await records("notes", "A")).length, 2);
  assert.equal((await records("notes", "B")).length, 1);
  assert.equal((await records("notes", "A", true)).length, 1);
  await purgeCleanCache("A");
  assert.equal((await records("notes", "A")).length, 1);
  assert.equal((await records("notes", "B")).length, 1);
  assert.equal((await getLocal("notes", "B:n2")).note.title, "B privat");
  await assert.rejects(
    store("notes", {
      key: "bad",
      owner: "A",
      note: { nonCloneable: () => {} },
      dirty: true,
    }),
  );
  // Independent stroke identities survive retries/re-open, and only dirty strokes are queued.
  await store("ink", {
    key: "A:s1",
    owner: "A",
    value: { id: "s1", note_id: "n1" },
    dirty: true,
  });
  await store("ink", {
    key: "A:s2",
    owner: "A",
    value: { id: "s2", note_id: "n1" },
    dirty: true,
  });
  await store("ink", {
    key: "A:s1",
    owner: "A",
    value: { id: "s1", note_id: "n1", revision: 1 },
    dirty: false,
  });
  assert.equal((await records("ink", "A")).length, 2);
  assert.equal((await records("ink", "A", true)).length, 1);
  for (let i = 0; i < 20; i++) {
    const key = "A:race" + i,
      old = {
        key,
        owner: "A",
        note: { id: "race", title: "old", revision: 1 },
        mutation: "old",
        dirty: true,
      };
    await store("notes", old);
    const edit = () =>
      store("notes", {
        ...old,
        note: { ...old.note, title: "new" },
        mutation: "new",
      });
    const ack = () =>
      updateLocal("notes", key, (current) =>
        current.mutation === "old"
          ? {
              ...current,
              note: { ...current.note, title: "old", revision: 2 },
              dirty: false,
            }
          : { ...current, note: { ...current.note, revision: 2 } },
      );
    await Promise.all(i % 2 ? [edit(), ack()] : [ack(), edit()]);
    assert.equal((await getLocal("notes", key)).note.title, "new");
  }
  console.log(
    "PASS: IndexedDB v1 upgrade, committed owner-scoped drafts, pending index, rejected local writes, logout clean-cache purge preserves unsynced work, independent ink records",
  );
} finally {
  await rm(tmp, { recursive: true, force: true });
}
