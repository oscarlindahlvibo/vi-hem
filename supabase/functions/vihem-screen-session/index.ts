// Exchanges a screen access token (vihem_screen_tokens, created by an
// admin in ScreenSettingsPage.tsx) for a real Supabase Auth session for
// that token's role='screen' profile -- lets a TV log in by visiting a
// link once instead of an admin typing the screen account's
// email+password directly on the device. The resulting session is a
// completely ordinary authenticated session for that profile, so every
// existing role='screen' RLS policy elsewhere keeps working unchanged --
// this only replaces how the credential reaches the device, not what the
// account can do. Public: called before any session exists, same as
// vihem-public-laundry/vihem-agreements-public (the anon apikey the
// client always sends is itself a valid JWT, so no verify_jwt=false
// override is needed in config.toml).
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
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    if (!token) return json({ error: "Länken saknar en giltig kod." }, 400);

    const { data: tokenRow } = await db.from("vihem_screen_tokens").select("id,profile_id,organisation_id,active").eq("token", token).maybeSingle();
    if (!tokenRow || !tokenRow.active) return json({ error: "Länken är ogiltig eller har återkallats." }, 401);

    const { data: profile } = await db.from("vihem_profiles").select("id,email,role,active,organisation_id").eq("id", tokenRow.profile_id).maybeSingle();
    if (!profile || profile.role !== "screen" || profile.active === false || profile.organisation_id !== tokenRow.organisation_id || !profile.email) {
      return json({ error: "Skärmkontot kunde inte hittas eller är inaktiverat." }, 401);
    }

    // generateLink mints a fresh, short-lived one-time token for the
    // existing auth.users row matching this email -- verified client-side
    // via auth.verifyOtp({ token_hash, type: 'magiclink' }), which returns
    // a normal, refreshable session, exactly like a real login.
    const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: "magiclink", email: profile.email });
    if (linkError || !link?.properties?.hashed_token) {
      console.error("vihem-screen-session generateLink", linkError);
      return json({ error: "Kunde inte skapa en inloggning för skärmen." }, 500);
    }

    await db.from("vihem_screen_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tokenRow.id);

    return json({ token_hash: link.properties.hashed_token });
  } catch (error) {
    console.error("vihem-screen-session", error);
    return json({ error: error instanceof Error ? error.message : "Inloggningen misslyckades." }, 500);
  }
});
