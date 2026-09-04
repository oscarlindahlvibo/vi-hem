import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BEDS24_BASE_URL = "https://api.beds24.com/v2";
// How many days ahead to push. Kept modest (not a full year) so a single
// sync stays well under Beds24's rolling 5-minute credit limit and any one
// mistake in the price rules only misprices the near future, not months out.
const SYNC_DAYS = 120;

type Season = { id: string; start_date: string; end_date: string; priority: number };
type Rate = { unit_id: string; season_id: string | null; price_per_night: number };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await serviceClient.from("vihem_profiles").select("id, role, organisation_id").eq("id", user.id).maybeSingle();
    if (!profile || !["admin", "superadmin"].includes(profile.role)) return json({ error: "Saknar behörighet." }, 403);
    const organisationId = profile.organisation_id;
    if (!organisationId) return json({ error: "Användaren saknar organisation." }, 400);

    const { data: connection } = await serviceClient.from("vihem_beds24_connections").select("*").eq("organisation_id", organisationId).maybeSingle();
    if (!connection?.enabled || !connection?.refresh_token) return json({ error: "Beds24 är inte anslutet eller aktiverat." }, 400);

    const { data: units } = await serviceClient
      .from("vihem_short_stay_units")
      .select("id, name, beds24_enabled, beds24_room_id")
      .eq("organisation_id", organisationId)
      .eq("beds24_enabled", true)
      .neq("beds24_room_id", "");
    if (!units || units.length === 0) return json({ error: "Ingen enhet är kopplad mot Beds24 än." }, 400);

    const [{ data: seasons }, { data: rates }] = await Promise.all([
      serviceClient.from("vihem_short_stay_seasons").select("id, start_date, end_date, priority").eq("organisation_id", organisationId),
      serviceClient.from("vihem_short_stay_rates").select("unit_id, season_id, price_per_night").eq("organisation_id", organisationId),
    ]);

    const token = await ensureAccessToken(serviceClient, connection);
    const today = new Date().toISOString().slice(0, 10);

    const results: { unit_id: string; unit_name: string; days_synced: number; error?: string }[] = [];
    for (const unit of units) {
      const roomId = Number(unit.beds24_room_id);
      if (!Number.isFinite(roomId)) {
        results.push({ unit_id: unit.id, unit_name: unit.name, days_synced: 0, error: "Ogiltigt Beds24 room id." });
        continue;
      }
      const ranges = buildPriceRanges(unit.id, today, SYNC_DAYS, (seasons || []) as Season[], (rates || []) as Rate[]);
      if (ranges.length === 0) {
        results.push({ unit_id: unit.id, unit_name: unit.name, days_synced: 0, error: "Inget pris konfigurerat för perioden." });
        await serviceClient.from("vihem_short_stay_price_sync_log").insert({ organisation_id: organisationId, unit_id: unit.id, status: "failed", message: "Inget pris konfigurerat för perioden.", days_synced: 0 });
        continue;
      }
      try {
        const response = await fetch(`${BEDS24_BASE_URL}/inventory/rooms/calendar`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json", token },
          body: JSON.stringify([{ roomId, calendar: ranges.map(r => ({ from: r.from, to: r.to, price1: r.price1 })) }]),
        });
        const text = await response.text();
        if (!response.ok) throw new Error(readBeds24Error(safeJson(text), response.status, "Beds24 avvisade prisuppdateringen."));
        const daysSynced = ranges.reduce((sum, r) => sum + (dayDiff(r.from, r.to) + 1), 0);
        results.push({ unit_id: unit.id, unit_name: unit.name, days_synced: daysSynced });
        await serviceClient.from("vihem_short_stay_price_sync_log").insert({ organisation_id: organisationId, unit_id: unit.id, status: "ok", message: `${ranges.length} intervall, ${daysSynced} dagar.`, days_synced: daysSynced });
      } catch (unitError) {
        const message = unitError instanceof Error ? unitError.message : "Okänt fel mot Beds24.";
        results.push({ unit_id: unit.id, unit_name: unit.name, days_synced: 0, error: message });
        await serviceClient.from("vihem_short_stay_price_sync_log").insert({ organisation_id: organisationId, unit_id: unit.id, status: "failed", message, days_synced: 0 });
      }
    }

    const failed = results.filter(r => r.error);
    return json({ ok: failed.length === 0, results, synced_units: results.length - failed.length, failed_units: failed.length });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Internt serverfel" }, 400);
  }
});

