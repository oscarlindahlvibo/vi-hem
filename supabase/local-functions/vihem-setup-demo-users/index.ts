import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const demoUsers = [
  { id: "aaaaaaaa-0000-0000-0000-000000000001", email: "superadmin@demo.se", password: "Superadmin1234!", role: "superadmin", name: "Superadmin", phone: "" },
  { id: "00000000-0000-0000-0000-000000000001", email: "admin@demo.se", password: "Admin1234!", role: "admin", name: "Anna Lindqvist", phone: "070-100 00 01" },
  { id: "00000000-0000-0000-0000-000000000002", email: "personal@demo.se", password: "Personal1234!", role: "staff", name: "Erik Johansson", phone: "070-100 00 02" },
  { id: "00000000-0000-0000-0000-000000000003", email: "personal2@demo.se", password: "Personal1234!", role: "staff", name: "Maja Svensson", phone: "070-100 00 03" },
  { id: "00000000-0000-0000-0000-000000000004", email: "hyresgast@demo.se", password: "Hyresgast1234!", role: "tenant", name: "Lars Andersson", phone: "070-200 00 01" },
  { id: "00000000-0000-0000-0000-000000000005", email: "hyresgast2@demo.se", password: "Hyresgast1234!", role: "tenant", name: "Karin Nilsson", phone: "070-200 00 02" },
  { id: "00000000-0000-0000-0000-000000000006", email: "hyresgast3@demo.se", password: "Hyresgast1234!", role: "tenant", name: "Peter Gustafsson", phone: "070-200 00 03" },
  { id: "00000000-0000-0000-0000-000000000007", email: "hyresgast4@demo.se", password: "Hyresgast1234!", role: "tenant", name: "Sara Eriksson", phone: "070-200 00 04" },
  { id: "00000000-0000-0000-0000-000000000008", email: "hyresgast5@demo.se", password: "Hyresgast1234!", role: "tenant", name: "Johan Pettersson", phone: "070-200 00 05" },
  { id: "00000000-0000-0000-0000-000000000009", email: "personal3@demo.se", password: "Personal1234!", role: "staff", name: "Maria Olsson", phone: "070-100 00 04" },
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const results: { email: string; status: string; error?: string }[] = [];

    for (const u of demoUsers) {
      // Try to create the user; if it exists, update the password instead
      const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = existing?.users?.find(eu => eu.email === u.email);

      if (existingUser) {
        // Update password
        const { error } = await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
          password: u.password,
          email_confirm: true,
        });
        if (error) {
          results.push({ email: u.email, status: "error updating", error: error.message });
        } else {
          await supabaseAdmin.from("profiles").upsert({
            id: existingUser.id,
            name: u.name,
            email: u.email,
            phone: u.phone,
            role: u.role,
            active: true,
          }, { onConflict: "id" });
          results.push({ email: u.email, status: "updated" });
        }
      } else {
        // Try update by known ID first (handles manually-inserted users)
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(u.id, {
          password: u.password,
          email_confirm: true,
        });
        if (!updateError) {
          await supabaseAdmin.from("profiles").upsert({
            id: u.id,
            name: u.name,
            email: u.email,
            phone: u.phone,
            role: u.role,
            active: true,
          }, { onConflict: "id" });
          results.push({ email: u.email, status: "updated by id" });
        } else {
          // Truly new user — create via admin API
          const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email: u.email,
            password: u.password,
            email_confirm: true,
            user_metadata: { name: u.name },
          });

          if (error) {
            results.push({ email: u.email, status: "error creating", error: error.message });
          } else if (data.user) {
            await supabaseAdmin.from("profiles").upsert({
              id: data.user.id,
              name: u.name,
              email: u.email,
              phone: u.phone,
              role: u.role,
              active: true,
            }, { onConflict: "id" });
            results.push({ email: u.email, status: "created", id: data.user.id });
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
