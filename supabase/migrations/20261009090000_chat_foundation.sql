BEGIN;
-- Additive changes: old IDs/history and support threads are retained.
ALTER TABLE public.vihem_chat_threads ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.vihem_properties(id);
ALTER TABLE public.vihem_chat_threads ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.vihem_customer_projects(id);
ALTER TABLE public.vihem_chat_threads ADD COLUMN IF NOT EXISTS work_order_id uuid REFERENCES public.vihem_work_orders(id);
ALTER TABLE public.vihem_chat_threads ADD COLUMN IF NOT EXISTS group_image_path text;
ALTER TABLE public.vihem_chat_participants ADD COLUMN IF NOT EXISTS left_at timestamptz;
ALTER TABLE public.vihem_chat_participants ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE public.vihem_chat_participants ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE public.vihem_chat_participants ADD COLUMN IF NOT EXISTS manual_unread boolean NOT NULL DEFAULT false;
ALTER TABLE public.vihem_chat_participants ADD COLUMN IF NOT EXISTS notification_mode text NOT NULL DEFAULT 'all' CHECK (notification_mode IN ('all','mentions','none'));
ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS send_request_hash text;
ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS reply_to uuid REFERENCES public.vihem_chat_messages(id);
ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS attachment_path text;
ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS attachment_size bigint;
ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS attachment_mime text;
ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS audio_duration numeric;
ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS linked_work_order_id uuid REFERENCES public.vihem_work_orders(id);
ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS linked_project_id uuid REFERENCES public.vihem_customer_projects(id);
ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS forwarded_from uuid REFERENCES public.vihem_chat_messages(id);
CREATE INDEX IF NOT EXISTS vihem_chat_messages_cursor ON public.vihem_chat_messages(thread_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS vihem_chat_participants_active_user ON public.vihem_chat_participants(user_id,thread_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS vihem_chat_threads_activity ON public.vihem_chat_threads(organisation_id,last_message_at DESC,id);
-- Match the actual substring searches; retain an existing extension's schema.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
DO $$ DECLARE ns text; BEGIN
 SELECT n.nspname INTO ns FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm';
 EXECUTE format('CREATE INDEX IF NOT EXISTS vihem_chat_messages_search ON public.vihem_chat_messages USING gin(message %I.gin_trgm_ops) WHERE deleted_at IS NULL',ns);
 EXECUTE format('CREATE INDEX IF NOT EXISTS vihem_chat_threads_subject_search ON public.vihem_chat_threads USING gin(subject %I.gin_trgm_ops)',ns);
END $$;

-- Backfill explicit historical participants, without creating duplicate conversations.
INSERT INTO public.vihem_chat_participants(thread_id,user_id)
SELECT t.id,p.id FROM public.vihem_chat_threads t JOIN public.vihem_profiles p ON p.organisation_id=t.organisation_id
 AND p.id IN (t.created_by,t.tenant_id,t.assigned_to) ON CONFLICT(thread_id,user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_access_chat_thread(thread_uuid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.vihem_chat_threads t JOIN public.vihem_profiles me ON me.id=auth.uid()
  WHERE t.id=thread_uuid AND me.active AND me.organisation_id=t.organisation_id
  AND (EXISTS (SELECT 1 FROM public.vihem_chat_participants p WHERE p.thread_id=t.id AND p.user_id=me.id AND p.left_at IS NULL)
   OR (t.chat_type='tenant_support' AND (t.tenant_id=me.id OR me.role IN ('staff','admin','superadmin'))))
 );
$$;
REVOKE ALL ON FUNCTION public.can_access_chat_thread(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_chat_thread(uuid) TO authenticated,service_role;

CREATE FUNCTION public.vihem_chat_same_org(thread uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.vihem_chat_threads t JOIN public.vihem_profiles me ON me.id=auth.uid() WHERE t.id=thread AND me.active AND me.organisation_id=t.organisation_id);
$$;
REVOKE ALL ON FUNCTION public.vihem_chat_same_org(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_chat_same_org(uuid) TO authenticated;

-- Security-definer mutations below own writes. Broad legacy UPDATE policies are removed.
DO $$ DECLARE p record; BEGIN
 FOR p IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('vihem_chat_threads','vihem_chat_messages','vihem_chat_participants') LOOP
  EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,p.tablename);
 END LOOP;
END $$;
REVOKE ALL ON public.vihem_chat_threads,public.vihem_chat_messages,public.vihem_chat_participants FROM anon,authenticated;
GRANT SELECT ON public.vihem_chat_threads,public.vihem_chat_messages,public.vihem_chat_participants TO authenticated;
GRANT ALL ON public.vihem_chat_threads,public.vihem_chat_messages,public.vihem_chat_participants TO service_role;
CREATE POLICY chat_members_read ON public.vihem_chat_threads FOR SELECT TO authenticated USING(public.can_access_chat_thread(id));
CREATE POLICY chat_members_read ON public.vihem_chat_messages FOR SELECT TO authenticated USING(public.can_access_chat_thread(thread_id));
-- The user's own former membership remains visible so Realtime can deliver
-- revocation immediately, without exposing the conversation or other members.
CREATE POLICY chat_members_read ON public.vihem_chat_participants FOR SELECT TO authenticated USING(public.can_access_chat_thread(thread_id) OR (user_id=auth.uid() AND public.vihem_chat_same_org(thread_id)));
CREATE POLICY chat_service ON public.vihem_chat_threads FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY chat_service ON public.vihem_chat_messages FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY chat_service ON public.vihem_chat_participants FOR ALL TO service_role USING(true) WITH CHECK(true);

CREATE OR REPLACE FUNCTION public.prevent_multiple_tenants_in_chat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.left_at IS NULL AND (SELECT chat_type FROM public.vihem_chat_threads WHERE id=NEW.thread_id)<>'group' AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=NEW.user_id AND role='tenant')
 AND EXISTS(SELECT 1 FROM public.vihem_chat_participants cp JOIN public.vihem_profiles p ON p.id=cp.user_id WHERE cp.thread_id=NEW.thread_id AND cp.user_id<>NEW.user_id AND cp.left_at IS NULL AND p.role='tenant') THEN
  RAISE EXCEPTION 'En chatt kan bara innehålla en hyresgäst';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prevent_multiple_tenants_in_chat_trigger ON public.vihem_chat_participants;
CREATE TRIGGER prevent_multiple_tenants_in_chat_trigger BEFORE INSERT OR UPDATE OF user_id,thread_id,left_at ON public.vihem_chat_participants FOR EACH ROW EXECUTE FUNCTION public.prevent_multiple_tenants_in_chat();

CREATE FUNCTION public.vihem_chat_create(kind text, recipients uuid[] DEFAULT '{}', title text DEFAULT '', context_property uuid DEFAULT NULL, context_project uuid DEFAULT NULL, context_order uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me public.vihem_profiles; tid uuid; tenant uuid; member uuid; ids uuid[]; expected integer;
BEGIN
 SELECT * INTO me FROM public.vihem_profiles WHERE id=auth.uid() AND active;
 IF me.id IS NULL OR me.organisation_id IS NULL OR me.role NOT IN ('tenant','staff','admin','superadmin') THEN RAISE EXCEPTION 'Saknar chattbehörighet' USING ERRCODE='42501'; END IF;
 IF kind NOT IN ('direct','group','tenant_support') OR length(title)>160 THEN RAISE EXCEPTION 'Ogiltig konversation'; END IF;
 ids:=ARRAY(SELECT DISTINCT x FROM unnest(array_append(COALESCE(recipients,'{}'),me.id)) x WHERE x IS NOT NULL ORDER BY x);
 expected:=cardinality(ids);
 IF expected>100 OR (SELECT count(*) FROM public.vihem_profiles WHERE id=ANY(ids) AND active AND organisation_id=me.organisation_id AND role IN ('tenant','staff','admin','superadmin'))<>expected THEN RAISE EXCEPTION 'Otillåten deltagare' USING ERRCODE='42501'; END IF;
 IF me.role='tenant' THEN
  IF kind<>'tenant_support' OR expected<>1 OR context_property IS NOT NULL OR context_project IS NOT NULL OR context_order IS NOT NULL THEN RAISE EXCEPTION 'Hyresgäster kontaktar endast fastighetskontoret' USING ERRCODE='42501'; END IF;
  tenant:=me.id;
  ids:=ARRAY(SELECT id FROM public.vihem_profiles WHERE organisation_id=me.organisation_id AND active AND role IN ('staff','admin','superadmin') UNION SELECT me.id);
 ELSE
  IF (kind IN ('direct','tenant_support') AND expected<>2) OR (kind='group' AND (expected<2 OR btrim(title)='')) THEN RAISE EXCEPTION 'Välj deltagare och gruppnamn'; END IF;
  SELECT id INTO tenant FROM public.vihem_profiles WHERE id=ANY(ids) AND role='tenant' LIMIT 1;
  IF (kind<>'group' AND (SELECT count(*) FROM public.vihem_profiles WHERE id=ANY(ids) AND role='tenant')>1) OR (kind='direct' AND tenant IS NOT NULL) OR (kind='tenant_support' AND tenant IS NULL) THEN RAISE EXCEPTION 'Otillåten hyresgästkommunikation' USING ERRCODE='42501'; END IF;
 END IF;
 IF kind='group' THEN tenant:=NULL; END IF;
 -- Check linked entities with the caller's existing RLS, not this function's definer role.
 IF context_property IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_properties WHERE id=context_property AND organisation_id=me.organisation_id) THEN RAISE EXCEPTION 'Okänd fastighet'; END IF;
 IF context_project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_customer_projects WHERE id=context_project AND organisation_id=me.organisation_id AND me.role IN ('staff','admin') AND public.is_customer_projects_enabled(me.organisation_id)) THEN RAISE EXCEPTION 'Saknar projektbehörighet' USING ERRCODE='42501'; END IF;
 IF context_order IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_work_orders WHERE id=context_order AND organisation_id=me.organisation_id AND me.role IN ('staff','admin','superadmin')) THEN RAISE EXCEPTION 'Saknar arbetsorderbehörighet' USING ERRCODE='42501'; END IF;
 IF kind IN ('direct','tenant_support') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(me.organisation_id::text||kind||CASE WHEN kind='direct' THEN ids::text ELSE tenant::text END,0));
  SELECT t.id INTO tid FROM public.vihem_chat_threads t WHERE t.organisation_id=me.organisation_id AND t.chat_type=kind
   AND t.status='open' AND (CASE WHEN kind='tenant_support' THEN t.tenant_id=tenant ELSE
    (SELECT array_agg(p.user_id ORDER BY p.user_id) FROM public.vihem_chat_participants p WHERE p.thread_id=t.id AND p.left_at IS NULL)=ids END)
   ORDER BY t.created_at LIMIT 1;
  IF tid IS NOT NULL THEN RETURN tid; END IF;
 END IF;
 INSERT INTO public.vihem_chat_threads(organisation_id,tenant_id,chat_type,created_by,subject,property_id,project_id,work_order_id)
 VALUES(me.organisation_id,tenant,kind,me.id,CASE WHEN btrim(title)<>'' THEN btrim(title) WHEN kind='tenant_support' THEN 'Fastighetskontoret' ELSE 'Direktchatt' END,context_property,context_project,context_order) RETURNING id INTO tid;
 FOREACH member IN ARRAY ids LOOP INSERT INTO public.vihem_chat_participants(thread_id,user_id) VALUES(tid,member); END LOOP;
 RETURN tid;
