BEGIN;
-- Explicit active role/org validation; locks serialize all steps of one instance.
CREATE OR REPLACE FUNCTION public.vihem_set_checklist_step(p_instance uuid,p_item uuid,p_completed boolean,p_expected boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller public.vihem_profiles; instance public.vihem_checklist_instances; item public.vihem_checklist_instance_items;
BEGIN
 SELECT * INTO caller FROM public.vihem_profiles WHERE id=auth.uid();
 IF caller.id IS NULL OR NOT caller.active OR caller.role NOT IN ('staff','admin','superadmin') OR caller.organisation_id IS NULL THEN
  RAISE EXCEPTION 'Du saknar behörighet att ändra checklistan.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO instance FROM public.vihem_checklist_instances WHERE id=p_instance AND organisation_id=caller.organisation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Checklistan är inte tillgänglig.' USING ERRCODE='42501'; END IF;
 SELECT * INTO item FROM public.vihem_checklist_instance_items WHERE id=p_item AND instance_id=p_instance FOR UPDATE;
 IF NOT FOUND OR p_completed IS NULL OR p_expected IS NULL THEN RAISE EXCEPTION 'Kontrollpunkten är inte tillgänglig.' USING ERRCODE='22023'; END IF;
 -- Setting a state that is already true is safe on retry, retaining original author/time.
 IF (item.completed_at IS NOT NULL)=p_completed THEN RETURN; END IF;
 IF instance.status='completed' OR (item.completed_at IS NOT NULL) IS DISTINCT FROM p_expected THEN
  RAISE EXCEPTION 'Checklistan har ändrats. Läs in den igen.' USING ERRCODE='P0001';
 END IF;
 UPDATE public.vihem_checklist_instance_items SET completed_by=CASE WHEN p_completed THEN auth.uid() ELSE NULL END,completed_at=CASE WHEN p_completed THEN now() ELSE NULL END WHERE id=p_item;
 IF NOT EXISTS(SELECT 1 FROM public.vihem_checklist_instance_items WHERE instance_id=p_instance AND completed_at IS NULL) THEN
  UPDATE public.vihem_checklist_instances SET status='completed',completed_at=now() WHERE id=p_instance;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.vihem_set_checklist_step(uuid,uuid,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_set_checklist_step(uuid,uuid,boolean,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
