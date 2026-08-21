/*
  # Billing adjustments (avdrag & tillägg)

  A general-purpose "one-off or recurring amount that should be folded into
  a future invoice" module. Not rent-specific: target_type/target_id follows
  the same source-vocabulary pattern as vihem_accounted_invoice_links, so a
  future billing source can reuse this table without a new one.

  This stage wires it into rent billing only (vihem-accounted-rent-billing).
  It does not touch or replace the existing vihem_rent_adjustments table --
  that table's own trigger-based mechanism keeps folding into
  vihem_rent_billing_items.amount at billing-run generation time, before any
  Accounted call happens, and legacy rent invoicing (vihem_generate_rent_
  invoices) still reads that. This module is deliberately separate because
  its consumption timing is different by design: an adjustment here is only
  ever marked consumed AFTER Accounted has confirmed the invoice, never at
  billing-run generation. The two systems can coexist without double-billing
  because they are different rows entirely; an org's rent V2 invoices may
  carry line items from both if both are used for the same tenancy/period,
  which is a real (if unlikely) source of confusion documented in
  docs/accounted-v2-integration.md rather than silently prevented.

  Amount sign convention (chosen once, used everywhere): positive = tillägg
  (addition), negative = avdrag (deduction). No separate kind/direction
  column -- the sign IS the model.
*/

CREATE TABLE IF NOT EXISTS public.vihem_billing_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE RESTRICT,
  target_type text NOT NULL
    CHECK (target_type IN ('tenancy', 'customer_project', 'finance_customer')),
  target_id uuid NOT NULL,
  adjustment_type text NOT NULL DEFAULT 'one_time'
    CHECK (adjustment_type IN ('one_time', 'recurring')),
  -- Sign is the model: positive = tillägg, negative = avdrag. Zero is
  -- meaningless (would be a no-op line item) so it's rejected outright.
  amount numeric(14,2) NOT NULL CHECK (amount <> 0),
  vat_rate numeric(6,2) NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled', 'completed')),
  -- Earliest billing period this may apply to. For one_time this is a
  -- floor ("apply to the target's next invoice on or after this date"),
  -- not a fixed period -- it fires on whichever billing attempt for the
  -- target happens next, matching "avdrag på nästa hyra" rather than a
  -- specific calendar month.
  start_period date NOT NULL DEFAULT CURRENT_DATE,
  -- Recurring only: last eligible period (inclusive), null = no fixed end.
  end_period date,
  -- Recurring only: cap on total applications ("X faktureringstillfällen").
  -- One-time adjustments are created with max_occurrences = 1 by the API
  -- layer, so the eligibility query below is identical for both types.
  max_occurrences integer CHECK (max_occurrences IS NULL OR max_occurrences > 0),
  applied_count integer NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
  last_applied_period date,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- one_time rows must not carry a recurring-only end_period. max_occurrences
