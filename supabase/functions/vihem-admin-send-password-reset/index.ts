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
      .from("vihem_profiles")
      .select("role, organisation_id")
      .eq("id", caller.id)
      .maybeSingle();

    if (callerProfileError || !callerProfile || !["admin", "superadmin"].includes(callerProfile.role)) {
      return json({ error: "Forbidden" }, 403);
    }

    const { user_id, redirect_to } = await req.json() as { user_id?: string; redirect_to?: string };
    if (!user_id) return json({ error: "user_id is required" }, 400);

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: targetProfile, error: targetProfileError } = await adminClient
      .from("vihem_profiles")
      .select("id, email, role, organisation_id")
      .eq("id", user_id)
      .maybeSingle();

    if (targetProfileError || !targetProfile) return json({ error: "User not found" }, 404);

    if (
      callerProfile.role !== "superadmin" &&
      targetProfile.organisation_id !== callerProfile.organisation_id
    ) {
      return json({ error: "Forbidden: user belongs to another organisation" }, 403);
    }

    if (callerProfile.role === "admin" && targetProfile.role === "superadmin") {
      return json({ error: "Forbidden: admins cannot reset superadmins" }, 403);
    }

    const { error } = await adminClient.auth.resetPasswordForEmail(targetProfile.email, {
      redirectTo: redirect_to || `${req.headers.get("origin") ?? ""}/reset-password`,
    });

    if (error) {
      const message = error.message.toLowerCase().includes("sending")
        ? "Kunde inte skicka återställningsmejl. Kontrollera SMTP/Postfix-konfigurationen på servern."
        : error.message;
      return json({ error: message }, 400);
    }

    return json({ success: true, email: targetProfile.email });
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
