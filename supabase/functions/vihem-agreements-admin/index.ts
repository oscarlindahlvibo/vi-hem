// Avtal V2 (BETA) admin surface: everything a staff/admin user does to a
// document BEFORE it's sent for signing -- create, edit blocks, manage
// parties/signers/attachments/entity links, and the template library.
//
// Org-scoped, not company-scoped (see 20260822100000's migration header for
// why): every action checks `organisation_id === caller.organisation_id`
// (or superadmin) directly, mirroring vihem_documents' RLS shape rather
// than Finance V2's vihem_user_has_company_access pattern.
//
// Sending a document (freezing a version, generating signing links,
// delivering email/SMS) is a SEPARATE function, vihem-agreements-workflow
// -- this function never creates a version or a signature request.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, corsHeaders, errorJson, isAuthContext, json } from "../_shared/vihem-auth.ts";

const STAFF_ROLES = ["staff", "admin", "superadmin"];
const ADMIN_ROLES = ["admin", "superadmin"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return errorJson("METHOD_NOT_ALLOWED", "Endast POST stöds.", 405);

  const auth = await authenticate(req);
  if (!isAuthContext(auth)) return auth;
  const { role, organisation_id: callerOrgId } = auth.callerProfile;
  if (!STAFF_ROLES.includes(role)) return errorJson("FORBIDDEN", "Du saknar behörighet för avtalsmodulen.", 403);
  const isSuperadmin = role === "superadmin";

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorJson("VALIDATION_ERROR", "Ogiltig JSON.", 400);
  }
  const action = String(body?.action || "");
  const db = auth.adminClient;

  // Resolves the organisation a request is scoped to: superadmin may pass
  // one explicitly (rare, mostly for support), everyone else is pinned to
  // their own -- this is a defence-in-depth belt alongside RLS, not a
  // replacement for it (every query below still goes through `db`, the
  // service-role client, precisely because RLS can't be relied on for
  // service-role writes; this app-level check is what stands in for it).
  const orgId = (): string => (isSuperadmin && body?.organisation_id ? String(body.organisation_id) : callerOrgId);

  async function assertAgreementInOrg(agreementId: string, statuses?: string[]): Promise<{ id: string; organisation_id: string; status: string } | Response> {
    const { data, error } = await db
      .from("vihem_agreements")
      .select("id, organisation_id, status")
      .eq("id", agreementId)
      .maybeSingle();
    if (error || !data) return errorJson("NOT_FOUND", "Dokumentet hittades inte.", 404);
    if (!isSuperadmin && data.organisation_id !== callerOrgId) return errorJson("FORBIDDEN", "Du saknar behörighet för detta dokument.", 403);
    if (statuses && !statuses.includes(data.status)) {
      return errorJson("INVALID_STATUS", `Åtgärden kräver status ${statuses.join("/")}, dokumentet har status ${data.status}.`, 409);
    }
    return data;
  }

  try {
    switch (action) {
      // ---- Agreements -----------------------------------------------------
      case "list_agreements": {
        let query = db
          .from("vihem_agreements")
          .select("id, document_number, document_type, category, title, status, created_at, updated_at, sent_at, completed_at, valid_until")
          .order("updated_at", { ascending: false })
          .limit(200);
        query = isSuperadmin && body?.organisation_id ? query.eq("organisation_id", body.organisation_id) : query.eq("organisation_id", callerOrgId);
        if (body?.status) query = query.eq("status", body.status);
        if (body?.document_type) query = query.eq("document_type", body.document_type);
        if (body?.search) query = query.or(`title.ilike.%${escapeIlike(body.search)}%,document_number.ilike.%${escapeIlike(body.search)}%`);
        const { data, error } = await query;
        if (error) return errorJson("INTERNAL_ERROR", error.message, 500);
        return json({ data });
      }

      case "get_agreement": {
        const agreementId = String(body?.id || "");
        const agreement = await assertAgreementInOrg(agreementId);
        if (agreement instanceof Response) return agreement;

        const [{ data: full }, { data: blocks }, { data: parties }, { data: signers }, { data: attachments }, { data: links }, { data: versions }, { data: auditEvents }, { data: signatures }] = await Promise.all([
          db.from("vihem_agreements").select("*").eq("id", agreementId).single(),
          db.from("vihem_agreement_blocks").select("*").eq("agreement_id", agreementId).order("position"),
          db.from("vihem_agreement_parties").select("*").eq("agreement_id", agreementId).order("position"),
          db.from("vihem_agreement_signers").select("*").eq("agreement_id", agreementId).order("created_at"),
          db.from("vihem_agreement_attachments").select("*").eq("agreement_id", agreementId).order("position"),
          db.from("vihem_agreement_entity_links").select("*").eq("agreement_id", agreementId),
          db.from("vihem_agreement_versions").select("id, version_number, content_hash, frozen_at").eq("agreement_id", agreementId).order("version_number", { ascending: false }),
          db.from("vihem_agreement_audit_events").select("*").eq("agreement_id", agreementId).order("created_at", { ascending: false }).limit(100),
          // Signature evidence (method, IP, user-agent, BankID reference) --
          // same data the final PDF's verification section renders, surfaced
          // to staff in-app. Never exposed on the public/signer-facing side.
          db.from("vihem_agreement_signatures").select("id, signer_id, method, signature_name, bankid_personal_number, bankid_reference, ip_address, user_agent, signed_at").eq("agreement_id", agreementId),
        ]);
        return json({ data: { agreement: full, blocks, parties, signers, attachments, entity_links: links, versions, audit_events: auditEvents, signatures } });
      }

      case "create_agreement": {
        const documentType = String(body?.document_type || "agreement");
        if (!["agreement", "offer", "other"].includes(documentType)) return errorJson("VALIDATION_ERROR", "Ogiltig dokumenttyp.", 400);
        const organisationId = orgId();
        if (!organisationId) return errorJson("VALIDATION_ERROR", "organisation_id saknas.", 400);

        const { data: numberData, error: numberErr } = await db.rpc("vihem_next_agreement_number", {
          p_organisation_id: organisationId,
          p_document_type: documentType,
        });
        if (numberErr) return errorJson("INTERNAL_ERROR", `Kunde inte generera dokumentnummer: ${numberErr.message}`, 500);

        const { data: created, error: createErr } = await db
          .from("vihem_agreements")
          .insert({
            organisation_id: organisationId,
            document_number: numberData,
            document_type: documentType,
            category: String(body?.category || ""),
            title: String(body?.title || ""),
            template_id: body?.template_id || null,
            created_by: auth.callerId,
            updated_by: auth.callerId,
          })
          .select("*")
          .single();
        if (createErr) return errorJson("INTERNAL_ERROR", createErr.message, 500);

        if (body?.template_id) {
          const { data: templateBlocks } = await db
            .from("vihem_agreement_template_blocks")
            .select("position, block_type, content")
            .eq("template_id", body.template_id)
            .order("position");
          if (templateBlocks?.length) {
            await db.from("vihem_agreement_blocks").insert(
              templateBlocks.map((b: any) => ({ agreement_id: created.id, position: b.position, block_type: b.block_type, content: b.content })),
            );
          }
        }

        await writeAudit(db, created.id, null, "created", "staff", auth.callerId);
        return json({ data: created });
      }

      case "update_agreement": {
        const agreementId = String(body?.id || "");
        const agreement = await assertAgreementInOrg(agreementId);
        if (agreement instanceof Response) return agreement;

        const patch: Record<string, unknown> = { updated_by: auth.callerId };
        for (const field of ["title", "category", "notes", "valid_until"] as const) {
          if (body?.[field] !== undefined) patch[field] = body[field];
        }
        // Status here only allows the pre-send draft<->ready toggle -- every
        // other transition (sent, signed, cancelled, ...) is a side effect
        // of vihem-agreements-workflow, never a direct client write.
        if (body?.status !== undefined) {
          if (!["draft", "ready"].includes(String(body.status)) || !["draft", "ready"].includes(agreement.status)) {
            return errorJson("INVALID_STATUS", "Status kan bara ändras mellan utkast och redo innan utskick.", 409);
          }
          patch.status = body.status;
        }

        const { data, error } = await db.from("vihem_agreements").update(patch).eq("id", agreementId).select("*").single();
        if (error) return errorJson("INTERNAL_ERROR", error.message, 500);
        return json({ data });
      }

      case "delete_agreement": {
        // Admin-only and any status, deliberately more permissive than
        // vihem_agreements' own RLS ("admin delete draft", draft only) --
        // that policy governs direct client deletes; this is the explicit
        // "clean up test data" escape hatch for a real admin action, so it
        // also allows deleting a sent/signed document (irreversibly losing
        // its audit trail and signature evidence, hence admin-only).
        if (!ADMIN_ROLES.includes(role)) return errorJson("FORBIDDEN", "Endast admin kan radera avtal.", 403);
        const agreementId = String(body?.id || "");
        const agreement = await assertAgreementInOrg(agreementId);
        if (agreement instanceof Response) return agreement;

        const { data: full } = await db.from("vihem_agreements").select("final_pdf_storage_path").eq("id", agreementId).maybeSingle();
        const { data: attachments } = await db.from("vihem_agreement_attachments").select("storage_path").eq("agreement_id", agreementId);
        const agreementStoragePaths = (attachments || []).map((a: any) => a.storage_path).filter(Boolean);
        if (full?.final_pdf_storage_path) agreementStoragePaths.push(full.final_pdf_storage_path);
        if (agreementStoragePaths.length > 0) await db.storage.from("vihem-agreements").remove(agreementStoragePaths);

        // Best-effort: also remove the vihem_documents mirror this
        // agreement's final PDF may have been copied into (see
        // _shared/agreement-signing.ts's linkFinalPdfToTenantDocuments) --
        // otherwise a deleted agreement's signed copy would linger under
        // the tenant's own Dokument page.
        const { data: mirrors } = await db.from("vihem_documents").select("id, storage_bucket, storage_path").ilike("storage_path", `%/agreements/${agreementId}/%`);
        for (const mirror of mirrors || []) {
          if (mirror.storage_bucket && mirror.storage_path) await db.storage.from(mirror.storage_bucket).remove([mirror.storage_path]);
        }
        if (mirrors && mirrors.length > 0) await db.from("vihem_documents").delete().in("id", mirrors.map((m: any) => m.id));

        // Explicit ordered deletes ahead of the agreement row itself: the
        // ON DELETE CASCADE from vihem_agreements reaches both
        // vihem_agreement_signatures (agreement_id) and
        // vihem_agreement_versions (agreement_id) directly, but
        // vihem_agreement_signatures.agreement_version_id -> versions is
        // ON DELETE RESTRICT -- deleting signatures first avoids relying
        // on cascade ordering across that second, indirect path.
        await db.from("vihem_agreement_signatures").delete().eq("agreement_id", agreementId);
        await db.from("vihem_agreement_signature_requests").delete().eq("agreement_id", agreementId);
        const { error: delErr } = await db.from("vihem_agreements").delete().eq("id", agreementId);
        if (delErr) return errorJson("INTERNAL_ERROR", delErr.message, 500);
        return json({ data: { ok: true } });
      }

      // ---- Draft blocks -----------------------------------------------------
      case "save_blocks": {
        const agreementId = String(body?.agreement_id || "");
        const agreement = await assertAgreementInOrg(agreementId, ["draft", "ready"]);
        if (agreement instanceof Response) return agreement;
        const blocks = Array.isArray(body?.blocks) ? body.blocks : [];

        // Replace-all: simplest correct model for a block-list editor's
        // "save" action (no client-side diffing needed, no risk of stale
        // position/id drift). Fine at this scale (documents have tens, not
        // thousands, of blocks).
        const { error: delErr } = await db.from("vihem_agreement_blocks").delete().eq("agreement_id", agreementId);
        if (delErr) return errorJson("INTERNAL_ERROR", delErr.message, 500);
        if (blocks.length > 0) {
          const { error: insErr } = await db.from("vihem_agreement_blocks").insert(
            blocks.map((b: any, i: number) => ({
              agreement_id: agreementId,
              position: i,
              block_type: String(b.block_type || ""),
              content: b.content || {},
            })),
          );
          if (insErr) return errorJson("INTERNAL_ERROR", insErr.message, 500);
        }
        await db.from("vihem_agreements").update({ updated_by: auth.callerId }).eq("id", agreementId);
        return json({ data: { ok: true, count: blocks.length } });
      }

      // ---- Parties ------------------------------------------------------
      case "save_parties": {
        const agreementId = String(body?.agreement_id || "");
        const agreement = await assertAgreementInOrg(agreementId, ["draft", "ready"]);
        if (agreement instanceof Response) return agreement;
        const parties = Array.isArray(body?.parties) ? body.parties : [];

        const { error: delErr } = await db.from("vihem_agreement_parties").delete().eq("agreement_id", agreementId);
        if (delErr) return errorJson("INTERNAL_ERROR", delErr.message, 500);
        if (parties.length > 0) {
          const { error: insErr } = await db.from("vihem_agreement_parties").insert(
            parties.map((p: any, i: number) => ({
              agreement_id: agreementId,
              position: i,
              party_type: String(p.party_type || "manual"),
              display_name: String(p.display_name || ""),
              org_number: String(p.org_number || ""),
              email: String(p.email || ""),
              phone: String(p.phone || ""),
              address: String(p.address || ""),
              source_type: p.source_type || null,
              source_id: p.source_id || null,
            })),
          );
          if (insErr) return errorJson("INTERNAL_ERROR", insErr.message, 500);
        }
        return json({ data: { ok: true, count: parties.length } });
      }

      // ---- Signers --------------------------------------------------------
      case "save_signers": {
        const agreementId = String(body?.agreement_id || "");
        const agreement = await assertAgreementInOrg(agreementId, ["draft", "ready"]);
        if (agreement instanceof Response) return agreement;
        const signers = Array.isArray(body?.signers) ? body.signers : [];

        const { data: existing } = await db.from("vihem_agreement_signers").select("id").eq("agreement_id", agreementId);
        const existingIds = new Set<string>((existing || []).map((s: any) => s.id as string));
        const keepIds = new Set<string>();

        for (const s of signers) {
          const row = {
            agreement_id: agreementId,
            party_id: s.party_id || null,
            profile_id: s.profile_id || null,
            name: String(s.name || ""),
            email: String(s.email || ""),
            phone: String(s.phone || ""),
            personal_number: String(s.personal_number || ""),
            role_title: String(s.role_title || ""),
            signing_method: s.signing_method === "bankid" ? "bankid" : "handwritten",
            signing_required: s.signing_required !== false,
            sign_order: s.sign_order ?? null,
          };
          if (s.id && existingIds.has(s.id)) {
            const { error } = await db.from("vihem_agreement_signers").update(row).eq("id", s.id);
            if (error) return errorJson("INTERNAL_ERROR", error.message, 500);
            keepIds.add(s.id);
          } else {
            const { data, error } = await db.from("vihem_agreement_signers").insert(row).select("id").single();
            if (error) return errorJson("INTERNAL_ERROR", error.message, 500);
            keepIds.add(data.id);
          }
        }
        const toRemove = [...existingIds].filter((id: string) => !keepIds.has(id));
        if (toRemove.length > 0) {
          const { error } = await db.from("vihem_agreement_signers").delete().in("id", toRemove);
          if (error) return errorJson("INTERNAL_ERROR", error.message, 500);
        }
        return json({ data: { ok: true } });
      }

      // ---- Attachments ----------------------------------------------------
      // Files are uploaded directly to storage by the frontend (same
      // createSignedUrl/direct-upload pattern vihem-documents already uses)
      // -- this only registers the metadata row after a successful upload.
      // The frontend computes content_hash client-side (Web Crypto,
      // SubtleCrypto.digest) before/after upload.
      case "register_attachment": {
        const agreementId = String(body?.agreement_id || "");
        const agreement = await assertAgreementInOrg(agreementId, ["draft", "ready"]);
        if (agreement instanceof Response) return agreement;
        const { count } = await db.from("vihem_agreement_attachments").select("id", { count: "exact", head: true }).eq("agreement_id", agreementId);

        const { data, error } = await db
          .from("vihem_agreement_attachments")
          .insert({
            agreement_id: agreementId,
            name: String(body?.name || body?.file_name || "Bilaga"),
            description: String(body?.description || ""),
            position: count ?? 0,
            storage_bucket: "vihem-agreements",
            storage_path: String(body?.storage_path || ""),
            file_name: String(body?.file_name || ""),
            content_type: String(body?.content_type || "application/pdf"),
            file_size: Number(body?.file_size || 0),
            content_hash: String(body?.content_hash || ""),
            uploaded_by: auth.callerId,
          })
          .select("*")
          .single();
        if (error) return errorJson("INTERNAL_ERROR", error.message, 500);
        return json({ data });
      }

      case "remove_attachment": {
        const attachmentId = String(body?.id || "");
        const { data: attachment } = await db.from("vihem_agreement_attachments").select("id, agreement_id, storage_path").eq("id", attachmentId).maybeSingle();
        if (!attachment) return errorJson("NOT_FOUND", "Bilagan hittades inte.", 404);
        const agreement = await assertAgreementInOrg(attachment.agreement_id, ["draft", "ready"]);
        if (agreement instanceof Response) return agreement;
        const { error } = await db.from("vihem_agreement_attachments").delete().eq("id", attachmentId);
        if (error) return errorJson("INTERNAL_ERROR", error.message, 500);
        await db.storage.from("vihem-agreements").remove([attachment.storage_path]);
        return json({ data: { ok: true } });
      }

      // ---- Entity links -----------------------------------------------------
      case "save_entity_links": {
        const agreementId = String(body?.agreement_id || "");
        const agreement = await assertAgreementInOrg(agreementId);
        if (agreement instanceof Response) return agreement;
        const links = Array.isArray(body?.links) ? body.links : [];

        const { error: delErr } = await db.from("vihem_agreement_entity_links").delete().eq("agreement_id", agreementId);
        if (delErr) return errorJson("INTERNAL_ERROR", delErr.message, 500);
        if (links.length > 0) {
          const { error: insErr } = await db.from("vihem_agreement_entity_links").insert(
            links.map((l: any) => ({
              agreement_id: agreementId,
              entity_type: String(l.entity_type || ""),
              entity_id: l.entity_id,
              label: String(l.label || ""),
              created_by: auth.callerId,
            })),
          );
          if (insErr) return errorJson("INTERNAL_ERROR", insErr.message, 500);
        }
        return json({ data: { ok: true } });
      }

      case "list_entity_agreements": {
        // Reverse lookup for the apartment/tenant page integration: "show
        // agreements linked to this entity".
        const entityType = String(body?.entity_type || "");
        const entityId = String(body?.entity_id || "");
        if (!entityType || !entityId) return errorJson("VALIDATION_ERROR", "entity_type och entity_id krävs.", 400);
        const { data: links, error } = await db
          .from("vihem_agreement_entity_links")
          .select("agreement_id")
          .eq("entity_type", entityType)
          .eq("entity_id", entityId);
        if (error) return errorJson("INTERNAL_ERROR", error.message, 500);
        const ids = (links || []).map((l: any) => l.agreement_id);
        if (ids.length === 0) return json({ data: [] });
        let query = db
          .from("vihem_agreements")
          .select("id, document_number, document_type, title, status, created_at")
          .in("id", ids);
        query = isSuperadmin ? query : query.eq("organisation_id", callerOrgId);
        const { data, error: agErr } = await query.order("created_at", { ascending: false });
        if (agErr) return errorJson("INTERNAL_ERROR", agErr.message, 500);
        return json({ data });
      }

      // ---- Templates ------------------------------------------------------
      case "list_templates": {
        let query = db
          .from("vihem_agreement_templates")
          .select("id, name, description, document_type, category, status, updated_at")
          .order("name");
        query = isSuperadmin && body?.organisation_id ? query.eq("organisation_id", body.organisation_id) : query.eq("organisation_id", callerOrgId);
        if (body?.status) query = query.eq("status", body.status);
        const { data, error } = await query;
        if (error) return errorJson("INTERNAL_ERROR", error.message, 500);
        return json({ data });
      }

      case "get_template": {
        const templateId = String(body?.id || "");
        const { data: template, error } = await db.from("vihem_agreement_templates").select("*").eq("id", templateId).maybeSingle();
        if (error || !template) return errorJson("NOT_FOUND", "Mallen hittades inte.", 404);
        if (!isSuperadmin && template.organisation_id !== callerOrgId) return errorJson("FORBIDDEN", "Du saknar behörighet för denna mall.", 403);
        const { data: blocks } = await db.from("vihem_agreement_template_blocks").select("*").eq("template_id", templateId).order("position");
        return json({ data: { template, blocks } });
      }

      case "create_template": {
        const organisationId = orgId();
        const { data, error } = await db
          .from("vihem_agreement_templates")
          .insert({
            organisation_id: organisationId,
            name: String(body?.name || "Ny mall"),
            description: String(body?.description || ""),
            document_type: ["agreement", "offer", "other"].includes(body?.document_type) ? body.document_type : "agreement",
            category: String(body?.category || ""),
            created_by: auth.callerId,
            updated_by: auth.callerId,
          })
          .select("*")
          .single();
        if (error) return errorJson("INTERNAL_ERROR", error.message, 500);
        return json({ data });
      }

      case "update_template": {
        const templateId = String(body?.id || "");
        const { data: existing } = await db.from("vihem_agreement_templates").select("organisation_id").eq("id", templateId).maybeSingle();
        if (!existing) return errorJson("NOT_FOUND", "Mallen hittades inte.", 404);
        if (!isSuperadmin && existing.organisation_id !== callerOrgId) return errorJson("FORBIDDEN", "Du saknar behörighet.", 403);
        const patch: Record<string, unknown> = { updated_by: auth.callerId };
        for (const field of ["name", "description", "category", "status"] as const) {
          if (body?.[field] !== undefined) patch[field] = body[field];
        }
        const { data, error } = await db.from("vihem_agreement_templates").update(patch).eq("id", templateId).select("*").single();
        if (error) return errorJson("INTERNAL_ERROR", error.message, 500);
        return json({ data });
      }

      case "save_template_blocks": {
        const templateId = String(body?.template_id || "");
        const { data: existing } = await db.from("vihem_agreement_templates").select("organisation_id").eq("id", templateId).maybeSingle();
        if (!existing) return errorJson("NOT_FOUND", "Mallen hittades inte.", 404);
        if (!isSuperadmin && existing.organisation_id !== callerOrgId) return errorJson("FORBIDDEN", "Du saknar behörighet.", 403);
        const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
        const { error: delErr } = await db.from("vihem_agreement_template_blocks").delete().eq("template_id", templateId);
        if (delErr) return errorJson("INTERNAL_ERROR", delErr.message, 500);
        if (blocks.length > 0) {
          const { error: insErr } = await db.from("vihem_agreement_template_blocks").insert(
            blocks.map((b: any, i: number) => ({ template_id: templateId, position: i, block_type: String(b.block_type || ""), content: b.content || {} })),
          );
          if (insErr) return errorJson("INTERNAL_ERROR", insErr.message, 500);
        }
        return json({ data: { ok: true, count: blocks.length } });
      }

      case "duplicate_template": {
        if (!ADMIN_ROLES.includes(role)) return errorJson("FORBIDDEN", "Endast admin kan duplicera mallar.", 403);
        const templateId = String(body?.id || "");
        const { data: original } = await db.from("vihem_agreement_templates").select("*").eq("id", templateId).maybeSingle();
        if (!original) return errorJson("NOT_FOUND", "Mallen hittades inte.", 404);
        if (!isSuperadmin && original.organisation_id !== callerOrgId) return errorJson("FORBIDDEN", "Du saknar behörighet.", 403);
        const { data: copy, error } = await db
          .from("vihem_agreement_templates")
          .insert({
            organisation_id: original.organisation_id,
            name: `${original.name} (kopia)`,
            description: original.description,
            document_type: original.document_type,
            category: original.category,
            created_by: auth.callerId,
            updated_by: auth.callerId,
          })
          .select("*")
          .single();
        if (error) return errorJson("INTERNAL_ERROR", error.message, 500);
        const { data: originalBlocks } = await db.from("vihem_agreement_template_blocks").select("position, block_type, content").eq("template_id", templateId).order("position");
        if (originalBlocks?.length) {
          await db.from("vihem_agreement_template_blocks").insert(originalBlocks.map((b: any) => ({ template_id: copy.id, ...b })));
        }
        return json({ data: copy });
      }

      default:
        return errorJson("VALIDATION_ERROR", `Okänd action: ${action}`, 400);
    }
  } catch (err) {
    console.error("vihem-agreements-admin", err);
    return errorJson("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), 500);
  }
});

function escapeIlike(value: string): string {
  return value.replace(/[%_]/g, (c) => `\\${c}`);
}

async function writeAudit(
  db: any,
  agreementId: string,
  signerId: string | null,
  eventType: string,
  actorType: "staff" | "signer" | "system",
  actorId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await db.from("vihem_agreement_audit_events").insert({
    agreement_id: agreementId,
    signer_id: signerId,
    event_type: eventType,
    actor_type: actorType,
    actor_id: actorId,
    metadata,
  });
}
