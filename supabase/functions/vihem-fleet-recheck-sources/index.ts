// Fleet Manager: hämtar om sparade informationssidor per fordon, tolkar dem med
// AI och uppdaterar besiktningsdatum (se migration 20261008100000). Körs dagligen
// av pg_cron (delad hemlighet i header) eller på begäran av en admin från
// fordonssidan ({ vehicle_id } eller { source_id }). verify_jwt är AV i config.toml.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { extractVehicleData, fetchPageText, isBlockedHost, loadAiSettings } from "../_shared/fleet-vehicle-extraction.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-vihem-fleet-recheck-secret",
};
const SETTINGS_KEY = "fleet_source_recheck";
const SECRET_HEADER = "x-vihem-fleet-recheck-secret";
const MAX_SOURCES_PER_RUN = 100;
const MAX_AI_PER_RUN = 4; // edge-workern avbryts efter ~60 s och AI-tolkning tar 15-40 s; cron kör varje timme
const CONCURRENCY = 2; // håll nere trycket mot källsidorna (de svarar 429 annars)
const INSPECTION_TYPE = "Kontrollbesiktning";
const DAY_MS = 86_400_000;

// Schemalagd körning: hämta bara källor som är "på tur". Besiktning sker en gång
// om året, så långt från förfallodatum räcker en kontroll per månad; nära eller
// efter förfall kontrolleras sidan dagligen så att en utförd besiktning fångas direkt.
function isDue(src: any, now: number): boolean {
  if (!src.last_checked_at) return true;
  const age = now - new Date(src.last_checked_at).getTime();
  if (src.last_status === "error") return age >= 3 * 3_600_000;
  if (!src.next_inspection_date) return age >= 14 * DAY_MS;
  const daysToDue = (new Date(src.next_inspection_date).getTime() - now) / DAY_MS;
  if (daysToDue <= 60) return age >= DAY_MS - 3_600_000;
  return age >= 30 * DAY_MS;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));

  let orgScope: string | null = null; // null = alla organisationer (cron)
  let authorized = false;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader) {
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (user) {
      const { data: profile } = await admin.from("vihem_profiles").select("role, organisation_id").eq("id", user.id).maybeSingle();
      if (profile && ["admin", "superadmin"].includes(profile.role)) {
        authorized = true;
        orgScope = profile.organisation_id;
      }
    }
  }
  if (!authorized) {
    const provided = req.headers.get(SECRET_HEADER) || "";
    const { data: row } = await admin.from("vihem_system_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
    const expected = row?.value && typeof row.value === "object" ? String((row.value as any).secret || "") : "";
    if (provided && expected && provided === expected) authorized = true;
  }
  if (!authorized) return json({ error: "Saknar behörighet." }, 401);

  let query = admin.from("vihem_fleet_vehicle_sources").select("*").order("last_checked_at", { ascending: true, nullsFirst: true }).limit(MAX_SOURCES_PER_RUN);
  if (orgScope) query = query.eq("organisation_id", orgScope);
  if (typeof body.source_id === "string") query = query.eq("id", body.source_id);
  else if (typeof body.vehicle_id === "string") query = query.eq("vehicle_id", body.vehicle_id);
  else query = query.eq("auto_check", true); // schemalagd körning: bara källor med automatisk kontroll
  const { data: allSources, error } = await query;
  if (error) return json({ error: error.message }, 500);
  const manual = typeof body.source_id === "string" || typeof body.vehicle_id === "string";
  const nowMs = Date.now();
  const sources = manual ? allSources : (allSources ?? []).filter((src: any) => isDue(src, nowMs));

  const aiCache = new Map<string, Awaited<ReturnType<typeof loadAiSettings>>>();
  const results: { source_id: string; status: string; summary?: string; error?: string }[] = [];

  const handle = async (src: any) => {
    try {
      const { data: org } = await admin.from("vihem_organisation_modules").select("enabled").eq("organisation_id", src.organisation_id).eq("module_key", "fleet_management").maybeSingle();
      if (!org?.enabled) return;

      let target: URL;
      try { target = new URL(src.url); } catch { throw new Error("Ogiltig länk."); }
      if (!["http:", "https:"].includes(target.protocol) || isBlockedHost(target.hostname)) throw new Error("Den här adressen kan inte hämtas.");

      const pageText = await fetchPageText(target.toString());
      if (!pageText.trim()) throw new Error("Kunde inte läsa något innehåll från sidan.");

      // Oförändrad sida sedan senast = ingen AI-körning (hämtningen är gratis, AI:n kostar).
      const contentHash = await sha256(pageText);
      if (src.content_hash && src.content_hash === contentHash && src.last_status === "ok") {
        await admin.from("vihem_fleet_vehicle_sources").update({ last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", src.id);
        results.push({ source_id: src.id, status: "unchanged" });
        return;
      }

      if (!aiCache.has(src.organisation_id)) aiCache.set(src.organisation_id, await loadAiSettings(admin, src.organisation_id));
      const ai = aiCache.get(src.organisation_id)!;
      if (!ai.openaiKey) throw new Error("Ingen AI-nyckel konfigurerad.");

      const result = await extractVehicleData(ai.openaiKey, ai.aiModel, pageText);
      if (!result.ok) throw new Error(result.error);
      const found = result.data as Record<string, unknown>;
      const newLast = isDate(found.last_inspection_date) ? found.last_inspection_date : null;
      const newNext = isDate(found.next_inspection_date) ? found.next_inspection_date : null;

      const changes: string[] = [];
      if (newLast && newLast !== src.last_inspection_date) changes.push(src.last_inspection_date ? `Ny besiktning registrerad ${newLast} (tidigare ${src.last_inspection_date})` : `Senaste besiktning ${newLast}`);
      if (newNext && newNext !== src.next_inspection_date) changes.push(`Nästa besiktning senast ${newNext}${src.next_inspection_date ? ` (tidigare ${src.next_inspection_date})` : ""}`);

      // Uppdatera fordonets besiktningspost, men låt aldrig en äldre uppgift skriva över en nyare.
      let notifyNewInspection = false;
      if (newLast || newNext) {
        const { data: insp } = await admin.from("vihem_fleet_inspections").select("id, last_inspection_date, next_inspection_date")
          .eq("vehicle_id", src.vehicle_id).eq("inspection_type", INSPECTION_TYPE).eq("active", true).maybeSingle();
        const prevLast: string | null = insp?.last_inspection_date ?? src.last_inspection_date ?? null;
        notifyNewInspection = !!(newLast && prevLast && newLast > prevLast);
        const olderThanExisting = !!(insp?.last_inspection_date && newLast && newLast < insp.last_inspection_date);
        if (!olderThanExisting) {
          const payload: Record<string, unknown> = {};
          if (newLast) payload.last_inspection_date = newLast;
          if (newNext) payload.next_inspection_date = newNext;
          const differs = !insp || (newLast && newLast !== insp.last_inspection_date) || (newNext && newNext !== insp.next_inspection_date);
          if (differs) {
            if (insp) await admin.from("vihem_fleet_inspections").update(payload).eq("id", insp.id);
            else await admin.from("vihem_fleet_inspections").insert({ organisation_id: src.organisation_id, vehicle_id: src.vehicle_id, inspection_type: INSPECTION_TYPE, ...payload });
            await admin.from("vihem_fleet_events").insert({
              organisation_id: src.organisation_id, vehicle_id: src.vehicle_id, event_type: "inspection_recorded",
              summary: `Besiktning uppdaterad från ${target.hostname}: ${[newLast ? `senast ${newLast}` : "", newNext ? `nästa ${newNext}` : ""].filter(Boolean).join(", ")}`,
            });
          }
        }
      }

      if (notifyNewInspection) {
        const { data: veh } = await admin.from("vihem_fleet_vehicles").select("name, registration_number").eq("id", src.vehicle_id).maybeSingle();
        const { data: admins } = await admin.from("vihem_profiles").select("id").eq("organisation_id", src.organisation_id).in("role", ["admin", "superadmin"]).eq("active", true);
        const label = [veh?.name, veh?.registration_number ? `(${veh.registration_number})` : ""].filter(Boolean).join(" ");
        for (const a of admins ?? []) {
          await admin.rpc("create_notification", {
            recipient_id: a.id, org_uuid: src.organisation_id, notification_title: "Besiktning utförd",
            notification_message: `${label}: besiktigad ${newLast}${newNext ? `, nästa senast ${newNext}` : ""}.`,
            notification_type: "fleet", notification_link: `fleet/${src.vehicle_id}`,
          });
        }
      }

      await admin.from("vihem_fleet_vehicle_sources").update({
        content_hash: contentHash, extracted: found, last_inspection_date: newLast, next_inspection_date: newNext,
        last_checked_at: new Date().toISOString(), last_status: "ok", last_error: "",
        last_change_summary: changes.length ? changes.join(" · ") : src.last_change_summary,
        updated_at: new Date().toISOString(),
      }).eq("id", src.id);
      results.push({ source_id: src.id, status: "ok", summary: changes.join(" · ") });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin.from("vihem_fleet_vehicle_sources").update({
        last_checked_at: new Date().toISOString(), last_status: "error", last_error: message.slice(0, 500), updated_at: new Date().toISOString(),
      }).eq("id", src.id);
      results.push({ source_id: src.id, status: "error", error: message });
    }
  };

  // Manuell körning: alla angivna källor. Schemalagd: högst MAX_AI_PER_RUN per anrop, äldst kontrollerade först.
  const queue = manual ? (sources ?? []) : (sources ?? []).slice(0, MAX_AI_PER_RUN);
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    await Promise.all(queue.slice(i, i + CONCURRENCY).map(handle));
  }
  return json({ ok: true, checked: results.length, results });
});
