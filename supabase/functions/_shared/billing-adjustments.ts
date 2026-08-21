// Shared "avdrag & tillägg" (billing adjustments) service. Centralises the
// logic every billing source (rent today, others later) needs: find what's
// eligible to apply to a target's next invoice, turn that into Accounted
// invoice line items, and record consumption -- but ONLY after Accounted has
// actually confirmed the invoice. Nothing here writes a "pending/consumed"
// state before that confirmation: see the module header in
// 20260821150000_billing_adjustments.sql for why.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { AccountedInvoiceItemInput } from "./accounted-invoice-creator.ts";

export const BILLING_ADJUSTMENT_TARGET_TYPES = ["tenancy", "customer_project", "finance_customer"] as const;
export type BillingAdjustmentTargetType = (typeof BILLING_ADJUSTMENT_TARGET_TYPES)[number];

export interface BillingAdjustmentRow {
  id: string;
  organisation_id: string;
  company_id: string;
  target_type: BillingAdjustmentTargetType;
  target_id: string;
  adjustment_type: "one_time" | "recurring";
  amount: number;
  vat_rate: number;
  description: string;
  status: "active" | "paused" | "cancelled" | "completed";
  start_period: string;
  end_period: string | null;
  max_occurrences: number | null;
  applied_count: number;
  last_applied_period: string | null;
}

/**
 * Adjustments eligible to apply to the target's NEXT invoice attempt for the
 * given period. Read-only: callers decide what to do with the result and
 * must call recordAdjustmentApplications only after Accounted confirms.
 */
export async function listEligibleAdjustments(
  adminClient: SupabaseClient,
  params: { companyId: string; targetType: BillingAdjustmentTargetType; targetId: string; period: string },
): Promise<BillingAdjustmentRow[]> {
  const { data, error } = await adminClient
    .from("vihem_billing_adjustments")
    .select("*")
    .eq("company_id", params.companyId)
    .eq("target_type", params.targetType)
    .eq("target_id", params.targetId)
    .eq("status", "active")
    .lte("start_period", params.period)
    .or(`end_period.is.null,end_period.gte.${params.period}`)
    .or(`last_applied_period.is.null,last_applied_period.neq.${params.period}`);
  if (error) throw new Error(`Kunde inte läsa avdrag/tillägg: ${error.message}`);

  const rows = (data ?? []) as BillingAdjustmentRow[];
  // max_occurrences comparison needs applied_count from the same row, which
  // PostgREST .or()/.lte() chaining can't express cleanly alongside the
  // other OR groups above -- filtered in JS instead of a third .or() clause.
  return rows.filter((r) => r.max_occurrences === null || r.applied_count < r.max_occurrences);
}

export function buildAdjustmentLineItems(adjustments: BillingAdjustmentRow[]): AccountedInvoiceItemInput[] {
  return adjustments.map((adj) => ({
    description: adj.description || (adj.amount >= 0 ? "Tillägg" : "Avdrag"),
    quantity: 1,
    unit: "st",
    unit_price: adj.amount,
    vat_rate: adj.vat_rate,
  }));
}

/**
 * Records that Accounted has confirmed an invoice carrying these
 * adjustments: inserts one application row per adjustment (the durable
 * "this was consumed" fact), and updates each adjustment's applied_count /
 * last_applied_period / status. Call this ONLY after
 * createAccountedInvoiceForSource has returned a real (non-dry-run,
 * non-already-invoiced) result -- never before the Accounted call, and never
 * if it threw.
 *
 * Best-effort per adjustment: one adjustment failing to record does not
 * roll back the others or the invoice itself (which already exists in
 * Accounted and cannot be un-created here) -- failures are returned so the
 * caller can surface them, matching the partial-success pattern used
 * elsewhere in this integration.
 */
export async function recordAdjustmentApplications(
  adminClient: SupabaseClient,
  params: {
    organisationId: string;
    adjustments: BillingAdjustmentRow[];
    billingPeriod: string | null;
    sourceType: "rental_billing" | "customer_project" | "manual_charge";
    sourceId: string;
    accountedInvoiceLinkId: string;
  },
): Promise<{ adjustmentId: string; ok: boolean; error?: string }[]> {
  const results: { adjustmentId: string; ok: boolean; error?: string }[] = [];

  for (const adjustment of params.adjustments) {
    const { error: applicationErr } = await adminClient.from("vihem_billing_adjustment_applications").insert({
      adjustment_id: adjustment.id,
      organisation_id: params.organisationId,
      billing_period: params.billingPeriod,
      source_type: params.sourceType,
      source_id: params.sourceId,
      accounted_invoice_link_id: params.accountedInvoiceLinkId,
      amount: adjustment.amount,
    });
    if (applicationErr) {
      results.push({ adjustmentId: adjustment.id, ok: false, error: applicationErr.message });
      continue;
    }

    const nextAppliedCount = adjustment.applied_count + 1;
    const exhausted = adjustment.adjustment_type === "one_time"
      || (adjustment.max_occurrences !== null && nextAppliedCount >= adjustment.max_occurrences)
      || (adjustment.end_period !== null && params.billingPeriod !== null && params.billingPeriod >= adjustment.end_period);

    const { error: updateErr } = await adminClient
      .from("vihem_billing_adjustments")
      .update({
        applied_count: nextAppliedCount,
        last_applied_period: params.billingPeriod,
        status: exhausted ? "completed" : adjustment.status,
      })
      .eq("id", adjustment.id);
    if (updateErr) {
      // The application row (the actual "was this consumed" fact) is
      // already durably recorded above; a failure here only means the
      // adjustment's own counters are stale, which a manual correction or
      // the next listEligibleAdjustments call (still respecting the
      // recorded application row's unique-period index) can catch.
      results.push({ adjustmentId: adjustment.id, ok: false, error: updateErr.message });
      continue;
    }

    results.push({ adjustmentId: adjustment.id, ok: true });
  }

  return results;
}
