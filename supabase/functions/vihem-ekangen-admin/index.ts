// Adminhjälp för Ekängens hemsida (inloggad admin i den bundna organisationen).
// Actions:
//   status      -> Stripe-/mejlstatus (nycklar finns? giltiga?) + webhook-adress att klistra in i Stripe
//   beds24_room -> förslag på rubrik, sängar, bekvämligheter och beskrivning för en enhet, hämtade från dess Beds24-rum
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, corsHeaders, errorJson, isAuthContext, json } from "../_shared/vihem-auth.ts";
import { stripeKey, webhookSecret } from "../_shared/ekangen-stripe.ts";

const BEDS24 = "https://api.beds24.com/v2";

const FEATURES: Record<string, string> = {
  WIFI: "Wi-Fi", ETHERNET: "Nätverksuttag", INTERNET: "Internet", TV: "TV", TV_ROOM: "TV-rum", KITCHEN: "Fullt utrustat kök", SHARED_KITCHEN: "Delat kök",
  OVEN: "Ugn", STOVE: "Spis", MICROWAVE: "Mikrovågsugn", REFRIGERATOR: "Kylskåp", FREEZER: "Frys", COFFEE_MAKER: "Kaffebryggare", KETTLE: "Vattenkokare",
  DISHES_UTENSILS: "Porslin och bestick", GLASSES_WINE: "Vinglas", DINING_TABLE: "Matbord", WASHER: "Tvättmaskin", PARKING: "Parkering", HEATING: "Värme",
  LINENS: "Sänglinne ingår", HANGERS: "Galgar", CLOSET: "Garderob", HAIR_DRYER: "Hårtork", HIGHCHAIR: "Barnstol", PACK_N_PLAY_TRAVEL_CRIB: "Resesäng finns",
  BED_CRIB: "Spjälsäng finns", GARDEN: "Trädgård", GRILL: "Grill", FIRE_PIT: "Eldstad", OUTDOOR_FURNITURE: "Utemöbler", OUTDOOR_DINING_AREA: "Uteplats med matplats",
  LAKE: "Nära sjö", EV_CHARGER: "Laddplats för elbil", ROOM_DARKENING_SHADES: "Mörkläggningsgardiner", LIVING_ROOM: "Vardagsrum", WATER_HOT: "Varmvatten",
  PETS_ALLOWED: "Husdjur tillåtna", PETS_CONSIDERED: "Husdjur kan godkännas", BATH_SHOWER: "Dusch", BATH_TOILET: "Toalett", BATHROOM: "Eget badrum",
  BATHROOM_FULL: "Badrum", LOCK_BEDROOM: "Låsbart sovrum", SMOKE_DETECTOR: "Brandvarnare", FIRE_EXTINGUISHER: "Brandsläckare", FIRST_AID_KIT: "Första hjälpen-låda",
  LONG_TERM_RENTERS: "Längre vistelser är välkomna", AIR_CONDITIONING: "Luftkonditionering", BALCONY: "Balkong", FIREPLACE: "Öppen spis", SAUNA: "Bastu",
};
const BEDS: Record<string, [string, string]> = {
  BED_SINGLE: ["enkelsäng", "enkelsängar"], BED_DOUBLE: ["dubbelsäng", "dubbelsängar"], BED_BUNK: ["våningssäng", "våningssängar"],
  BED_COUCH: ["bäddsoffa", "bäddsoffor"], BED_QUEEN: ["queensize-säng", "queensize-sängar"], BED_KING: ["kingsize-säng", "kingsize-sängar"],
};

