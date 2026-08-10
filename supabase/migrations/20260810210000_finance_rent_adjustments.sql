/*
  # VI-HEM rent adjustments

  Adds one-off rent adjustments per tenancy and rent period. Adjustments are
  applied automatically when rent billing items are created, regardless of
  whether the run is created manually or by finance cron.
*/

ALTER TABLE public.vihem_rent_billing_items
  ADD COLUMN IF NOT EXISTS base_rent_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment_amount numeric(14,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.vihem_rent_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE RESTRICT,
  tenancy_id uuid NOT NULL REFERENCES public.vihem_tenancies(id) ON DELETE CASCADE,
  rent_period date NOT NULL,
  description text NOT NULL DEFAULT '',
  amount numeric(14,2) NOT NULL DEFAULT 0,
  vat_rate numeric(6,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'applied')),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_rent_adjustments_org_period_idx
  ON public.vihem_rent_adjustments (organisation_id, rent_period DESC);
CREATE INDEX IF NOT EXISTS vihem_rent_adjustments_tenancy_period_idx
  ON public.vihem_rent_adjustments (tenancy_id, rent_period, status);

ALTER TABLE public.vihem_rent_adjustments ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.vihem_rent_adjustments;
CREATE TRIGGER vihem_touch_updated_at_trigger
  BEFORE UPDATE ON public.vihem_rent_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

DROP TRIGGER IF EXISTS vihem_finance_audit_trigger ON public.vihem_rent_adjustments;
CREATE TRIGGER vihem_finance_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.vihem_rent_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.vihem_finance_audit_trigger();

DROP POLICY IF EXISTS "VIHEM finance rent adjustments read" ON public.vihem_rent_adjustments;
CREATE POLICY "VIHEM finance rent adjustments read"
  ON public.vihem_rent_adjustments FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'viewer')
    )
  );

DROP POLICY IF EXISTS "VIHEM finance rent adjustments insert" ON public.vihem_rent_adjustments;
CREATE POLICY "VIHEM finance rent adjustments insert"
  ON public.vihem_rent_adjustments FOR INSERT TO authenticated
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'seller')
    )
  );

DROP POLICY IF EXISTS "VIHEM finance rent adjustments update" ON public.vihem_rent_adjustments;
CREATE POLICY "VIHEM finance rent adjustments update"
  ON public.vihem_rent_adjustments FOR UPDATE TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'seller')
    )
  )
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'seller')
    )
  );

CREATE OR REPLACE FUNCTION public.vihem_apply_rent_adjustments_to_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  adjustment_total numeric(14,2) := 0;
  adjustment_labels text := '';
  base_amount numeric(14,2) := 0;
BEGIN
  IF NEW.tenancy_id IS NULL OR NEW.rent_period IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(SUM(amount), 0),
    COALESCE(string_agg(description, ', ' ORDER BY created_at), '')
  INTO adjustment_total, adjustment_labels
  FROM public.vihem_rent_adjustments
  WHERE tenancy_id = NEW.tenancy_id
    AND rent_period = date_trunc('month', NEW.rent_period)::date
    AND status = 'active';

  base_amount := COALESCE(NULLIF(NEW.base_rent_amount, 0), NEW.amount, 0);

  NEW.base_rent_amount := base_amount;
  NEW.adjustment_amount := adjustment_total;
  NEW.amount := base_amount + adjustment_total;
  NEW.vat_amount := ROUND((base_amount + adjustment_total) * COALESCE(NEW.vat_rate, 0) / 100, 2);
  NEW.total_amount := NEW.amount + NEW.vat_amount;

  IF adjustment_total <> 0 AND adjustment_labels <> '' THEN
    NEW.description := NEW.description || ' inkl. justering: ' || adjustment_labels;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vihem_apply_rent_adjustments_to_item_trigger ON public.vihem_rent_billing_items;
CREATE TRIGGER vihem_apply_rent_adjustments_to_item_trigger
  BEFORE INSERT ON public.vihem_rent_billing_items
  FOR EACH ROW EXECUTE FUNCTION public.vihem_apply_rent_adjustments_to_item();

CREATE OR REPLACE FUNCTION public.vihem_refresh_rent_items_for_adjustment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_tenancy_id uuid;
  affected_period date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_tenancy_id := OLD.tenancy_id;
    affected_period := date_trunc('month', OLD.rent_period)::date;
  ELSE
    affected_tenancy_id := NEW.tenancy_id;
    affected_period := date_trunc('month', NEW.rent_period)::date;
  END IF;

  WITH adjustment_totals AS (
    SELECT
      COALESCE(SUM(amount), 0) AS total_adjustment,
      COALESCE(string_agg(description, ', ' ORDER BY created_at), '') AS labels
    FROM public.vihem_rent_adjustments
    WHERE tenancy_id = affected_tenancy_id
      AND rent_period = affected_period
      AND status = 'active'
  )
  UPDATE public.vihem_rent_billing_items item
  SET
    base_rent_amount = COALESCE(NULLIF(item.base_rent_amount, 0), item.amount, 0),
    adjustment_amount = adjustment_totals.total_adjustment,
    amount = COALESCE(NULLIF(item.base_rent_amount, 0), item.amount, 0) + adjustment_totals.total_adjustment,
    vat_amount = ROUND((COALESCE(NULLIF(item.base_rent_amount, 0), item.amount, 0) + adjustment_totals.total_adjustment) * COALESCE(item.vat_rate, 0) / 100, 2),
    total_amount = (COALESCE(NULLIF(item.base_rent_amount, 0), item.amount, 0) + adjustment_totals.total_adjustment)
      + ROUND((COALESCE(NULLIF(item.base_rent_amount, 0), item.amount, 0) + adjustment_totals.total_adjustment) * COALESCE(item.vat_rate, 0) / 100, 2),
    updated_at = now()
  FROM adjustment_totals
  WHERE item.tenancy_id = affected_tenancy_id
    AND item.rent_period = affected_period
    AND item.status = 'draft'
    AND item.invoice_id IS NULL;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vihem_refresh_rent_items_for_adjustment_trigger ON public.vihem_rent_adjustments;
CREATE TRIGGER vihem_refresh_rent_items_for_adjustment_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.vihem_rent_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.vihem_refresh_rent_items_for_adjustment();

NOTIFY pgrst, 'reload schema';
