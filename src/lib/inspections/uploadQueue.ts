// Origin-local queue, partitioned by account and inspection. No cross-account reads.
// Quota/private-mode failures stop upload before the only local copy is discarded.
export type QueuedPhoto = { id: string; owner: string; inspection: string; roomKey: string; file: File; created: number; form?: string };
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('vihem-inspection-upload-queue', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(Error('Bilden kunde inte sparas lokalt. Behåll originalbilden och försök igen.'));
  });
}
export async function storeQueuedPhoto(photo: QueuedPhoto) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').put(photo); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(Error('Bilden kunde inte sparas lokalt. Behåll originalbilden.')); }); }
  finally { db.close(); }
}
export async function queuedPhotos(owner: string, inspection: string): Promise<QueuedPhoto[]> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const request = db.transaction('photos').objectStore('photos').getAll(); request.onsuccess = () => resolve(request.result.filter((photo: QueuedPhoto) => photo.owner === owner && photo.inspection === inspection)); request.onerror = () => reject(request.error); }); }
  finally { db.close(); }
}
export async function removeQueuedPhoto(id: string) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
  finally { db.close(); }
}

export function inspectionFormKey(value: unknown): string {
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize) : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)])) : item;
  return JSON.stringify(normalize(value));
}
