BEGIN;
-- Forward repair: keep Storage-policy administration outside the cutover RPC.
-- Copies/checksums remain mandatory; originals and quarantine are preserved.
CREATE OR REPLACE FUNCTION public.vihem_chat_legacy_cutover(mapping jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE entry jsonb; row public.vihem_chat_messages; total integer:=0;
BEGIN
 -- postgres is not the owner of storage.objects on the shared installation.
 -- Never run Storage DDL from this service-role SECURITY DEFINER function.
 -- The separately installed restrictive quarantine must remain in place.
 IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname='vihem_beta_legacy_quarantine' AND NOT polpermissive AND polcmd='*' AND polroles=ARRAY[0::oid]) THEN
  RAISE EXCEPTION 'Legacy Storage quarantine must be installed before reference cutover';
 END IF;
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
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.vihem_chat_legacy_cutover(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_chat_legacy_cutover(jsonb) TO service_role;
COMMIT;
