-- Kvittokonfiguration och OTA-avräkning per korttidsbokning.

ALTER TABLE public.vihem_short_stay_bookings
  ADD COLUMN IF NOT EXISTS receipt_company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS receipt_title text NOT NULL DEFAULT 'Kvitto',
  ADD COLUMN IF NOT EXISTS receipt_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS receipt_vat_rate numeric(6,2) NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS receipt_vat_exempt boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_commission_rate numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_commission_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_settlement_amount numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.vihem_short_stay_units
  ADD COLUMN IF NOT EXISTS receipt_vat_rate numeric(6,2) NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS receipt_vat_exempt boolean NOT NULL DEFAULT false;

UPDATE public.vihem_short_stay_bookings
SET
  receipt_title = COALESCE(NULLIF(receipt_title, ''), 'Kvitto'),
  receipt_vat_rate = COALESCE(receipt_vat_rate, 12),
  receipt_lines = CASE
    WHEN jsonb_typeof(receipt_lines) = 'array' AND jsonb_array_length(receipt_lines) > 0 THEN receipt_lines
    ELSE jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'description', 'Boende',
      'amount', COALESCE(total_price, 0)
    ))
  END,
  platform_settlement_amount = CASE
    WHEN COALESCE(platform_settlement_amount, 0) = 0 THEN GREATEST(COALESCE(total_price, 0) - COALESCE(platform_commission_amount, 0), 0)
    ELSE platform_settlement_amount
  END;

CREATE TABLE IF NOT EXISTS public.vihem_short_stay_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL UNIQUE REFERENCES public.vihem_short_stay_bookings(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL,
  channel_name text NOT NULL DEFAULT '',
  gross_amount numeric(14,2) NOT NULL DEFAULT 0,
  commission_rate numeric(6,2) NOT NULL DEFAULT 0,
  commission_amount numeric(14,2) NOT NULL DEFAULT 0,
  net_settlement_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'needs_review' CHECK (status IN ('needs_review', 'confirmed', 'exported')),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vihem_short_stay_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read short stay settlements" ON public.vihem_short_stay_settlements;
CREATE POLICY "Admins can read short stay settlements"
  ON public.vihem_short_stay_settlements FOR SELECT TO authenticated
  USING (
    organisation_id = public.get_my_org_id()
    AND public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "Admins can manage short stay settlements" ON public.vihem_short_stay_settlements;
CREATE POLICY "Admins can manage short stay settlements"
  ON public.vihem_short_stay_settlements FOR ALL TO authenticated
  USING (
    organisation_id = public.get_my_org_id()
    AND public.get_my_role() = 'admin'
  )
  WITH CHECK (
    organisation_id = public.get_my_org_id()
    AND public.get_my_role() = 'admin'
  );

DROP TRIGGER IF EXISTS set_updated_at ON public.vihem_short_stay_settlements;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.vihem_short_stay_settlements
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

CREATE OR REPLACE FUNCTION public.vihem_upsert_short_stay_settlement(
  target_booking_id uuid,
  target_company_id uuid DEFAULT NULL
)
RETURNS public.vihem_short_stay_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  booking_row public.vihem_short_stay_bookings%ROWTYPE;
  settlement_row public.vihem_short_stay_settlements%ROWTYPE;
  gross numeric(14,2);
  commission numeric(14,2);
BEGIN
  SELECT * INTO booking_row
  FROM public.vihem_short_stay_bookings
  WHERE id = target_booking_id
  FOR UPDATE;

  IF booking_row.id IS NULL THEN RAISE EXCEPTION 'Bokningen hittades inte.'; END IF;
  IF public.get_my_role() NOT IN ('admin', 'superadmin') OR (public.get_my_role() <> 'superadmin' AND public.get_my_org_id() <> booking_row.organisation_id) THEN
    RAISE EXCEPTION 'Saknar behörighet att spara avräkning.';
  END IF;

  gross := COALESCE(booking_row.total_price, 0);
  commission := GREATEST(COALESCE(booking_row.platform_commission_amount, 0), 0);

  INSERT INTO public.vihem_short_stay_settlements (
    organisation_id, booking_id, company_id, channel_name, gross_amount,
    commission_rate, commission_amount, net_settlement_amount, created_by, updated_at
  ) VALUES (
    booking_row.organisation_id, booking_row.id, COALESCE(target_company_id, booking_row.receipt_company_id),
    booking_row.channel_name, gross, COALESCE(booking_row.platform_commission_rate, 0), commission,
    GREATEST(gross - commission, 0), auth.uid(), now()
  )
  ON CONFLICT (booking_id) DO UPDATE SET
    company_id = EXCLUDED.company_id,
    channel_name = EXCLUDED.channel_name,
    gross_amount = EXCLUDED.gross_amount,
    commission_rate = EXCLUDED.commission_rate,
    commission_amount = EXCLUDED.commission_amount,
    net_settlement_amount = EXCLUDED.net_settlement_amount,
    updated_at = now()
  RETURNING * INTO settlement_row;

  RETURN settlement_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vihem_upsert_short_stay_settlement(uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
