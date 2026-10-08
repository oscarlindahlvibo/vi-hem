import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BEDS24_BASE_URL = "https://api.beds24.com/v2";
// How many days ahead to push. A full year: Booking.com/Expedia want prices
// up to 12 months out (Beds24 warns "less than 12 months available"
// otherwise). Prices are sent as merged date ranges, so this is still only a
// handful of calendar entries per room.
const SYNC_DAYS = 365;

// Beds24 "Daily Price" levels. Level 1 is the normal nightly price. Levels 2-4
// are the length-of-stay prices: a Beds24 price rule per level carries the
// minimum stay, and (once a channel rate plan is mapped to it, see
// vihem_short_stay_channel_rate_codes) Beds24 offers that price to the channel
// as its own rate plan. VI-HEM owns the PRICE of every level per date (season
// discount); a level with no discount on a date gets no price, which closes
// that rate plan for the date on the channels.
const LEVELS = [
  { level: 2, minNights: 2, name: "Kort 2+ natter" },
  { level: 3, minNights: 7, name: "Vecka 7+ natter" },
  { level: 4, minNights: 28, name: "Manad 28+ natter" },
] as const;
const LEVEL_CHANNELS = ["booking", "expedia"] as const;

type Season = { id: string; name: string; start_date: string; end_date: string; priority: number };
type Rate = { unit_id: string; season_id: string | null; price_per_night: number };
type LosDiscount = { unit_id: string; season_id: string | null; min_nights: number; discount_percent: number };
type RateCode = { unit_id: string; level: number; channel: string; rate_code: string };
type PriceVector = { price1: number; price2: number | null; price3: number | null; price4: number | null };

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

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;

    // Server-to-server calls (maintenance from the host) authenticate with the
    // service-role key and name the organisation explicitly; everyone else must
    // be an admin of their own organisation.
    let organisationId: string | null = null;
    if (authHeader === `Bearer ${serviceKey}` && typeof body?.organisation_id === "string") {
      organisationId = body.organisation_id;
    } else {
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) return json({ error: "Unauthorized" }, 401);
      const { data: profile } = await serviceClient.from("vihem_profiles").select("id, role, organisation_id").eq("id", user.id).maybeSingle();
      if (!profile || !["admin", "superadmin"].includes(profile.role)) return json({ error: "Saknar behörighet." }, 403);
      organisationId = profile.organisation_id;
    }
    if (!organisationId) return json({ error: "Användaren saknar organisation." }, 400);

    const { data: connection } = await serviceClient.from("vihem_beds24_connections").select("*").eq("organisation_id", organisationId).maybeSingle();
    if (!connection?.enabled || !connection?.refresh_token) return json({ error: "Beds24 är inte anslutet eller aktiverat." }, 400);

    const { data: units } = await serviceClient
      .from("vihem_short_stay_units")
      .select("id, name, beds24_enabled, beds24_room_id, beds24_property_id")
      .eq("organisation_id", organisationId)
      .eq("beds24_enabled", true)
      .neq("beds24_room_id", "");
    if (!units || units.length === 0) return json({ error: "Ingen enhet är kopplad mot Beds24 än." }, 400);

    const [{ data: seasons }, { data: rates }, { data: discounts }, { data: rateCodes }] = await Promise.all([
      serviceClient.from("vihem_short_stay_seasons").select("id, name, start_date, end_date, priority").eq("organisation_id", organisationId),
      serviceClient.from("vihem_short_stay_rates").select("unit_id, season_id, price_per_night").eq("organisation_id", organisationId),
      serviceClient.from("vihem_short_stay_los_discounts").select("unit_id, season_id, min_nights, discount_percent").eq("organisation_id", organisationId),
      serviceClient.from("vihem_short_stay_channel_rate_codes").select("unit_id, level, channel, rate_code").eq("organisation_id", organisationId),
    ]);

    const token = await ensureAccessToken(serviceClient, connection);
    const today = new Date().toISOString().slice(0, 10);
    const propertyRules = new Map<number, any[]>();

    const results: { unit_id: string; unit_name: string; days_synced: number; rules_synced?: number; error?: string }[] = [];
    for (const unit of units) {
      const roomId = Number(unit.beds24_room_id);
      const propertyId = Number(unit.beds24_property_id);
      if (!Number.isFinite(roomId)) {
        results.push({ unit_id: unit.id, unit_name: unit.name, days_synced: 0, error: "Ogiltigt Beds24 room id." });
        continue;
      }
      const ranges = buildPriceRanges(unit.id, today, SYNC_DAYS, (seasons || []) as Season[], (rates || []) as Rate[], (discounts || []) as LosDiscount[]);
      if (ranges.length === 0) {
        results.push({ unit_id: unit.id, unit_name: unit.name, days_synced: 0, error: "Inget pris konfigurerat för perioden." });
        await serviceClient.from("vihem_short_stay_price_sync_log").insert({ organisation_id: organisationId, unit_id: unit.id, status: "failed", message: "Inget pris konfigurerat för perioden.", days_synced: 0 });
        continue;
      }
      if (dryRun) {
        results.push({ unit_id: unit.id, unit_name: unit.name, days_synced: ranges.reduce((sum, r) => sum + (dayDiff(r.from, r.to) + 1), 0), preview: ranges } as any);
        continue;
      }
      try {
        // 1. Make sure the length-of-stay price rules (levels 2-4) exist and
        //    point at this unit's channel rate plans.
        let rulesSynced = 0;
        if (Number.isFinite(propertyId)) {
          rulesSynced = await ensureLevelRules(token, propertyId, roomId, propertyRules, ((rateCodes || []) as RateCode[]).filter((c) => c.unit_id === unit.id));
        }

        // 2. Push the nightly price (level 1) and every level's price per date.
        const response = await fetch(`${BEDS24_BASE_URL}/inventory/rooms/calendar`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json", token },
          body: JSON.stringify([{ roomId, calendar: ranges }]),
        });
        const text = await response.text();
        if (!response.ok) throw new Error(readBeds24Error(safeJson(text), response.status, "Beds24 avvisade prisuppdateringen."));
        const parsed = safeJson(text);
        const first = Array.isArray(parsed) ? parsed[0] : parsed;
        if (first && first.success === false) throw new Error(readBeds24Error(first, 400, "Beds24 avvisade prisuppdateringen."));
        const daysSynced = ranges.reduce((sum, r) => sum + (dayDiff(r.from, r.to) + 1), 0);

        results.push({ unit_id: unit.id, unit_name: unit.name, days_synced: daysSynced, rules_synced: rulesSynced });
        await serviceClient.from("vihem_short_stay_price_sync_log").insert({
          organisation_id: organisationId,
          unit_id: unit.id,
          status: "ok",
          message: `${ranges.length} prisintervall, ${daysSynced} dagar. ${rulesSynced} prisregler uppdaterade.`,
          days_synced: daysSynced,
        });
      } catch (unitError) {
        const message = unitError instanceof Error ? unitError.message : "Okänt fel mot Beds24.";
        results.push({ unit_id: unit.id, unit_name: unit.name, days_synced: 0, error: message });
        await serviceClient.from("vihem_short_stay_price_sync_log").insert({ organisation_id: organisationId, unit_id: unit.id, status: "failed", message, days_synced: 0 });
      }
    }

    const failed = results.filter((r) => r.error);
    return json({ ok: failed.length === 0, results, synced_units: results.length - failed.length, failed_units: failed.length });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Internt serverfel" }, 400);
  }
});