END $$;

CREATE FUNCTION public.vihem_chat_send(thread uuid, client_id uuid, body text DEFAULT '', reply uuid DEFAULT NULL, file_path text DEFAULT NULL, file_name text DEFAULT NULL, file_mime text DEFAULT NULL, file_size bigint DEFAULT NULL, duration numeric DEFAULT NULL, mention_ids uuid[] DEFAULT '{}', order_link uuid DEFAULT NULL, project_link uuid DEFAULT NULL, forward_id uuid DEFAULT NULL) RETURNS public.vihem_chat_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request_hash text; t public.vihem_chat_threads; existing public.vihem_chat_messages; result public.vihem_chat_messages; allowed_types text[]:=ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','video/mp4','video/quicktime','video/webm','audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav'];
BEGIN
 SELECT * INTO t FROM public.vihem_chat_threads WHERE id=thread FOR UPDATE;
 IF NOT public.can_access_chat_thread(thread) THEN RAISE EXCEPTION 'Saknar åtkomst' USING ERRCODE='42501'; END IF;
 request_hash:=md5(jsonb_build_array(thread,auth.uid(),btrim(body),reply,file_path,file_name,file_mime,file_size,duration,COALESCE(mention_ids,'{}'),order_link,project_link,forward_id)::text);
 SELECT * INTO existing FROM public.vihem_chat_messages WHERE id=client_id;
 IF existing.id IS NOT NULL THEN
  IF existing.thread_id<>thread OR existing.sender_id<>auth.uid() OR existing.send_request_hash IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'Meddelandereferensen används redan'; END IF;
  RETURN existing;
 END IF;
 IF t.status<>'open' OR length(body)>10000 OR (btrim(body)='' AND file_path IS NULL AND order_link IS NULL AND project_link IS NULL) THEN RAISE EXCEPTION 'Ogiltigt meddelande eller stängd konversation'; END IF;
 IF reply IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_chat_messages WHERE id=reply AND thread_id=thread) THEN RAISE EXCEPTION 'Svaret tillhör inte konversationen'; END IF;
 IF file_path IS NOT NULL THEN
  IF file_path NOT LIKE t.organisation_id::text||'/'||thread::text||'/'||auth.uid()::text||'/%' OR file_path LIKE '%..%' OR file_mime IS NULL OR NOT(file_mime=ANY(allowed_types)) OR file_size IS NULL OR file_size NOT BETWEEN 1 AND 52428800 OR file_name IS NULL OR file_name='' OR length(file_name)>240 OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='vihem-chat-private' AND name=file_path AND (owner_id=auth.uid()::text OR user_metadata->>'chat_uploader'=auth.uid()::text) AND (metadata->>'size')::bigint=file_size AND metadata->>'mimetype'=file_mime) THEN RAISE EXCEPTION 'Otillåten bilaga'; END IF;
 END IF;
 IF duration IS NOT NULL AND (duration<=0 OR duration>300 OR file_path IS NULL OR file_mime IS NULL OR file_mime NOT LIKE 'audio/%') THEN RAISE EXCEPTION 'Ogiltig inspelning'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(COALESCE(mention_ids,'{}')) uid WHERE NOT EXISTS(SELECT 1 FROM public.vihem_chat_participants p WHERE p.thread_id=thread AND p.user_id=uid AND p.left_at IS NULL)) THEN RAISE EXCEPTION 'Omnämnandet gäller inte en deltagare'; END IF;
 IF order_link IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_work_orders WHERE id=order_link AND organisation_id=t.organisation_id AND public.vihem_get_my_role() IN ('staff','admin','superadmin')) THEN RAISE EXCEPTION 'Saknar arbetsorderbehörighet' USING ERRCODE='42501'; END IF;
 IF project_link IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_customer_projects WHERE id=project_link AND organisation_id=t.organisation_id AND public.vihem_get_my_role() IN ('staff','admin') AND public.is_customer_projects_enabled(t.organisation_id)) THEN RAISE EXCEPTION 'Saknar projektbehörighet' USING ERRCODE='42501'; END IF;
 IF forward_id IS NOT NULL AND (EXISTS(SELECT 1 FROM public.vihem_chat_participants p JOIN public.vihem_profiles u ON u.id=p.user_id WHERE p.thread_id IN (thread,(SELECT m.thread_id FROM public.vihem_chat_messages m WHERE m.id=forward_id)) AND u.role='tenant') OR file_path IS NOT NULL) THEN RAISE EXCEPTION 'Vidarebefordra endast text mellan interna personalkonversationer'; END IF;
 IF forward_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_chat_messages m WHERE m.id=forward_id AND m.deleted_at IS NULL AND public.can_access_chat_thread(m.thread_id)) THEN RAISE EXCEPTION 'Otillåten vidarebefordran'; END IF;
 INSERT INTO public.vihem_chat_messages(id,thread_id,sender_id,message,created_at,reply_to,attachment_path,attachment_name,attachment_type,attachment_size,attachment_mime,audio_duration,mentions,linked_work_order_id,linked_project_id,forwarded_from,send_request_hash)
 VALUES(client_id,thread,auth.uid(),btrim(body),clock_timestamp(),reply,file_path,file_name,CASE WHEN file_mime LIKE 'image/%' THEN 'image' WHEN file_mime LIKE 'audio/%' THEN 'audio' WHEN file_mime LIKE 'video/%' THEN 'video' WHEN file_path IS NOT NULL THEN 'document' END,file_size,file_mime,duration,COALESCE(mention_ids,'{}'),order_link,project_link,forward_id,request_hash) RETURNING * INTO result;
 UPDATE public.vihem_chat_threads SET last_message_at=result.created_at WHERE id=thread;
 INSERT INTO public.vihem_chat_participants(thread_id,user_id) VALUES(thread,auth.uid()) ON CONFLICT(thread_id,user_id) DO UPDATE SET manual_unread=false;
 RETURN result;
