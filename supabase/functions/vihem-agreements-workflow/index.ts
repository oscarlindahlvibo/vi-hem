// Avtal V2 (BETA) workflow surface: the state-changing, side-effect-having
// actions -- send for signing (freezes the immutable version, locks
// attachments, creates one signature request per signer, delivers via
// email/SMS), send a reminder, and cancel.
//
// This is the ONLY place that ever creates a vihem_agreement_versions row
// or a vihem_agreement_signature_requests row -- vihem-agreements-admin
// never does either, by design (see that function's header).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, corsHeaders, errorJson, isAuthContext, json } from "../_shared/vihem-auth.ts";
import { buildDynamicFieldContext, hashBlocks, mergeEntityContext, resolveBlocks, type AgreementBlock, type DynamicFieldContext } from "../_shared/agreement-snapshot.ts";
import { buildSigningUrl, generateSigningToken, hashSigningToken } from "../_shared/agreement-tokens.ts";
import { readSmtpConfigFromEnv, sendMail } from "../_shared/smtp-mailer.ts";

const STAFF_ROLES = ["staff", "admin", "superadmin"];
const REQUEST_TTL_DAYS = 30;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return errorJson("METHOD_NOT_ALLOWED", "Endast POST stöds.", 405);

  const auth = await authenticate(req);
  if (!isAuthContext(auth)) return auth;
  const { role, organisation_id: callerOrgId } = auth.callerProfile;
  if (!STAFF_ROLES.includes(role)) return errorJson("FORBIDDEN", "Du saknar behörighet för avtalsmodulen.", 403);
  const isSuperadmin = role === "superadmin";
  const db = auth.adminClient;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorJson("VALIDATION_ERROR", "Ogiltig JSON.", 400);
  }
  const action = String(body?.action || "");

  async function loadAgreement(agreementId: string) {
    const { data, error } = await db.from("vihem_agreements").select("*").eq("id", agreementId).maybeSingle();
    if (error || !data) return null;
    if (!isSuperadmin && data.organisation_id !== callerOrgId) return null;
    return data;
  }

  try {
    switch (action) {
      case "send": {
        const agreementId = String(body?.agreement_id || "");
        const agreement = await loadAgreement(agreementId);
        if (!agreement) return errorJson("NOT_FOUND", "Dokumentet hittades inte.", 404);
        if (!["draft", "ready"].includes(agreement.status)) {
          return errorJson("INVALID_STATUS", `Dokumentet kan inte skickas från status ${agreement.status}.`, 409);
        }

        const [{ data: blocks }, { data: signers }, { data: links }] = await Promise.all([
          db.from("vihem_agreement_blocks").select("id, block_type, content").eq("agreement_id", agreementId).order("position"),
          db.from("vihem_agreement_signers").select("*").eq("agreement_id", agreementId),
          db.from("vihem_agreement_entity_links").select("entity_type, entity_id").eq("agreement_id", agreementId),
        ]);
        if (!blocks || blocks.length === 0) return errorJson("VALIDATION_ERROR", "Dokumentet saknar innehåll.", 400);
        const requiredSigners = (signers || []).filter((s: any) => s.signing_required);
        if (requiredSigners.length === 0) return errorJson("VALIDATION_ERROR", "Dokumentet behöver minst en signatär.", 400);

        // Build dynamic-field context: base (today/organisation) + one
        // namespace per linked entity type, using whatever basic fields
        // that entity's table actually has. Deliberately small/best-effort
        // -- an unmapped entity_type just contributes no extra tokens
        // rather than failing the whole send.
        let context: DynamicFieldContext = await buildDynamicFieldContext(db, agreement.organisation_id);
        for (const link of links || []) {
          context = await mergeLinkedEntity(db, context, link.entity_type, link.entity_id);
        }

        const resolvedBlocks = resolveBlocks(blocks as AgreementBlock[], context);
        const contentHash = await hashBlocks(resolvedBlocks);

        const { count: existingVersions } = await db.from("vihem_agreement_versions").select("id", { count: "exact", head: true }).eq("agreement_id", agreementId);
        const versionNumber = (existingVersions ?? 0) + 1;

        const { data: version, error: versionErr } = await db
          .from("vihem_agreement_versions")
          .insert({
            agreement_id: agreementId,
            version_number: versionNumber,
            blocks: resolvedBlocks,
            content_hash: contentHash,
            frozen_by: auth.callerId,
          })
          .select("*")
          .single();
        if (versionErr) return errorJson("INTERNAL_ERROR", `Kunde inte frysa dokumentversionen: ${versionErr.message}`, 500);

        // Lock the current attachment set into this version -- anything
        // added to the agreement AFTER this point (which the RLS status
        // gate no longer even allows) is simply not part of what was sent.
        await db.from("vihem_agreement_attachments").update({ included_in_version_id: version.id }).eq("agreement_id", agreementId).is("included_in_version_id", null);

        await db
          .from("vihem_agreements")
          .update({ status: "sent", current_version_id: version.id, sent_at: new Date().toISOString(), updated_by: auth.callerId })
          .eq("id", agreementId);

        await writeAudit(db, agreementId, null, "sent", "staff", auth.callerId, { version_id: version.id, document_hash: contentHash }, version.id, contentHash);

        const channels: { email: boolean; sms: boolean } = { email: body?.channels?.email !== false, sms: Boolean(body?.channels?.sms) };
        const appUrl = Deno.env.get("VIHEM_PUBLIC_APP_URL") || "https://app.vi-hem.se";
        const { data: org } = await db.from("vihem_organisations").select("name").eq("id", agreement.organisation_id).maybeSingle();

        const deliveryResults: { signer_id: string; ok: boolean; channels_used: string[]; error?: string }[] = [];
        for (const signer of requiredSigners) {
          const token = generateSigningToken();
          const tokenHash = await hashSigningToken(token);
          const { data: requestRow, error: reqErr } = await db
            .from("vihem_agreement_signature_requests")
            .insert({
              agreement_id: agreementId,
              signer_id: signer.id,
              agreement_version_id: version.id,
              token_hash: tokenHash,
              expires_at: new Date(Date.now() + REQUEST_TTL_DAYS * 86400000).toISOString(),
            })
            .select("id")
            .single();
          if (reqErr) {
            deliveryResults.push({ signer_id: signer.id, ok: false, channels_used: [], error: reqErr.message });
            continue;
          }

          const signUrl = buildSigningUrl(appUrl, token);
          const usedChannels: string[] = [];
          let deliveryOk = false;

          if (channels.email && signer.email) {
            const sent = await sendSigningEmail(org?.name || "VI-HEM", signer, agreement, signUrl);
            usedChannels.push("email");
            deliveryOk = deliveryOk || sent.ok;
            await writeAudit(db, agreementId, signer.id, sent.ok ? "sent_email" : "email_delivery_failed", "system", null, sent.ok ? {} : { error: sent.error }, version.id, contentHash, "email");
          }
          if (channels.sms && signer.phone) {
            const sent = await sendSigningSms(auth.userClient, agreement.organisation_id, signer, org?.name || "VI-HEM", signUrl);
            usedChannels.push("sms");
            deliveryOk = deliveryOk || sent.ok;
            await writeAudit(db, agreementId, signer.id, sent.ok ? "sent_sms" : "sms_delivery_failed", "system", null, sent.ok ? {} : { error: sent.error }, version.id, contentHash, "sms");
          }

          if (deliveryOk) {
            await db.from("vihem_agreement_signers").update({ status: "sent" }).eq("id", signer.id).eq("status", "pending");
          }
          deliveryResults.push({ signer_id: signer.id, ok: deliveryOk, channels_used: usedChannels, error: requestRow ? undefined : "no_channel_available" });
        }

        return json({ data: { version_id: version.id, version_number: versionNumber, content_hash: contentHash, delivery: deliveryResults } });
      }

      case "remind": {
        const agreementId = String(body?.agreement_id || "");
        const signerId = String(body?.signer_id || "");
        const agreement = await loadAgreement(agreementId);
        if (!agreement) return errorJson("NOT_FOUND", "Dokumentet hittades inte.", 404);
        if (!["sent", "viewed", "partially_signed"].includes(agreement.status)) {
          return errorJson("INVALID_STATUS", "Dokumentet väntar inte längre på signering.", 409);
        }
        const { data: signer } = await db.from("vihem_agreement_signers").select("*").eq("id", signerId).eq("agreement_id", agreementId).maybeSingle();
        if (!signer) return errorJson("NOT_FOUND", "Signatären hittades inte.", 404);
        if (signer.status === "signed" || signer.status === "declined") return errorJson("INVALID_STATUS", "Signatären har redan signerat eller avböjt.", 409);

        const { data: existingRequest } = await db
          .from("vihem_agreement_signature_requests")
          .select("id, token_hash, revoked_at, expires_at")
          .eq("signer_id", signerId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingRequest && !existingRequest.revoked_at && new Date(existingRequest.expires_at) > new Date()) {
          // Existing link is still valid -- but we never re-derive the raw
          // token from a stored hash (impossible by design), so a reminder
          // ALWAYS issues a fresh token for the same version and revokes
          // the previous request. This keeps "one valid link per signer at
          // a time" simple rather than tracking multiple live tokens.
          await db.from("vihem_agreement_signature_requests").update({ revoked_at: new Date().toISOString() }).eq("id", existingRequest.id);
        }
        const token = generateSigningToken();
        const tokenHash = await hashSigningToken(token);
        const { data: newRequest, error: reqErr } = await db
          .from("vihem_agreement_signature_requests")
          .insert({
            agreement_id: agreementId,
            signer_id: signerId,
            agreement_version_id: agreement.current_version_id,
            token_hash: tokenHash,
            expires_at: new Date(Date.now() + REQUEST_TTL_DAYS * 86400000).toISOString(),
          })
          .select("id")
          .single();
        if (reqErr) return errorJson("INTERNAL_ERROR", reqErr.message, 500);

        const appUrl = Deno.env.get("VIHEM_PUBLIC_APP_URL") || "https://app.vi-hem.se";
        const signUrl = buildSigningUrl(appUrl, token);
        const { data: org } = await db.from("vihem_organisations").select("name").eq("id", agreement.organisation_id).maybeSingle();

        const usedChannels: string[] = [];
        if (signer.email) {
          const sent = await sendSigningEmail(org?.name || "VI-HEM", signer, agreement, signUrl, true);
          usedChannels.push("email");
          await writeAudit(db, agreementId, signerId, sent.ok ? "reminder_sent" : "email_delivery_failed", "staff", auth.callerId, { channel: "email" }, agreement.current_version_id, null, "email");
        }
        if (signer.phone && body?.also_sms) {
          const sent = await sendSigningSms(auth.userClient, agreement.organisation_id, signer, org?.name || "VI-HEM", signUrl, true);
          usedChannels.push("sms");
          await writeAudit(db, agreementId, signerId, sent.ok ? "reminder_sent" : "sms_delivery_failed", "staff", auth.callerId, { channel: "sms" }, agreement.current_version_id, null, "sms");
        }
        return json({ data: { ok: usedChannels.length > 0, channels_used: usedChannels } });
      }

      case "cancel": {
        const agreementId = String(body?.agreement_id || "");
        const agreement = await loadAgreement(agreementId);
        if (!agreement) return errorJson("NOT_FOUND", "Dokumentet hittades inte.", 404);
        if (["signed", "accepted", "cancelled", "archived"].includes(agreement.status)) {
          return errorJson("INVALID_STATUS", "Dokumentet kan inte avbrytas i sitt nuvarande läge.", 409);
        }
        await db.from("vihem_agreement_signature_requests").update({ revoked_at: new Date().toISOString() }).eq("agreement_id", agreementId).is("revoked_at", null);
        await db.from("vihem_agreements").update({ status: "cancelled", updated_by: auth.callerId }).eq("id", agreementId);
        await writeAudit(db, agreementId, null, "cancelled", "staff", auth.callerId);
        return json({ data: { ok: true } });
      }

      default:
        return errorJson("VALIDATION_ERROR", `Okänd action: ${action}`, 400);
    }
  } catch (err) {
    console.error("vihem-agreements-workflow", err);
    return errorJson("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), 500);
  }
});

