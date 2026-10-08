import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authenticate,
  isAuthContext,
  json,
  errorJson,
  corsHeaders,
} from "../_shared/vihem-auth.ts";
import { validateChatBytes } from "../_shared/chat-files.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")
    return errorJson("METHOD", "Endast POST stöds.", 405);
  const auth = await authenticate(req);
  if (!isAuthContext(auth)) return auth;
  const org = auth.callerProfile.organisation_id;
  if (
    !org ||
    !["tenant", "staff", "admin", "superadmin"].includes(
      auth.callerProfile.role,
    )
  )
    return errorJson("FORBIDDEN", "Saknar behörighet.", 403);
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const { action, path, thread } = await req.json();
      if (
        action !== "discard" ||
        typeof path !== "string" ||
        !path.startsWith(`${org}/${thread}/${auth.callerId}/`) ||
        path.includes("..")
      )
        return errorJson("INVALID", "Ogiltig bilaga.", 400);
      const { data: allowed } = await auth.userClient
        .from("vihem_chat_threads")
        .select("id")
        .eq("id", thread)
        .maybeSingle();
      if (!allowed) return errorJson("FORBIDDEN", "Saknar åtkomst.", 403);
      const [
        { data: messages, error: messageError },
        { data: groups, error: groupError },
      ] = await Promise.all([
        auth.adminClient
          .from("vihem_chat_messages")
          .select("id")
          .eq("attachment_path", path)
          .limit(1),
        auth.adminClient
          .from("vihem_chat_threads")
          .select("id")
          .eq("group_image_path", path)
          .limit(1),
      ]);
      if (messageError || groupError)
        throw new Error("Bilagans användning kunde inte verifieras.");
      if (messages?.length || groups?.length)
        return errorJson("IN_USE", "Bilagan används redan.", 409);
      const { error } = await auth.adminClient.storage
        .from("vihem-chat-private")
        .remove([path]);
      if (error) throw new Error("Bilagan kunde inte tas bort.");
      return json({ ok: true });
    }
    const data = await req.formData(),
      thread = String(data.get("thread") || ""),
      file = data.get("file");
    if (
      !/^[0-9a-f-]{36}$/i.test(thread) ||
      !(file instanceof File) ||
      file.size > 52428800 ||
      !file.size ||
      file.name.length > 240
    )
      return errorJson("INVALID_FILE", "Ogiltig bilaga. Högst 50 MB.", 400);
    const { data: t, error } = await auth.userClient
      .from("vihem_chat_threads")
      .select("id,status,organisation_id")
      .eq("id", thread)
      .eq("organisation_id", org)
      .maybeSingle();
    if (error || !t || t.status !== "open")
      return errorJson("FORBIDDEN", "Saknar åtkomst till konversationen.", 403);
    const mime = file.type.split(";")[0],
      bytes = new Uint8Array(await file.arrayBuffer());
    validateChatBytes(bytes, mime);
    const path = `${org}/${thread}/${auth.callerId}/${crypto.randomUUID()}`;
    const { error: uploadError } = await auth.adminClient.storage
      .from("vihem-chat-private")
      .upload(path, bytes, {
        contentType: mime,
        upsert: false,
        metadata: { chat_uploader: auth.callerId },
      });
    if (uploadError) throw new Error("Bilagan kunde inte laddas upp.");
    // Storage's service uploads have no user owner: match uploader via the path
    // and validate an authoritative metadata field in the send RPC instead.
    return json({ path, name: file.name, mime, size: file.size });
  } catch (err) {
    return errorJson(
      "UPLOAD_FAILED",
      err instanceof Error ? err.message : "Uppladdningen misslyckades.",
      400,
    );
  }
});
