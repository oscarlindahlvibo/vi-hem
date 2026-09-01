// Drift & rutiner -- Åtkomst. Every write to an access entry (including
// the metadata, not just the secret) goes through here rather than
// straight from the client, so the secret is always encrypted server-side
// and every reveal/copy is always audited -- there is no code path that
// can create/update an entry or read its plaintext secret without this
// function seeing it.
//
// Metadata (vihem_access_entries) is written via the CALLER's own client
// (their JWT), so RLS's access.manage check is the real enforcement and
// the AFTER INSERT/UPDATE audit trigger (20260901140000_access_entries.sql)
// fires with the correct actor automatically. The secret
// (vihem_access_entry_secrets) has zero RLS policies for anyone but the
// service role, so it's only ever written/read via this function.
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
    const authHeaders = { Authorization: req.headers.get("Authorization") || "" };
    const authDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: authHeaders } });
    const { data: authData } = await authDb.auth.getUser();
    if (!authData.user) return json({ error: "Du måste vara inloggad." }, 401);

    const { data: profile } = await db.from("vihem_profiles").select("id,role,organisation_id").eq("id", authData.user.id).maybeSingle();
    if (!profile?.organisation_id) return json({ error: "Kontot saknar organisation." }, 400);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "create" || action === "update") {
      const { data: allowed } = await db.rpc("vihem_has_permission", { p_user_id: profile.id, p_permission_key: "access.manage" });
      if (!allowed) return json({ error: "Du saknar behörighet att hantera åtkomstuppgifter." }, 403);

      const secretValue = body.secret !== undefined ? String(body.secret || "").trim() : undefined;
      const entryId = String(body.id || "");

      const metadata: Record<string, unknown> = {
        name: String(body.name || "").trim(),
        entry_type: String(body.entry_type || "ovrigt"),
        property_id: body.property_id || null,
        apartment_id: body.apartment_id || null,
        company_id: body.company_id || null,
        customer_project_id: body.customer_project_id || null,
        location_note: String(body.location_note || ""),
        instructions: String(body.instructions || ""),
        comments: String(body.comments || ""),
        valid_from: body.valid_from || null,
        valid_to: body.valid_to || null,
        active: body.active !== undefined ? Boolean(body.active) : true,
      };
      // secret_hint is not sensitive (e.g. "••32") -- it lives on the
      // metadata table precisely so the list view can show it without
      // ever touching vihem_access_entry_secrets. Only set it when a new
      // secret is actually provided; otherwise leave the existing hint
      // alone on update.
      if (secretValue) {
        metadata.secret_hint = secretValue.length <= 2 ? "••" : `••${secretValue.slice(-2)}`;
      }
      if (!metadata.name) return json({ error: "Namn krävs." }, 400);
      if (!metadata.property_id && !metadata.apartment_id && !metadata.company_id && !metadata.customer_project_id) {
        return json({ error: "Koppla posten till minst en fastighet, lägenhet, företag eller projekt." }, 400);
      }

      // Uses the CALLER's own client so RLS enforces access.manage for
      // real and the audit trigger records the correct actor -- this
      // function's own permission check above is a fast pre-check, not
      // the actual gate.
      const callerDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: authHeaders } });
      let savedId = entryId;
      if (action === "create") {
        const { data: created, error: createError } = await callerDb
          .from("vihem_access_entries")
          .insert({ ...metadata, organisation_id: profile.organisation_id, created_by: profile.id, updated_by: profile.id })
          .select("id")
          .single();
        if (createError) throw createError;
        savedId = created.id;
      } else {
        if (!entryId) return json({ error: "id krävs för uppdatering." }, 400);
        const { error: updateError } = await callerDb
          .from("vihem_access_entries")
          .update({ ...metadata, updated_by: profile.id, updated_at: new Date().toISOString() })
          .eq("id", entryId)
          .eq("organisation_id", profile.organisation_id);
        if (updateError) throw updateError;
      }

      if (secretValue) {
        const encrypted = await encrypt(secretValue, encryptionSecret());
        const { error: secretError } = await db
          .from("vihem_access_entry_secrets")
          .upsert({ entry_id: savedId, encrypted_secret: encrypted, updated_at: new Date().toISOString() }, { onConflict: "entry_id" });
        if (secretError) throw secretError;
      }

      return json({ ok: true, id: savedId });
    }

    if (action === "reveal") {
      const entryId = String(body.id || "");
      if (!entryId) return json({ error: "id krävs." }, 400);

      const { data: allowed } = await db.rpc("vihem_has_permission", { p_user_id: profile.id, p_permission_key: "access.reveal" });
      if (!allowed) return json({ error: "Du saknar behörighet att visa koden." }, 403);

      const { data: entry } = await db.from("vihem_access_entries").select("id,name,organisation_id,requires_step_up").eq("id", entryId).maybeSingle();
      if (!entry || entry.organisation_id !== profile.organisation_id) return json({ error: "Posten hittades inte." }, 404);

      const { data: secretRow } = await db.from("vihem_access_entry_secrets").select("encrypted_secret").eq("entry_id", entryId).maybeSingle();
      if (!secretRow) return json({ error: "Ingen kod är sparad för denna post." }, 404);

      if (entry.requires_step_up) {
        // Structure for a future extra-verification (Face ID) step before
        // reveal -- not activated yet, see plan. No secret is ever
        // returned in this branch.
        return json({ ok: true, step_up_required: true });
      }

      const secret = await decrypt(secretRow.encrypted_secret, encryptionSecret());

      await db.from("vihem_audit_events").insert({
        organisation_id: profile.organisation_id,
        actor_id: profile.id,
        event_type: "access_entry_revealed",
        entity_type: "access_entry",
        entity_id: entryId,
        summary: entry.name,
        metadata: {},
      });

      return json({ ok: true, secret });
    }

    if (action === "log_copy") {
      const entryId = String(body.id || "");
      if (!entryId) return json({ error: "id krävs." }, 400);
      const { data: allowed } = await db.rpc("vihem_has_permission", { p_user_id: profile.id, p_permission_key: "access.reveal" });
      if (!allowed) return json({ error: "Du saknar behörighet." }, 403);

      const { data: entry } = await db.from("vihem_access_entries").select("id,name,organisation_id").eq("id", entryId).maybeSingle();
      if (!entry || entry.organisation_id !== profile.organisation_id) return json({ error: "Posten hittades inte." }, 404);

      await db.from("vihem_audit_events").insert({
        organisation_id: profile.organisation_id,
        actor_id: profile.id,
        event_type: "access_entry_copied",
        entity_type: "access_entry",
        entity_id: entryId,
        summary: entry.name,
        metadata: {},
      });
      return json({ ok: true });
    }

    return json({ error: "Okänd åtgärd." }, 400);
  } catch (error) {
    console.error("vihem-access-entries", error);
    return json({ error: error instanceof Error ? error.message : "Åtgärden misslyckades." }, 500);
  }
});

function encryptionSecret() {
  return Deno.env.get("VIHEM_ACCESS_SECRET_KEY") || Deno.env.get("VIHEM_BANKID_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
async function encrypt(value: string, secret: string) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(value));
  const all = new Uint8Array(iv.length + cipher.byteLength);
  all.set(iv);
  all.set(new Uint8Array(cipher), iv.length);
  return btoa(String.fromCharCode(...all));
}
async function decrypt(value: string, secret: string) {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
}
