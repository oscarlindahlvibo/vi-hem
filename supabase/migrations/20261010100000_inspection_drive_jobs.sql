-- Additive Drive archive ledger. Old URLs/documents remain readable.
ALTER TABLE public.vihem_apartment_inspections ADD COLUMN IF NOT EXISTS drive_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.vihem_apartment_inspections ADD COLUMN IF NOT EXISTS archive_status text NOT NULL DEFAULT 'legacy' CHECK (archive_status IN ('legacy','pending','failed','archived'));
CREATE TABLE public.vihem_inspection_file_jobs (
 id uuid PRIMARY KEY, inspection_id uuid NOT NULL REFERENCES public.vihem_apartment_inspections(id),
 organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id), created_by uuid NOT NULL REFERENCES public.vihem_profiles(id),
 kind text NOT NULL CHECK(kind IN ('photo','protocol')), room_key text NOT NULL DEFAULT 'general',
 filename text NOT NULL, mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','application/pdf')),
 byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 26214400), sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','uploading','failed','verified')),
 stage_path text NOT NULL UNIQUE, drive_file_id text, drive_folder_id text, drive_web_url text,
 document_id uuid REFERENCES public.vihem_documents(id), version integer NOT NULL DEFAULT 0,
 snapshot jsonb NOT NULL, lease_token uuid, lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0, error_code text, created_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz
);
CREATE INDEX ON public.vihem_inspection_file_jobs(inspection_id,created_at);
CREATE UNIQUE INDEX ON public.vihem_inspection_file_jobs(drive_file_id) WHERE drive_file_id IS NOT NULL;
ALTER TABLE public.vihem_google_drive_files ADD COLUMN IF NOT EXISTS byte_size bigint;
ALTER TABLE public.vihem_google_drive_files ADD COLUMN IF NOT EXISTS sha256 text;
ALTER TABLE public.vihem_google_drive_files ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.vihem_inspection_file_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY inspection_jobs_read ON public.vihem_inspection_file_jobs FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active AND p.organisation_id=vihem_inspection_file_jobs.organisation_id)
 AND EXISTS(SELECT 1 FROM public.vihem_apartment_inspections i WHERE i.id=inspection_id)
);
GRANT SELECT ON public.vihem_inspection_file_jobs TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.vihem_inspection_file_jobs FROM authenticated,anon;

CREATE OR REPLACE FUNCTION public.vihem_inspection_snapshot(i public.vihem_apartment_inspections) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT to_jsonb(i)-ARRAY['created_at','updated_at','status','archive_status','drive_required','document_id'];
$$;
CREATE OR REPLACE FUNCTION public.vihem_begin_inspection_file(p_id uuid,p_inspection uuid,p_kind text,p_room text,p_filename text,p_mime text,p_size bigint,p_sha256 text)
RETURNS public.vihem_inspection_file_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor public.vihem_profiles%ROWTYPE; insp public.vihem_apartment_inspections%ROWTYPE; job public.vihem_inspection_file_jobs%ROWTYPE;
BEGIN
 SELECT * INTO actor FROM public.vihem_profiles WHERE id=auth.uid() AND active;
 IF actor.id IS NULL OR actor.role NOT IN ('staff','admin','superadmin') THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO insp FROM public.vihem_apartment_inspections WHERE id=p_inspection AND organisation_id=actor.organisation_id FOR UPDATE;
 IF insp.id IS NULL THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_kind NOT IN ('photo','protocol') OR p_kind IS NULL OR p_filename IS NULL OR p_filename !~ '^[^/\\[:cntrl:]]{1,180}$' OR p_filename IN ('.','..') OR
 p_size IS NULL OR p_size<1 OR p_size>26214400 OR p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' OR
 (p_kind='photo' AND (p_mime IS DISTINCT FROM 'image/jpeg' OR p_size>10485760)) OR (p_kind='protocol' AND p_mime IS DISTINCT FROM 'application/pdf') THEN RAISE EXCEPTION 'Invalid file'; END IF;
 IF p_room IS NULL OR (p_room<>'general' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(insp.rooms) r WHERE r->>'id'=p_room)) THEN RAISE EXCEPTION 'Unknown room'; END IF;
 IF p_kind='protocol' AND EXISTS(SELECT 1 FROM public.vihem_inspection_file_jobs WHERE inspection_id=insp.id AND kind='photo' AND state<>'verified') THEN RAISE EXCEPTION 'Photos awaiting archive'; END IF;
 SELECT * INTO job FROM public.vihem_inspection_file_jobs WHERE id=p_id;
 IF job.id IS NOT NULL THEN
  IF job.inspection_id IS DISTINCT FROM p_inspection OR job.organisation_id IS DISTINCT FROM actor.organisation_id OR job.created_by IS DISTINCT FROM actor.id OR job.sha256 IS DISTINCT FROM p_sha256 OR job.byte_size IS DISTINCT FROM p_size OR job.kind IS DISTINCT FROM p_kind OR job.room_key IS DISTINCT FROM p_room THEN RAISE EXCEPTION 'Operation mismatch' USING ERRCODE='42501'; END IF;
  RETURN job;
 END IF;
 IF (SELECT count(*) FROM public.vihem_inspection_file_jobs WHERE inspection_id=insp.id)>=200 THEN RAISE EXCEPTION 'Inspection file limit reached'; END IF;
 INSERT INTO public.vihem_inspection_file_jobs(id,inspection_id,organisation_id,created_by,kind,room_key,filename,mime_type,byte_size,sha256,stage_path,snapshot,version)
 VALUES(p_id,insp.id,actor.organisation_id,actor.id,p_kind,p_room,p_filename,p_mime,p_size,p_sha256,actor.organisation_id||'/'||insp.id||'/'||p_id,public.vihem_inspection_snapshot(insp),CASE WHEN p_kind='protocol' THEN (SELECT COALESCE(max(version),0)+1 FROM public.vihem_inspection_file_jobs WHERE inspection_id=insp.id) ELSE 0 END) RETURNING * INTO job;
 UPDATE public.vihem_apartment_inspections SET drive_required=true,archive_status='pending' WHERE id=insp.id;
 RETURN job;
END $$;
REVOKE ALL ON FUNCTION public.vihem_begin_inspection_file(uuid,uuid,text,text,text,text,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_begin_inspection_file(uuid,uuid,text,text,text,text,bigint,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.vihem_claim_inspection_file(p_id uuid,p_token uuid) RETURNS public.vihem_inspection_file_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job public.vihem_inspection_file_jobs%ROWTYPE;
BEGIN
 UPDATE public.vihem_inspection_file_jobs SET state='uploading',lease_token=p_token,lease_until=now()+interval '5 minutes',attempts=attempts+1,error_code=NULL
 WHERE id=p_id AND state<>'verified' AND (lease_until IS NULL OR lease_until<now()) RETURNING * INTO job;
 RETURN job;
END $$;
REVOKE ALL ON FUNCTION public.vihem_claim_inspection_file(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_claim_inspection_file(uuid,uuid) TO service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('vihem-inspection-staging','vihem-inspection-staging',false,26214400,ARRAY['image/jpeg','application/pdf']) ON CONFLICT(id) DO NOTHING;
-- Only a server can write/read staging. No authenticated/anon policy is added.
CREATE POLICY inspection_staging_deny ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated,anon USING(bucket_id<>'vihem-inspection-staging') WITH CHECK(bucket_id<>'vihem-inspection-staging');
NOTIFY pgrst,'reload schema';
