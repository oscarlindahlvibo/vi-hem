BEGIN;
-- Invoked only after the deployment utility has downloaded both copies and
-- verified SHA-256 for every legacy reference. This migration itself is inert.
CREATE FUNCTION public.vihem_chat_legacy_cutover(mapping jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE entry jsonb; row public.vihem_chat_messages; total integer:=0;
BEGIN
 LOCK TABLE public.vihem_chat_messages IN SHARE ROW EXCLUSIVE MODE;
 FOR entry IN SELECT * FROM jsonb_array_elements(mapping) LOOP
  SELECT * INTO row FROM public.vihem_chat_messages WHERE id=(entry->>'id')::uuid;
  IF row.id IS NULL OR row.attachment_url IS DISTINCT FROM entry->>'old_url' OR row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Bilagans referens har ändrats'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vihem_chat_threads t JOIN storage.objects o ON o.bucket_id='vihem-chat-private' AND o.name=entry->>'path' WHERE t.id=row.thread_id AND o.name=t.organisation_id::text||'/'||t.id::text||'/'||row.sender_id::text||'/legacy-'||row.id::text AND (o.metadata->>'size')::bigint=(entry->>'size')::bigint) THEN RAISE EXCEPTION 'Verifierad privat kopia saknas'; END IF;
  UPDATE public.vihem_chat_messages SET attachment_path=entry->>'path',attachment_size=(entry->>'size')::bigint,attachment_mime=entry->>'mime' WHERE id=row.id;
  total:=total+1;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.vihem_chat_messages WHERE deleted_at IS NULL AND attachment_url LIKE '%/storage/v1/object/public/vihem-chat-attachments/%' AND attachment_path IS NULL) THEN RAISE EXCEPTION 'Alla äldre bilagor måste kopieras först'; END IF;
 UPDATE storage.buckets SET public=false WHERE id='vihem-chat-attachments';
 DROP POLICY IF EXISTS "VIHEM public can view chat attachments" ON storage.objects;
 DROP POLICY IF EXISTS "VIHEM authenticated can upload chat attachments" ON storage.objects;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.vihem_chat_legacy_cutover(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_chat_legacy_cutover(jsonb) TO service_role;
COMMIT;
