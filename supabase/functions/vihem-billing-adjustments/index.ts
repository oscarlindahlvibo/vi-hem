// CRUD for avdrag & tillägg (billing adjustments). All writes go through
// here rather than direct table access: vihem_billing_adjustments' RLS
// blocks client writes entirely (see 20260821150000_billing_adjustments.sql
// for why -- applied_count/last_applied_period/status='completed' must only
// ever be written by the consuming billing function, never a client, and
// Postgres RLS can't split that at the column level). This function is the
// single place "create/edit/cancel an adjustment" business logic lives, so
// no React component reimplements it.
//
// This function never talks to Accounted and never marks anything consumed
// -- that only happens inside a billing function (e.g.
// vihem-accounted-rent-billing) via _shared/billing-adjustments.ts, after
// Accounted has confirmed an invoice.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, type AuthContext, corsHeaders, errorJson, isAuthContext, json, requireCompanyAccess } from "../_shared/vihem-auth.ts";
import { BILLING_ADJUSTMENT_TARGET_TYPES, type BillingAdjustmentTargetType } from "../_shared/billing-adjustments.ts";

const EDITABLE_STATUSES = new Set(["active", "paused"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return errorJson("METHOD_NOT_ALLOWED", "Endast POST stöds.", 405);

  const auth = await authenticate(req);
  if (!isAuthContext(auth)) return auth;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorJson("VALIDATION_ERROR", "Ogiltig JSON.", 400);
  }

  const action = String(body?.action || "create");
  const companyId = String(body?.company_id || "");
  if (!companyId) return errorJson("VALIDATION_ERROR", "company_id krävs.", 400);

  const accessError = await requireCompanyAccess(auth, companyId, "seller");
  if (accessError) return accessError;

  const { data: company, error: companyErr } = await auth.adminClient
    .from("vihem_companies")
    .select("id, organisation_id")
    .eq("id", companyId)
    .maybeSingle();
  if (companyErr || !company) return errorJson("NOT_FOUND", "Bolaget hittades inte.", 404);

  if (action === "create") return handleCreate(auth, company, body);
  if (action === "update") return handleUpdate(auth, company, body);
  return errorJson("VALIDATION_ERROR", `Okänd action: ${action}`, 400);
});

async function handleCreate(auth: AuthContext, company: { id: string; organisation_id: string }, body: any) {
  const targetType = String(body?.target_type || "");
  const targetId = String(body?.target_id || "");
  const adjustmentType = body?.adjustment_type === "recurring" ? "recurring" : "one_time";
  const amount = Number(body?.amount);
  const vatRate = Number(body?.vat_rate ?? 0);
  const description = String(body?.description || "").trim();
  const startPeriod = String(body?.start_period || new Date().toISOString().slice(0, 10));

  if (!BILLING_ADJUSTMENT_TARGET_TYPES.includes(targetType as BillingAdjustmentTargetType)) {
    return errorJson("VALIDATION_ERROR", `target_type måste vara en av: ${BILLING_ADJUSTMENT_TARGET_TYPES.join(", ")}`, 400);
  }
  if (!targetId) return errorJson("VALIDATION_ERROR", "target_id krävs.", 400);
  if (!Number.isFinite(amount) || amount === 0) {
    return errorJson("VALIDATION_ERROR", "amount krävs och måste vara skilt från 0 (positivt = tillägg, negativt = avdrag).", 400);
  }

  const row: Record<string, unknown> = {
    organisation_id: company.organisation_id,
    company_id: company.id,
    target_type: targetType,
    target_id: targetId,
    adjustment_type: adjustmentType,
    amount,
    vat_rate: vatRate,
    description,
    start_period: startPeriod,
    created_by: auth.callerId,
  };

  if (adjustmentType === "recurring") {
    const endPeriod = body?.end_period ? String(body.end_period) : null;
    const maxOccurrences = body?.max_occurrences ? Number(body.max_occurrences) : null;
    if (maxOccurrences !== null && (!Number.isInteger(maxOccurrences) || maxOccurrences < 1)) {
      return errorJson("VALIDATION_ERROR", "max_occurrences måste vara ett positivt heltal.", 400);
    }
    row.end_period = endPeriod;
    row.max_occurrences = maxOccurrences;
  } else {
    // One-time adjustments apply exactly once, to whichever billing attempt
    // for the target happens next on or after start_period -- enforced here
    // (not by a DB default) so the eligibility query in
    // _shared/billing-adjustments.ts can treat both types identically.
    row.end_period = null;
    row.max_occurrences = 1;
  }

  const { data: inserted, error: insertErr } = await auth.adminClient
    .from("vihem_billing_adjustments")
    .insert(row)
    .select("*")
    .single();
  if (insertErr) return errorJson("INTERNAL_ERROR", "Kunde inte skapa avdraget/tillägget.", 500, { details: insertErr.message });

  return json({ data: inserted }, 201);
}