async function mergeLinkedEntity(db: any, context: DynamicFieldContext, entityType: string, entityId: string): Promise<DynamicFieldContext> {
  try {
    switch (entityType) {
      case "tenant": {
        const { data } = await db.from("vihem_profiles").select("name, email, phone, personal_number").eq("id", entityId).maybeSingle();
        return data ? mergeEntityContext(context, "tenant", data) : context;
      }
      case "apartment": {
        const { data } = await db.from("vihem_apartments").select("apartment_number, address, size, rooms").eq("id", entityId).maybeSingle();
        return data ? mergeEntityContext(context, "apartment", data) : context;
      }
      case "property": {
        const { data } = await db.from("vihem_properties").select("name, address").eq("id", entityId).maybeSingle();
        return data ? mergeEntityContext(context, "property", data) : context;
      }
      case "finance_customer": {
        const { data } = await db.from("vihem_finance_customers").select("name, email, phone, organisation_number").eq("id", entityId).maybeSingle();
        return data ? mergeEntityContext(context, "customer", data) : context;
      }
      case "customer_project": {
        const { data } = await db.from("vihem_customer_projects").select("title, name").eq("id", entityId).maybeSingle();
        return data ? mergeEntityContext(context, "project", { name: data.title || data.name || "" }) : context;
      }
      default:
        return context;
    }
  } catch {
    return context;
  }
}

