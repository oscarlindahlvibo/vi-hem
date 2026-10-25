-- Explicit, owner-managed sharing. Personal reminders/tags/history remain private.
BEGIN;
CREATE TABLE public.vihem_personal_shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES auth.users(id),
 note_id uuid REFERENCES public.vihem_personal_notes(id) ON DELETE CASCADE,
 collection_id uuid REFERENCES public.vihem_personal_collections(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 permission text NOT NULL CHECK(permission IN ('read','edit')),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK((note_id IS NULL)<>(collection_id IS NULL)), CHECK(owner_id<>user_id)
);
CREATE UNIQUE INDEX personal_share_note_member ON vihem_personal_shares(note_id,user_id) WHERE note_id IS NOT NULL;
CREATE UNIQUE INDEX personal_share_collection_member ON vihem_personal_shares(collection_id,user_id) WHERE collection_id IS NOT NULL;
CREATE INDEX personal_share_recipient ON vihem_personal_shares(user_id);
ALTER TABLE vihem_personal_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY share_owner ON vihem_personal_shares FOR SELECT TO authenticated USING(owner_id=auth.uid());
GRANT SELECT ON vihem_personal_shares TO authenticated;
CREATE FUNCTION public.vihem_personal_collection_access(p_id uuid,p_write boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH RECURSIVE ancestors AS (
 SELECT id,parent_id,owner_id FROM vihem_personal_collections WHERE id=p_id
 UNION SELECT c.id,c.parent_id,c.owner_id FROM vihem_personal_collections c JOIN ancestors a ON c.id=a.parent_id AND c.owner_id=a.owner_id
 ) SELECT EXISTS(SELECT 1 FROM ancestors a JOIN vihem_profiles actor ON actor.id=auth.uid() AND actor.active AND actor.role IN ('staff','admin','superadmin')
 JOIN vihem_profiles owner ON owner.id=a.owner_id AND owner.active
 WHERE a.owner_id=auth.uid() OR (actor.organisation_id=owner.organisation_id AND EXISTS(SELECT 1 FROM vihem_personal_shares sh WHERE sh.collection_id=a.id AND sh.owner_id=a.owner_id AND sh.user_id=auth.uid() AND (NOT p_write OR sh.permission='edit'))));
$$;
CREATE FUNCTION public.vihem_personal_note_access(p_id uuid,p_write boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM vihem_personal_notes n JOIN vihem_profiles actor ON actor.id=auth.uid() AND actor.active AND actor.role IN ('staff','admin','superadmin')
 JOIN vihem_profiles owner ON owner.id=n.owner_id AND owner.active
 WHERE n.id=p_id AND (n.owner_id=auth.uid() OR (n.deleted_at IS NULL AND actor.organisation_id=owner.organisation_id AND (
 public.vihem_personal_collection_access(n.collection_id,p_write) OR EXISTS(SELECT 1 FROM vihem_personal_shares sh WHERE sh.note_id=n.id AND sh.owner_id=n.owner_id AND sh.user_id=auth.uid() AND (NOT p_write OR sh.permission='edit'))))));
$$;
REVOKE ALL ON FUNCTION vihem_personal_collection_access(uuid,boolean),vihem_personal_note_access(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vihem_personal_collection_access(uuid,boolean),vihem_personal_note_access(uuid,boolean) TO authenticated;
-- No write grants added: all document writes still pass through CAS RPCs.
DROP POLICY private_staff_guard ON vihem_personal_notes;
CREATE POLICY private_staff_guard ON vihem_personal_notes AS RESTRICTIVE FOR ALL TO authenticated USING(vihem_personal_note_access(id)) WITH CHECK(owner_id=auth.uid());
CREATE POLICY shared_read ON vihem_personal_notes FOR SELECT TO authenticated USING(vihem_personal_note_access(id));
DROP POLICY private_staff_guard ON vihem_personal_collections;
CREATE POLICY private_staff_guard ON vihem_personal_collections AS RESTRICTIVE FOR ALL TO authenticated USING(vihem_personal_collection_access(id)) WITH CHECK(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')));
CREATE POLICY shared_read ON vihem_personal_collections FOR SELECT TO authenticated USING(vihem_personal_collection_access(id));
DROP POLICY private_staff_guard ON vihem_personal_ink_strokes;
CREATE POLICY private_staff_guard ON vihem_personal_ink_strokes AS RESTRICTIVE FOR ALL TO authenticated USING(vihem_personal_note_access(note_id)) WITH CHECK(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')));
CREATE POLICY shared_read ON vihem_personal_ink_strokes FOR SELECT TO authenticated USING(vihem_personal_note_access(note_id));
DROP POLICY private_staff_guard ON vihem_personal_attachments;
CREATE POLICY private_staff_guard ON vihem_personal_attachments AS RESTRICTIVE FOR ALL TO authenticated USING(vihem_personal_note_access(note_id)) WITH CHECK(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')));
CREATE POLICY shared_read ON vihem_personal_attachments FOR SELECT TO authenticated USING(vihem_personal_note_access(note_id));
-- Reads require both metadata and current access, including inherited folder access.
DROP POLICY personal_storage_guard ON storage.objects;
CREATE POLICY personal_storage_guard ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING(bucket_id<>'vihem-personal' OR ((storage.foldername(name))[1]=auth.uid()::text AND EXISTS(SELECT 1 FROM vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin'))) OR EXISTS(SELECT 1 FROM vihem_personal_attachments a WHERE a.storage_path=objects.name AND vihem_personal_note_access(a.note_id)))
WITH CHECK(bucket_id<>'vihem-personal' OR ((storage.foldername(name))[1]=auth.uid()::text AND EXISTS(SELECT 1 FROM vihem_personal_notes WHERE id::text=(storage.foldername(name))[2] AND owner_id=auth.uid()) AND EXISTS(SELECT 1 FROM vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin'))));
CREATE POLICY personal_shared_files ON storage.objects FOR SELECT TO authenticated USING(bucket_id='vihem-personal' AND EXISTS(SELECT 1 FROM vihem_personal_attachments a WHERE a.storage_path=objects.name AND vihem_personal_note_access(a.note_id)));
-- Notes may be authored by a member inside an explicitly writable shared folder.
ALTER TABLE vihem_personal_notes DROP CONSTRAINT vihem_personal_notes_collection_id_owner_id_fkey;
ALTER TABLE vihem_personal_notes ADD CONSTRAINT personal_note_collection FOREIGN KEY(collection_id) REFERENCES vihem_personal_collections(id);
-- Receipts retain document ownership; actor identifies the writer for safe retry.
ALTER TABLE vihem_personal_mutations ADD COLUMN actor_id uuid REFERENCES auth.users(id);
UPDATE vihem_personal_mutations SET actor_id=owner_id;
ALTER TABLE vihem_personal_mutations ALTER COLUMN actor_id SET NOT NULL;
CREATE OR REPLACE FUNCTION public.vihem_personal_save_note(p_id uuid,p_expected integer,p_mutation uuid,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=vihem_personal_require_owner(); n vihem_personal_notes; result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,26));
 IF EXISTS(SELECT 1 FROM vihem_personal_notes WHERE id=p_id) AND NOT vihem_personal_note_access(p_id,true) THEN RAISE EXCEPTION 'Åtkomst nekad' USING ERRCODE='42501'; END IF;
 SELECT m.result INTO result FROM vihem_personal_mutations m WHERE id=p_mutation AND actor_id=u AND note_id=p_id;
 IF FOUND THEN RETURN result; END IF;
 SELECT * INTO n FROM vihem_personal_notes WHERE id=p_id FOR UPDATE;
 IF FOUND AND n.owner_id<>u AND (n.collection_id IS DISTINCT FROM (p_data->>'collection_id')::uuid OR n.deleted_at IS DISTINCT FROM (p_data->>'deleted_at')::timestamptz OR n.archived IS DISTINCT FROM (p_data->>'archived')::boolean OR n.favorite IS DISTINCT FROM (p_data->>'favorite')::boolean OR n.pinned IS DISTINCT FROM (p_data->>'pinned')::boolean) THEN RAISE EXCEPTION 'Bara ägaren får flytta eller ändra dokumentets organisering' USING ERRCODE='42501'; END IF;
 IF (n.id IS NULL AND p_expected<>0) OR (n.id IS NOT NULL AND n.revision<>p_expected) THEN RAISE EXCEPTION 'Dokumentkonflikt' USING ERRCODE='40001'; END IF;
 IF (n.id IS NULL OR n.collection_id IS DISTINCT FROM (p_data->>'collection_id')::uuid) AND p_data->>'collection_id' IS NOT NULL AND NOT vihem_personal_collection_access((p_data->>'collection_id')::uuid,true) THEN RAISE EXCEPTION 'Mappen kräver redigeringsrätt' USING ERRCODE='42501'; END IF;
 IF n.id IS NOT NULL THEN
  INSERT INTO vihem_personal_revisions(owner_id,note_id,revision,snapshot) VALUES(n.owner_id,n.id,n.revision,to_jsonb(n)-'search_document');
 ELSE INSERT INTO vihem_personal_notes(id,owner_id) VALUES(p_id,u); END IF;
 UPDATE vihem_personal_notes SET title=coalesce(p_data->>'title',''), content=coalesce(p_data->'content',content),
 plain_text=coalesce(p_data->>'plain_text',''), collection_id=(p_data->>'collection_id')::uuid,
 mode=coalesce(p_data->>'mode','text'), favorite=coalesce((p_data->>'favorite')::boolean,false), pinned=coalesce((p_data->>'pinned')::boolean,false),
 archived=coalesce((p_data->>'archived')::boolean,false), deleted_at=(p_data->>'deleted_at')::timestamptz,
 revision=p_expected+1, updated_at=clock_timestamp() WHERE id=p_id RETURNING jsonb_build_object('revision',vihem_personal_notes.revision,'created_at',vihem_personal_notes.created_at,'updated_at',vihem_personal_notes.updated_at) INTO result;
 INSERT INTO vihem_personal_mutations(id,owner_id,actor_id,note_id,result) VALUES(p_mutation,(SELECT owner_id FROM vihem_personal_notes WHERE id=p_id),u,p_id,result);
 -- Retain last 50 revisions per document. Mutation receipts kept 90 days by maintenance.
 DELETE FROM vihem_personal_revisions WHERE note_id=p_id AND revision<p_expected-49;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.vihem_personal_save_stroke(p_id uuid,p_note uuid,p_page uuid,p_expected integer,p_stroke jsonb,p_deleted boolean) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=vihem_personal_require_owner(); s vihem_personal_ink_strokes; document_owner uuid;
BEGIN
 IF NOT vihem_personal_note_access(p_note,true) THEN RAISE EXCEPTION 'Åtkomst nekad' USING ERRCODE='42501'; END IF;
 SELECT owner_id INTO document_owner FROM vihem_personal_notes WHERE id=p_note;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,27));
 SELECT * INTO s FROM vihem_personal_ink_strokes WHERE id=p_id FOR UPDATE;
 IF FOUND AND (s.owner_id<>document_owner OR s.note_id<>p_note OR s.page_id<>p_page) THEN RAISE EXCEPTION 'Åtkomst nekad' USING ERRCODE='42501'; END IF;
 IF s.id IS NOT NULL AND s.stroke=p_stroke AND s.deleted=p_deleted THEN RETURN s.revision; END IF;
 IF (s.id IS NULL AND p_expected<>0) OR (s.id IS NOT NULL AND s.revision<>p_expected) THEN RAISE EXCEPTION 'Pennkonflikt' USING ERRCODE='40001'; END IF;
 INSERT INTO vihem_personal_ink_strokes(id,owner_id,note_id,page_id,stroke,deleted,revision) VALUES(p_id,document_owner,p_note,p_page,p_stroke,p_deleted,p_expected+1)
 ON CONFLICT(id) DO UPDATE SET stroke=excluded.stroke,deleted=excluded.deleted,revision=excluded.revision,updated_at=now();
 UPDATE vihem_personal_notes SET updated_at=clock_timestamp() WHERE id=p_note;
 RETURN p_expected+1;
END $$;
CREATE FUNCTION public.vihem_personal_share_members(p_note uuid DEFAULT NULL,p_collection uuid DEFAULT NULL)
RETURNS TABLE(user_id uuid,name text,permission text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=vihem_personal_require_owner();
BEGIN
 IF (p_note IS NULL)=(p_collection IS NULL) OR NOT (EXISTS(SELECT 1 FROM vihem_personal_notes WHERE id=p_note AND owner_id=u) OR EXISTS(SELECT 1 FROM vihem_personal_collections WHERE id=p_collection AND owner_id=u)) THEN RAISE EXCEPTION 'Åtkomst nekad' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT sh.user_id,p.name,sh.permission FROM vihem_personal_shares sh JOIN vihem_profiles p ON p.id=sh.user_id WHERE sh.owner_id=u AND (sh.note_id=p_note OR sh.collection_id=p_collection) ORDER BY p.name;
END $$;
CREATE FUNCTION public.vihem_personal_share_people() RETURNS TABLE(id uuid,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p.id,p.name FROM vihem_profiles p JOIN vihem_profiles me ON me.id=auth.uid() AND me.active AND me.role IN ('staff','admin','superadmin')
 WHERE p.active AND p.role IN ('staff','admin','superadmin') AND p.organisation_id=me.organisation_id AND p.id<>me.id ORDER BY p.name;
$$;
CREATE FUNCTION public.vihem_personal_set_share(p_user uuid,p_permission text,p_note uuid DEFAULT NULL,p_collection uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=vihem_personal_require_owner();
BEGIN
 IF (p_note IS NULL)=(p_collection IS NULL) OR NOT (EXISTS(SELECT 1 FROM vihem_personal_notes WHERE id=p_note AND owner_id=u) OR EXISTS(SELECT 1 FROM vihem_personal_collections WHERE id=p_collection AND owner_id=u)) THEN RAISE EXCEPTION 'Bara ägaren får dela' USING ERRCODE='42501'; END IF;
 -- Serialize ACL changes with document CAS; each write checks current permission.
 IF p_note IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(p_note::text,26)); END IF;
 IF p_permission IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vihem_profiles p JOIN vihem_profiles me ON me.id=u WHERE p.id=p_user AND p.id<>u AND p.active AND p.role IN ('staff','admin','superadmin') AND p.organisation_id=me.organisation_id) THEN RAISE EXCEPTION 'Välj aktiv personal i din organisation' USING ERRCODE='42501'; END IF;
 DELETE FROM vihem_personal_shares WHERE owner_id=u AND user_id=p_user AND (note_id=p_note OR collection_id=p_collection);
 IF p_permission IS NOT NULL THEN INSERT INTO vihem_personal_shares(owner_id,note_id,collection_id,user_id,permission) VALUES(u,p_note,p_collection,p_user,p_permission); END IF;
END $$;
REVOKE ALL ON FUNCTION vihem_personal_share_members(uuid,uuid),vihem_personal_share_people(),vihem_personal_set_share(uuid,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vihem_personal_share_members(uuid,uuid),vihem_personal_share_people(),vihem_personal_set_share(uuid,text,uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
