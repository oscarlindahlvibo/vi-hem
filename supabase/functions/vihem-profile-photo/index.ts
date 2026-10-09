import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authenticate,
  isAuthContext,
  corsHeaders,
  errorJson,
  json,
} from "../_shared/vihem-auth.ts";
import { validProfileJpeg } from "./jpeg.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")
    return errorJson("METHOD", "Endast POST stöds", 405);
  const auth = await authenticate(req);
  if (!isAuthContext(auth)) return auth;
  const { data: profile } = await auth.userClient
    .from("vihem_profiles")
    .select("active")
    .eq("id", auth.callerId)
    .single();
  if (!profile?.active)
    return errorJson("PROFILE", "Kontot är inte aktivt.", 403);
  try {
    const data = await req.formData(),
      file = data.get("file");
    if (
      !(file instanceof File) ||
      file.type !== "image/jpeg" ||
      file.size < 4 ||
      file.size > 2097152
    )
      return errorJson("PHOTO", "Välj en JPEG-bild mindre än 2 MB.", 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validProfileJpeg(bytes))
      return errorJson("PHOTO", "Filen är inte en giltig JPEG-bild.", 400);
    const owner = auth.callerId,
      org = auth.callerProfile.organisation_id;
    const path = `${org || "platform"}/${owner}/${crypto.randomUUID()}.jpg`;
    const { error: upload } = await auth.adminClient.storage
      .from("vihem-profile-photos")
      .upload(path, file, {
        contentType: "image/jpeg",
        upsert: false,
        metadata: { profile_owner: owner },
      });
    if (upload)
      return errorJson(
        "UPLOAD",
        "Bilden kunde inte laddas upp. Försök igen.",
        500,
      );
    // Mutation as the caller: database ownership and uploaded-object checks apply.
    const { error: save } = await auth.userClient.rpc(
      "vihem_set_profile_photo",
      { path },
    );
    if (save) {
      await auth.adminClient.storage
        .from("vihem-profile-photos")
        .remove([path]);
      return errorJson(
        "SAVE",
        "Profilbilden kunde inte sparas. Försök igen.",
        500,
      );
    }
    return json({ path });
  } catch {
    return errorJson("PHOTO", "Bilden kunde inte sparas. Försök igen.", 500);
  }
});
