-- Preserve existing inspection/document tables and policies. Caller rights + RLS apply.
-- The client keeps the same UUID on retry; save + generated protocol + link commit together.
CREATE OR REPLACE FUNCTION public.vihem_save_inspection(
 p_id uuid, p_form jsonb, p_document jsonb DEFAULT NULL, p_document_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
 actor public.vihem_profiles%ROWTYPE;
 old_row public.vihem_apartment_inspections%ROWTYPE;
 result public.vihem_apartment_inspections%ROWTYPE;
 apt public.vihem_apartments%ROWTYPE;
 tenancy public.vihem_tenancies%ROWTYPE;
 doc_id uuid;
 status_value text := p_form->>'status';
 property_id_value uuid := (p_form->>'property_id')::uuid;
 apartment_id_value uuid := (p_form->>'apartment_id')::uuid;
 tenancy_id_value uuid := NULLIF(p_form->>'tenancy_id','')::uuid;
BEGIN
 SELECT * INTO actor FROM public.vihem_profiles WHERE id=auth.uid() AND active;
 IF actor.id IS NULL OR actor.role NOT IN ('staff','admin','superadmin') OR actor.organisation_id IS NULL THEN
  RAISE EXCEPTION 'Inspection access denied' USING ERRCODE='42501';
 END IF;
 IF p_id IS NULL OR status_value IS NULL OR status_value NOT IN ('draft','completed') THEN RAISE EXCEPTION 'Invalid inspection'; END IF;
 SELECT * INTO apt FROM public.vihem_apartments WHERE id=apartment_id_value AND organisation_id=actor.organisation_id AND property_id=property_id_value;
 IF apt.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.vihem_properties WHERE id=property_id_value AND organisation_id=actor.organisation_id) THEN
  RAISE EXCEPTION 'Invalid inspection object' USING ERRCODE='42501';
 END IF;
 IF tenancy_id_value IS NOT NULL THEN
  SELECT * INTO tenancy FROM public.vihem_tenancies WHERE id=tenancy_id_value AND organisation_id=actor.organisation_id AND apartment_id=apt.id AND property_id=property_id_value;
  IF tenancy.id IS NULL THEN RAISE EXCEPTION 'Invalid inspection tenancy' USING ERRCODE='42501'; END IF;
 END IF;
 IF jsonb_typeof(p_form->'rooms') IS DISTINCT FROM 'array' OR jsonb_typeof(p_form->'photo_urls') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid inspection contents'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vihem-inspection:'||p_id::text,0));
 SELECT * INTO old_row FROM public.vihem_apartment_inspections WHERE id=p_id FOR UPDATE;
 IF old_row.id IS NOT NULL AND old_row.organisation_id IS DISTINCT FROM actor.organisation_id THEN RAISE EXCEPTION 'Inspection access denied' USING ERRCODE='42501'; END IF;
 doc_id := old_row.document_id;
 IF status_value='completed' THEN
  IF jsonb_typeof(p_document) IS DISTINCT FROM 'object' OR p_document_id IS NULL OR ((p_document->>'file_url') LIKE 'data:application/pdf;base64,%') IS DISTINCT FROM true OR length(p_document->>'file_url')>30000000 THEN RAISE EXCEPTION 'Generated protocol required'; END IF;
  IF doc_id IS NOT NULL AND doc_id IS DISTINCT FROM p_document_id THEN RAISE EXCEPTION 'Protocol reference changed'; END IF;
  doc_id := p_document_id;
  IF old_row.document_id IS NULL AND EXISTS (SELECT 1 FROM public.vihem_documents WHERE id=doc_id) THEN RAISE EXCEPTION 'Protocol already belongs to another record' USING ERRCODE='42501'; END IF;
  IF old_row.document_id IS NOT NULL THEN
   UPDATE public.vihem_documents SET title=p_document->>'title', file_url=p_document->>'file_url', file_name=p_document->>'file_name', file_size=(p_document->>'file_size')::integer,
    description=p_document->>'description', tenant_id=tenancy.tenant_id, property_id=property_id_value, apartment_id=apt.id, updated_at=now()
   WHERE id=doc_id AND organisation_id=actor.organisation_id AND document_type='inspection';
   IF NOT FOUND THEN RAISE EXCEPTION 'Protocol access denied' USING ERRCODE='42501'; END IF;
  ELSE
   INSERT INTO public.vihem_documents (id,organisation_id,title,file_url,file_name,file_size,document_type,visibility,tenant_id,property_id,apartment_id,description,created_by)
   VALUES(doc_id,actor.organisation_id,p_document->>'title',p_document->>'file_url',p_document->>'file_name',(p_document->>'file_size')::integer,'inspection','tenant',tenancy.tenant_id,property_id_value,apt.id,p_document->>'description',actor.id);
  END IF;
 END IF;
 IF old_row.id IS NULL THEN
  INSERT INTO public.vihem_apartment_inspections (id,organisation_id,apartment_id,property_id,tenancy_id,inspection_type,inspection_date,inspector_id,tenant_present,overall_condition,rooms,notes,action_required,photo_urls,status,document_id)
  VALUES(p_id,actor.organisation_id,apt.id,property_id_value,tenancy_id_value,p_form->>'inspection_type',(p_form->>'inspection_date')::date,actor.id,(p_form->>'tenant_present')::boolean,p_form->>'overall_condition',p_form->'rooms',p_form->>'notes',p_form->>'action_required',p_form->'photo_urls',status_value,doc_id)
  RETURNING * INTO result;
 ELSE
  UPDATE public.vihem_apartment_inspections SET apartment_id=apt.id,property_id=property_id_value,tenancy_id=tenancy_id_value,inspection_type=p_form->>'inspection_type',inspection_date=(p_form->>'inspection_date')::date,inspector_id=actor.id,tenant_present=(p_form->>'tenant_present')::boolean,overall_condition=p_form->>'overall_condition',rooms=p_form->'rooms',notes=p_form->>'notes',action_required=p_form->>'action_required',photo_urls=p_form->'photo_urls',status=status_value,document_id=doc_id,updated_at=now()
  WHERE id=p_id RETURNING * INTO result;
  IF result.id IS NULL THEN RAISE EXCEPTION 'Inspection update denied' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.vihem_save_inspection(uuid,jsonb,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vihem_save_inspection(uuid,jsonb,jsonb,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
