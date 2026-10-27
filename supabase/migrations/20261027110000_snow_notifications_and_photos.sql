BEGIN;
ALTER TABLE public.vihem_snow_notices ADD COLUMN closed_at timestamptz;
CREATE INDEX snow_pending_notices ON public.vihem_snow_notices(created_at) WHERE notification_id IS NULL AND closed_at IS NULL;
CREATE FUNCTION public.vihem_snow_push_allowed(p_notification uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n vihem_snow_notices;BEGIN
 SELECT * INTO n FROM vihem_snow_notices WHERE notification_id=p_notification;
 IF NOT FOUND THEN RETURN true;END IF;
 IF NOT vihem_snow_worker(n.user_id,n.organisation_id) THEN RETURN false;END IF;
 IF n.kind='callout' THEN RETURN EXISTS(SELECT 1 FROM vihem_snow_invitations i JOIN vihem_snow_duties d ON d.id=i.duty_id WHERE i.id=n.object_id AND i.state='pending' AND i.expires_at>clock_timestamp() AND d.state='calling' AND d.accepted_user IS NULL);END IF;
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.vihem_snow_push_allowed(uuid) FROM PUBLIC,authenticated,anon;
GRANT EXECUTE ON FUNCTION public.vihem_snow_push_allowed(uuid) TO service_role;
CREATE TABLE public.vihem_snow_photos(id uuid PRIMARY KEY,organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),entry_id uuid NOT NULL REFERENCES public.vihem_time_entries(id),user_id uuid NOT NULL REFERENCES public.vihem_profiles(id),path text NOT NULL UNIQUE,ready boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.vihem_snow_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY snow_photo_read ON public.vihem_snow_photos FOR SELECT TO authenticated USING(organisation_id=vihem_get_my_org_id() AND vihem_snow_access() AND (user_id=auth.uid() OR vihem_snow_admin()));
GRANT SELECT ON public.vihem_snow_photos TO authenticated;
GRANT ALL ON public.vihem_snow_photos TO service_role;
CREATE FUNCTION public.vihem_snow_photo_access(p_name text,p_write boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT vihem_snow_access() AND EXISTS(SELECT 1 FROM vihem_snow_photos p WHERE p.path=p_name AND p.organisation_id=vihem_get_my_org_id() AND (p.user_id=auth.uid() OR (NOT p_write AND vihem_snow_admin())))
$$;
CREATE FUNCTION public.vihem_snow_photo(p_id uuid,p_entry uuid,p_extension text,p_complete boolean DEFAULT false) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org uuid:=vihem_get_my_org_id();value text;BEGIN
 IF NOT vihem_snow_access() OR p_extension NOT IN ('jpg','png','webp') OR p_id IS NULL OR NOT EXISTS(SELECT 1 FROM vihem_time_entries WHERE id=p_entry AND user_id=auth.uid() AND organisation_id=org AND snow_client_id IS NOT NULL) THEN RAISE EXCEPTION 'Eget snöpass och JPEG/PNG/WebP krävs' USING ERRCODE='42501';END IF;
 value:=org::text||'/'||auth.uid()::text||'/'||p_entry::text||'/'||p_id::text||'.'||p_extension;
 INSERT INTO vihem_snow_photos(id,organisation_id,entry_id,user_id,path) VALUES(p_id,org,p_entry,auth.uid(),value) ON CONFLICT(id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM vihem_snow_photos WHERE id=p_id AND organisation_id=org AND user_id=auth.uid() AND entry_id=p_entry AND path=value) THEN RAISE EXCEPTION 'Bilagans identitet har ändrats';END IF;
 IF p_complete THEN
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='vihem-snow-photos' AND name=value) THEN RAISE EXCEPTION 'Bilden är inte färdiguppladdad';END IF;
  UPDATE vihem_snow_photos SET ready=true WHERE id=p_id;
 END IF;RETURN value;
END$$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('vihem-snow-photos','vihem-snow-photos',false,10485760,ARRAY['image/jpeg','image/png','image/webp']) ON CONFLICT(id) DO NOTHING;
-- The old restrictive snow gate remains restrictive for every other module's files.
DROP POLICY snow_external_storage_gate ON storage.objects;
CREATE POLICY snow_external_storage_gate ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated USING(vihem_get_my_role()<>'snow' OR (bucket_id='vihem-snow-photos' AND vihem_snow_photo_access(name))) WITH CHECK(vihem_get_my_role()<>'snow' OR (bucket_id='vihem-snow-photos' AND vihem_snow_photo_access(name,true)));
CREATE POLICY snow_photo_bucket_gate ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated USING(bucket_id<>'vihem-snow-photos' OR vihem_snow_photo_access(name)) WITH CHECK(bucket_id<>'vihem-snow-photos' OR vihem_snow_photo_access(name,true));
CREATE POLICY snow_photo_select ON storage.objects FOR SELECT TO authenticated USING(bucket_id='vihem-snow-photos' AND vihem_snow_photo_access(name));
CREATE POLICY snow_photo_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='vihem-snow-photos' AND vihem_snow_photo_access(name,true));
REVOKE ALL ON FUNCTION public.vihem_snow_photo(uuid,uuid,text,boolean),public.vihem_snow_photo_access(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_snow_photo(uuid,uuid,text,boolean),public.vihem_snow_photo_access(text,boolean) TO authenticated;
DO $$DECLARE f text;BEGIN
 SELECT pg_get_functiondef('public.vihem_snow_api_guard()'::regprocedure) INTO f;
 f:=replace(f,'IF actor.snow_time_access THEN',E'IF actor.snow_time_access THEN\n IF method=''POST'' AND path=''/rpc/vihem_snow_photo'' THEN RETURN;END IF;\n IF method IN (''GET'',''HEAD'') AND path=''/vihem_snow_photos'' THEN RETURN;END IF;');EXECUTE f;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
