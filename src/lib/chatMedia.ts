import { supabase } from "./supabase";
import { validateChatFile } from "./chat";
export async function prepareChatImage(original: File): Promise<File> {
  let file = original;
  if (
    /\.(heic|heif)$/i.test(file.name) ||
    ["image/heic", "image/heif"].includes(file.type)
  ) {
    if (file.size > 50 * 1024 * 1024)
      throw new Error("Bilden får vara högst 50 MB.");
    try {
      const { default: heic2any } = await import("heic2any");
      const result = await heic2any({
        blob: file,
        toType: "image/jpeg",
        quality: 0.86,
      });
      file = new File(
        [Array.isArray(result) ? result[0] : result],
        file.name.replace(/\.(heic|heif)$/i, ".jpg"),
        { type: "image/jpeg" },
      );
    } catch {
      throw new Error(
        "HEIC-bilden kunde inte konverteras. Välj en JPEG-bild eller exportera fotot som JPEG.",
      );
    }
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    if (ratio === 1 && file.size < 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, 0.86),
    );
    if (blob && blob.size < file.size)
      return new File(
        [blob],
        type === "image/jpeg"
          ? file.name.replace(/\.[^.]+$/, ".jpg")
          : file.name,
        { type },
      );
    return file;
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
export async function uploadChatFile(thread: string, original: File) {
  if (
    !original.size ||
    original.size > 50 * 1024 * 1024 ||
    original.name.length > 240
  )
    throw new Error(
      "Bilagan får vara högst 50 MB och filnamnet högst 240 tecken.",
    );
  const file = await prepareChatImage(original);
  validateChatFile(file);
  const form = new FormData();
  form.append("thread", thread);
  form.append("file", file);
  const { data, error } = await supabase.functions.invoke("vihem-chat-upload", {
    body: form,
  });
  if (error || !data?.path)
    throw new Error(
      "Bilagan kunde inte laddas upp. Kontrollera filtypen och anslutningen.",
    );
  return data as { path: string; name: string; mime: string; size: number };
}

export async function discardChatFile(thread: string, path: string) {
  const { error } = await supabase.functions.invoke("vihem-chat-upload", {
    body: { action: "discard", thread, path },
  });
  if (error) throw new Error("Bilagan kunde inte tas bort från lagringen.");
}
