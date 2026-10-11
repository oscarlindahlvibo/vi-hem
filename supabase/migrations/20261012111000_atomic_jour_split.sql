BEGIN;
CREATE OR REPLACE FUNCTION public.vihem_split_jour_shift(p_id uuid, p_revision timestamptz, p_split timestamptz, p_end timestamptz, p_owner uuid, p_child uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor public.vihem_profiles; original public.vihem_jour_shifts; child public.vihem_jour_shifts;
BEGIN
 SELECT * INTO actor FROM public.vihem_profiles WHERE id=auth.uid();
 IF actor.id IS NULL OR NOT actor.active OR actor.role NOT IN ('admin','superadmin') OR NOT public.vihem_module_enabled('jour') THEN RAISE EXCEPTION 'Du saknar behörighet.' USING ERRCODE='42501'; END IF;
 SELECT * INTO original FROM public.vihem_jour_shifts WHERE id=p_id AND organisation_id=actor.organisation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Passet är inte tillgängligt.' USING ERRCODE='42501'; END IF;
 IF p_child IS NULL OR p_child=p_id THEN RAISE EXCEPTION 'Begäran saknar giltigt ID.'; END IF;
 IF p_owner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=p_owner AND organisation_id=actor.organisation_id AND active AND role IN ('staff','admin','superadmin')) THEN RAISE EXCEPTION 'Välj personal i organisationen.' USING ERRCODE='42501'; END IF;
 SELECT * INTO child FROM public.vihem_jour_shifts WHERE id=p_child;
 IF FOUND THEN
  IF child.organisation_id=original.organisation_id AND child.created_by=actor.id AND child.duty_type=original.duty_type AND child.starts_at=p_split AND child.ends_at=p_end AND child.user_id IS NOT DISTINCT FROM p_owner AND original.ends_at=p_split THEN RETURN child.id; END IF;
  RAISE EXCEPTION 'Begäran har ändrats.' USING ERRCODE='22023';
 END IF;
 IF original.updated_at IS DISTINCT FROM p_revision OR original.ends_at IS DISTINCT FROM p_end THEN RAISE EXCEPTION 'Passet har ändrats. Öppna det igen.' USING ERRCODE='22023'; END IF;
 IF p_split IS NULL OR p_split<=original.starts_at OR p_split>=original.ends_at THEN RAISE EXCEPTION 'Delningen måste ligga inom passet.'; END IF;
 UPDATE public.vihem_jour_shifts SET ends_at=p_split WHERE id=p_id;
 INSERT INTO public.vihem_jour_shifts(id,organisation_id,duty_type,user_id,starts_at,ends_at,source,notes,created_by)
 VALUES(p_child,original.organisation_id,original.duty_type,p_owner,p_split,p_end,'manual',original.notes,actor.id);
 RETURN p_child;
END $$;
REVOKE ALL ON FUNCTION public.vihem_split_jour_shift(uuid,timestamptz,timestamptz,timestamptz,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_split_jour_shift(uuid,timestamptz,timestamptz,timestamptz,uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
