-- Jour: rotationsregler ska kunna uttrycka mönster kortare än en hel
-- vecka (t.ex. städjour som normalt bara ligger på helger: lördag-
-- söndag, alltså 2 dagar, inte 7) och kunna vara OBEMANNADE (en
-- återkommande "ledig" jourtyp som personal själva får plocka varje
-- gång den genereras, istället för att alltid vara förbunden till en
-- specifik person).
--
-- duration_weeks (alltid hela veckor) byts till duration_days (valfritt
-- antal dagar) -- samma kolumn, ny betydelse. user_id blir nullable.

ALTER TABLE public.vihem_jour_rotation_rules RENAME COLUMN duration_weeks TO duration_days;
ALTER TABLE public.vihem_jour_rotation_rules ALTER COLUMN duration_days SET DEFAULT 7;
ALTER TABLE public.vihem_jour_rotation_rules ALTER COLUMN user_id DROP NOT NULL;

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
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_inserted integer := 0;
  v_occurrences integer := 0;
  v_new_shift_id uuid;
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
    v_occurrence_end := v_occurrence_start + v_rule.duration_days;
    v_starts_at := (v_occurrence_start + time '07:00') AT TIME ZONE 'Europe/Stockholm';
    v_ends_at := (v_occurrence_end + time '07:00') AT TIME ZONE 'Europe/Stockholm';
    IF NOT EXISTS (
      SELECT 1 FROM public.vihem_jour_shifts existing
      WHERE existing.organisation_id = v_rule.organisation_id
        AND existing.duty_type = v_rule.duty_type
        AND tstzrange(existing.starts_at, existing.ends_at) && tstzrange(v_starts_at, v_ends_at)
    ) THEN
      BEGIN
        INSERT INTO public.vihem_jour_shifts (organisation_id, duty_type, user_id, starts_at, ends_at, source, rotation_rule_id)
        VALUES (v_rule.organisation_id, v_rule.duty_type, v_rule.user_id, v_starts_at, v_ends_at, 'template', p_rule_id)
        RETURNING id INTO v_new_shift_id;
        IF v_rule.user_id IS NULL THEN
          INSERT INTO public.vihem_jour_swap_offers (organisation_id, shift_id, offered_by, allow_partial, note)
          VALUES (v_rule.organisation_id, v_new_shift_id, COALESCE(v_rule.created_by, auth.uid()), true, 'Genererat obemannat pass');
        END IF;
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

NOTIFY pgrst, 'reload schema';