async function handleUpdate(auth: AuthContext, company: { id: string; organisation_id: string }, body: any) {
  const id = String(body?.id || "");
  if (!id) return errorJson("VALIDATION_ERROR", "id krävs.", 400);

  const { data: existing, error: existingErr } = await auth.adminClient
    .from("vihem_billing_adjustments")
    .select("*")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (existingErr || !existing) return errorJson("NOT_FOUND", "Avdraget/tillägget hittades inte.", 404);

  const requestedStatus = typeof body?.status === "string" ? body.status : undefined;

  // Field edits (amount/description/dates/etc.) are only allowed while the
  // adjustment hasn't been consumed or cancelled -- editing something
  // that's already on a confirmed Accounted invoice would make the
  // application-table snapshot the only correct record, which is exactly
  // the historical-integrity property that snapshot exists to protect.
  const wantsFieldEdit = ["amount", "vat_rate", "description", "start_period", "end_period", "max_occurrences"]
    .some((key) => body?.[key] !== undefined);
  if (wantsFieldEdit && !EDITABLE_STATUSES.has(existing.status)) {
    return errorJson(
      "ADJUSTMENT_NOT_EDITABLE",
      `Kan inte redigera ett avdrag/tillägg med status "${existing.status}".`,
      400,
    );
  }

  const update: Record<string, unknown> = {};
  if (body?.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      return errorJson("VALIDATION_ERROR", "amount måste vara skilt från 0.", 400);
    }
    update.amount = amount;
  }
  if (body?.vat_rate !== undefined) update.vat_rate = Number(body.vat_rate);
  if (body?.description !== undefined) update.description = String(body.description).trim();
  if (body?.start_period !== undefined) update.start_period = String(body.start_period);
  if (existing.adjustment_type === "recurring") {
    if (body?.end_period !== undefined) update.end_period = body.end_period ? String(body.end_period) : null;
    if (body?.max_occurrences !== undefined) {
      const maxOccurrences = body.max_occurrences ? Number(body.max_occurrences) : null;
      if (maxOccurrences !== null && (!Number.isInteger(maxOccurrences) || maxOccurrences < existing.applied_count)) {
        return errorJson(
          "VALIDATION_ERROR",
          `max_occurrences kan inte vara lägre än antal redan använda tillfällen (${existing.applied_count}).`,
          400,
        );
      }
      update.max_occurrences = maxOccurrences;
    }
  }

  if (requestedStatus !== undefined) {
    if (!["active", "paused", "cancelled"].includes(requestedStatus)) {
      return errorJson("VALIDATION_ERROR", "status kan bara sättas till active, paused eller cancelled härifrån.", 400);
    }
    if (existing.status === "completed") {
      return errorJson("ADJUSTMENT_NOT_EDITABLE", "Ett förbrukat avdrag/tillägg kan inte ändra status.", 400);
    }
    update.status = requestedStatus;
  }

  if (Object.keys(update).length === 0) {
    return errorJson("VALIDATION_ERROR", "Inga fält att uppdatera angavs.", 400);
  }

  const { data: updated, error: updateErr } = await auth.adminClient
    .from("vihem_billing_adjustments")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (updateErr) return errorJson("INTERNAL_ERROR", "Kunde inte uppdatera avdraget/tillägget.", 500, { details: updateErr.message });

  return json({ data: updated });
}
