// Bygger lektionsinnehåll (utan facit) med korta signerade URL:er för privata filer. Används av deltagar-API:t och personalens förhandsvisning.
import { isUuid } from "./kp-common.ts";

export const SIGN_TTL = 2 * 3600;

/** Funktionerna ser lagringen via den interna adressen (kong:8000). Webbläsare behöver den publika: byt ut ursprunget i signerade URL:er. */
export const publicApiBase = () => (Deno.env.get("KP_PUBLIC_API_URL") || "https://supabase.asedatruckmeet.se").replace(/\/$/, "");
export const publicize = (url: string | null | undefined) => (url ? url.replace(/^https?:\/\/[^/]+/, publicApiBase()) : null);

export function makeSigner(admin: any) {
  return async (bucket: string, path: string | null | undefined, ttl = SIGN_TTL, download?: string) => {
    if (!path) return null;
    const { data } = await admin.storage.from(bucket).createSignedUrl(path, ttl, download ? { download } : undefined);
    return publicize(data?.signedUrl);
  };
}

export async function buildLessonBlocks(admin: any, org: string, versionId: string, lessonId: string) {
  const sign = makeSigner(admin);
  const { data: lesson } = await admin.from("vihem_kp_lessons").select("id,title,kind,completion_rule,estimated_minutes").eq("id", lessonId).eq("version_id", versionId).single();
  const { data: blocks } = await admin.from("vihem_kp_lesson_blocks").select("id,kind,sort_order,content").eq("lesson_id", lesson.id).order("sort_order");
  const assetIds = (blocks ?? []).map((b: any) => b.content?.asset_id).filter(isUuid);
  const { data: assets } = assetIds.length ? await admin.from("vihem_kp_media_assets").select("id,kind,bucket,storage_path,duration_seconds,poster_path,captions,alt_text,original_name,mime_type").in("id", assetIds).eq("organisation_id", org) : { data: [] };
  const out: any[] = [];
  for (const b of blocks ?? []) {
    const c = b.content ?? {}; const a: any = (assets ?? []).find((x: any) => x.id === c.asset_id);
    if (b.kind === "text") out.push({ id: b.id, kind: "text", markdown: String(c.markdown ?? "") });
    else if (b.kind === "link") out.push({ id: b.id, kind: "link", url: String(c.url ?? ""), title: String(c.title ?? c.url ?? "") });
    else if (b.kind === "video" && a) out.push({ id: b.id, kind: "video", asset_id: a.id, title: c.title ?? a.original_name, duration_seconds: a.duration_seconds, poster_url: await sign(a.bucket, a.poster_path, 3600), captions: await Promise.all((a.captions ?? []).map(async (cap: any) => ({ lang: cap.lang, label: cap.label ?? cap.lang, url: await sign(a.bucket, cap.path, SIGN_TTL) }))) });
    else if (["image", "audio", "document"].includes(b.kind) && a) out.push({ id: b.id, kind: b.kind, title: c.title ?? a.original_name, alt: a.alt_text, url: await sign(a.bucket, a.storage_path, SIGN_TTL, b.kind === "document" ? (a.original_name || "dokument") : undefined) });
    else if (b.kind === "knowledge_check") {
      const ids = (c.question_ids ?? []).filter(isUuid);
      const { data: qs } = ids.length ? await admin.from("vihem_kp_questions").select("id,prompt,type,vihem_kp_question_options(id,label,sort_order)").in("id", ids).eq("organisation_id", org) : { data: [] };
      out.push({ id: b.id, kind: "knowledge_check", questions: (qs ?? []).map((q: any) => ({ id: q.id, prompt: q.prompt, multiple: q.type === "multiple", options: [...q.vihem_kp_question_options].sort((x: any, y: any) => x.sort_order - y.sort_order).map((o: any) => ({ id: o.id, label: o.label })) })) });
    }
  }
  return { lesson: { id: lesson.id, title: lesson.title, kind: lesson.kind, completion_rule: lesson.completion_rule, minutes: lesson.estimated_minutes }, blocks: out };
}
