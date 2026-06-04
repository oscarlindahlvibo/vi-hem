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
    // Verify the calling user is admin/superadmin via their JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Client scoped to the calling user (to check their role)
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: caller }, error: callerError } = await userClient.auth.getUser();
    if (callerError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch caller profile to verify role
    const { data: callerProfile, error: profileError } = await userClient
      .from("profiles")
      .select("role, organisation_id")
      .eq("id", caller.id)
      .maybeSingle();

    if (profileError || !callerProfile) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["admin", "superadmin"].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden: only admins can create users" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { name, email, phone, role, organisation_id } = body as {
      name: string;
      email: string;
      phone?: string;
      role: string;
      organisation_id?: string;
    };

    if (!name || !email || !role) {
      return new Response(JSON.stringify({ error: "name, email and role are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (role === "superadmin" && callerProfile.role !== "superadmin") {
      return new Response(JSON.stringify({ error: "Forbidden: only superadmins can create superadmins" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Non-superadmin can only create users in their own organisation.
    // Superadmin accounts are platform accounts and do not belong to an organisation.
    const targetOrgId = role === "superadmin"
      ? null
      : callerProfile.role === "superadmin"
        ? (organisation_id ?? callerProfile.organisation_id)
        : callerProfile.organisation_id;

    if (role !== "superadmin" && !targetOrgId) {
      return new Response(JSON.stringify({ error: "Organisation saknas för användaren." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admins cannot create superadmins
    if (callerProfile.role === "admin" && role === "superadmin") {
      return new Response(JSON.stringify({ error: "Forbidden: admins cannot create superadmins" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role to create auth user
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (role !== "superadmin") {
      const [{ data: org, error: orgError }, { count: userCount, error: countError }] = await Promise.all([
        adminClient
          .from("organisations")
          .select("max_users")
          .eq("id", targetOrgId)
          .maybeSingle(),
        adminClient
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("organisation_id", targetOrgId),
      ]);

      if (orgError || !org) {
        return new Response(JSON.stringify({ error: "Organisationen kunde inte hittas." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (countError) {
        return new Response(JSON.stringify({ error: "Kunde inte kontrollera användarkvoten." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if ((userCount ?? 0) >= org.max_users) {
        return new Response(JSON.stringify({ error: `Licensgränsen för användare är nådd (${org.max_users} st).` }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Generate a secure temporary password
    const tempPassword = generatePassword();

    const { data: newAuthUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createError) {
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create the profile row (trigger may also create one — use upsert)
    await adminClient.from("profiles").upsert({
      id: newAuthUser.user!.id,
      name,
      email,
      phone: phone ?? "",
      role,
      active: true,
      organisation_id: targetOrgId,
      auth_method: "password",
    });

    // Create a recovery link for production email integrations. The temporary
    // password is still returned so admins can share it securely when needed.
    await adminClient.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${req.headers.get("origin") ?? ""}/reset-password` },
    });

    return new Response(
      JSON.stringify({
        success: true,
        user_id: newAuthUser.user!.id,
        temp_password: tempPassword,
        message: "Användare skapad med tillfälligt lösenord för " + email,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: "Internt serverfel" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/** Generate a cryptographically random temporary password */
function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#";
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}
