import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authenticate,
  isAuthContext,
  json,
  errorJson,
  corsHeaders,
} from "../_shared/vihem-auth.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")
    return errorJson("METHOD", "Endast POST stöds.", 405);
  const auth = await authenticate(req);
  if (!isAuthContext(auth)) return auth;
  try {
    if (!["staff", "admin", "superadmin"].includes(auth.callerProfile.role))
      return errorJson(
        "FORBIDDEN",
        "Endast personal kan kopiera bilagan.",
        403,
      );
    const { work_order_id, message_id } = await req.json();
    const { data: order } = await auth.userClient
      .from("vihem_work_orders")
      .select("id,organisation_id,created_by")
      .eq("id", work_order_id)
      .eq("organisation_id", auth.callerProfile.organisation_id)
      .eq("created_by", auth.callerId)
      .maybeSingle();
    const { data: source } = await auth.userClient
      .from("vihem_chat_messages")
      .select(
        "id,thread_id,attachment_path,attachment_name,attachment_mime,attachment_size,deleted_at",
      )
      .eq("id", message_id)
      .maybeSingle();
    if (!order || !source || source.deleted_at || !source.attachment_path)
      return errorJson(
        "FORBIDDEN",
        "Saknar åtkomst till arbetsordern eller bilagan.",
        403,
      );
    const { data: previous } = await auth.userClient
      .from("vihem_chat_workorder_files")
      .select("id")
      .eq("work_order_id", order.id)
      .eq("source_message_id", source.id)
      .maybeSingle();
    if (previous) return json({ ok: true, id: previous.id });
    const { data: file, error } = await auth.userClient.storage
      .from("vihem-chat-private")
      .download(source.attachment_path);
    if (error || !file) throw new Error("Bilagan kunde inte hämtas.");
    const { data: stillAllowed } = await auth.userClient
      .from("vihem_chat_messages")
      .select("id")
      .eq("id", source.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!stillAllowed)
      return errorJson("FORBIDDEN", "Åtkomsten till bilagan har ändrats.", 403);
    const path = `${order.organisation_id}/${order.id}/${source.id}`;
    const { error: uploadError } = await auth.adminClient.storage
      .from("vihem-chat-workorder-private")
      .upload(path, file, {
        contentType: source.attachment_mime || "application/octet-stream",
        upsert: false,
      });
    if (uploadError && uploadError.statusCode !== "409")
      throw new Error("Bilagan kunde inte kopieras.");
    const { data: result, error: insertError } = await auth.adminClient
      .from("vihem_chat_workorder_files")
      .upsert(
        {
          organisation_id: order.organisation_id,
          work_order_id: order.id,
          source_message_id: source.id,
          path,
          name: source.attachment_name || "Bilaga",
          mime: source.attachment_mime,
          size: file.size,
          created_by: auth.callerId,
        },
        { onConflict: "work_order_id,source_message_id" },
      )
      .select("id")
      .single();
    if (insertError)
      throw new Error("Kopplingen till arbetsordern kunde inte sparas.");
    return json({ ok: true, id: result.id });
  } catch {
    return errorJson(
      "COPY_FAILED",
      "Arbetsordern finns kvar, men bilagan kunde inte kopieras. Försök igen.",
      400,
    );
  }
});
