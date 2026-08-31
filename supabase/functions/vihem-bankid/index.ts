import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { hashSigningToken } from "../_shared/agreement-tokens.ts";
import { maybeCompleteAgreement, writeAgreementAudit } from "../_shared/agreement-signing.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey" };
const TEST_SIGN_URL = "https://banksign-test.azurewebsites.net/api/sign";
const TEST_COLLECT_URL = "https://banksign-test.azurewebsites.net/api/collectstatus";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = getAuthClient(req);
    const { data: authData } = await auth.client.auth.getUser();
    const profile = authData.user ? await getProfile(db, authData.user.id) : null;

    if (["get_settings", "save_settings", "delete_settings"].includes(action)) {
      if (!profile || !(profile.role === "superadmin" || (profile.role === "admin" && profile.is_system_admin))) return json({ error: "Endast systemadmin kan hantera BankID." }, 403);
      if (action === "get_settings") return json({ ok: true, settings: publicSettings(await getSettings(db, profile.organisation_id)) });
      if (action === "delete_settings") {
        await db.from("vihem_bankid_settings").upsert({ organisation_id: profile.organisation_id, encrypted_api_user: "", encrypted_password: "", encrypted_company_api_guid: "", api_user_hint: "", company_api_guid_hint: "", enabled: false, login_enabled: false, signing_enabled: false, updated_by: profile.id, updated_at: new Date().toISOString() }, { onConflict: "organisation_id" });
        return json({ ok: true, settings: publicSettings(null) });
      }
      const apiUser = String(body.api_user || "").trim();
      const password = String(body.password || "").trim();
      const companyApiGuid = String(body.company_api_guid || "").trim();
      const existing = await getSettings(db, profile.organisation_id);
      if (!apiUser && !existing?.encrypted_api_user) return json({ error: "API-användare krävs första gången kopplingen sparas." }, 400);
      if (!password && !existing?.encrypted_password) return json({ error: "Lösenord krävs första gången kopplingen sparas." }, 400);
      if (!companyApiGuid && !existing?.encrypted_company_api_guid) return json({ error: "Company API GUID krävs första gången kopplingen sparas." }, 400);
      const secret = encryptionSecret();
      const row = { organisation_id: profile.organisation_id, environment: body.environment === "production" ? "production" : "test", enabled: Boolean(body.enabled), login_enabled: Boolean(body.login_enabled), signing_enabled: Boolean(body.signing_enabled), encrypted_api_user: apiUser ? await encrypt(apiUser, secret) : existing.encrypted_api_user, encrypted_password: password ? await encrypt(password, secret) : existing.encrypted_password, encrypted_company_api_guid: companyApiGuid ? await encrypt(companyApiGuid, secret) : existing.encrypted_company_api_guid, api_user_hint: apiUser ? hint(apiUser) : existing.api_user_hint, company_api_guid_hint: companyApiGuid ? hint(companyApiGuid) : existing.company_api_guid_hint, provider_note: String(body.provider_note || "").trim(), updated_by: profile.id, updated_at: new Date().toISOString() };
      const { data, error } = await db.from("vihem_bankid_settings").upsert(row, { onConflict: "organisation_id" }).select("*").single();
      if (error) throw error;
      return json({ ok: true, settings: publicSettings(data) });
    }

    if (action === "start_auth") {
      // BankID login doesn't ask who's signing in up front -- the person is
      // identified afterwards in "collect" below, by matching the
      // personnummer BankID returns against vihem_profiles.bankid_personal_number
      // (set on the profile ahead of time by an admin). Starting the order
      // still needs ONE organisation's BankSignering API credentials before
      // anyone has identified themselves, though, so this picks the only
      // organisation with BankID login enabled -- correct as long as VI-HEM
      // runs as a single organisation, which is the only case that exists
      // anywhere in this codebase today (there is no pre-auth
      // org-resolution mechanism, e.g. by subdomain, anywhere else either).
      const { data: enabledOrgs } = await db.from("vihem_bankid_settings").select("organisation_id").eq("enabled", true).eq("login_enabled", true);
      if (!enabledOrgs || enabledOrgs.length === 0) return json({ error: "BankID-inloggning är inte aktiverad." }, 403);
      if (enabledOrgs.length > 1) return json({ error: "BankID-inloggning kan inte avgöra vilken organisation -- kontakta support." }, 409);
      const organisationId = enabledOrgs[0].organisation_id;
      const settings = await getSettings(db, organisationId);
      const order = await startProvider(settings, "Logga in i VI-HEM med BankID", "", req);
      await db.from("vihem_bankid_orders").insert({ organisation_id: organisationId, order_ref: order.orderRef, flow: "auth" });
      return json({ ok: true, ...order });
    }

    if (action === "start_sign") {
      const signingToken = String(body.signing_token || "");
      if (signingToken) {
        // Avtal V2: the signer never has a VI-HEM session -- see
        // vihem-agreements-public/index.ts's resolveRequest(), same
        // hash-lookup convention (only the token's hash is ever stored).
        const tokenHash = await hashSigningToken(signingToken);
        const { data: request } = await db.from("vihem_agreement_signature_requests").select("id, agreement_id, signer_id, expires_at, revoked_at").eq("token_hash", tokenHash).maybeSingle();
        if (!request) return json({ error: "Länken är ogiltig." }, 404);
        if (request.revoked_at) return json({ error: "Länken har återkallats." }, 410);
        if (new Date(request.expires_at) < new Date()) return json({ error: "Länken har gått ut. Be avsändaren skicka en ny." }, 410);
        const { data: signer } = await db.from("vihem_agreement_signers").select("id, name, status, signing_method").eq("id", request.signer_id).maybeSingle();
        if (!signer) return json({ error: "Signatären hittades inte." }, 404);
        if (signer.signing_method !== "bankid") return json({ error: "Fel signeringsmetod för denna signatär." }, 400);
        if (signer.status === "signed") return json({ error: "Du har redan signerat detta dokument." }, 409);
        if (signer.status === "declined") return json({ error: "Du har redan avböjt detta dokument." }, 409);
        const { data: agreement } = await db.from("vihem_agreements").select("organisation_id, title, document_number").eq("id", request.agreement_id).maybeSingle();
        if (!agreement) return json({ error: "Avtalet kunde inte hittas." }, 404);
        const settings = await getSettings(db, agreement.organisation_id);
        if (!settings?.enabled || !settings.signing_enabled) return json({ error: "BankID-signering är inte aktiverad för organisationen." }, 403);
        const visible = String(body.user_visible_data || `Godkänn och signera ${agreement.title || agreement.document_number} i VI-HEM.`);
        const order = await startProvider(settings, visible, "", req);
        await db.from("vihem_bankid_orders").insert({ organisation_id: agreement.organisation_id, order_ref: order.orderRef, flow: "sign", agreement_signature_request_id: request.id });
        return json({ ok: true, ...order });
      }

      // Legacy path: authenticated tenant signing their own
      // vihem_contract_signatures row (a real VI-HEM session, unlike Avtal
      // V2's token-only signers above).
      if (!profile?.organisation_id) return json({ error: "Du måste vara inloggad för att signera avtalet." }, 401);
      const contractId = String(body.contract_id || "");
      const { data: contract } = await db.from("vihem_contract_signatures").select("id,organisation_id,tenant_id").eq("id", contractId).maybeSingle();
      if (!contract || contract.organisation_id !== profile.organisation_id || contract.tenant_id !== profile.id) return json({ error: "Avtalet kunde inte hittas." }, 404);
      const settings = await getSettings(db, profile.organisation_id);
      if (!settings?.enabled || !settings.signing_enabled) return json({ error: "BankID-signering är inte aktiverad för organisationen." }, 403);
      const visible = String(body.user_visible_data || "Godkänn och signera hyresavtalet i VI-HEM.");
      const order = await startProvider(settings, visible, String(body.user_non_visible_data || ""), req);
      await db.from("vihem_bankid_orders").insert({ organisation_id: profile.organisation_id, order_ref: order.orderRef, flow: "sign", user_id: profile.id, contract_id: contract.id });
      return json({ ok: true, ...order });
    }

    if (action === "start_link") {
      // Self-service "koppla mitt konto till BankID" for an already
      // logged-in user (any role) -- gets a real, BankID-verified
      // personnummer onto their own profile so a FUTURE start_auth login
      // can find them, without needing an admin to type it in by hand.
      if (!profile?.organisation_id) return json({ error: "Du måste vara inloggad för att koppla BankID." }, 401);
      const settings = await getSettings(db, profile.organisation_id);
      if (!settings?.enabled || !settings.login_enabled) return json({ error: "BankID-inloggning är inte aktiverad för organisationen." }, 403);
      const order = await startProvider(settings, "Koppla ditt BankID till ditt VI-HEM-konto", "", req);
      await db.from("vihem_bankid_orders").insert({ organisation_id: profile.organisation_id, order_ref: order.orderRef, flow: "link", user_id: profile.id });
      return json({ ok: true, ...order });
    }

    if (action === "collect") {
      const orderRef = String(body.order_ref || "");
      const { data: order } = await db.from("vihem_bankid_orders").select("*").eq("order_ref", orderRef).maybeSingle();
      if (!order || new Date(order.expires_at) < new Date()) return json({ error: "BankID-sessionen har gått ut." }, 410);
      if (order.flow === "sign" && order.agreement_signature_request_id) {
        // Avtal V2: re-verify the SAME signing token on every poll, not
        // just at start_sign -- there is no Supabase session to check
        // against instead (see module header).
        const signingToken = String(body.signing_token || "");
        if (!signingToken) return json({ error: "Signeringstoken krävs." }, 401);
        const tokenHash = await hashSigningToken(signingToken);
        const { data: matchingRequest } = await db.from("vihem_agreement_signature_requests").select("id").eq("id", order.agreement_signature_request_id).eq("token_hash", tokenHash).maybeSingle();
        if (!matchingRequest) return json({ error: "Obehörig signering." }, 403);
      } else if ((order.flow === "sign" || order.flow === "link") && (!profile || profile.id !== order.user_id)) {
        return json({ error: order.flow === "sign" ? "Obehörig signering." : "Obehörig länkning." }, 403);
      }
      const settings = await getSettings(db, order.organisation_id);
      const result = await collectProvider(settings, orderRef);
      if (result.status === "pending") return json(result);
      const completion = result.completionData || null;
      await db.from("vihem_bankid_orders").update({ status: result.status, completion_data: completion, updated_at: new Date().toISOString() }).eq("order_ref", orderRef);
      if (result.status !== "complete" || !completion) return json(result);
      const pno = completion.user?.personalNumber || "";
      if (order.flow === "sign" && order.contract_id) {
        const now = new Date().toISOString();
        const { error } = await db.from("vihem_contract_signatures").update({ tenant_bankid_personal_number: pno, tenant_bankid_signature: completion.signature || "", tenant_bankid_signed_at: now, tenant_signature_method: "bankid", tenant_signed_at: now, tenant_signature_name: completion.user?.name || "", status: "signed" }).eq("id", order.contract_id);
        if (error) throw error;
        return json({ ...result, signed: true });
      }
      if (order.flow === "sign" && order.agreement_signature_request_id) {
        const { data: request } = await db.from("vihem_agreement_signature_requests").select("id, agreement_id, signer_id, agreement_version_id").eq("id", order.agreement_signature_request_id).maybeSingle();
        if (!request) return json({ ...result, error: "Signeringsförfrågan hittades inte." });
        const { data: signer } = await db.from("vihem_agreement_signers").select("id, name, status").eq("id", request.signer_id).maybeSingle();
        if (!signer) return json({ ...result, error: "Signatären hittades inte." });
        // Idempotent: a re-poll landing here after the first "complete"
        // response already recorded the signature would otherwise hit the
        // (signer_id, agreement_version_id) unique constraint on
        // vihem_agreement_signatures.
        if (signer.status === "signed") return json({ ...result, signed: true });
        const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
        const userAgent = req.headers.get("user-agent") || "";
        const { error: sigErr } = await db.from("vihem_agreement_signatures").insert({
          agreement_id: request.agreement_id,
          signer_id: request.signer_id,
          signature_request_id: request.id,
          agreement_version_id: request.agreement_version_id,
          method: "bankid",
          bankid_personal_number: pno,
          bankid_reference: orderRef,
          signature_name: completion.user?.name || signer.name || "",
          ip_address: ip,
          user_agent: userAgent,
        });
        if (sigErr) return json({ ...result, error: `Kunde inte spara signaturen: ${sigErr.message}` });
        await db.from("vihem_agreement_signers").update({ status: "signed" }).eq("id", request.signer_id);
        const { data: version } = await db.from("vihem_agreement_versions").select("content_hash").eq("id", request.agreement_version_id).maybeSingle();
        await writeAgreementAudit(db, request.agreement_id, request.signer_id, "signed", request.agreement_version_id, version?.content_hash, ip, userAgent, { method: "bankid" });
        await maybeCompleteAgreement(db, request.agreement_id);
        return json({ ...result, signed: true });
      }
      if (order.flow === "link") {
        // Unlike start_auth's login flow, the user is already identified
        // (order.user_id, set by start_link below from the authenticated
        // caller) -- this just writes the BankID-VERIFIED personnummer onto
        // THEIR OWN profile. Never trust a personnummer typed into a form
        // for this; it must come from an actual completed BankID order.
        const normalizedPno = pno.replace(/\D/g, "");
        if (!normalizedPno) return json({ ...result, linked: false, error: "BankID godkändes men inget personnummer kunde läsas." });
        const { data: conflict } = await db.from("vihem_profiles").select("id").eq("organisation_id", order.organisation_id).eq("bankid_personal_number", normalizedPno).neq("id", order.user_id).maybeSingle();
        if (conflict) return json({ ...result, linked: false, error: "Detta BankID är redan kopplat till ett annat VI-HEM-konto." });
        const { error } = await db.from("vihem_profiles").update({ bankid_personal_number: normalizedPno, bankid_linked_at: new Date().toISOString(), auth_method: profile.auth_method === "password" ? "both" : "bankid" }).eq("id", order.user_id);
        if (error) throw error;
        return json({ ...result, linked: true });
      }
      const normalizedPno = pno.replace(/\D/g, "");
      if (!normalizedPno) return json({ ...result, login_ready: false, error: "BankID godkändes men inget personnummer kunde läsas." });
      const { data: target } = await db.from("vihem_profiles").select("id,email").eq("organisation_id", order.organisation_id).eq("bankid_personal_number", normalizedPno).maybeSingle();
      if (!target?.email) return json({ ...result, login_ready: false, error: "Inget VI-HEM-konto är kopplat till detta BankID. Be en administratör lägga till ditt personnummer på ditt konto." });
      await db.from("vihem_profiles").update({ bankid_linked_at: new Date().toISOString(), auth_method: "both" }).eq("id", target.id);
      const link = await db.auth.admin.generateLink({ type: "magiclink", email: target.email, options: { redirectTo: Deno.env.get("VIHEM_PUBLIC_APP_URL") || "https://app.vi-hem.se" } });
      return json({ ...result, login_ready: true, magic_link: link.data?.properties?.action_link || null });
    }
    if (action === "cancel") { await db.from("vihem_bankid_orders").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("order_ref", String(body.order_ref || "")); return json({ ok: true }); }
    return json({ error: "Okänd BankID-åtgärd." }, 400);
  } catch (error) { console.error("vihem-bankid", error); return json({ error: error instanceof Error ? error.message : "BankID-fel" }, 500); }
});

