import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizeTraccar } from "../_shared/fleet-telematics.ts";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD" }, 405);
  const secret = Deno.env.get("FLEET_TRACCAR_SECRET") || "";
  const supplied =
    req.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (secret.length < 32 || supplied.length > 256)
    return json({ error: "UNAUTHORIZED" }, 401);
  const digest = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    );
  const [a, b] = await Promise.all([digest(secret), digest(supplied)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (difference) return json({ error: "UNAUTHORIZED" }, 401);
  try {
    const reader = req.body?.getReader();
    if (!reader) return json({ error: "BODY" }, 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 32768) {
        await reader.cancel();
        return json({ error: "TOO_LARGE" }, 413);
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    if (body.action === "registry") {
      const { data: devices, error } = await db
        .from("vihem_fleet_telematics_devices")
        .select("imei,device_model,organisation_id,expires_at,provisioned_at")
        .eq("active", true)
        .eq("provider", "teltonika")
        .not("provisioned_at", "is", null)
        .not("vehicle_id", "is", null);
      const { data: modules, error: moduleError } = await db
        .from("vihem_organisation_modules")
        .select("organisation_id")
        .eq("module_key", "fleet_management")
        .eq("enabled", true);
      if (error || moduleError) return json({ error: "REGISTRY_FAILED" }, 503);
      const enabled = new Set((modules || []).map((m) => m.organisation_id));
      return json({
        status: "registry",
        devices: (devices || [])
          .filter(
            (d) =>
              enabled.has(d.organisation_id) &&
              (!d.expires_at || Date.parse(d.expires_at) > Date.now()),
          )
          .map((d) => ({ imei: d.imei, model: d.device_model })),
      });
    }
    if (body.action === "maintenance") {
      const { error } = await db.rpc("vihem_fleet_tracking_maintenance");
      return error
        ? json({ error: "MAINTENANCE_FAILED" }, 503)
        : json({ status: "maintained" });
    }
    const position = normalizeTraccar(body);
    const { data, error } = await db.rpc("vihem_fleet_ingest_position", {
      p: position,
    });
    if (error) {
      console.warn("Fleet ingest rejected", error.code);
      return json(
        { error: "INGEST_REJECTED", code: error.code },
        error.code === "22023" ? 422 : 503,
      );
    }
    return json({ status: data });
  } catch {
    return json({ error: "INVALID_PAYLOAD" }, 400);
  }
});
