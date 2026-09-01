// Drift & rutiner -- Rutiner. Coordinates the two things that are unsafe
// to do from the client directly: assigning the next version_number
// (a race between two edits must never produce two versions with the same
// number) and fanning published/acknowledgement-required routines out to
// affected staff via create_notification. Everything else (reading
// routines, acknowledging one, editing scope/local notes/attachments) goes
// straight through the client against RLS -- see
// 20260901150000_routines.sql's policies. Audit logging for create/update/
// publish/archive is a DB trigger (20260901180000), not done here, so it
// can't be skipped by a future call site.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey" };

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeaders = { Authorization: req.headers.get("Authorization") || "" };
    const authDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: authHeaders } });
    const { data: authData } = await authDb.auth.getUser();
    if (!authData.user) return json({ error: "Du måste vara inloggad." }, 401);

    const { data: profile } = await db.from("vihem_profiles").select("id,role,organisation_id").eq("id", authData.user.id).maybeSingle();
    if (!profile?.organisation_id) return json({ error: "Kontot saknar organisation." }, 400);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "save") {
      const { data: allowed } = await db.rpc("vihem_has_permission", { p_user_id: profile.id, p_permission_key: "routine.edit" });
      if (!allowed) return json({ error: "Du saknar behörighet att redigera rutiner." }, 403);

      const title = String(body.title || "").trim();
      if (!title) return json({ error: "Titel krävs." }, 400);
      const status = body.status === "published" ? "published" : "draft";
      if (status === "published") {
        const { data: canPublish } = await db.rpc("vihem_has_permission", { p_user_id: profile.id, p_permission_key: "routine.publish" });
        if (!canPublish) return json({ error: "Du saknar behörighet att publicera rutiner." }, 403);
      }

      const callerDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: authHeaders } });

      const routineFields = {
        organisation_id: profile.organisation_id,
        title,
        category: String(body.category || "ovrigt"),
        summary: String(body.summary || ""),
        is_emergency: Boolean(body.is_emergency),
        applies_to_roles: Array.isArray(body.applies_to_roles) && body.applies_to_roles.length ? body.applies_to_roles : ["staff", "admin"],
        requires_acknowledgement: Boolean(body.requires_acknowledgement),
        valid_from: body.valid_from || null,
        valid_to: body.valid_to || null,
        status,
      };

      let routineId = String(body.id || "");
      if (!routineId) {
        // Always insert as 'draft' regardless of the requested final
        // status: the later UPDATE below (which sets the real status)
        // is what makes the audit trigger's draft->published transition
        // fire correctly for a brand-new routine published immediately.
        const { data: created, error: createError } = await callerDb.from("vihem_routines").insert({ ...routineFields, status: "draft", created_by: profile.id }).select("id").single();
        if (createError) throw createError;
        routineId = created.id;
      } else {
        const { data: existing } = await db.from("vihem_routines").select("id,organisation_id").eq("id", routineId).maybeSingle();
        if (!existing || existing.organisation_id !== profile.organisation_id) return json({ error: "Rutinen hittades inte." }, 404);
      }

      const { data: maxVersion } = await db
        .from("vihem_routine_versions")
        .select("version_number")
        .eq("routine_id", routineId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVersionNumber = (maxVersion?.version_number || 0) + 1;

      const { data: version, error: versionError } = await callerDb
        .from("vihem_routine_versions")
        .insert({
          routine_id: routineId,
          version_number: nextVersionNumber,
          body: String(body.body || ""),
          steps: Array.isArray(body.steps) ? body.steps : [],
          warnings: String(body.warnings || ""),
          tips: String(body.tips || ""),
          change_comment: String(body.change_comment || ""),
          changed_by: profile.id,
        })
        .select("id")
        .single();
      if (versionError) throw versionError;

      const checklistItems = Array.isArray(body.checklist_items) ? body.checklist_items : [];
      if (checklistItems.length) {
        const rows = checklistItems.map((item: any, index: number) => ({
          routine_version_id: version.id,
          sort_order: index,
          label: String(item.label || "").trim(),
          required: Boolean(item.required),
          requires_photo: Boolean(item.requires_photo),
        })).filter((row: any) => row.label);
        if (rows.length) {
          const { error: checklistError } = await callerDb.from("vihem_routine_checklist_templates").insert(rows);
          if (checklistError) throw checklistError;
        }
      }

      const { error: updateError } = await callerDb
        .from("vihem_routines")
        .update({ ...routineFields, current_version_id: version.id, updated_at: new Date().toISOString() })
        .eq("id", routineId);
      if (updateError) throw updateError;

      if (status === "published" && routineFields.requires_acknowledgement) {
        const { data: recipients } = await db
          .from("vihem_profiles")
          .select("id")
          .eq("organisation_id", profile.organisation_id)
          .eq("active", true)
          .in("role", routineFields.applies_to_roles as string[]);
        for (const recipient of recipients || []) {
          await db.rpc("create_notification", {
            recipient_id: recipient.id,
            org_uuid: profile.organisation_id,
            notification_title: "Ny rutin kräver kvittering",
            notification_message: title,
            notification_type: "announcement",
            notification_link: `operations/routines/${routineId}`,
            setting_key: "admin_broadcast",
          });
        }
      }

      return json({ ok: true, id: routineId, version_id: version.id, version_number: nextVersionNumber });
    }

    if (action === "archive") {
      const routineId = String(body.id || "");
      if (!routineId) return json({ error: "id krävs." }, 400);
      const { data: allowed } = await db.rpc("vihem_has_permission", { p_user_id: profile.id, p_permission_key: "routine.archive" });
      if (!allowed) return json({ error: "Du saknar behörighet att arkivera rutiner." }, 403);

      const callerDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: authHeaders } });
      const { error } = await callerDb.from("vihem_routines").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", routineId);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Okänd åtgärd." }, 400);
  } catch (error) {
    console.error("vihem-routines", error);
    return json({ error: error instanceof Error ? error.message : "Åtgärden misslyckades." }, 500);
  }
});