function getAuthClient(req: Request) { const headers = { Authorization: req.headers.get("Authorization") || "" }; return { client: createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers } }) }; }
async function getProfile(db: any, id: string) { const { data } = await db.from("vihem_profiles").select("id,role,organisation_id,email,auth_method,is_system_admin").eq("id", id).maybeSingle(); return data; }
async function getSettings(db: any, organisationId: string) { const { data } = await db.from("vihem_bankid_settings").select("*").eq("organisation_id", organisationId).maybeSingle(); return data; }
function publicSettings(s: any) { return { configured: Boolean(s?.encrypted_api_user && s?.encrypted_password && s?.encrypted_company_api_guid), enabled: Boolean(s?.enabled), login_enabled: Boolean(s?.login_enabled), signing_enabled: Boolean(s?.signing_enabled), environment: s?.environment || "test", api_user_hint: s?.api_user_hint || "", company_api_guid_hint: s?.company_api_guid_hint || "", provider_note: s?.provider_note || "", updated_at: s?.updated_at || null }; }
async function startProvider(s: any, visible: string, nonVisible: string, req: Request) { const credentials = await credentialsFor(s); const response = await fetch(signUrl(s), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...credentials, endUserIp: (req.headers.get("x-forwarded-for") || "0.0.0.0").split(",")[0].trim(), userVisibleData: visible, userNonVisibleData: nonVisible, getQr: true }) }); const data = await response.json(); if (!response.ok) throw new Error(data?.message || `BankSignering start misslyckades (${response.status}).`); const r = data?.apiCallResponse?.Response || data?.Response || data; if (!r?.OrderRef) throw new Error("BankSignering returnerade inget OrderRef."); return { orderRef: String(r.OrderRef), autoStartToken: String(r.AutoStartToken || ""), qrImage: r.QrImage || null }; }
async function collectProvider(s: any, orderRef: string) { const credentials = await credentialsFor(s); const response = await fetch(collectUrl(s), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...credentials, orderRef }) }); const data = await response.json(); if (!response.ok) throw new Error(data?.message || `BankSignering collect misslyckades (${response.status}).`); const r = data?.apiCallResponse?.Response || data?.Response || data; const status = String(r?.Status || "pending").toLowerCase(); const completion = r?.CompletionData; return { orderRef, status: status === "complete" ? "complete" : status === "failed" ? "failed" : "pending", hintCode: r?.HintCode, completionData: completion ? { user: { personalNumber: completion.User?.PersonalNumber || completion.user?.personalNumber || "", name: completion.User?.Name || completion.user?.name || "", givenName: completion.User?.GivenName || completion.user?.givenName || "", surname: completion.User?.Surname || completion.user?.surname || "" }, signature: completion.Signature || completion.signature || "", ocspResponse: completion.OcspResponse || completion.ocspResponse || "" } : undefined }; }
async function credentialsFor(s: any) { const secret = encryptionSecret(); return { apiUser: await decrypt(s.encrypted_api_user, secret), password: await decrypt(s.encrypted_password, secret), companyApiGuid: await decrypt(s.encrypted_company_api_guid, secret) }; }
function signUrl(s: any) { return s.environment === "test" ? (Deno.env.get("BANKSIGN_TEST_SIGN_URL") || TEST_SIGN_URL) : requiredEnv("BANKSIGN_PRODUCTION_SIGN_URL"); }
function collectUrl(s: any) { return s.environment === "test" ? (Deno.env.get("BANKSIGN_TEST_COLLECT_URL") || TEST_COLLECT_URL) : requiredEnv("BANKSIGN_PRODUCTION_COLLECT_URL"); }
function requiredEnv(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`Servern saknar ${name}.`); return value; }
function encryptionSecret() { return Deno.env.get("VIHEM_BANKID_SECRET_KEY") || Deno.env.get("VIHEM_ACCOUNTING_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; }
async function encrypt(value: string, secret: string) { const enc = new TextEncoder(); const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret)); const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt"]); const iv = crypto.getRandomValues(new Uint8Array(12)); const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(value)); const all = new Uint8Array(iv.length + cipher.byteLength); all.set(iv); all.set(new Uint8Array(cipher), iv.length); return btoa(String.fromCharCode(...all)); }
async function decrypt(value: string, secret: string) { const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0)); const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)); const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12))); }
function hint(value: string) { return value.length <= 6 ? "sparad" : `${value.slice(0, 3)}...${value.slice(-3)}`; }
function json(data: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } }); }
