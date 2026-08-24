-- Jour: lägger till städjour som en tredje jourtyp, och ersätter det
-- linjära "grundschema"-konceptet (en delad cykel av (person, dagar)
-- -segment i strikt turordning) med oberoende, redigerbara
-- ROTATIONSREGLER: "person X har jour var N:e vecka, M veckor åt gången,
-- från datum D". Flera regler kan gälla samma person samtidigt (t.ex.
-- "var tredje vecka" OCH "var sjätte vecka" som två separata regler) --
-- när de råkar hamna intill varandra i tiden blir det naturligt två
-- veckor i rad, exakt det uttryckta behovet. Det gamla
-- mall+segment-konceptet hann aldrig användas på riktigt (modulen
-- aktiverades precis), så det byts ut rakt av snarare än att migreras.

-- ---- Städjour: en tredje jourtyp överallt duty_type förekommer ----

ALTER TABLE public.vihem_jour_eligibility DROP CONSTRAINT IF EXISTS vihem_jour_eligibility_duty_type_check;
ALTER TABLE public.vihem_jour_eligibility ADD CONSTRAINT vihem_jour_eligibility_duty_type_check CHECK (duty_type IN ('fastighet', 'sno', 'stad'));

ALTER TABLE public.vihem_jour_shifts DROP CONSTRAINT IF EXISTS vihem_jour_shifts_duty_type_check;
ALTER TABLE public.vihem_jour_shifts ADD CONSTRAINT vihem_jour_shifts_duty_type_check CHECK (duty_type IN ('fastighet', 'sno', 'stad'));

UPDATE public.vihem_module_registry
SET description = 'Fastighetsjour, snöjour och städjour -- schema, dagbesked och passbyten.'
WHERE module_key = 'jour';

-- ---- Ersätt mall+segment med oberoende rotationsregler ----