async function sendSigningEmail(
  orgName: string,
  signer: { name: string; email: string },
  agreement: { title: string; document_number: string },
  signUrl: string,
  isReminder = false,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const config = readSmtpConfigFromEnv();
    const subject = isReminder
      ? `Påminnelse: ${agreement.title || agreement.document_number} väntar på din signatur`
      : `Du har fått ett dokument från ${orgName}`;
    const text = [
      isReminder ? `Påminnelse: du har ett dokument som väntar på din signatur.` : `Du har fått ett dokument från ${orgName}.`,
      "",
      `${agreement.title || agreement.document_number} (${agreement.document_number})`,
      "",
      `Öppna och signera: ${signUrl}`,
      "",
      "Länken är personlig och ska inte delas vidare.",
    ].join("\n");
    await sendMail(config, { toEmail: signer.email, toName: signer.name, subject, text });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Must be called with the ORIGINAL caller's user-JWT client (auth.userClient
// from vihem-auth.ts), never the service-role client: vihem-send-sms
// authenticates via supabase.auth.getUser(token) against a real user
// session and checks that user's own vihem_profiles role -- a service-role
// key has no associated user, so calling it with the admin client would
// always be rejected with 403.
async function sendSigningSms(
  userClient: any,
  organisationId: string,
  signer: { name: string; phone: string },
  orgName: string,
  signUrl: string,
  isReminder = false,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Kept deliberately short: the token itself is already the largest
    // component of signUrl (see _shared/agreement-tokens.ts -- base64url,
    // not hex, specifically to keep this under a single SMS's length),
    // and every extra word here eats into that budget further.
    const message = isReminder
      ? `Paminnelse: dokument fran ${orgName} vantar pa signatur: ${signUrl}`
      : `Dokument fran ${orgName} att signera: ${signUrl}`;
    const { data, error } = await userClient.functions.invoke("vihem-send-sms", {
      body: { organisation_id: organisationId, recipient: signer.phone, message, related_type: "agreement_signing", related_id: null },
    });
    if (error) return { ok: false, error: error.message || "SMS-utskick misslyckades." };
    if (data?.error) return { ok: false, error: String(data.error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function writeAudit(
  db: any,
  agreementId: string,
  signerId: string | null,
  eventType: string,
  actorType: "staff" | "signer" | "system",
  actorId: string | null,
  metadata: Record<string, unknown> = {},
  versionId: string | null = null,
  documentHash: string | null = null,
  channel: "email" | "sms" | null = null,
) {
  await db.from("vihem_agreement_audit_events").insert({
    agreement_id: agreementId,
    signer_id: signerId,
    event_type: eventType,
    actor_type: actorType,
    actor_id: actorId,
    agreement_version_id: versionId,
    document_hash: documentHash,
    channel,
    metadata,
  });
}