END $$;

CREATE FUNCTION public.vihem_chat_read(thread uuid, through_message uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE boundary timestamptz;
BEGIN
 PERFORM 1 FROM public.vihem_chat_threads WHERE id=thread FOR UPDATE;
 IF NOT public.can_access_chat_thread(thread) THEN RAISE EXCEPTION 'Saknar åtkomst' USING ERRCODE='42501'; END IF;
 SELECT created_at INTO boundary FROM public.vihem_chat_messages WHERE id=through_message AND thread_id=thread;
 IF boundary IS NULL THEN RETURN NULL; END IF;
 INSERT INTO public.vihem_chat_participants(thread_id,user_id,last_read_at) VALUES(thread,auth.uid(),boundary)
 ON CONFLICT(thread_id,user_id) DO UPDATE SET last_read_at=greatest(vihem_chat_participants.last_read_at,EXCLUDED.last_read_at),manual_unread=false;
 UPDATE public.vihem_notifications SET read_at=clock_timestamp() WHERE user_id=auth.uid() AND type IN ('chat','message','chat_message') AND read_at IS NULL
 AND (link='chat/'||thread::text OR link LIKE 'chat/'||thread::text||'/%') AND created_at<=boundary;
 RETURN boundary;
END $$;

CREATE FUNCTION public.vihem_chat_members(thread uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id',p.user_id,'last_read_at',p.last_read_at,'left_at',p.left_at,'name',u.name,'role',u.role) ORDER BY p.created_at),'[]'::jsonb)
 FROM public.vihem_chat_participants p JOIN public.vihem_profiles u ON u.id=p.user_id
 WHERE p.thread_id=thread AND p.left_at IS NULL AND u.organisation_id=(SELECT t.organisation_id FROM public.vihem_chat_threads t WHERE t.id=thread) AND public.can_access_chat_thread(thread);
$$;
REVOKE ALL ON FUNCTION public.vihem_chat_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_chat_members(uuid) TO authenticated;

CREATE FUNCTION public.vihem_chat_inbox(query text DEFAULT '', batch integer DEFAULT 100, offset_rows integer DEFAULT 0, thread_filter uuid DEFAULT NULL, filter_value text DEFAULT 'any') RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(row ORDER BY pinned DESC,last_message_at DESC,id),'[]'::jsonb) FROM (
 SELECT t.*,COALESCE(own.archived,false) AS archived,COALESCE(own.pinned,false) AS pinned,COALESCE(own.notification_mode,'all') AS notification_mode,
 COALESCE(own.manual_unread,false) AS manual_unread,
 (SELECT count(*) FROM public.vihem_chat_messages m WHERE m.thread_id=t.id AND m.sender_id<>auth.uid() AND m.created_at>COALESCE(own.last_read_at,'epoch'::timestamptz)) AS unread_count,
 (SELECT jsonb_build_object('id',m.id,'message',CASE WHEN m.deleted_at IS NULL THEN m.message ELSE 'Meddelandet har raderats' END,'sender_id',m.sender_id,'attachment_name',CASE WHEN m.deleted_at IS NULL THEN m.attachment_name END,'created_at',m.created_at) FROM public.vihem_chat_messages m WHERE m.thread_id=t.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS latest,
 public.vihem_chat_members(t.id) AS participants,
 (SELECT left(m.message,180) FROM public.vihem_chat_messages m WHERE m.thread_id=t.id AND m.deleted_at IS NULL AND query<>'' AND m.message ILIKE '%'||query||'%' ORDER BY m.created_at DESC LIMIT 1) AS search_excerpt
 FROM public.vihem_chat_threads t LEFT JOIN public.vihem_chat_participants own ON own.thread_id=t.id AND own.user_id=auth.uid() AND own.left_at IS NULL
 WHERE public.can_access_chat_thread(t.id) AND (thread_filter IS NULL OR t.id=thread_filter)
 AND (filter_value='any' OR (filter_value='archived' AND COALESCE(own.archived,false)) OR (NOT COALESCE(own.archived,false) AND (filter_value='all' OR (filter_value='staff' AND t.chat_type='direct') OR (filter_value='tenant' AND t.chat_type='tenant_support') OR (filter_value='group' AND t.chat_type='group') OR (filter_value='unread' AND (COALESCE(own.manual_unread,false) OR EXISTS(SELECT 1 FROM public.vihem_chat_messages m WHERE m.thread_id=t.id AND m.sender_id<>auth.uid() AND m.created_at>COALESCE(own.last_read_at,'epoch'::timestamptz)))))))
 AND (query='' OR t.subject ILIKE '%'||query||'%' OR EXISTS(SELECT 1 FROM jsonb_array_elements(public.vihem_chat_members(t.id)) member WHERE member->>'name' ILIKE '%'||query||'%') OR EXISTS(SELECT 1 FROM public.vihem_chat_messages m WHERE m.thread_id=t.id AND m.deleted_at IS NULL AND m.message ILIKE '%'||query||'%'))
 ORDER BY COALESCE(own.pinned,false) DESC,t.last_message_at DESC,t.id LIMIT least(greatest(batch,1),200) OFFSET greatest(offset_rows,0)
 ) row;
$$;

CREATE FUNCTION public.vihem_chat_history(thread uuid, before_time timestamptz DEFAULT NULL, before_id uuid DEFAULT NULL, batch integer DEFAULT 50) RETURNS SETOF public.vihem_chat_messages
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT m.* FROM public.vihem_chat_messages m WHERE m.thread_id=thread AND public.can_access_chat_thread(thread)
 AND (before_time IS NULL OR (m.created_at,m.id)<(before_time,COALESCE(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 ORDER BY m.created_at DESC,m.id DESC LIMIT least(greatest(batch,1),100);
$$;

CREATE OR REPLACE FUNCTION public.notify_chat_message_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org uuid; recipient record; mention boolean;
BEGIN
 SELECT organisation_id INTO org FROM public.vihem_chat_threads WHERE id=NEW.thread_id;
 FOR recipient IN SELECT p.user_id,p.notification_mode FROM public.vihem_chat_participants p JOIN public.vihem_profiles u ON u.id=p.user_id WHERE p.thread_id=NEW.thread_id AND p.left_at IS NULL AND p.user_id<>NEW.sender_id AND u.active AND u.organisation_id=org LOOP
  mention:=recipient.user_id=ANY(NEW.mentions);
  IF recipient.notification_mode='none' OR (recipient.notification_mode='mentions' AND NOT mention) THEN CONTINUE; END IF;
  PERFORM public.create_notification(recipient.user_id,org,CASE WHEN mention THEN 'Du har blivit omnämnd' ELSE 'Nytt chattmeddelande' END,CASE WHEN mention THEN 'Du har blivit omnämnd i en konversation.' ELSE 'Du har fått ett nytt meddelande i VI-HEM.' END,'chat','chat/'||NEW.thread_id||'/'||NEW.id,'chat_message');
 END LOOP;
 RETURN NEW;
END $$;

DO $$ DECLARE name text; signature regprocedure; BEGIN
 FOR name IN SELECT unnest(ARRAY['vihem_chat_create','vihem_chat_send','vihem_chat_read','vihem_chat_inbox','vihem_chat_history']) LOOP
  FOR signature IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=name LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',signature);
  END LOOP;
 END LOOP;
END $$;
DO $$ DECLARE name text; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN RAISE EXCEPTION 'Supabase Realtime publication saknas'; END IF;
 FOREACH name IN ARRAY ARRAY['vihem_chat_threads','vihem_chat_messages','vihem_chat_participants','vihem_notifications'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=name) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',name); END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
