CREATE OR REPLACE FUNCTION public.vihem_commit_inspection_file(p_id uuid,p_token uuid,p_file text,p_folder text,p_web text)
RETURNS public.vihem_inspection_file_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job public.vihem_inspection_file_jobs%ROWTYPE; insp public.vihem_apartment_inspections%ROWTYPE; doc uuid; ref text; updated_rooms jsonb;
BEGIN
 SELECT * INTO job FROM public.vihem_inspection_file_jobs WHERE id=p_id FOR UPDATE;
 IF job.id IS NULL THEN RAISE EXCEPTION 'Unknown archive job'; END IF;
 IF job.state='verified' THEN RETURN job; END IF;
 IF job.lease_token IS DISTINCT FROM p_token OR job.lease_until<now() OR job.state<>'uploading' OR job.drive_file_id IS DISTINCT FROM p_file OR p_file IS NULL OR p_folder IS NULL THEN RAISE EXCEPTION 'Archive lease mismatch'; END IF;
 SELECT * INTO insp FROM public.vihem_apartment_inspections WHERE id=job.inspection_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=job.created_by AND active AND organisation_id=job.organisation_id AND role IN ('staff','admin','superadmin')) OR insp.organisation_id IS DISTINCT FROM job.organisation_id THEN RAISE EXCEPTION 'Archive access revoked' USING ERRCODE='42501'; END IF;
 IF insp.apartment_id IS DISTINCT FROM (job.snapshot->>'apartment_id')::uuid OR insp.property_id IS DISTINCT FROM (job.snapshot->>'property_id')::uuid THEN RAISE EXCEPTION 'Inspection object changed'; END IF;
 IF job.kind='protocol' THEN
  IF public.vihem_inspection_snapshot(insp) IS DISTINCT FROM job.snapshot THEN RAISE EXCEPTION 'Inspection changed during archive'; END IF;
  IF EXISTS(SELECT 1 FROM public.vihem_inspection_file_jobs WHERE inspection_id=insp.id AND kind='photo' AND state<>'verified') THEN RAISE EXCEPTION 'Photos awaiting archive'; END IF;
  -- A fresh document per version; previous final/signed document rows are never overwritten.
  INSERT INTO public.vihem_documents(organisation_id,title,file_url,file_name,file_size,document_type,visibility,tenant_id,property_id,apartment_id,description,created_by,storage_provider,drive_file_id,drive_web_url,drive_folder_id,drive_synced_at)
  VALUES(job.organisation_id,'Besiktningsprotokoll · version '||job.version,'',job.filename,job.byte_size,'inspection','tenant',
   (SELECT tenant_id FROM public.vihem_tenancies WHERE id=insp.tenancy_id),insp.property_id,insp.apartment_id,'Besiktning '||insp.id,job.created_by,'google_drive',p_file,p_web,p_folder,now()) RETURNING id INTO doc;
 ELSE
  ref:='vihem-drive:'||job.id;
  IF job.room_key='general' THEN
   UPDATE public.vihem_apartment_inspections SET photo_urls=CASE WHEN photo_urls ? ref THEN photo_urls ELSE photo_urls||jsonb_build_array(ref) END,updated_at=now() WHERE id=insp.id;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(insp.rooms) r WHERE r->>'id'=job.room_key) THEN RAISE EXCEPTION 'Room removed during archive'; END IF;
   SELECT jsonb_agg(CASE WHEN r->>'id'=job.room_key THEN jsonb_set(r,'{photos}',CASE WHEN COALESCE(r->'photos','[]'::jsonb) ? ref THEN r->'photos' ELSE COALESCE(r->'photos','[]'::jsonb)||jsonb_build_array(ref) END) ELSE r END ORDER BY ord)
   INTO updated_rooms FROM jsonb_array_elements(insp.rooms) WITH ORDINALITY x(r,ord);
   UPDATE public.vihem_apartment_inspections SET rooms=updated_rooms,updated_at=now() WHERE id=insp.id;
  END IF;
 END IF;
 INSERT INTO public.vihem_google_drive_files(organisation_id,source_type,source_id,source_key,filename,mime_type,drive_file_id,drive_web_url,drive_folder_id,created_by,byte_size,sha256,verified_at)
 VALUES(job.organisation_id,'inspection_'||job.kind,insp.id,job.id::text,job.filename,job.mime_type,p_file,p_web,p_folder,job.created_by,job.byte_size,job.sha256,now());
 UPDATE public.vihem_inspection_file_jobs SET state='verified',drive_folder_id=p_folder,drive_web_url=p_web,document_id=doc,verified_at=now(),lease_until=NULL,lease_token=NULL,error_code=NULL WHERE id=job.id RETURNING * INTO job;
 IF job.kind='protocol' THEN UPDATE public.vihem_apartment_inspections SET document_id=doc,status='completed',archive_status='archived',updated_at=now() WHERE id=insp.id; END IF;
 RETURN job;
