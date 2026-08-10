ALTER TABLE public.vihem_rent_adjustments
  ADD COLUMN IF NOT EXISTS adjustment_type text NOT NULL DEFAULT 'one_time',
  ADD COLUMN IF NOT EXISTS start_period date,
  ADD COLUMN IF NOT EXISTS end_period date,
  ADD COLUMN IF NOT EXISTS percentage_rate numeric(8,4) NOT NULL DEFAULT 0;

ALTER TABLE public.vihem_rent_adjustments
  DROP CONSTRAINT IF EXISTS vihem_rent_adjustments_adjustment_type_check,
  ADD CONSTRAINT vihem_rent_adjustments_adjustment_type_check
  CHECK (adjustment_type IN ('one_time', 'recurring', 'indexed'));

UPDATE public.vihem_rent_adjustments
SET start_period = COALESCE(start_period, rent_period),
    end_period = CASE WHEN adjustment_type = 'one_time' THEN COALESCE(end_period, rent_period) ELSE end_period END
WHERE start_period IS NULL
   OR (adjustment_type = 'one_time' AND end_period IS NULL);

CREATE INDEX IF NOT EXISTS vihem_rent_adjustments_active_period_idx
  ON public.vihem_rent_adjustments (tenancy_id, adjustment_type, start_period, end_period, status);

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
  item_period date;
BEGIN
  IF NEW.tenancy_id IS NULL OR NEW.rent_period IS NULL THEN
    RETURN NEW;
  END IF;

  item_period := date_trunc('month', NEW.rent_period)::date;
  base_amount := COALESCE(NULLIF(NEW.base_rent_amount, 0), NEW.amount, 0);

  SELECT
    COALESCE(SUM(
      amount + CASE
        WHEN adjustment_type = 'indexed' AND COALESCE(percentage_rate, 0) <> 0 THEN ROUND(base_amount * percentage_rate / 100, 2)
        ELSE 0
      END
    ), 0),
    COALESCE(string_agg(description, ', ' ORDER BY created_at), '')
  INTO adjustment_total, adjustment_labels
  FROM public.vihem_rent_adjustments
  WHERE tenancy_id = NEW.tenancy_id
    AND status = 'active'
    AND (
      (adjustment_type = 'one_time' AND rent_period = item_period)
      OR (
        adjustment_type IN ('recurring', 'indexed')
        AND COALESCE(start_period, rent_period) <= item_period
        AND (end_period IS NULL OR end_period >= item_period)
      )
    );

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

CREATE OR REPLACE FUNCTION public.vihem_refresh_rent_items_for_adjustment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_tenancy_id uuid;
  affected_start_period date;
  affected_end_period date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_tenancy_id := OLD.tenancy_id;
    affected_start_period := date_trunc('month', COALESCE(OLD.start_period, OLD.rent_period))::date;
    affected_end_period := OLD.end_period;
  ELSE
    affected_tenancy_id := NEW.tenancy_id;
    affected_start_period := date_trunc('month', COALESCE(NEW.start_period, NEW.rent_period))::date;
    affected_end_period := NEW.end_period;
  END IF;

  WITH item_periods AS (
    SELECT
      item.id,
      date_trunc('month', item.rent_period)::date AS item_period,
      COALESCE(NULLIF(item.base_rent_amount, 0), item.amount, 0) AS base_amount
    FROM public.vihem_rent_billing_items item
    WHERE item.tenancy_id = affected_tenancy_id
      AND item.status = 'draft'
      AND item.invoice_id IS NULL
      AND date_trunc('month', item.rent_period)::date >= affected_start_period
      AND (affected_end_period IS NULL OR date_trunc('month', item.rent_period)::date <= affected_end_period)
  ),
  adjustment_totals AS (
    SELECT
      item_periods.id,
      COALESCE(SUM(
        adjustment.amount + CASE
          WHEN adjustment.adjustment_type = 'indexed' AND COALESCE(adjustment.percentage_rate, 0) <> 0
            THEN ROUND(item_periods.base_amount * adjustment.percentage_rate / 100, 2)
          ELSE 0
        END
      ), 0) AS total_adjustment,
      COALESCE(string_agg(adjustment.description, ', ' ORDER BY adjustment.created_at), '') AS labels
    FROM item_periods
    LEFT JOIN public.vihem_rent_adjustments adjustment
      ON adjustment.tenancy_id = affected_tenancy_id
      AND adjustment.status = 'active'
      AND (
        (adjustment.adjustment_type = 'one_time' AND adjustment.rent_period = item_periods.item_period)
        OR (
          adjustment.adjustment_type IN ('recurring', 'indexed')
          AND COALESCE(adjustment.start_period, adjustment.rent_period) <= item_periods.item_period
          AND (adjustment.end_period IS NULL OR adjustment.end_period >= item_periods.item_period)
        )
      )
    GROUP BY item_periods.id
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
  WHERE item.id = adjustment_totals.id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