CREATE TABLE IF NOT EXISTS public.vihem_jour_rotation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  duty_type text NOT NULL CHECK (duty_type IN ('fastighet', 'sno', 'stad')),
  user_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  start_date date NOT NULL,
  interval_weeks integer NOT NULL CHECK (interval_weeks > 0),
  duration_weeks integer NOT NULL DEFAULT 1 CHECK (duration_weeks > 0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_jour_rotation_rules_org_type_idx ON public.vihem_jour_rotation_rules (organisation_id, duty_type);

DO $$
BEGIN
  IF to_regprocedure('public.vihem_touch_updated_at()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS vihem_jour_rotation_rules_updated_at ON public.vihem_jour_rotation_rules';
    EXECUTE 'CREATE TRIGGER vihem_jour_rotation_rules_updated_at BEFORE UPDATE ON public.vihem_jour_rotation_rules FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at()';
  END IF;
END $$;

ALTER TABLE public.vihem_jour_shifts DROP COLUMN IF EXISTS rotation_template_id;
ALTER TABLE public.vihem_jour_shifts ADD COLUMN IF NOT EXISTS rotation_rule_id uuid REFERENCES public.vihem_jour_rotation_rules(id) ON DELETE SET NULL;

DROP FUNCTION IF EXISTS public.vihem_generate_jour_shifts_from_template(uuid, date);

DROP POLICY IF EXISTS "Jour rotation template slots admin" ON public.vihem_jour_rotation_template_slots;
DROP POLICY IF EXISTS "Jour rotation templates admin" ON public.vihem_jour_rotation_templates;
DROP TABLE IF EXISTS public.vihem_jour_rotation_template_slots;
DROP TABLE IF EXISTS public.vihem_jour_rotation_templates;

ALTER TABLE public.vihem_jour_rotation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Jour rotation rules admin" ON public.vihem_jour_rotation_rules;
CREATE POLICY "Jour rotation rules admin" ON public.vihem_jour_rotation_rules
  FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('jour'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('jour'));

-- ---- Generation: one rule at a time, and a bulk helper per jourtyp ----
-- Same idempotency guarantee as before: skips (does not insert) any
-- occurrence whose date range already overlaps an EXISTING shift of the
-- same duty_type, regardless of which rule or manual edit put that shift
-- there -- a manual override, or another rule's occurrence for the same
-- person landing adjacent/overlapping, is never silently clobbered.
CREATE OR REPLACE FUNCTION public.vihem_generate_jour_shifts_from_rule(
  p_rule_id uuid,
  p_until_date date
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_occurrence_start date;
  v_occurrence_end date;
  v_inserted integer := 0;
  v_occurrences integer := 0;
BEGIN
  IF public.vihem_get_my_role() NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Endast admin kan generera jourpass.';
  END IF;

  SELECT * INTO v_rule FROM public.vihem_jour_rotation_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Regeln hittades inte.';
  END IF;
  IF public.vihem_get_my_role() <> 'superadmin' AND v_rule.organisation_id <> public.vihem_get_my_org_id() THEN
    RAISE EXCEPTION 'Du saknar behörighet för denna regel.';
  END IF;

  v_occurrence_start := v_rule.start_date;
  WHILE v_occurrence_start < p_until_date AND v_occurrences < 500 LOOP
    v_occurrence_end := v_occurrence_start + (v_rule.duration_weeks * 7);
    IF NOT EXISTS (
      SELECT 1 FROM public.vihem_jour_shifts existing
      WHERE existing.organisation_id = v_rule.organisation_id
        AND existing.duty_type = v_rule.duty_type
        AND tstzrange(existing.starts_at, existing.ends_at) && tstzrange(v_occurrence_start::timestamptz, v_occurrence_end::timestamptz)
    ) THEN
      BEGIN
        INSERT INTO public.vihem_jour_shifts (organisation_id, duty_type, user_id, starts_at, ends_at, source, rotation_rule_id)
        VALUES (v_rule.organisation_id, v_rule.duty_type, v_rule.user_id, v_occurrence_start::timestamptz, v_occurrence_end::timestamptz, 'template', p_rule_id);
        v_inserted := v_inserted + 1;
      EXCEPTION WHEN exclusion_violation THEN
        NULL;
      END;
    END IF;
    v_occurrence_start := v_occurrence_start + (v_rule.interval_weeks * 7);
    v_occurrences := v_occurrences + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

-- Convenience for the admin UI: generate every ACTIVE rule for one
-- jourtyp in one click, instead of one click per rule.
CREATE OR REPLACE FUNCTION public.vihem_generate_jour_shifts_for_duty_type(
  p_organisation_id uuid,
  p_duty_type text,
  p_until_date date
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_total integer := 0;
BEGIN
  IF public.vihem_get_my_role() NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Endast admin kan generera jourpass.';
  END IF;
  IF public.vihem_get_my_role() <> 'superadmin' AND p_organisation_id <> public.vihem_get_my_org_id() THEN
    RAISE EXCEPTION 'Du saknar behörighet för denna organisation.';
  END IF;

  FOR v_rule IN
    SELECT id FROM public.vihem_jour_rotation_rules
    WHERE organisation_id = p_organisation_id AND duty_type = p_duty_type AND active = true
  LOOP
    v_total := v_total + public.vihem_generate_jour_shifts_from_rule(v_rule.id, p_until_date);
  END LOOP;

  RETURN v_total;
END;
$$;

-- ---- Notistrigger: lägg till städjour-etiketten ----

CREATE OR REPLACE FUNCTION public.notify_jour_swap_offered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift record;
  v_offerer_name text;
  v_eligible record;
  v_duty_label text;
BEGIN
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_shift FROM public.vihem_jour_shifts WHERE id = NEW.shift_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NOT public.notification_enabled(NEW.organisation_id, 'jour_swap_available') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(name, email, 'Personal') INTO v_offerer_name FROM public.vihem_profiles WHERE id = NEW.offered_by;
  v_duty_label := CASE v_shift.duty_type WHEN 'fastighet' THEN 'fastighetsjour' WHEN 'sno' THEN 'snöjour' WHEN 'stad' THEN 'städjour' ELSE 'jour' END;

  FOR v_eligible IN
    SELECT e.user_id
    FROM public.vihem_jour_eligibility e
    WHERE e.organisation_id = NEW.organisation_id
      AND e.duty_type = v_shift.duty_type
      AND e.active = true
      AND e.user_id <> NEW.offered_by
  LOOP
    PERFORM public.create_notification(
      v_eligible.user_id,
      NEW.organisation_id,
      'Jourpass ute för byte',
      v_offerer_name || ' har lagt ut ett pass (' || v_duty_label || ') för byte.',
      'jour',
      'jour'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
