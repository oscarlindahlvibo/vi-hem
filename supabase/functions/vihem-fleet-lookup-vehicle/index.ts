// Fleet Manager: tolkar fordonsdata med AI från antingen (a) en webbsida
// admin själv länkar till (t.ex. biluppgifter.se) eller (b) text admin
// själv kopierat och klistrat in (för sidor som inte går att länka direkt
// till, t.ex. Transportstyrelsens sökverktyg där resultatet inte hamnar i
// URL:en -- admin gör själv den vanliga, legitima sökningen där och
// klistrar in resultatet). Förifyller "Ny tillgång"-formuläret. Återanvänder
// samma OpenAI-nyckel/inställningar som leverantörsfaktura-OCR:n
// (vihem_ocr_provider_settings), så ingen ny nyckelhantering behövs.
//
// Säkerhet: admin-endast. Länkläget hämtar EN sida admin själv anger (inte
// en crawler/bulk-skrapare, och absolut ingen automatiserad sökning/
// formulärifyllnad mot tredjepartssajter -- bara en enkel GET av en URL
// admin redan valt). Länken valideras mot http/https och privata/interna
// adresser blockeras (SSRF-skydd). Text (hämtad eller inklistrad) skickas
// till AI:n som strikt DATA -- prompten instruerar modellen att aldrig
// följa instruktioner som förekommer i texten, och modellen har inga
// verktyg/åtgärder att utföra, bara ett fast JSON-schema att fylla i.
// Resultatet förifyller bara formuläret; admin granskar och sparar själv.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { MAX_TEXT_CHARS, extractVehicleData, fetchPageText, isBlockedHost, loadAiSettings } from "../_shared/fleet-vehicle-extraction.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};



Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile, error: profileError } = await serviceClient
      .from("vihem_profiles")
      .select("id, role, organisation_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError || !profile) return json({ error: "Kunde inte verifiera användaren." }, 403);
    if (!["admin", "superadmin"].includes(profile.role)) return json({ error: "Kräver adminbehörighet." }, 403);

    const { data: moduleRow } = await serviceClient
      .from("vihem_organisation_modules")
      .select("enabled")
      .eq("organisation_id", profile.organisation_id)
      .eq("module_key", "fleet_management")
      .maybeSingle();
    if (!moduleRow?.enabled) return json({ error: "Fleet Manager-modulen är inte aktiverad." }, 403);

    const body = await req.json().catch(() => ({}));
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    const rawText = typeof body.text === "string" ? body.text.trim() : "";
    if (!rawUrl && !rawText) return json({ error: "Ange antingen en länk eller klistra in text." }, 400);

    let pageText = "";
    let sourceUrl: string | null = null;

    if (rawUrl) {
      let target: URL;
      try {
        target = new URL(rawUrl);
      } catch {
        return json({ error: "Ogiltig länk." }, 400);
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        return json({ error: "Endast http/https-länkar stöds." }, 400);
      }
      if (isBlockedHost(target.hostname)) {
        return json({ error: "Den här adressen kan inte hämtas." }, 400);
      }
      pageText = await fetchPageText(target.toString());
      sourceUrl = target.toString();
      if (!pageText.trim()) return json({ error: "Kunde inte läsa något innehåll från sidan." }, 400);
    } else {
      // Inklistrad text -- ingen hämtning görs, admin har själv kopierat innehållet
      // (t.ex. från en sida som inte kan länkas direkt till, som Transportstyrelsens
      // interaktiva sökverktyg där resultatet inte hamnar i URL:en).
      pageText = rawText.slice(0, MAX_TEXT_CHARS);
    }

    const settings = await loadAiSettings(serviceClient, profile.organisation_id);
    if (!settings.openaiKey) return json({ error: "Ingen AI-nyckel konfigurerad. Kontakta administratören (samma nyckel som används för fakturaskanning)." }, 500);

    const result = await extractVehicleData(settings.openaiKey, settings.aiModel, pageText);
    if (!result.ok) return json({ error: result.error }, 502);

    return json({ ok: true, data: result.data, source_url: sourceUrl });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