-- for one_time is enforced by the API layer (always set to 1), not by a DB
-- constraint, since a CHECK can't express "must be 1, but only once the
-- caller has defaulted it" without duplicating that policy in SQL too.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.vihem_billing_adjustments'::regclass
      AND conname = 'vihem_billing_adjustments_one_time_no_end_period'
  ) THEN
    ALTER TABLE public.vihem_billing_adjustments
      ADD CONSTRAINT vihem_billing_adjustments_one_time_no_end_period
      CHECK (adjustment_type = 'recurring' OR end_period IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS vihem_billing_adjustments_target_idx
  ON public.vihem_billing_adjustments (company_id, target_type, target_id, status);
CREATE INDEX IF NOT EXISTS vihem_billing_adjustments_org_idx
  ON public.vihem_billing_adjustments (organisation_id);

-- ---------------------------------------------------------------------------
-- Consumption trail. A row here is only ever inserted AFTER Accounted has
-- confirmed the invoice -- there is no "pending" state in this table by
-- design, so "does this row exist" IS the answer to "was this adjustment
-- actually consumed". If the Accounted call fails, nothing is written here
-- and the adjustment in vihem_billing_adjustments is untouched.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vihem_billing_adjustment_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id uuid NOT NULL REFERENCES public.vihem_billing_adjustments(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  billing_period date,
  source_type text NOT NULL
    CHECK (source_type IN ('rental_billing', 'customer_project', 'manual_charge')),
  source_id uuid NOT NULL,
  accounted_invoice_link_id uuid NOT NULL REFERENCES public.vihem_accounted_invoice_links(id) ON DELETE RESTRICT,
  -- Snapshot of the amount actually applied: if the adjustment is edited
  -- later, history still shows what was really on that invoice.
  amount numeric(14,2) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Best-effort guard against applying the same recurring adjustment twice for
-- the same period. Primary defense is the eligibility check in application
-- code (last_applied_period / applied_count read-then-write); this is a
-- backstop, not a substitute -- see accounted-v2-integration.md for the
-- known race-condition limitation (no row lock across the Accounted call).
CREATE UNIQUE INDEX IF NOT EXISTS vihem_billing_adjustment_applications_period_unique
  ON public.vihem_billing_adjustment_applications (adjustment_id, billing_period)
  WHERE billing_period IS NOT NULL;

CREATE INDEX IF NOT EXISTS vihem_billing_adjustment_applications_adjustment_idx
  ON public.vihem_billing_adjustment_applications (adjustment_id);
CREATE INDEX IF NOT EXISTS vihem_billing_adjustment_applications_invoice_link_idx
  ON public.vihem_billing_adjustment_applications (accounted_invoice_link_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger + audit trigger, same shared functions every other
-- finance table uses.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.vihem_billing_adjustments;
CREATE TRIGGER vihem_touch_updated_at_trigger
  BEFORE UPDATE ON public.vihem_billing_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

DROP TRIGGER IF EXISTS vihem_finance_audit_trigger ON public.vihem_billing_adjustments;
CREATE TRIGGER vihem_finance_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.vihem_billing_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.vihem_finance_audit_trigger();

-- ---------------------------------------------------------------------------
-- RLS.
--
-- vihem_billing_adjustments: read at company-viewer level. ALL writes go
-- through the vihem-billing-adjustments Edge Function (service role), not
-- direct client writes -- the fields that must only ever be service-role-
-- written (applied_count, last_applied_period, status='completed') live on
-- the same row as the fields a normal admin/seller edits (description,
-- amount, dates, status='paused'/'cancelled'), and Postgres RLS can't
-- restrict individual columns without GRANT/REVOKE column privileges (no
-- precedent for that elsewhere in this schema), so the simplest correct
-- boundary is: no client writes at all, same pattern as the invoice/
-- customer link tables.
--
-- vihem_billing_adjustment_applications: read-only for clients (history/
-- audit view), service-role writes only -- same reasoning as the invoice
-- links: a row here is a claim "Accounted confirmed this", which must never
-- be something a client can fabricate.
-- ---------------------------------------------------------------------------

ALTER TABLE public.vihem_billing_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_billing_adjustment_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM billing adjustments read" ON public.vihem_billing_adjustments;
CREATE POLICY "VIHEM billing adjustments read"
  ON public.vihem_billing_adjustments FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, 'viewer'))
  );

DROP POLICY IF EXISTS "VIHEM billing adjustments no client insert" ON public.vihem_billing_adjustments;
CREATE POLICY "VIHEM billing adjustments no client insert"
  ON public.vihem_billing_adjustments FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "VIHEM billing adjustments no client update" ON public.vihem_billing_adjustments;
CREATE POLICY "VIHEM billing adjustments no client update"
  ON public.vihem_billing_adjustments FOR UPDATE TO authenticated USING (false);
DROP POLICY IF EXISTS "VIHEM billing adjustments no client delete" ON public.vihem_billing_adjustments;
CREATE POLICY "VIHEM billing adjustments no client delete"
  ON public.vihem_billing_adjustments FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS "VIHEM billing adjustment applications read" ON public.vihem_billing_adjustment_applications;
CREATE POLICY "VIHEM billing adjustment applications read"
  ON public.vihem_billing_adjustment_applications FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND EXISTS (
        SELECT 1 FROM public.vihem_billing_adjustments a
        WHERE a.id = vihem_billing_adjustment_applications.adjustment_id
          AND public.vihem_user_has_company_access(a.company_id, 'viewer')
      )
    )
  );

DROP POLICY IF EXISTS "VIHEM billing adjustment applications no client writes" ON public.vihem_billing_adjustment_applications;
CREATE POLICY "VIHEM billing adjustment applications no client writes"
  ON public.vihem_billing_adjustment_applications FOR ALL TO authenticated USING (false) WITH CHECK (false);
