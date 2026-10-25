-- Personal data never inherits organisation administrator visibility.
BEGIN;
CREATE TABLE public.vihem_personal_collections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
 parent_id uuid, kind text NOT NULL CHECK(kind IN ('notebook','folder')), title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 color text NOT NULL DEFAULT '#2563eb' CHECK(color ~ '^#[0-9a-fA-F]{6}$'), position integer NOT NULL DEFAULT 0,
 UNIQUE(id,owner_id), FOREIGN KEY(parent_id,owner_id) REFERENCES public.vihem_personal_collections(id,owner_id), CHECK(parent_id IS DISTINCT FROM id)
);
CREATE FUNCTION public.vihem_personal_collection_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 -- Serialise hierarchy edits per owner; prevent concurrent cycle creation.
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text, 25));
 IF NEW.parent_id IS NOT NULL AND (NEW.kind='notebook' OR EXISTS(
 WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM vihem_personal_collections WHERE id=NEW.parent_id AND owner_id=NEW.owner_id
 UNION SELECT c.id,c.parent_id FROM vihem_personal_collections c JOIN ancestors a ON c.id=a.parent_id WHERE c.owner_id=NEW.owner_id)
 SELECT 1 FROM ancestors WHERE id=NEW.id)) THEN RAISE EXCEPTION 'Ogiltig mapphierarki'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER personal_collection_guard BEFORE INSERT OR UPDATE ON public.vihem_personal_collections FOR EACH ROW EXECUTE FUNCTION public.vihem_personal_collection_guard();
