import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BEDS24_BASE_URL = "https://api.beds24.com/v2";

type Action = "get" | "save" | "disconnect" | "test";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile, error: profileError } = await serviceClient
      .from("vihem_profiles")
      .select("id, role, organisation_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) return json({ error: "Kunde inte verifiera användaren." }, 403);
    if (!["admin", "superadmin"].includes(profile.role)) return json({ error: "Saknar behörighet." }, 403);
    if (!profile.organisation_id) return json({ error: "Användaren saknar organisation." }, 400);

    const body = await req.json().catch(() => ({}));
    const action = (body.action || "get") as Action;

    const { data: existing } = await serviceClient
      .from("vihem_beds24_connections")
      .select("*")
      .eq("organisation_id", profile.organisation_id)
      .maybeSingle();

    if (action === "get") {
      const logs = await getRecentLogs(serviceClient, profile.organisation_id);
      return json({ connection: safeConnection(existing), logs });
    }

    if (action === "disconnect") {
      if (existing?.id) {
        const { error } = await serviceClient
          .from("vihem_beds24_connections")
          .update({
            enabled: false,
            refresh_token: "",
            access_token: "",
            access_token_expires_at: null,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        if (error) throw error;
      }
      return json({ connection: safeConnection({ ...existing, enabled: false, refresh_token: "", access_token: "" }) });
    }

    if (action === "save") {
      const enabled = Boolean(body.enabled);
      const inviteCode = String(body.invite_code || "").trim();
      const refreshTokenInput = String(body.refresh_token || "").trim();
      let refreshToken = refreshTokenInput || existing?.refresh_token || "";
      let accessToken = existing?.access_token || "";
      let expiresAt = existing?.access_token_expires_at || null;

      if (inviteCode) {
        const setup = await beds24Setup(inviteCode);
        refreshToken = setup.refreshToken;
        accessToken = setup.token;
        expiresAt = new Date(Date.now() + Math.max(setup.expiresIn - 300, 60) * 1000).toISOString();
      } else if (refreshTokenInput) {
        const refreshed = await refreshBeds24Token(refreshTokenInput);
        accessToken = refreshed.token;
        expiresAt = new Date(Date.now() + Math.max(refreshed.expiresIn - 300, 60) * 1000).toISOString();
      }

      if (enabled && !refreshToken) {
        return json({ error: "Ange invite code eller refresh token för att aktivera Beds24." }, 400);
      }

      const payload = {
        organisation_id: profile.organisation_id,
        enabled,
        refresh_token: refreshToken,
        access_token: accessToken,
        access_token_expires_at: expiresAt,
        last_error: null,
        settings: body.settings || existing?.settings || {},
        created_by: user.id,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await serviceClient
        .from("vihem_beds24_connections")
        .upsert(payload, { onConflict: "organisation_id" })
        .select("*")
        .single();
      if (error) throw error;

      return json({ connection: safeConnection(data) });
    }

    if (action === "test") {
      if (!existing?.refresh_token) return json({ error: "Beds24 är inte anslutet ännu." }, 400);
      const token = await ensureAccessToken(serviceClient, existing);
      const response = await fetch(`${BEDS24_BASE_URL}/properties?includeAllRooms=true`, {
        headers: { accept: "application/json", token },
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Beds24 svarade ${response.status}: ${text.slice(0, 300)}`);
      const parsed = safeJson(text);
      return json({
        ok: true,
        connection: safeConnection({ ...existing, last_error: null }),
        properties_count: Array.isArray(parsed) ? parsed.length : Array.isArray(parsed?.data) ? parsed.data.length : 0,
      });
    }

    return json({ error: "Okänd åtgärd." }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Internt serverfel" }, 400);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeConnection(connection: any) {
  if (!connection) {
    return {
      enabled: false,
      connected: false,
      webhook_url_hint: "/functions/v1/vihem-beds24-webhook",
    };
  }
  return {
    id: connection.id,
    organisation_id: connection.organisation_id,
    enabled: Boolean(connection.enabled),
    connected: Boolean(connection.refresh_token),
    webhook_secret: connection.webhook_secret,
    last_sync_at: connection.last_sync_at,
    last_error: connection.last_error,
    settings: connection.settings || {},
    updated_at: connection.updated_at,
    webhook_url_hint: "/functions/v1/vihem-beds24-webhook",
  };
}

async function getRecentLogs(serviceClient: any, organisationId: string) {
  const { data } = await serviceClient
    .from("vihem_beds24_sync_logs")
    .select("id, status, event_type, message, imported_count, external_id, created_at, metadata")
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false })
    .limit(12);
  return data || [];
}

async function beds24Setup(inviteCode: string) {
  const response = await fetch(`${BEDS24_BASE_URL}/authentication/setup`, {
    headers: { accept: "application/json", code: inviteCode },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.refreshToken || !data?.token) {
    throw new Error(data?.error || data?.message || "Kunde inte växla Beds24 invite code.");
  }
  return data as { token: string; expiresIn: number; refreshToken: string };
}

async function refreshBeds24Token(refreshToken: string) {
  const response = await fetch(`${BEDS24_BASE_URL}/authentication/token`, {
    headers: { accept: "application/json", refreshToken },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.token) {
    throw new Error(data?.error || data?.message || "Kunde inte hämta Beds24 access token.");
  }
  return data as { token: string; expiresIn: number };
}

async function ensureAccessToken(serviceClient: any, connection: any) {
  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
  if (connection.access_token && expiresAt > Date.now() + 5 * 60 * 1000) return connection.access_token;

  const refreshed = await refreshBeds24Token(connection.refresh_token);
  const accessTokenExpiresAt = new Date(Date.now() + Math.max(refreshed.expiresIn - 300, 60) * 1000).toISOString();
  await serviceClient
    .from("vihem_beds24_connections")
    .update({
      access_token: refreshed.token,
      access_token_expires_at: accessTokenExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);
  return refreshed.token;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
