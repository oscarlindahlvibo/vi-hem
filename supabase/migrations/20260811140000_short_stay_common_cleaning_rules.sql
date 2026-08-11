-- Regelstyrd städning av gemensamma ytor.
-- En regel skapar högst en städpost per yta och datum när ett valt rum är bebott.

CREATE TABLE IF NOT EXISTS public.vihem_short_stay_common_cleaning_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  required_unit_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  weekdays smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vihem_common_cleaning_rules_weekdays_check
    CHECK (weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  CONSTRAINT vihem_common_cleaning_rules_units_check
    CHECK (cardinality(required_unit_ids) > 0)
);

ALTER TABLE public.vihem_short_stay_common_cleanings
  ADD COLUMN IF NOT EXISTS rule_id uuid REFERENCES public.vihem_short_stay_common_cleaning_rules(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vihem_common_cleanings_rule_date
  ON public.vihem_short_stay_common_cleanings(rule_id, due_date)
  WHERE rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vihem_common_cleaning_rules_org_active
  ON public.vihem_short_stay_common_cleaning_rules(organisation_id, active);

ALTER TABLE public.vihem_short_stay_common_cleaning_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org staff can read common cleaning rules" ON public.vihem_short_stay_common_cleaning_rules;
CREATE POLICY "Org staff can read common cleaning rules"
  ON public.vihem_short_stay_common_cleaning_rules FOR SELECT TO authenticated
  USING (
    organisation_id = public.get_my_org_id()
    AND public.is_short_stay_enabled(organisation_id)
    AND public.get_my_role() = ANY (ARRAY['staff','admin'])
  );

DROP POLICY IF EXISTS "Admins can manage common cleaning rules" ON public.vihem_short_stay_common_cleaning_rules;
CREATE POLICY "Admins can manage common cleaning rules"
  ON public.vihem_short_stay_common_cleaning_rules FOR ALL TO authenticated
  USING (
    organisation_id = public.get_my_org_id()
    AND public.is_short_stay_enabled(organisation_id)
    AND public.get_my_role() = 'admin'
  )
  WITH CHECK (
    organisation_id = public.get_my_org_id()
    AND public.is_short_stay_enabled(organisation_id)
    AND public.get_my_role() = 'admin'
  );

DROP TRIGGER IF EXISTS set_updated_at ON public.vihem_short_stay_common_cleaning_rules;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.vihem_short_stay_common_cleaning_rules
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

CREATE OR REPLACE FUNCTION public.vihem_generate_short_stay_common_cleanings(
  p_organisation_id uuid,
  p_from date DEFAULT CURRENT_DATE,
  p_to date DEFAULT (CURRENT_DATE + 370)
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rule_record record;
  target_date date;
  created_count integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND p_organisation_id <> public.get_my_org_id() THEN
    RAISE EXCEPTION 'Organisationen kan inte användas här';
  END IF;

  IF p_to < p_from THEN RETURN 0; END IF;

  FOR rule_record IN
    SELECT *
    FROM public.vihem_short_stay_common_cleaning_rules
    WHERE organisation_id = p_organisation_id
      AND active
      AND cardinality(required_unit_ids) > 0
  LOOP
    FOR target_date IN
      SELECT value::date
      FROM generate_series(p_from, p_to, interval '1 day') AS value
    LOOP
      IF EXTRACT(ISODOW FROM target_date)::smallint = ANY (rule_record.weekdays)
         AND EXISTS (
           SELECT 1
           FROM public.vihem_short_stay_bookings booking
           WHERE booking.organisation_id = p_organisation_id
             AND booking.booking_type = 'booking'
             AND booking.unit_id = ANY (rule_record.required_unit_ids)
             AND booking.start_date <= target_date
             AND booking.end_date > target_date
         )
      THEN
        INSERT INTO public.vihem_short_stay_common_cleanings (
          organisation_id, title, description, due_date, required_unit_ids,
          rule_id, cleaning_status, created_by, updated_at
        )
        VALUES (
          rule_record.organisation_id,
          rule_record.title,
          rule_record.description,
          target_date,
          rule_record.required_unit_ids,
          rule_record.id,
          'dirty',
          rule_record.created_by,
          now()
        )
        ON CONFLICT (rule_id, due_date) WHERE rule_id IS NOT NULL DO NOTHING;

        IF FOUND THEN created_count := created_count + 1; END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN created_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vihem_generate_short_stay_common_cleanings(uuid, date, date) TO authenticated, service_role;
