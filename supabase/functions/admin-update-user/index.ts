import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: caller }, error: callerError } = await userClient.auth.getUser();
    if (callerError || !caller) return json({ error: "Unauthorized" }, 401);

    const { data: callerProfile, error: callerProfileError } = await userClient
      .from("profiles")
      .select("role, organisation_id")
      .eq("id", caller.id)
      .maybeSingle();

    if (callerProfileError || !callerProfile) return json({ error: "Unauthorized" }, 401);

    const { user_id, name, email, phone, active } = await req.json() as {
      user_id?: string;
      name?: string;
      email?: string;
      phone?: string;
      active?: boolean;
    };

    if (!user_id) return json({ error: "user_id is required" }, 400);
    if (!name?.trim()) return json({ error: "Namn krävs." }, 400);
    if (!email?.trim()) return json({ error: "E-post krävs." }, 400);

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: targetProfile, error: targetProfileError } = await adminClient
      .from("profiles")
      .select("id, role, organisation_id")
      .eq("id", user_id)
      .maybeSingle();

    if (targetProfileError || !targetProfile) return json({ error: "User not found" }, 404);

    const callerIsSuperadmin = callerProfile.role === "superadmin";
    const callerIsOrgAdmin = callerProfile.role === "admin"
      && targetProfile.role !== "superadmin"
      && targetProfile.organisation_id === callerProfile.organisation_id;

    if (!callerIsSuperadmin && !callerIsOrgAdmin) {
      return json({ error: "Forbidden" }, 403);
    }

    if (targetProfile.role === "superadmin" && !callerIsSuperadmin) {
      return json({ error: "Forbidden: only superadmins can update superadmins" }, 403);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const { error: authError } = await adminClient.auth.admin.updateUserById(user_id, {
      email: normalizedEmail,
      email_confirm: true,
      user_metadata: { name: name.trim() },
    });

    if (authError) return json({ error: authError.message }, 400);

    const { error: profileError } = await adminClient
      .from("profiles")
      .update({
        name: name.trim(),
        email: normalizedEmail,
        phone: phone?.trim() ?? "",
        active: active ?? true,
      })
      .eq("id", user_id);

    if (profileError) return json({ error: profileError.message }, 400);

    return json({ success: true, email: normalizedEmail });
  } catch (err) {
    console.error(err);
    return json({ error: "Internt serverfel" }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
