import { supabase } from "./supabase";
const lifetime = 5 * 60 * 1000;
type Cached = { url: string; expires: number };
const cache = new Map<string, Cached>();
const pending = new Map<string, Promise<string>>();
type Request = { id: string; resolve: (path: string | null) => void };
let queue: Request[] = [],
  scheduled = false;
function pathFor(id: string) {
  return new Promise<string | null>((resolve) => {
    queue.push({ id, resolve });
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(async () => {
      const requests = queue;
      queue = [];
      scheduled = false;
      for (let index = 0; index < requests.length; index += 100) {
        const batch = requests.slice(index, index + 100),
          ids = [...new Set(batch.map((r) => r.id))];
        try {
          const { data, error } = await supabase.rpc("vihem_avatar_paths", {
            ids,
          });
          const paths = new Map<string, string>(
            (!error && Array.isArray(data) ? data : []).map((row) => [
              row.user_id,
              row.path,
            ]),
          );
          batch.forEach((r) => r.resolve(paths.get(r.id) || null));
        } catch {
          batch.forEach((r) => r.resolve(null));
        }
      }
    });
  });
}
let generation = 0;
export function clearAvatarPhotos() {
  generation++;
  for (const item of cache.values())
    if (item.url) URL.revokeObjectURL(item.url);
  cache.clear();
  pending.clear();
  window.dispatchEvent(new Event("vihem-avatar-changed"));
}
export async function getAvatarPhoto(scope: string, id: string) {
  const key = scope + ":" + id,
    entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.url;
  if (pending.has(key)) return pending.get(key)!;
  const epoch = generation;
  const promise = (async () => {
    const path = await pathFor(id);
    let url = "";
    if (path) {
      const { data, error } = await supabase.storage
        .from("vihem-profile-photos")
        .download(path);
      if (!error && data) url = URL.createObjectURL(data);
    }
    if (epoch !== generation) {
      if (url) URL.revokeObjectURL(url);
      return "";
    }
    if (entry?.url) URL.revokeObjectURL(entry.url);
    cache.set(key, { url, expires: Date.now() + lifetime });
    return url;
  })()
    .catch(() => "")
    .finally(() => {
      if (epoch === generation) pending.delete(key);
    });
  pending.set(key, promise);
  return promise;
}
