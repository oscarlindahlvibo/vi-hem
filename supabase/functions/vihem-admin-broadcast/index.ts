// Admin-authored push broadcast: fans a title+message out to every active
// profile of the chosen audience in the caller's own organisation, via
// create_notification() -- same RPC every other notification path in the
// app uses, so the existing AFTER INSERT trigger on vihem_notifications
// (see supabase/functions/vihem-send-push) turns each one into a real
// push automatically. Never cross-org: the target set is always scoped to
// the caller's own profile.organisation_id, same as every other org-admin
// action in this codebase.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey" };
const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 500;

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } });
}

function rolesForAudience(audience: string): string[] | null {
  if (audience === "tenant") return ["tenant"];
  if (audience === "staff") return ["staff", "admin"];
  if (audience === "all") return ["tenant", "staff", "admin"];
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeaders = { Authorization: req.headers.get("Authorization") || "" };
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: authHeaders } });
    const { data: authData } = await authClient.auth.getUser();
    if (!authData.user) return json({ error: "Du måste vara inloggad." }, 401);

    const { data: profile } = await db.from("vihem_profiles").select("id,role,organisation_id").eq("id", authData.user.id).maybeSingle();
    if (!profile || !["admin", "superadmin"].includes(profile.role)) return json({ error: "Endast admin kan skicka utskick." }, 403);
    if (!profile.organisation_id) return json({ error: "Kontot saknar organisation." }, 400);

    const body = await req.json().catch(() => ({}));
    const title = String(body.title || "").trim();
    const message = String(body.message || "").trim();
    const audience = String(body.audience || "");
    const recipientId = String(body.recipient_id || "").trim();

    if (!title) return json({ error: "Rubrik krävs." }, 400);
    if (title.length > MAX_TITLE_LENGTH) return json({ error: `Rubriken får vara högst ${MAX_TITLE_LENGTH} tecken.` }, 400);
    if (!message) return json({ error: "Meddelande krävs." }, 400);
    if (message.length > MAX_MESSAGE_LENGTH) return json({ error: `Meddelandet får vara högst ${MAX_MESSAGE_LENGTH} tecken.` }, 400);

    // Two mutually exclusive targeting modes: a whole audience group
    // (tenant/staff/all, see rolesForAudience) or one named person
    // (audience: 'individual' + recipient_id) -- resolve to the same
    // shape (a list of {id, name} to notify) either way so the
    // create_notification fan-out below doesn't need to branch.
    let recipients: { id: string; name: string | null }[];
    if (audience === "individual") {
      if (!recipientId) return json({ error: "Välj en mottagare." }, 400);
      const { data: person, error: personError } = await db
        .from("vihem_profiles")
        .select("id,name")
        .eq("id", recipientId)
        .eq("organisation_id", profile.organisation_id)
        .eq("active", true)
        .maybeSingle();
      if (personError) throw personError;
      if (!person) return json({ error: "Mottagaren hittades inte i din organisation." }, 404);
      recipients = [person];
    } else {
      const roles = rolesForAudience(audience);
      if (!roles) return json({ error: "Ogiltig mottagargrupp." }, 400);
      const { data: groupRecipients, error: recipientsError } = await db
        .from("vihem_profiles")
        .select("id,name")
        .eq("organisation_id", profile.organisation_id)
        .eq("active", true)
        .in("role", roles);
      if (recipientsError) throw recipientsError;
      if (!groupRecipients || groupRecipients.length === 0) return json({ error: "Inga mottagare hittades för vald grupp." }, 404);
      recipients = groupRecipients;
    }

    for (const recipient of recipients) {
      const { error: rpcError } = await db.rpc("create_notification", {
        recipient_id: recipient.id,
        org_uuid: profile.organisation_id,
        notification_title: title,
        notification_message: message,
        notification_type: "announcement",
        notification_link: "",
        setting_key: "admin_broadcast",
      });
      if (rpcError) throw rpcError;
    }

    await db.from("vihem_admin_broadcasts").insert({
      organisation_id: profile.organisation_id,
      sent_by: profile.id,
      audience,
      title,
      message,
      recipient_count: recipients.length,
      recipient_id: audience === "individual" ? recipients[0].id : null,
      recipient_name: audience === "individual" ? recipients[0].name : null,
    });

    return json({ ok: true, recipient_count: recipients.length });
  } catch (error) {
    console.error("vihem-admin-broadcast", error);
    return json({ error: error instanceof Error ? error.message : "Utskicket misslyckades." }, 500);
  }
});
