BEGIN;
CREATE TABLE public.vihem_chat_reactions (
 message_id uuid NOT NULL REFERENCES public.vihem_chat_messages(id) ON DELETE CASCADE,
 thread_id uuid NOT NULL REFERENCES public.vihem_chat_threads(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.vihem_profiles(id),
 emoji text NOT NULL CHECK(emoji IN ('👍','❤️','😂','✅')),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(message_id,user_id,emoji)
);
ALTER TABLE public.vihem_chat_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_chat_reactions FROM anon,authenticated;
GRANT SELECT ON public.vihem_chat_reactions TO authenticated;
GRANT ALL ON public.vihem_chat_reactions TO service_role;
CREATE POLICY members_read ON public.vihem_chat_reactions FOR SELECT TO authenticated USING(public.can_access_chat_thread(thread_id));
CREATE POLICY service_all ON public.vihem_chat_reactions FOR ALL TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION public.vihem_chat_message_action(message_id uuid, action text, text_value text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m public.vihem_chat_messages;
BEGIN
 SELECT * INTO m FROM public.vihem_chat_messages WHERE id=message_id;
 PERFORM 1 FROM public.vihem_chat_threads WHERE id=m.thread_id FOR UPDATE;
 SELECT * INTO m FROM public.vihem_chat_messages WHERE id=message_id FOR UPDATE;
 IF m.id IS NULL OR NOT public.can_access_chat_thread(m.thread_id) THEN RAISE EXCEPTION 'Saknar åtkomst' USING ERRCODE='42501'; END IF;
 IF action='reaction' THEN
  IF m.deleted_at IS NOT NULL OR text_value NOT IN ('👍','❤️','😂','✅') OR text_value IS NULL THEN RAISE EXCEPTION 'Ogiltig reaktion'; END IF;
  IF EXISTS(SELECT 1 FROM public.vihem_chat_reactions r WHERE r.message_id=m.id AND r.user_id=auth.uid() AND r.emoji=text_value AND r.active) THEN
   UPDATE public.vihem_chat_reactions r SET active=false WHERE r.message_id=m.id AND r.user_id=auth.uid() AND r.emoji=text_value;
  ELSE INSERT INTO public.vihem_chat_reactions(message_id,thread_id,user_id,emoji) VALUES(m.id,m.thread_id,auth.uid(),text_value) ON CONFLICT ON CONSTRAINT vihem_chat_reactions_pkey DO UPDATE SET active=true; END IF;
 ELSIF action IN ('edit','delete') THEN
  IF m.sender_id<>auth.uid() OR m.created_at<clock_timestamp()-interval '15 minutes' OR m.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Du kan bara ändra egna meddelanden inom 15 minuter' USING ERRCODE='42501'; END IF;
  IF action='edit' THEN
   IF text_value IS NULL OR btrim(text_value)='' OR length(text_value)>10000 THEN RAISE EXCEPTION 'Ogiltig text'; END IF;
   UPDATE public.vihem_chat_messages SET message=btrim(text_value),edited_at=clock_timestamp() WHERE id=m.id;
  ELSE
   UPDATE public.vihem_chat_messages SET message='',attachment_path=NULL,attachment_url=NULL,attachment_name=NULL,attachment_mime=NULL,attachment_type=NULL,attachment_size=NULL,audio_duration=NULL,mentions='{}',linked_work_order_id=NULL,linked_project_id=NULL,deleted_at=clock_timestamp() WHERE id=m.id;
   UPDATE public.vihem_chat_reactions r SET active=false WHERE r.message_id=m.id;
  END IF;
 ELSE RAISE EXCEPTION 'Okänd åtgärd'; END IF;
END $$;

CREATE FUNCTION public.vihem_chat_settings(thread uuid, archived_value boolean DEFAULT NULL, pinned_value boolean DEFAULT NULL, unread_value boolean DEFAULT NULL, notification_value text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM 1 FROM public.vihem_chat_threads WHERE id=thread FOR UPDATE;
 IF NOT public.can_access_chat_thread(thread) THEN RAISE EXCEPTION 'Saknar åtkomst' USING ERRCODE='42501'; END IF;
 IF notification_value IS NOT NULL AND notification_value NOT IN ('all','mentions','none') THEN RAISE EXCEPTION 'Ogiltig inställning'; END IF;
 INSERT INTO public.vihem_chat_participants(thread_id,user_id) VALUES(thread,auth.uid()) ON CONFLICT DO NOTHING;
 UPDATE public.vihem_chat_participants SET archived=COALESCE(archived_value,archived),pinned=COALESCE(pinned_value,pinned),manual_unread=COALESCE(unread_value,manual_unread),notification_mode=COALESCE(notification_value,notification_mode) WHERE thread_id=thread AND user_id=auth.uid() AND left_at IS NULL;
END $$;

CREATE FUNCTION public.vihem_chat_group(thread uuid, action text, target_user uuid DEFAULT NULL, title text DEFAULT NULL, image_path text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t public.vihem_chat_threads; me public.vihem_profiles; target public.vihem_profiles;
BEGIN
 SELECT * INTO t FROM public.vihem_chat_threads WHERE id=thread FOR UPDATE;
 SELECT * INTO me FROM public.vihem_profiles WHERE id=auth.uid() AND active;
 IF NOT public.can_access_chat_thread(thread) OR t.chat_type<>'group' THEN RAISE EXCEPTION 'Saknar gruppbehörighet' USING ERRCODE='42501'; END IF;
 IF action='leave' THEN UPDATE public.vihem_chat_participants SET left_at=clock_timestamp() WHERE thread_id=thread AND user_id=me.id; RETURN; END IF;
 IF me.role NOT IN ('staff','admin','superadmin') OR (t.created_by<>me.id AND me.role NOT IN ('admin','superadmin')) THEN RAISE EXCEPTION 'Endast gruppskaparen eller administratörer hanterar gruppen' USING ERRCODE='42501'; END IF;
 IF action='rename' THEN
  IF title IS NULL OR btrim(title)='' OR length(title)>160 THEN RAISE EXCEPTION 'Ange ett gruppnamn'; END IF;
  UPDATE public.vihem_chat_threads SET subject=btrim(title) WHERE id=thread;
 ELSIF action='image' THEN
  IF image_path IS NOT NULL AND (image_path NOT LIKE t.organisation_id::text||'/'||thread::text||'/'||me.id::text||'/%' OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE name=image_path AND bucket_id='vihem-chat-private' AND (owner_id=me.id::text OR user_metadata->>'chat_uploader'=me.id::text) AND metadata->>'mimetype' IN ('image/jpeg','image/png','image/webp'))) THEN RAISE EXCEPTION 'Otillåten gruppbild'; END IF;
  UPDATE public.vihem_chat_threads SET group_image_path=image_path WHERE id=thread;
 ELSIF action IN ('add','remove') THEN
  SELECT * INTO target FROM public.vihem_profiles WHERE id=target_user AND active AND organisation_id=t.organisation_id AND role IN ('tenant','staff','admin','superadmin');
  IF target.id IS NULL THEN RAISE EXCEPTION 'Otillåten deltagare' USING ERRCODE='42501'; END IF;
  IF action='add' THEN INSERT INTO public.vihem_chat_participants(thread_id,user_id) VALUES(thread,target.id) ON CONFLICT(thread_id,user_id) DO UPDATE SET left_at=NULL,last_read_at=NULL;
  ELSE
   IF target.id=t.created_by AND me.role NOT IN ('admin','superadmin') THEN RAISE EXCEPTION 'Gruppskaparen kan bara lämna själv'; END IF;
   UPDATE public.vihem_chat_participants SET left_at=clock_timestamp() WHERE thread_id=thread AND user_id=target.id;
  END IF;
 ELSE RAISE EXCEPTION 'Okänd gruppåtgärd'; END IF;
END $$;

-- Ephemeral activity uses per-event RLS. Unlike a cached Broadcast authorization,
-- removed members lose access immediately. Only expiry timestamps are stored, never typed text.
CREATE TABLE public.vihem_chat_activity (
 thread_id uuid NOT NULL REFERENCES public.vihem_chat_threads(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.vihem_profiles(id),
 typing_until timestamptz NOT NULL DEFAULT 'epoch', online_until timestamptz NOT NULL DEFAULT 'epoch',
 PRIMARY KEY(thread_id,user_id)
);
CREATE TABLE public.vihem_chat_preferences (
 user_id uuid PRIMARY KEY REFERENCES public.vihem_profiles(id), show_presence boolean NOT NULL DEFAULT true, mute_groups boolean NOT NULL DEFAULT false
);
ALTER TABLE public.vihem_chat_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_chat_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_chat_activity,public.vihem_chat_preferences FROM anon,authenticated;
GRANT SELECT ON public.vihem_chat_activity,public.vihem_chat_preferences TO authenticated;
GRANT ALL ON public.vihem_chat_activity,public.vihem_chat_preferences TO service_role;
CREATE POLICY active_members_read ON public.vihem_chat_activity FOR SELECT TO authenticated USING(public.can_access_chat_thread(thread_id) AND greatest(typing_until,online_until)>now());
CREATE POLICY self_read ON public.vihem_chat_preferences FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY service_all ON public.vihem_chat_activity FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY service_all ON public.vihem_chat_preferences FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE FUNCTION public.vihem_chat_activity_update(thread uuid, typing boolean DEFAULT false, online boolean DEFAULT true, show_presence boolean DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE show_status boolean;
BEGIN
 IF NOT public.can_access_chat_thread(thread) THEN RAISE EXCEPTION 'Saknar åtkomst' USING ERRCODE='42501'; END IF;
 IF show_presence IS NOT NULL THEN
  INSERT INTO public.vihem_chat_preferences(user_id,show_presence) VALUES(auth.uid(),show_presence) ON CONFLICT(user_id) DO UPDATE SET show_presence=EXCLUDED.show_presence;
  IF NOT show_presence THEN UPDATE public.vihem_chat_activity SET online_until='epoch',typing_until='epoch' WHERE user_id=auth.uid(); END IF;
 END IF;
 SELECT COALESCE((SELECT p.show_presence FROM public.vihem_chat_preferences p WHERE p.user_id=auth.uid()),true) INTO show_status;
 INSERT INTO public.vihem_chat_activity(thread_id,user_id,typing_until,online_until) VALUES(thread,auth.uid(),CASE WHEN typing AND show_status THEN clock_timestamp()+interval '8 seconds' ELSE 'epoch' END,CASE WHEN online AND show_status THEN clock_timestamp()+interval '45 seconds' ELSE 'epoch' END)
 ON CONFLICT(thread_id,user_id) DO UPDATE SET typing_until=EXCLUDED.typing_until,online_until=EXCLUDED.online_until;
END $$;
CREATE FUNCTION public.vihem_chat_preferences_save(presence_value boolean DEFAULT NULL, mute_groups_value boolean DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND organisation_id IS NOT NULL AND role IN ('tenant','staff','admin','superadmin')) THEN RAISE EXCEPTION 'Saknar behörighet' USING ERRCODE='42501'; END IF;
 INSERT INTO public.vihem_chat_preferences(user_id) VALUES(auth.uid()) ON CONFLICT DO NOTHING;
 UPDATE public.vihem_chat_preferences SET show_presence=COALESCE(presence_value,show_presence),mute_groups=COALESCE(mute_groups_value,mute_groups) WHERE user_id=auth.uid();
 IF presence_value=false THEN UPDATE public.vihem_chat_activity SET online_until='epoch',typing_until='epoch' WHERE user_id=auth.uid(); END IF;
END $$;
REVOKE ALL ON FUNCTION public.vihem_chat_preferences_save(boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_chat_preferences_save(boolean,boolean) TO authenticated;
-- TTL cleanup is shared-infrastructure safe: only this new activity table is affected.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  PERFORM cron.schedule('vihem-chat-activity-expiry','* * * * *',$job$DELETE FROM public.vihem_chat_activity WHERE greatest(typing_until,online_until)<now()-interval '1 minute';$job$);
 END IF;
END $$;
DO $$ DECLARE name text; signature regprocedure; BEGIN
 FOREACH name IN ARRAY ARRAY['vihem_chat_message_action','vihem_chat_settings','vihem_chat_group','vihem_chat_activity_update'] LOOP
  FOR signature IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=name LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',signature);
  END LOOP;
 END LOOP;
 FOREACH name IN ARRAY ARRAY['vihem_chat_reactions','vihem_chat_activity'] LOOP
  EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',name);
 END LOOP;
END $$;

CREATE FUNCTION public.vihem_chat_unread() RETURNS bigint LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT COALESCE(sum(unread),0)::bigint FROM (
 SELECT greatest(CASE WHEN COALESCE(p.manual_unread,false) THEN 1 ELSE 0 END,(SELECT count(*) FROM public.vihem_chat_messages m WHERE m.thread_id=t.id AND m.sender_id<>auth.uid() AND m.created_at>COALESCE(p.last_read_at,'epoch'::timestamptz))) unread
 FROM public.vihem_chat_threads t LEFT JOIN public.vihem_chat_participants p ON p.thread_id=t.id AND p.user_id=auth.uid() AND p.left_at IS NULL WHERE public.can_access_chat_thread(t.id) AND NOT COALESCE(p.archived,false)
 ) unread_threads;
$$;
REVOKE ALL ON FUNCTION public.vihem_chat_unread() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_chat_unread() TO authenticated;
CREATE FUNCTION public.vihem_chat_status(thread uuid, new_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.can_access_chat_thread(thread) OR public.vihem_get_my_role() NOT IN ('staff','admin','superadmin') THEN RAISE EXCEPTION 'Saknar behörighet' USING ERRCODE='42501'; END IF;
 IF new_status NOT IN ('open','closed') THEN RAISE EXCEPTION 'Ogiltig status'; END IF;
 UPDATE public.vihem_chat_threads SET status=new_status WHERE id=thread;
END $$;
REVOKE ALL ON FUNCTION public.vihem_chat_status(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_chat_status(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.notify_chat_message_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org uuid; recipient record; mention boolean;
BEGIN
 SELECT organisation_id INTO org FROM public.vihem_chat_threads WHERE id=NEW.thread_id;
 FOR recipient IN SELECT p.user_id,p.notification_mode FROM public.vihem_chat_participants p JOIN public.vihem_profiles u ON u.id=p.user_id WHERE p.thread_id=NEW.thread_id AND p.left_at IS NULL AND p.user_id<>NEW.sender_id AND u.active AND u.organisation_id=org LOOP
  IF (SELECT chat_type FROM public.vihem_chat_threads WHERE id=NEW.thread_id)='group' AND COALESCE((SELECT mute_groups FROM public.vihem_chat_preferences WHERE user_id=recipient.user_id),false) THEN CONTINUE; END IF;
  mention:=recipient.user_id=ANY(NEW.mentions);
  IF recipient.notification_mode='none' OR (recipient.notification_mode='mentions' AND NOT mention) THEN CONTINUE; END IF;
  PERFORM public.create_notification(recipient.user_id,org,CASE WHEN mention THEN 'Du har blivit omnämnd' ELSE 'Nytt chattmeddelande' END,CASE WHEN mention THEN 'Du har blivit omnämnd i en konversation.' ELSE 'Du har fått ett nytt meddelande i VI-HEM.' END,'chat','chat/'||NEW.thread_id||'/'||NEW.id,'chat_message');
 END LOOP;
 RETURN NEW;
END $$;
COMMIT;