// --- Price calculation: a duplicate of src/lib/shortStayPricing.ts's
// findSeasonForDate/getBaseNightlyPrice, kept in sync manually rather than
// shared -- edge functions can't import from src/.

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayDiff(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);
}

function findSeasonForDate(seasons: Season[], date: string): Season | null {
  const matches = seasons.filter((s) => date >= s.start_date && date <= s.end_date);
  if (matches.length === 0) return null;
  return matches.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return dayDiff(a.start_date, a.end_date) - dayDiff(b.start_date, b.end_date);
  })[0];
}

function getBaseNightlyPrice(rates: Rate[], unitId: string, seasonId: string | null): number | null {
  if (seasonId) {
    const seasonRate = rates.find((r) => r.unit_id === unitId && r.season_id === seasonId);
    if (seasonRate) return Number(seasonRate.price_per_night);
  }
  const defaultRate = rates.find((r) => r.unit_id === unitId && r.season_id === null);
  return defaultRate ? Number(defaultRate.price_per_night) : null;
}

// A tier scoped to the date's season wins over a unit-wide (season null) one.
function discountFor(discounts: LosDiscount[], unitId: string, seasonId: string | null, minNights: number): number | null {
  const scoped = discounts.find((d) => d.unit_id === unitId && d.min_nights === minNights && seasonId !== null && d.season_id === seasonId);
  if (scoped) return Number(scoped.discount_percent);
  const wide = discounts.find((d) => d.unit_id === unitId && d.min_nights === minNights && d.season_id === null);
  return wide ? Number(wide.discount_percent) : null;
}

function priceVectorForDate(unitId: string, date: string, seasons: Season[], rates: Rate[], discounts: LosDiscount[]): PriceVector | null {
  const season = findSeasonForDate(seasons, date);
  const base = getBaseNightlyPrice(rates, unitId, season?.id ?? null);
  if (base === null) return null;
  const levelPrice = (minNights: number) => {
    const pct = discountFor(discounts, unitId, season?.id ?? null, minNights);
    return pct === null ? null : Math.round(base * (1 - pct / 100));
  };
  return { price1: base, price2: levelPrice(2), price3: levelPrice(7), price4: levelPrice(28) };
}