// --- Price calculation: a duplicate of src/lib/shortStayPricing.ts's
// findSeasonForDate/getBaseNightlyPrice/buildBeds24PriceRanges, kept in
// sync manually rather than shared -- edge functions can't import from
// src/, and this logic is small and stable enough that duplication is
// less risk than a cross-boundary build dependency.

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayDiff(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);
}

function findSeasonForDate(seasons: Season[], date: string): Season | null {
  const matches = seasons.filter(s => date >= s.start_date && date <= s.end_date);
  if (matches.length === 0) return null;
  return matches.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return dayDiff(a.start_date, a.end_date) - dayDiff(b.start_date, b.end_date);
  })[0];
}

function getBaseNightlyPrice(rates: Rate[], unitId: string, seasonId: string | null): number | null {
  if (seasonId) {
    const seasonRate = rates.find(r => r.unit_id === unitId && r.season_id === seasonId);
    if (seasonRate) return Number(seasonRate.price_per_night);
  }
  const defaultRate = rates.find(r => r.unit_id === unitId && r.season_id === null);
  return defaultRate ? Number(defaultRate.price_per_night) : null;
}

function buildPriceRanges(unitId: string, startDate: string, days: number, seasons: Season[], rates: Rate[]) {
  const ranges: { from: string; to: string; price1: number }[] = [];
  let current: { from: string; to: string; price1: number } | null = null;
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const season = findSeasonForDate(seasons, date);
    const price = getBaseNightlyPrice(rates, unitId, season?.id ?? null);
    if (price === null) { current = null; continue; }
    if (current && current.price1 === price && addDays(current.to, 1) === date) {
      current.to = date;
    } else {
      current = { from: date, to: date, price1: price };
      ranges.push(current);
    }
  }
  return ranges;
}

// --- Beds24 auth (duplicate of vihem-beds24-connection/index.ts's token
// refresh -- that function serves the live connection UI today, so it
// isn't touched to add this).

async function refreshBeds24Token(refreshToken: string) {
  const response = await fetch(`${BEDS24_BASE_URL}/authentication/token`, {
    headers: { accept: "application/json", refreshToken },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.token) throw new Error(readBeds24Error(data, response.status, "Kunde inte hämta Beds24 access token."));
  return data as { token: string; expiresIn: number };
}

async function ensureAccessToken(serviceClient: any, connection: any) {
  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
  if (connection.access_token && expiresAt > Date.now() + 5 * 60 * 1000) return connection.access_token;
  const refreshed = await refreshBeds24Token(connection.refresh_token);
  const accessTokenExpiresAt = new Date(Date.now() + Math.max(refreshed.expiresIn - 300, 60) * 1000).toISOString();
  await serviceClient.from("vihem_beds24_connections").update({ access_token: refreshed.token, access_token_expires_at: accessTokenExpiresAt, updated_at: new Date().toISOString() }).eq("id", connection.id);
  return refreshed.token;
}

function safeJson(text: string) {
  try { return JSON.parse(text); } catch { return null; }
}

function readBeds24Error(data: any, status: number, fallback: string) {
  const message = data?.error || data?.message || data?.detail || (Array.isArray(data?.errors) ? data.errors.map((item: any) => item?.message || item).join(", ") : "");
  return message ? `Beds24 ${status}: ${message}` : `${fallback} (Beds24 ${status})`;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
