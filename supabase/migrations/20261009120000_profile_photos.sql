BEGIN;
ALTER TABLE public.vihem_profiles ADD COLUMN IF NOT EXISTS avatar_path text;
-- Legacy URLs stay intact until their owner explicitly changes/removes a photo.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('vihem-profile-photos','vihem-profile-photos',false,2097152,ARRAY['image/jpeg'])
ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='vihem-profile-photos' AND (public OR file_size_limit IS DISTINCT FROM 2097152::bigint OR allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg'])) THEN
  RAISE EXCEPTION 'Existing profile photo bucket has unexpected configuration; review before migration';
 END IF;
END $$;
CREATE FUNCTION public.vihem_can_read_avatar(owner uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.vihem_profiles me JOIN public.vihem_profiles target ON target.id=owner
 WHERE me.id=auth.uid() AND me.active AND (me.id=target.id OR
 (target.active AND me.organisation_id=target.organisation_id AND
 (me.role IN ('staff','admin','superadmin') OR EXISTS(
 SELECT 1 FROM public.vihem_chat_participants mine JOIN public.vihem_chat_participants theirs ON theirs.thread_id=mine.thread_id
 JOIN public.vihem_chat_threads t ON t.id=mine.thread_id AND t.organisation_id=me.organisation_id
 WHERE mine.user_id=me.id AND theirs.user_id=target.id AND mine.left_at IS NULL AND theirs.left_at IS NULL))))
 );
$$;
REVOKE ALL ON FUNCTION public.vihem_can_read_avatar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_can_read_avatar(uuid) TO authenticated;
CREATE FUNCTION public.vihem_avatar_paths(ids uuid[]) RETURNS TABLE(user_id uuid,path text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p.id,p.avatar_path FROM public.vihem_profiles p WHERE p.id=ANY(ids) AND cardinality(ids)<=100 AND public.vihem_can_read_avatar(p.id);
$$;
REVOKE ALL ON FUNCTION public.vihem_avatar_paths(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_avatar_paths(uuid[]) TO authenticated;
CREATE FUNCTION public.vihem_can_read_avatar_object(object_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.vihem_profiles p WHERE p.avatar_path=object_path AND public.vihem_can_read_avatar(p.id));
$$;
REVOKE ALL ON FUNCTION public.vihem_can_read_avatar_object(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_can_read_avatar_object(text) TO authenticated;
CREATE POLICY profile_photos_read ON storage.objects FOR SELECT TO authenticated USING(
 bucket_id='vihem-profile-photos' AND public.vihem_can_read_avatar_object(name)
);
CREATE POLICY profile_photos_restrict_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(
 bucket_id<>'vihem-profile-photos' OR public.vihem_can_read_avatar_object(name)
);
CREATE POLICY profile_photos_no_anon_read ON storage.objects AS RESTRICTIVE FOR SELECT TO anon USING(bucket_id<>'vihem-profile-photos');
-- Restrictive rules also defend against any existing broad Storage policies.
CREATE POLICY profile_photos_no_client_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(bucket_id<>'vihem-profile-photos');
CREATE POLICY profile_photos_no_client_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING(bucket_id<>'vihem-profile-photos') WITH CHECK(bucket_id<>'vihem-profile-photos');
CREATE POLICY profile_photos_no_client_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(bucket_id<>'vihem-profile-photos');
CREATE FUNCTION public.vihem_set_profile_photo(path text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me public.vihem_profiles; prefix text;
BEGIN
 SELECT * INTO me FROM public.vihem_profiles WHERE id=auth.uid() AND active FOR UPDATE;
 IF me.id IS NULL THEN RAISE EXCEPTION 'Logga in för att ändra din profilbild' USING ERRCODE='42501'; END IF;
 prefix:=coalesce(me.organisation_id::text,'platform')||'/'||me.id||'/';
 IF path IS NOT NULL AND (path NOT LIKE prefix||'%' OR path LIKE '%..%' OR NOT EXISTS(
  SELECT 1 FROM storage.objects o WHERE o.bucket_id='vihem-profile-photos' AND o.name=path AND o.user_metadata->>'profile_owner'=me.id::text
  AND o.metadata->>'mimetype'='image/jpeg' AND (o.metadata->>'size')::bigint BETWEEN 1 AND 2097152
 )) THEN RAISE EXCEPTION 'Profilbilden kunde inte verifieras' USING ERRCODE='42501'; END IF;
 UPDATE public.vihem_profiles SET avatar_path=path,avatar_url='',updated_at=now() WHERE id=me.id;
END $$;
REVOKE ALL ON FUNCTION public.vihem_set_profile_photo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_set_profile_photo(text) TO authenticated;
CREATE FUNCTION public.vihem_guard_avatar_path() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF ((TG_OP='INSERT' AND NEW.avatar_path IS NOT NULL) OR (TG_OP='UPDATE' AND NEW.avatar_path IS DISTINCT FROM OLD.avatar_path)) AND current_user NOT IN ('postgres','supabase_admin','service_role') THEN
  RAISE EXCEPTION 'Använd profilbildsfunktionen' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vihem_guard_avatar_path BEFORE INSERT OR UPDATE OF avatar_path ON public.vihem_profiles FOR EACH ROW EXECUTE FUNCTION public.vihem_guard_avatar_path();
NOTIFY pgrst,'reload schema';
COMMIT;