function buildPriceRanges(unitId: string, startDate: string, days: number, seasons: Season[], rates: Rate[], discounts: LosDiscount[]) {
  type Range = { from: string; to: string } & PriceVector;
  const ranges: Range[] = [];
  let current: Range | null = null;
  const same = (a: PriceVector, b: PriceVector) => a.price1 === b.price1 && a.price2 === b.price2 && a.price3 === b.price3 && a.price4 === b.price4;
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const vector = priceVectorForDate(unitId, date, seasons, rates, discounts);
    if (vector === null) { current = null; continue; }
    if (current && same(current, vector) && addDays(current.to, 1) === date) {
      current.to = date;
    } else {
      current = { from: date, to: date, ...vector };
      ranges.push(current);
    }
  }
  return ranges;
}

// --- Beds24 price rules (levels 2-4) -----------------------------------------

async function loadPropertyRules(token: string, propertyId: number, cache: Map<number, any[]>) {
  if (cache.has(propertyId)) return cache.get(propertyId)!;
  const response = await fetch(`${BEDS24_BASE_URL}/properties?id=${propertyId}&includeAllRooms=true&includePriceRules=true`, {
    headers: { accept: "application/json", token },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(readBeds24Error(safeJson(text), response.status, "Kunde inte läsa prisreglerna i Beds24."));
  const data = safeJson(text);
  const rooms = (data?.data ?? []).flatMap((p: any) => p.roomTypes ?? []);
  cache.set(propertyId, rooms);
  return rooms;
}

// Creates/updates the three length-of-stay rules for one room. A level's channel
// is only switched on when a channel rate plan code exists for it, so nothing is
// offered to a channel that has no matching rate plan there.
async function ensureLevelRules(token: string, propertyId: number, roomId: number, cache: Map<number, any[]>, codes: RateCode[]) {
  const rooms = await loadPropertyRules(token, propertyId, cache);
  const room = rooms.find((r: any) => r.id === roomId);
  if (!room) throw new Error(`Rum ${roomId} hittades inte i Beds24-fastighet ${propertyId}.`);
  const base = (room.priceRules ?? []).find((r: any) => r.id === 1);
  const channelKeys = Object.keys(base?.channels ?? {});
  const priceFor = base?.priceFor?.type ? base.priceFor : { type: "maxCapacity" };
  // A positive extra-person price makes the rule bookable above Price For.
  // Preserve occupancy supplements from the standard rule, otherwise rooms
  // priced for three people lose their four-person channel prices.
  const extraPerson = Number(base?.extraPerson ?? 0);
  const extraChild = Number(base?.extraChild ?? 0);

  const rules = LEVELS.map((lv) => {
    const channels: Record<string, { enable: boolean; rateCode?: string }> = {};
    for (const key of channelKeys) channels[key] = { enable: false };
    // Airbnb LOS pricing uses the daily rules directly, without rate codes.
    // Preserve an explicit Beds24 opt-in (the listing must use Per Occupancy
    // Pricing) instead of disabling its seasonal discounts on every sync.
    const existingRule = (room.priceRules ?? []).find((r: any) => r.id === lv.level);
    if (base?.channels?.airbnb?.enable && existingRule?.channels?.airbnb?.enable) {
      channels.airbnb = { enable: true };
    }
    for (const channel of LEVEL_CHANNELS) {
      const code = codes.find((c) => c.level === lv.level && c.channel === channel);
      if (code) channels[channel] = { enable: true, rateCode: code.rate_code };
    }
    // Daily Price IDs and Offers are separate in Beds24. Offers 2-4 may be
    // disabled, which excludes these rules from channel exports even with a
    // mapped rate code. Use the active standard offer; the explicit rate code
    // and minimum stay distinguish each channel's length-of-stay plan.
    return { id: lv.level, name: lv.name, offer: 1, minimumStay: lv.minNights, maximumStay: 365, priceFor, extraPerson, extraChild, channels };
  });

  const response = await fetch(`${BEDS24_BASE_URL}/properties`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", token },
    body: JSON.stringify([{ id: propertyId, roomTypes: [{ id: roomId, priceRules: rules }] }]),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(readBeds24Error(safeJson(text), response.status, "Beds24 avvisade prisreglerna."));
  const parsed = safeJson(text);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  // "internal error" on bookingPage is a known Beds24 quirk for these fields (we never send them); only real failures count.
  if (first && first.success === false && !first.modified) throw new Error(readBeds24Error(first, 400, "Beds24 avvisade prisreglerna."));
  return rules.length;
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
