/** A partial batch must not discard successful uploads or retry those files. */
export async function uploadImageBatch<T>(
  files: T[],
  upload: (file: T) => Promise<string>,
) {
  const uploaded: string[] = [];
  const failed: T[] = [];
  for (const file of files) {
    try {
      uploaded.push(await upload(file));
    } catch {
      failed.push(file);
    }
  }
  return { uploaded, failed };
}