END $$;
REVOKE ALL ON FUNCTION public.vihem_commit_inspection_file(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_commit_inspection_file(uuid,uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.vihem_guard_drive_inspection() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.drive_required AND NEW.status='completed' AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.document_id IS DISTINCT FROM NEW.document_id) AND NOT EXISTS(
 SELECT 1 FROM public.vihem_inspection_file_jobs j WHERE j.inspection_id=NEW.id AND j.document_id=NEW.document_id AND j.state='verified' AND j.kind='protocol' AND j.snapshot=public.vihem_inspection_snapshot(NEW)) THEN RAISE EXCEPTION 'Verified Drive protocol required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vihem_guard_drive_inspection BEFORE UPDATE ON public.vihem_apartment_inspections FOR EACH ROW EXECUTE FUNCTION public.vihem_guard_drive_inspection();
-- Fix qualified correlation in the read policy explicitly (also for QA revision).
DROP POLICY inspection_jobs_read ON public.vihem_inspection_file_jobs;
CREATE POLICY inspection_jobs_read ON public.vihem_inspection_file_jobs FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active AND p.organisation_id=vihem_inspection_file_jobs.organisation_id)
 AND EXISTS(SELECT 1 FROM public.vihem_apartment_inspections i WHERE i.id=vihem_inspection_file_jobs.inspection_id)
);
NOTIFY pgrst,'reload schema';
CREATE TABLE public.vihem_inspection_drive_folders (
 organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id), logical_key text NOT NULL,
 drive_id text NOT NULL UNIQUE, PRIMARY KEY(organisation_id,logical_key)
);
ALTER TABLE public.vihem_inspection_drive_folders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_inspection_drive_folders FROM authenticated,anon;
ALTER TABLE public.vihem_apartment_inspections ALTER COLUMN drive_required SET DEFAULT true;
ALTER TABLE public.vihem_apartment_inspections ALTER COLUMN archive_status SET DEFAULT 'pending';
CREATE OR REPLACE FUNCTION public.vihem_guard_drive_inspection() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.drive_required:=true; ELSE NEW.drive_required:=OLD.drive_required OR NEW.drive_required; END IF;
 IF NEW.drive_required AND NEW.status='completed' AND NOT EXISTS(
 SELECT 1 FROM public.vihem_inspection_file_jobs j WHERE j.inspection_id=NEW.id AND j.document_id=NEW.document_id AND j.state='verified' AND j.kind='protocol' AND j.snapshot=public.vihem_inspection_snapshot(NEW)) THEN RAISE EXCEPTION 'Verified Drive protocol required'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER vihem_guard_drive_inspection ON public.vihem_apartment_inspections;
CREATE TRIGGER vihem_guard_drive_inspection BEFORE INSERT OR UPDATE ON public.vihem_apartment_inspections FOR EACH ROW EXECUTE FUNCTION public.vihem_guard_drive_inspection();
GRANT SELECT,INSERT,UPDATE,DELETE ON public.vihem_inspection_file_jobs,public.vihem_inspection_drive_folders TO service_role;