async function beds24Token(admin: any, organisationId: string): Promise<string> {
  const { data: connection } = await admin.from("vihem_beds24_connections").select("*").eq("organisation_id", organisationId).maybeSingle();
  if (!connection?.enabled || !connection.refresh_token) throw new Error("Beds24 är inte aktiverat.");
  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
  if (connection.access_token && expiresAt > Date.now() + 300_000) return connection.access_token;
  const response = await fetch(`${BEDS24}/authentication/token`, { headers: { accept: "application/json", refreshToken: connection.refresh_token } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.token) throw new Error("Kunde inte hämta Beds24-token.");
  await admin.from("vihem_beds24_connections").update({
    access_token: data.token, access_token_expires_at: new Date(Date.now() + Math.max(Number(data.expiresIn || 86400) - 300, 60) * 1000).toISOString(),
  }).eq("id", connection.id);
  return data.token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return errorJson("METHOD_NOT_ALLOWED", "Endast POST stöds.", 405);
  const auth = await authenticate(req);
  if (!isAuthContext(auth)) return auth;
  const { data: isEditor } = await auth.userClient.rpc("vihem_ekangen_is_editor");
  if (!isEditor) return errorJson("FORBIDDEN", "Du behöver vara administratör i Vibogruppen AB.", 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* tom body */ }
  const action = String(body?.action || "");

  try {
    if (action === "status") {
      const key = stripeKey();
      const stripe: Record<string, unknown> = {
        secretKeySet: Boolean(key), webhookSecretSet: Boolean(webhookSecret()),
        mode: key.startsWith("sk_live") || key.startsWith("rk_live") ? "live" : key.startsWith("sk_test") || key.startsWith("rk_test") ? "test" : null,
        verified: null as boolean | null, error: "",
      };
      if (key) {
        const response = await fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${key}` } });
        stripe.verified = response.ok;
        if (!response.ok) stripe.error = ((await response.json().catch(() => ({})))?.error?.message as string) || `Stripe svarade ${response.status}`;
      }
      const publicUrl = (Deno.env.get("SUPABASE_PUBLIC_URL") || "https://supabase.asedatruckmeet.se").replace(/\/$/, "");
      return json({ data: { stripe, webhookUrl: `${publicUrl}/functions/v1/vihem-ekangen-stripe-webhook`, siteUrl: Deno.env.get("EKANGEN_SITE_URL") || "https://ekangensvandrarhem.se" } });
    }

    if (action === "beds24_room") {
      const unitId = String(body?.unit_id || "");
      const { data: unit } = await auth.adminClient.from("vihem_short_stay_units").select("id, organisation_id, name, beds24_property_id, beds24_room_id, beds24_enabled").eq("id", unitId).maybeSingle();
      if (!unit || unit.organisation_id !== auth.callerProfile.organisation_id) return errorJson("NOT_FOUND", "Enheten hittades inte.", 404);
      if (!unit.beds24_enabled || !unit.beds24_property_id || !unit.beds24_room_id) return errorJson("NOT_LINKED", "Enheten är inte kopplad till Beds24.", 409);

      const token = await beds24Token(auth.adminClient, unit.organisation_id);
      const response = await fetch(`${BEDS24}/properties?id=${encodeURIComponent(unit.beds24_property_id)}&includeTexts=all&includeAllRooms=true`, { headers: { accept: "application/json", token } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) return errorJson("BEDS24_FAILED", `Beds24 svarade ${response.status}.`, 502);
      const property = (Array.isArray(payload) ? payload : payload?.data)?.[0];
      const room = (property?.roomTypes || []).find((r: any) => String(r.id) === String(unit.beds24_room_id));
      if (!room) return errorJson("NOT_FOUND", "Rummet hittades inte i Beds24.", 404);

      const codes: string[] = [...(room.featureCodes || [])].flat();
      const propertyCodes: string[] = [...(property.featureCodes || [])].flat();
      const isApartment = codes.includes("KITCHEN") || String(room.name).includes(" · ");
      // Fastighetens gemensamma bekvämligheter (t.ex. delat kök) gäller bara rum, inte lägenheter med eget kök.
      const all = isApartment ? codes : [...codes, ...propertyCodes];
      const features = [...new Set(all.map((c) => FEATURES[c]).filter(Boolean))];
      if (room.roomSize) features.unshift(`Yta ${room.roomSize} m²`);

      const bedCounts = new Map<string, number>();
      for (const c of codes) if (BEDS[c]) bedCounts.set(c, (bedCounts.get(c) || 0) + 1);
      const beds = [...bedCounts].map(([c, n]) => `${n} ${n === 1 ? BEDS[c][0] : BEDS[c][1]}`).join(", ");

      const texts: any[] = room.texts || [];
      const text = texts.find((t) => t.language === "sv") || texts.find((t) => (t.contentDescription || t.roomDescription)) || texts[0] || {};
      const description = String(text.contentDescription || text.roomDescription || "").trim();
      const rawName = String(room.name || "");
      const title = rawName.includes(" · ") ? rawName.split(" · ").slice(1).join(" · ").trim() : String(unit.name).replace(/ - Ekängens vandrarhem$/i, "").trim();

      return json({ data: {
        title, kind: isApartment ? "apartment" : "room", beds, features, description,
        descriptionLanguage: description ? (text.language || "") : "",
        beds24: { name: rawName, maxPeople: room.maxPeople, size: room.roomSize || null, checkInStart: property.checkInStart, checkOutEnd: property.checkOutEnd },
      } });
    }
    return errorJson("VALIDATION_ERROR", "Okänd åtgärd.");
  } catch (error) {
    console.error("vihem-ekangen-admin:", error instanceof Error ? error.message : error);
    return errorJson("INTERNAL_ERROR", error instanceof Error ? error.message : "Något gick fel.", 500);
  }
});
