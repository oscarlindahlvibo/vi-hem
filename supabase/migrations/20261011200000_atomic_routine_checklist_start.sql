BEGIN;
CREATE TABLE public.vihem_routine_checklist_operations(actor_id uuid NOT NULL REFERENCES public.vihem_profiles(id),operation_id uuid NOT NULL,version_id uuid NOT NULL REFERENCES public.vihem_routine_versions(id),instance_id uuid NOT NULL REFERENCES public.vihem_checklist_instances(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,operation_id));
ALTER TABLE public.vihem_routine_checklist_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_routine_checklist_operations FROM anon,authenticated;
GRANT ALL ON public.vihem_routine_checklist_operations TO service_role;
CREATE FUNCTION public.vihem_start_routine_checklist(p_operation uuid,p_version uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller public.vihem_profiles; routine public.vihem_routines; previous public.vihem_routine_checklist_operations; result uuid;
BEGIN
 SELECT * INTO caller FROM public.vihem_profiles WHERE id=auth.uid();
 IF caller.id IS NULL OR NOT caller.active OR caller.role NOT IN ('staff','admin','superadmin') OR caller.organisation_id IS NULL OR p_operation IS NULL OR NOT public.vihem_has_permission(caller.id,'routine.read') THEN RAISE EXCEPTION 'Du saknar behörighet att starta checklistan.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(caller.id::text||p_operation::text,0));
 SELECT r.* INTO routine FROM public.vihem_routines r JOIN public.vihem_routine_versions v ON v.routine_id=r.id WHERE v.id=p_version AND r.organisation_id=caller.organisation_id FOR SHARE OF r;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rutinen är inte tillgänglig.' USING ERRCODE='42501'; END IF;
 SELECT * INTO previous FROM public.vihem_routine_checklist_operations WHERE actor_id=caller.id AND operation_id=p_operation;
 IF FOUND THEN
  IF previous.version_id IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Begäran har ändrats.' USING ERRCODE='22023'; END IF;
  RETURN previous.instance_id;
 END IF;
 IF routine.current_version_id IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Rutinen har uppdaterats. Öppna den igen innan du startar checklistan.' USING ERRCODE='P0001'; END IF;
 PERFORM id FROM public.vihem_routine_checklist_templates WHERE routine_version_id=p_version FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rutinen saknar checklistrader.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.vihem_checklist_instances(organisation_id,source_routine_version_id,title,created_by) VALUES(caller.organisation_id,p_version,routine.title,caller.id) RETURNING id INTO result;
 INSERT INTO public.vihem_checklist_instance_items(instance_id,sort_order,label,required,requires_photo) SELECT result,sort_order,label,required,requires_photo FROM public.vihem_routine_checklist_templates WHERE routine_version_id=p_version ORDER BY sort_order,id;
 INSERT INTO public.vihem_routine_checklist_operations(actor_id,operation_id,version_id,instance_id) VALUES(caller.id,p_operation,p_version,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.vihem_start_routine_checklist(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_start_routine_checklist(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
