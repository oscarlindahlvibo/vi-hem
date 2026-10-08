BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('vihem-chat-private','vihem-chat-private',false,52428800,ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','video/mp4','video/quicktime','video/webm','audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav']);
CREATE FUNCTION public.vihem_chat_file_thread(path text) RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN split_part(path,'/',2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN split_part(path,'/',2)::uuid END;
$$;
REVOKE ALL ON FUNCTION public.vihem_chat_file_thread(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_chat_file_thread(text) TO authenticated,service_role;
CREATE POLICY chat_private_read ON storage.objects FOR SELECT TO authenticated USING (
 bucket_id='vihem-chat-private' AND public.can_access_chat_thread(public.vihem_chat_file_thread(name))
 AND split_part(name,'/',1)=public.vihem_get_my_org_id()::text
 AND ((owner_id=auth.uid()::text OR user_metadata->>'chat_uploader'=auth.uid()::text) OR EXISTS(SELECT 1 FROM public.vihem_chat_messages m WHERE m.attachment_path=name AND m.deleted_at IS NULL) OR EXISTS(SELECT 1 FROM public.vihem_chat_threads t WHERE t.group_image_path=name))
);
-- Uploads are performed by the authenticated upload edge function after inspecting bytes.
-- Clients cannot bypass that validation by talking to Storage directly.
CREATE POLICY chat_private_service ON storage.objects FOR ALL TO service_role USING(bucket_id='vihem-chat-private') WITH CHECK(bucket_id='vihem-chat-private');
-- Keep the five legacy public files readable during the staged frontend rollout.
-- A separate verified migration utility copies them, checks bytes and references,
-- and only then disables the legacy bucket's public flag/policy. Never delete old objects.
NOTIFY pgrst,'reload schema';
COMMIT;
