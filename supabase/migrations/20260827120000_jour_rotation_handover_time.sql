-- Jour: rotationsregler genererade jourpass med start/slut vid midnatt
-- UTC (00:00), vilket i svensk lokal tid (Europe/Stockholm, UTC+1/+2
-- beroende på sommartid) blev 01:00/02:00 -- ett konstigt klockslag för
-- ett jourbyte. Byter till ett fast handover-klockslag, 07:00 svensk
-- lokal tid, för varje regel-genererat tillfälle (oavsett vilken
-- veckodag regelns start_date råkar falla på -- för en måndagsankrad
-- regel blir det alltså måndag 07:00, precis det efterfrågade).
--
-- `(timestamp AT TIME ZONE 'Europe/Stockholm')` är det korrekta
-- Postgres-idiomet för "detta klockslag, tolkat som lokal tid i den
-- här staden" -> tar automatiskt hänsyn till sommartidsväxlingar för
-- rätt datum, till skillnad från ett fast UTC-offset.

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
        VALUES (v_rule.organisation_id, v_rule.duty_type, v_rule.user_id, v_starts_at, v_ends_at, 'template', p_rule_id);
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