CREATE TABLE public.vihem_personal_notes (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
 collection_id uuid, title text NOT NULL DEFAULT '' CHECK(length(title)<=500), content jsonb NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
 plain_text text NOT NULL DEFAULT '' CHECK(length(plain_text)<=2000000), mode text NOT NULL DEFAULT 'text' CHECK(mode IN ('text','ink','mixed')),
 favorite boolean NOT NULL DEFAULT false, pinned boolean NOT NULL DEFAULT false, archived boolean NOT NULL DEFAULT false,
 deleted_at timestamptz, revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 search_document tsvector GENERATED ALWAYS AS (setweight(to_tsvector('swedish',title),'A') || setweight(to_tsvector('swedish',plain_text),'B')) STORED,
 UNIQUE(id,owner_id), FOREIGN KEY(collection_id,owner_id) REFERENCES public.vihem_personal_collections(id,owner_id), CHECK(jsonb_typeof(content)='object'), CHECK(pg_column_size(content)<8000000)
);
CREATE INDEX personal_notes_recent ON public.vihem_personal_notes(owner_id,updated_at DESC,id);
CREATE INDEX personal_notes_search ON public.vihem_personal_notes USING gin(search_document);
CREATE INDEX personal_collections_parent ON public.vihem_personal_collections(owner_id,parent_id,position);
CREATE TABLE public.vihem_personal_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, note_id uuid NOT NULL, revision integer NOT NULL,
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(note_id,revision),
 FOREIGN KEY(note_id,owner_id) REFERENCES public.vihem_personal_notes(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE public.vihem_personal_mutations (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, note_id uuid NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(note_id,owner_id) REFERENCES public.vihem_personal_notes(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE public.vihem_personal_tags (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 100), UNIQUE(owner_id,title), UNIQUE(id,owner_id)
);
CREATE TABLE public.vihem_personal_note_tags (
 owner_id uuid NOT NULL DEFAULT auth.uid(), note_id uuid NOT NULL, tag_id uuid NOT NULL, PRIMARY KEY(note_id,tag_id),
 FOREIGN KEY(note_id,owner_id) REFERENCES public.vihem_personal_notes(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(tag_id,owner_id) REFERENCES public.vihem_personal_tags(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE public.vihem_personal_ink_strokes (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL DEFAULT auth.uid(), note_id uuid NOT NULL, page_id uuid NOT NULL,
 stroke jsonb NOT NULL CHECK(jsonb_typeof(stroke)='object' AND pg_column_size(stroke)<1000000), deleted boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(note_id,owner_id) REFERENCES public.vihem_personal_notes(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX personal_ink_order ON public.vihem_personal_ink_strokes(owner_id,note_id,created_at,id);
CREATE INDEX personal_ink_pages ON public.vihem_personal_ink_strokes(owner_id,note_id,page_id);
CREATE TABLE public.vihem_personal_object_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL DEFAULT auth.uid(), note_id uuid NOT NULL,
 object_type text NOT NULL CHECK(object_type IN ('property','apartment','vehicle','workorder','project','meeting','customer','page')),
 object_id text NOT NULL CHECK(length(object_id) BETWEEN 1 AND 300), label text NOT NULL DEFAULT '',
 FOREIGN KEY(note_id,owner_id) REFERENCES public.vihem_personal_notes(id,owner_id) ON DELETE CASCADE,
 UNIQUE(note_id,object_type,object_id)
);
CREATE TABLE public.vihem_personal_attachments (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL DEFAULT auth.uid(), note_id uuid NOT NULL, name text NOT NULL,
 storage_path text NOT NULL UNIQUE, mime text NOT NULL, bytes bigint NOT NULL CHECK(bytes>0 AND bytes<=20971520),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(storage_path=owner_id::text||'/'||note_id::text||'/'||id::text),
 FOREIGN KEY(note_id,owner_id) REFERENCES public.vihem_personal_notes(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE public.vihem_personal_reminders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
 note_id uuid, block_id text, title text NOT NULL CHECK(length(title) BETWEEN 1 AND 500), description text NOT NULL DEFAULT '',
 due_at timestamptz NOT NULL, timezone text NOT NULL DEFAULT 'Europe/Stockholm', priority integer NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 2),
 recurrence text NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none','daily','weekly','monthly','weekdays','interval')),
 repeat_every integer NOT NULL DEFAULT 1 CHECK(repeat_every BETWEEN 1 AND 365), weekdays integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5] CHECK(weekdays <@ ARRAY[1,2,3,4,5,6,7] AND cardinality(weekdays) BETWEEN 1 AND 7),
 completed_at timestamptz, cancelled_at timestamptz, preview boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(note_id,owner_id) REFERENCES public.vihem_personal_notes(id,owner_id), UNIQUE(id,owner_id)
);
CREATE INDEX personal_reminders_due ON public.vihem_personal_reminders(due_at) WHERE completed_at IS NULL AND cancelled_at IS NULL;
CREATE TABLE public.vihem_personal_reminder_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reminder_id uuid NOT NULL, owner_id uuid NOT NULL, due_at timestamptz NOT NULL,
 notification_id uuid REFERENCES public.vihem_notifications(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reminder_id,due_at), FOREIGN KEY(reminder_id,owner_id) REFERENCES public.vihem_personal_reminders(id,owner_id) ON DELETE CASCADE
);
ALTER TABLE public.vihem_personal_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner ON public.vihem_personal_collections FOR ALL TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
CREATE POLICY private_staff_guard ON public.vihem_personal_collections AS RESTRICTIVE FOR ALL TO authenticated
USING(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')))
WITH CHECK(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')));
GRANT SELECT ON public.vihem_personal_collections TO authenticated;
ALTER TABLE public.vihem_personal_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner ON public.vihem_personal_notes FOR ALL TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
CREATE POLICY private_staff_guard ON public.vihem_personal_notes AS RESTRICTIVE FOR ALL TO authenticated
USING(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')))
WITH CHECK(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')));
GRANT SELECT ON public.vihem_personal_notes TO authenticated;
ALTER TABLE public.vihem_personal_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner ON public.vihem_personal_revisions FOR ALL TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
CREATE POLICY private_staff_guard ON public.vihem_personal_revisions AS RESTRICTIVE FOR ALL TO authenticated
USING(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')))
WITH CHECK(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')));
GRANT SELECT ON public.vihem_personal_revisions TO authenticated;
ALTER TABLE public.vihem_personal_mutations ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner ON public.vihem_personal_mutations FOR ALL TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
CREATE POLICY private_staff_guard ON public.vihem_personal_mutations AS RESTRICTIVE FOR ALL TO authenticated
USING(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')))
WITH CHECK(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')));
GRANT SELECT ON public.vihem_personal_mutations TO authenticated;
ALTER TABLE public.vihem_personal_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner ON public.vihem_personal_tags FOR ALL TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
CREATE POLICY private_staff_guard ON public.vihem_personal_tags AS RESTRICTIVE FOR ALL TO authenticated
USING(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')))
WITH CHECK(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')));
GRANT SELECT ON public.vihem_personal_tags TO authenticated;
ALTER TABLE public.vihem_personal_note_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner ON public.vihem_personal_note_tags FOR ALL TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
CREATE POLICY private_staff_guard ON public.vihem_personal_note_tags AS RESTRICTIVE FOR ALL TO authenticated
USING(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')))
WITH CHECK(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')));
GRANT SELECT ON public.vihem_personal_note_tags TO authenticated;
ALTER TABLE public.vihem_personal_ink_strokes ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner ON public.vihem_personal_ink_strokes FOR ALL TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
CREATE POLICY private_staff_guard ON public.vihem_personal_ink_strokes AS RESTRICTIVE FOR ALL TO authenticated
USING(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')))
WITH CHECK(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')));
GRANT SELECT ON public.vihem_personal_ink_strokes TO authenticated;
ALTER TABLE public.vihem_personal_object_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner ON public.vihem_personal_object_links FOR ALL TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
CREATE POLICY private_staff_guard ON public.vihem_personal_object_links AS RESTRICTIVE FOR ALL TO authenticated
USING(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')))
WITH CHECK(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')));
GRANT SELECT ON public.vihem_personal_object_links TO authenticated;
ALTER TABLE public.vihem_personal_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner ON public.vihem_personal_attachments FOR ALL TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
CREATE POLICY private_staff_guard ON public.vihem_personal_attachments AS RESTRICTIVE FOR ALL TO authenticated
USING(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')))
WITH CHECK(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')));
GRANT SELECT ON public.vihem_personal_attachments TO authenticated;
ALTER TABLE public.vihem_personal_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner ON public.vihem_personal_reminders FOR ALL TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
CREATE POLICY private_staff_guard ON public.vihem_personal_reminders AS RESTRICTIVE FOR ALL TO authenticated
USING(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')))
WITH CHECK(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')));
GRANT SELECT ON public.vihem_personal_reminders TO authenticated;
ALTER TABLE public.vihem_personal_reminder_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner ON public.vihem_personal_reminder_deliveries FOR ALL TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
CREATE POLICY private_staff_guard ON public.vihem_personal_reminder_deliveries AS RESTRICTIVE FOR ALL TO authenticated
USING(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')))
WITH CHECK(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')));
GRANT SELECT ON public.vihem_personal_reminder_deliveries TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.vihem_personal_collections TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.vihem_personal_tags TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.vihem_personal_note_tags TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.vihem_personal_object_links TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.vihem_personal_attachments TO authenticated;

CREATE FUNCTION public.vihem_personal_require_owner() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')) THEN RAISE EXCEPTION 'Åtkomst nekad' USING ERRCODE='42501'; END IF;
 RETURN auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.vihem_personal_require_owner() FROM PUBLIC;
CREATE FUNCTION public.vihem_personal_save_note(p_id uuid,p_expected integer,p_mutation uuid,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=vihem_personal_require_owner(); n vihem_personal_notes; result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,26));
 SELECT m.result INTO result FROM vihem_personal_mutations m WHERE id=p_mutation AND owner_id=u AND note_id=p_id;
 IF FOUND THEN RETURN result; END IF;
 SELECT * INTO n FROM vihem_personal_notes WHERE id=p_id FOR UPDATE;
 IF FOUND AND n.owner_id<>u THEN RAISE EXCEPTION 'Åtkomst nekad' USING ERRCODE='42501'; END IF;
 IF (n.id IS NULL AND p_expected<>0) OR (n.id IS NOT NULL AND n.revision<>p_expected) THEN RAISE EXCEPTION 'Dokumentkonflikt' USING ERRCODE='40001'; END IF;
 IF n.id IS NOT NULL THEN
  INSERT INTO vihem_personal_revisions(owner_id,note_id,revision,snapshot) VALUES(u,n.id,n.revision,to_jsonb(n)-'search_document');
 ELSE INSERT INTO vihem_personal_notes(id,owner_id) VALUES(p_id,u); END IF;
 UPDATE vihem_personal_notes SET title=coalesce(p_data->>'title',''), content=coalesce(p_data->'content',content),
 plain_text=coalesce(p_data->>'plain_text',''), collection_id=(p_data->>'collection_id')::uuid,
 mode=coalesce(p_data->>'mode','text'), favorite=coalesce((p_data->>'favorite')::boolean,false), pinned=coalesce((p_data->>'pinned')::boolean,false),
 archived=coalesce((p_data->>'archived')::boolean,false), deleted_at=(p_data->>'deleted_at')::timestamptz,
 revision=p_expected+1, updated_at=clock_timestamp() WHERE id=p_id AND owner_id=u RETURNING jsonb_build_object('revision',vihem_personal_notes.revision,'created_at',vihem_personal_notes.created_at,'updated_at',vihem_personal_notes.updated_at) INTO result;
 INSERT INTO vihem_personal_mutations(id,owner_id,note_id,result) VALUES(p_mutation,u,p_id,result);
 -- Retain last 50 revisions per document. Mutation receipts kept 90 days by maintenance.
 DELETE FROM vihem_personal_revisions WHERE note_id=p_id AND revision<p_expected-49;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.vihem_personal_save_note(uuid,integer,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_personal_save_note(uuid,integer,uuid,jsonb) TO authenticated;
CREATE FUNCTION public.vihem_personal_save_stroke(p_id uuid,p_note uuid,p_page uuid,p_expected integer,p_stroke jsonb,p_deleted boolean) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=vihem_personal_require_owner(); s vihem_personal_ink_strokes;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM vihem_personal_notes WHERE id=p_note AND owner_id=u) THEN RAISE EXCEPTION 'Åtkomst nekad' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,27));
 SELECT * INTO s FROM vihem_personal_ink_strokes WHERE id=p_id FOR UPDATE;
 IF FOUND AND (s.owner_id<>u OR s.note_id<>p_note OR s.page_id<>p_page) THEN RAISE EXCEPTION 'Åtkomst nekad' USING ERRCODE='42501'; END IF;
 IF s.id IS NOT NULL AND s.stroke=p_stroke AND s.deleted=p_deleted THEN RETURN s.revision; END IF;
 IF (s.id IS NULL AND p_expected<>0) OR (s.id IS NOT NULL AND s.revision<>p_expected) THEN RAISE EXCEPTION 'Pennkonflikt' USING ERRCODE='40001'; END IF;
 INSERT INTO vihem_personal_ink_strokes(id,owner_id,note_id,page_id,stroke,deleted,revision) VALUES(p_id,u,p_note,p_page,p_stroke,p_deleted,p_expected+1)
 ON CONFLICT(id) DO UPDATE SET stroke=excluded.stroke,deleted=excluded.deleted,revision=excluded.revision,updated_at=now();
 UPDATE vihem_personal_notes SET updated_at=clock_timestamp() WHERE id=p_note AND owner_id=u;
 RETURN p_expected+1;
END $$;
REVOKE ALL ON FUNCTION public.vihem_personal_save_stroke(uuid,uuid,uuid,integer,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_personal_save_stroke(uuid,uuid,uuid,integer,jsonb,boolean) TO authenticated;
CREATE FUNCTION public.vihem_personal_save_reminder(p_id uuid,p_expected integer,p_data jsonb) RETURNS public.vihem_personal_reminders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=vihem_personal_require_owner(); r vihem_personal_reminders;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,28));
 SELECT * INTO r FROM vihem_personal_reminders WHERE id=p_id FOR UPDATE;
 IF FOUND AND r.owner_id<>u THEN RAISE EXCEPTION 'Åtkomst nekad' USING ERRCODE='42501'; END IF;
 IF (r.id IS NULL AND p_expected<>0) OR (r.id IS NOT NULL AND r.revision<>p_expected) THEN RAISE EXCEPTION 'Påminnelsekonflikt' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_data->>'timezone') THEN RAISE EXCEPTION 'Ogiltig tidszon'; END IF;
 INSERT INTO vihem_personal_reminders(id,owner_id,note_id,block_id,title,description,due_at,timezone,priority,recurrence,repeat_every,weekdays,completed_at,cancelled_at,preview,revision)
 VALUES(p_id,u,(p_data->>'note_id')::uuid,p_data->>'block_id',p_data->>'title',coalesce(p_data->>'description',''),(p_data->>'due_at')::timestamptz,p_data->>'timezone',coalesce((p_data->>'priority')::integer,0),coalesce(p_data->>'recurrence','none'),coalesce((p_data->>'repeat_every')::integer,1),coalesce(ARRAY(SELECT value::integer FROM jsonb_array_elements_text(coalesce(p_data->'weekdays','[1,2,3,4,5]'::jsonb))),ARRAY[1,2,3,4,5]),(p_data->>'completed_at')::timestamptz,(p_data->>'cancelled_at')::timestamptz,coalesce((p_data->>'preview')::boolean,false),p_expected+1)
 ON CONFLICT(id) DO UPDATE SET note_id=excluded.note_id,block_id=excluded.block_id,title=excluded.title,description=excluded.description,due_at=excluded.due_at,timezone=excluded.timezone,priority=excluded.priority,recurrence=excluded.recurrence,repeat_every=excluded.repeat_every,weekdays=excluded.weekdays,completed_at=excluded.completed_at,cancelled_at=excluded.cancelled_at,preview=excluded.preview,revision=excluded.revision,updated_at=now() RETURNING * INTO r;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.vihem_personal_save_reminder(uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_personal_save_reminder(uuid,integer,jsonb) TO authenticated;
CREATE FUNCTION public.vihem_personal_complete_reminder(p_id uuid,p_expected integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=vihem_personal_require_owner(); r vihem_personal_reminders; d timestamp;
BEGIN
 SELECT * INTO r FROM vihem_personal_reminders WHERE id=p_id AND owner_id=u FOR UPDATE;
 IF NOT FOUND OR r.revision<>p_expected THEN RAISE EXCEPTION 'Påminnelsekonflikt' USING ERRCODE='40001'; END IF;
 IF r.recurrence='none' THEN UPDATE vihem_personal_reminders SET completed_at=now(),revision=revision+1 WHERE id=r.id;
 ELSE
  d:=r.due_at AT TIME ZONE r.timezone;
  LOOP
   d:=d+CASE r.recurrence WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '1 week' ELSE interval '1 month' END;
   EXIT WHEN (d AT TIME ZONE r.timezone)>now();
  END LOOP;
  UPDATE vihem_personal_reminders SET due_at=d AT TIME ZONE r.timezone,revision=revision+1 WHERE id=r.id;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.vihem_personal_complete_reminder(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_personal_complete_reminder(uuid,integer) TO authenticated;
-- One transaction per batch: notification, delivery receipt and row lock are atomic.
-- Existing AFTER INSERT notification trigger dispatches the existing native push.
CREATE FUNCTION public.vihem_personal_dispatch_reminders() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r vihem_personal_reminders; nid uuid; total integer:=0;
BEGIN
 FOR r IN SELECT pr.* FROM vihem_personal_reminders pr JOIN vihem_profiles p ON p.id=pr.owner_id AND p.active AND p.role IN ('staff','admin','superadmin')
 WHERE pr.due_at<=now() AND pr.completed_at IS NULL AND pr.cancelled_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM vihem_personal_reminder_deliveries d WHERE d.reminder_id=pr.id AND d.due_at=pr.due_at)
 AND (pr.note_id IS NULL OR EXISTS(SELECT 1 FROM vihem_personal_notes n WHERE n.id=pr.note_id AND n.deleted_at IS NULL))
 ORDER BY pr.due_at LIMIT 100 FOR UPDATE OF pr SKIP LOCKED LOOP
  INSERT INTO vihem_notifications(user_id,organisation_id,title,message,type,link)
  SELECT r.owner_id,p.organisation_id,'Min arbetsyta',CASE WHEN r.preview THEN r.title ELSE 'Du har en personlig påminnelse.' END,'info','personal-workspace/reminders/'||r.id::text FROM vihem_profiles p WHERE p.id=r.owner_id RETURNING id INTO nid;
  IF nid IS NULL THEN RAISE EXCEPTION 'Den personliga notisen kunde inte skapas'; END IF;
  INSERT INTO vihem_personal_reminder_deliveries(reminder_id,owner_id,due_at,notification_id) VALUES(r.id,r.owner_id,r.due_at,nid);
  total:=total+1;
 END LOOP;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.vihem_personal_dispatch_reminders() FROM PUBLIC,authenticated,anon;
GRANT EXECUTE ON FUNCTION public.vihem_personal_dispatch_reminders() TO service_role;
-- Intentionally no automatic cron activation. See installation guide.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('vihem-personal','vihem-personal',false,20971520,ARRAY['image/jpeg','image/png','image/webp','application/pdf','text/plain','audio/mpeg','audio/mp4','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) ON CONFLICT(id) DO NOTHING;
CREATE POLICY personal_files ON storage.objects FOR ALL TO authenticated
USING(bucket_id='vihem-personal' AND (storage.foldername(name))[1]=auth.uid()::text AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin')))
WITH CHECK(bucket_id='vihem-personal' AND (storage.foldername(name))[1]=auth.uid()::text AND EXISTS(SELECT 1 FROM public.vihem_personal_notes WHERE id::text=(storage.foldername(name))[2] AND owner_id=auth.uid()));
COMMIT;
