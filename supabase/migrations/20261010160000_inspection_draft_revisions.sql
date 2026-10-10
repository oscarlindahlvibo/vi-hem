-- Old clients remain readable, but cannot silently overwrite newer inspection drafts.
ALTER TABLE public.vihem_apartment_inspections ADD COLUMN revision bigint NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION public.vihem_inspection_snapshot(i public.vihem_apartment_inspections) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT to_jsonb(i)-ARRAY['created_at','updated_at','status','archive_status','drive_required','document_id','revision'];
$$;
CREATE OR REPLACE FUNCTION public.vihem_inspection_content(row_data jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('property_id',row_data->'property_id','apartment_id',row_data->'apartment_id','tenancy_id',row_data->'tenancy_id','inspection_type',row_data->'inspection_type','inspection_date',row_data->'inspection_date','tenant_present',row_data->'tenant_present','overall_condition',row_data->'overall_condition','rooms',row_data->'rooms','notes',row_data->'notes','action_required',row_data->'action_required','photo_urls',row_data->'photo_urls','status',row_data->'status');
$$;
CREATE OR REPLACE FUNCTION public.vihem_guard_inspection_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' OR public.vihem_inspection_content(to_jsonb(NEW)) IS DISTINCT FROM public.vihem_inspection_content(to_jsonb(OLD)) THEN
  IF auth.role()='authenticated' AND COALESCE(current_setting('vihem.inspection_revision_authorized',true),'') IS DISTINCT FROM NEW.id::text THEN RAISE EXCEPTION 'INSPECTION_CLIENT_UPGRADE_REQUIRED' USING ERRCODE='42501'; END IF;
  NEW.revision:=CASE WHEN TG_OP='INSERT' THEN 1 ELSE OLD.revision+1 END;
 ELSE NEW.revision:=OLD.revision;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inspection_revision_guard BEFORE INSERT OR UPDATE ON public.vihem_apartment_inspections FOR EACH ROW EXECUTE FUNCTION public.vihem_guard_inspection_revision();
CREATE OR REPLACE FUNCTION public.vihem_save_inspection_draft(p_id uuid,p_form jsonb,p_expected bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor public.vihem_profiles%ROWTYPE; existing public.vihem_apartment_inspections%ROWTYPE; desired jsonb;
BEGIN
 SELECT * INTO actor FROM public.vihem_profiles WHERE id=auth.uid() AND active;
 IF actor.id IS NULL OR actor.role NOT IN ('staff','admin','superadmin') OR actor.organisation_id IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'Inspection access denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vihem-inspection:'||p_id::text,0));
 SELECT * INTO existing FROM public.vihem_apartment_inspections WHERE id=p_id FOR UPDATE;
 IF existing.id IS NOT NULL AND existing.organisation_id IS DISTINCT FROM actor.organisation_id THEN RAISE EXCEPTION 'Inspection access denied' USING ERRCODE='42501'; END IF;
 desired:=p_form||jsonb_build_object('status','draft');
 IF existing.id IS NOT NULL AND existing.revision IS DISTINCT FROM p_expected THEN
  -- Lost-response retry only returns an identical current draft, never writes over it.
  IF public.vihem_inspection_content(to_jsonb(existing))=public.vihem_inspection_content(desired) THEN RETURN to_jsonb(existing); END IF;
  RAISE EXCEPTION 'INSPECTION_REVISION_CONFLICT' USING ERRCODE='23505';
 END IF;
 IF existing.id IS NULL AND p_expected IS NOT NULL THEN RAISE EXCEPTION 'INSPECTION_REVISION_CONFLICT' USING ERRCODE='23505'; END IF;
 PERFORM set_config('vihem.inspection_revision_authorized',p_id::text,true);
 RETURN public.vihem_save_inspection(p_id,desired,NULL,NULL);
END $$;
REVOKE ALL ON FUNCTION public.vihem_save_inspection_draft(uuid,jsonb,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_save_inspection_draft(uuid,jsonb,bigint) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.vihem_save_inspection(uuid,jsonb,jsonb,uuid) FROM authenticated;
NOTIFY pgrst,'reload schema';
