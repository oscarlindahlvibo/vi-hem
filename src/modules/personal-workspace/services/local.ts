import type { Draft, InkDraft } from "../types";
// Separate from the legacy queue: it has neither owner scope nor document CAS.
// Resolve only on transaction COMMIT, never on a put request's early success.
let opening: Promise<IDBDatabase> | undefined;
function database() {
  return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("vihem-personal-workspace", 2);
    r.onupgradeneeded = () => {
      for (const name of ["notes", "ink"]) {
        const store = r.result.objectStoreNames.contains(name)
          ? r.transaction!.objectStore(name)
          : r.result.createObjectStore(name, { keyPath: "key" });
        if (!store.indexNames.contains("owner"))
          store.createIndex("owner", "owner");
        if (!store.indexNames.contains("pending"))
          store.createIndex("pending", "queue_owner");
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c) {
            c.update({
              ...c.value,
              queue_owner: c.value.dirty ? c.value.owner : undefined,
            });
            c.continue();
          }
        };
      }
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => {
        r.result.close();
        opening = undefined;
      };
      resolve(r.result);
    };
    r.onblocked = () => {
      opening = undefined;
      reject(
        Error(
          "Stäng andra VI-HEM-flikar och ladda om för att uppdatera den lokala lagringen.",
        ),
      );
    };
    r.onerror = () => {
      opening = undefined;
      reject(r.error);
    };
  }));
}
export async function store<T extends Draft | InkDraft>(
  name: "notes" | "ink",
  value: T,
) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(name, "readwrite");
    tx.objectStore(name).put({
      ...value,
      queue_owner: value.dirty ? value.owner : undefined,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function records<T extends Draft | InkDraft>(
  name: "notes" | "ink",
  owner: string,
  pending = false,
): Promise<T[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db
      .transaction(name)
      .objectStore(name)
      .index(pending ? "pending" : "owner")
      .getAll(owner);
    r.onsuccess = () =>
      resolve((r.result as T[]).filter((x) => x.owner === owner));
    r.onerror = () => reject(r.error);
  });
}
export async function removeLocal(name: "notes" | "ink", key: string) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(name, "readwrite");
    tx.objectStore(name).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export async function purgeCleanCache(owner: string) {
  for (const name of ["notes", "ink"] as const)
    for (const item of await records(name, owner))
      if (!item.dirty) await removeLocal(name, item.key);
}

export async function getLocal<T extends Draft | InkDraft>(
  name: "notes" | "ink",
  key: string,
): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db.transaction(name).objectStore(name).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

/** Atomic read/modify/write: an ACK must not overwrite a newer local edit. */
export async function updateLocal<T extends Draft | InkDraft>(
  name: "notes" | "ink",
  key: string,
  change: (old: T | undefined) => T | undefined,
): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, "readwrite"),
      bucket = tx.objectStore(name);
    let result: T | undefined;
    const r = bucket.get(key);
    r.onsuccess = () => {
      try {
        result = change(r.result as T | undefined);
        if (result)
          bucket.put({
            ...result,
            queue_owner: result.dirty ? result.owner : undefined,
          });
      } catch {
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error("Lokal transaktion avbröts."));
  });
}
