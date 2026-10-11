-- Run ONLY against isolated synthetic QA, in a rollback transaction with
-- 20261013110000_chat_notification_previews.sql loaded in the same transaction.
DO $$
DECLARE org uuid; users uuid[]; outsider uuid; thread uuid; mid uuid; n record;
BEGIN
 SELECT id INTO org FROM public.vihem_organisations WHERE name='VI-HEM Chat QA';
 IF org IS NULL THEN RAISE EXCEPTION 'Synthetic QA organisation required'; END IF;
 SELECT array_agg(id ORDER BY id) INTO users FROM public.vihem_profiles
 WHERE organisation_id=org AND active AND role IN ('admin','staff');
 IF cardinality(users)<3 THEN RAISE EXCEPTION 'Three synthetic staff accounts required'; END IF;
 SELECT id INTO outsider FROM public.vihem_profiles WHERE organisation_id<>org AND active AND role='admin' LIMIT 1;
 IF outsider IS NULL THEN RAISE EXCEPTION 'Cross-org synthetic account required'; END IF;
 UPDATE public.vihem_profiles SET name='Åsa Öberg' WHERE id=users[1];
 INSERT INTO public.vihem_chat_threads(organisation_id,chat_type,subject,created_by)
 VALUES(org,'direct','',users[1]) RETURNING id INTO thread;
 INSERT INTO public.vihem_chat_participants(thread_id,user_id)
 VALUES(thread,users[1]),(thread,users[2]),(thread,users[3]),(thread,outsider);
 UPDATE public.vihem_chat_participants SET notification_mode='none' WHERE thread_id=thread AND user_id=users[3];
 INSERT INTO public.vihem_chat_messages(thread_id,sender_id,message)
 VALUES(thread,users[1],E'Hej!\n\tHur mår du? ❤️') RETURNING id INTO mid;
 SELECT * INTO n FROM public.vihem_notifications WHERE link='chat/'||thread||'/'||mid;
 IF n.title IS DISTINCT FROM 'Åsa Öberg' OR n.message IS DISTINCT FROM 'Hej! Hur mår du? ❤️' OR n.user_id IS DISTINCT FROM users[2] THEN
  RAISE EXCEPTION 'Sender/preview/recipient incorrect'; END IF;
 IF (SELECT count(*) FROM public.vihem_notifications WHERE link='chat/'||thread||'/'||mid)<>1 THEN RAISE EXCEPTION 'Sender/muted/cross-org received notification'; END IF;
 INSERT INTO public.vihem_chat_messages(thread_id,sender_id,message)
 VALUES(thread,users[1],repeat('ö',200)) RETURNING id INTO mid;
 IF NOT EXISTS(SELECT 1 FROM public.vihem_notifications WHERE link='chat/'||thread||'/'||mid AND length(message)=180 AND right(message,1)='…') THEN RAISE EXCEPTION 'Long Unicode preview not bounded'; END IF;
 INSERT INTO public.vihem_chat_messages(thread_id,sender_id,message,attachment_type,attachment_mime,attachment_path)
 VALUES(thread,users[1],'','image','image/jpeg','qa/photo.jpg') RETURNING id INTO mid;
 IF NOT EXISTS(SELECT 1 FROM public.vihem_notifications WHERE link='chat/'||thread||'/'||mid AND message='Bild') THEN RAISE EXCEPTION 'Image preview missing'; END IF;
 INSERT INTO public.vihem_chat_messages(thread_id,sender_id,message,attachment_type,attachment_mime,attachment_path)
 VALUES(thread,users[1],'','audio','audio/mp4','qa/audio.m4a') RETURNING id INTO mid;
 IF NOT EXISTS(SELECT 1 FROM public.vihem_notifications WHERE link='chat/'||thread||'/'||mid AND message='Röstmeddelande') THEN RAISE EXCEPTION 'Audio preview missing'; END IF;
 INSERT INTO public.vihem_chat_messages(thread_id,sender_id,message,attachment_mime,attachment_path)
 VALUES(thread,users[1],'','application/pdf','qa/document.pdf') RETURNING id INTO mid;
 IF NOT EXISTS(SELECT 1 FROM public.vihem_notifications WHERE link='chat/'||thread||'/'||mid AND message='Dokument') THEN RAISE EXCEPTION 'Document preview missing'; END IF;
 UPDATE public.vihem_chat_threads SET chat_type='group',subject='Fastighetsteamet' WHERE id=thread;
 UPDATE public.vihem_chat_participants SET notification_mode='mentions' WHERE thread_id=thread AND user_id=users[2];
 INSERT INTO public.vihem_chat_messages(thread_id,sender_id,message)
 VALUES(thread,users[1],'Ingen omnämnd') RETURNING id INTO mid;
 IF EXISTS(SELECT 1 FROM public.vihem_notifications WHERE link='chat/'||thread||'/'||mid) THEN RAISE EXCEPTION 'Mention-only preference ignored'; END IF;
 INSERT INTO public.vihem_chat_messages(thread_id,sender_id,message,mentions)
 VALUES(thread,users[1],'@Test Kan du kika?',ARRAY[users[2]]) RETURNING id INTO mid;
 IF NOT EXISTS(SELECT 1 FROM public.vihem_notifications WHERE link='chat/'||thread||'/'||mid AND title='Åsa Öberg omnämnde dig · Fastighetsteamet' AND message='@Test Kan du kika?') THEN RAISE EXCEPTION 'Group mention preview incorrect'; END IF;
 INSERT INTO public.vihem_chat_preferences(user_id,mute_groups) VALUES(users[2],true)
 ON CONFLICT(user_id) DO UPDATE SET mute_groups=true;
 INSERT INTO public.vihem_chat_messages(thread_id,sender_id,message,mentions)
 VALUES(thread,users[1],'Tyst grupp',ARRAY[users[2]]) RETURNING id INTO mid;
 IF EXISTS(SELECT 1 FROM public.vihem_notifications WHERE link='chat/'||thread||'/'||mid) THEN RAISE EXCEPTION 'Group mute ignored'; END IF;
 UPDATE public.vihem_chat_threads SET chat_type='direct' WHERE id=thread;
 UPDATE public.vihem_chat_participants SET notification_mode='all',left_at=clock_timestamp() WHERE thread_id=thread AND user_id=users[2];
 INSERT INTO public.vihem_chat_messages(thread_id,sender_id,message)
 VALUES(thread,users[1],'Lämnad chatt') RETURNING id INTO mid;
 IF EXISTS(SELECT 1 FROM public.vihem_notifications WHERE link='chat/'||thread||'/'||mid) THEN RAISE EXCEPTION 'Former member notified'; END IF;
 RAISE NOTICE 'PASS: sender/text/Unicode/bounds/attachments/groups/mentions/mutes/deep links/cross-org/former-member';
END $$;
