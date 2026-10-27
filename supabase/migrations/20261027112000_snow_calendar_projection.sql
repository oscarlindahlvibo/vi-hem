BEGIN;
-- Keep the dated editor's revision model intact. Recurrence is projected separately,
-- so a synthetic baseline row can never be mistaken for a saved date exception.
ALTER FUNCTION public.vihem_snow_availability_snapshot(date,integer) RENAME TO vihem_snow_availability_dated_snapshot;
REVOKE ALL ON FUNCTION public.vihem_snow_availability_dated_snapshot(date,integer) FROM PUBLIC,authenticated,anon;
CREATE FUNCTION public.vihem_snow_availability_snapshot(p_from date,p_days integer DEFAULT 7) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE base jsonb;org uuid:=vihem_get_my_org_id();BEGIN
 base:=vihem_snow_availability_dated_snapshot(p_from,p_days);
 RETURN base||jsonb_build_object(
 'base_patterns',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM vihem_snow_patterns p WHERE organisation_id=org AND user_id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(base->'people') x)),
 'confirmed_weeks',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('current',NOT EXISTS(SELECT 1 FROM vihem_snow_patterns WHERE organisation_id=org AND user_id=c.user_id AND updated_at>c.confirmed_at) AND NOT EXISTS(SELECT 1 FROM vihem_snow_availability WHERE organisation_id=org AND user_id=c.user_id AND work_date BETWEEN c.week_start AND c.week_start+6 AND updated_at>c.confirmed_at))),'[]') FROM vihem_snow_week_confirmations c WHERE organisation_id=org AND week_start BETWEEN p_from-6 AND p_from+p_days AND user_id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(base->'people') x)));
END$$;
REVOKE ALL ON FUNCTION public.vihem_snow_availability_snapshot(date,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_snow_availability_snapshot(date,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
