BEGIN;
-- Existing notification transport, recipients, preferences and deep links are
-- preserved. This only changes future notification titles and previews.
CREATE OR REPLACE FUNCTION public.notify_chat_message_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 org uuid;
 recipient record;
 mention boolean;
 kind text;
 group_name text;
 sender_name text;
 preview text;
 heading text;
BEGIN
 SELECT organisation_id,chat_type,subject INTO org,kind,group_name
 FROM public.vihem_chat_threads WHERE id=NEW.thread_id;
 SELECT name INTO sender_name FROM public.vihem_profiles
 WHERE id=NEW.sender_id AND organisation_id=org;
 sender_name:=COALESCE(NULLIF(btrim(regexp_replace(sender_name,'[[:space:][:cntrl:]]+',' ','g')),''),'En deltagare');
 sender_name:=left(sender_name,80);
 group_name:=left(btrim(regexp_replace(COALESCE(group_name,''),'[[:space:][:cntrl:]]+',' ','g')),72);
 preview:=btrim(regexp_replace(COALESCE(NEW.message,''),'[[:space:][:cntrl:]]+',' ','g'));
 IF preview='' THEN
  preview:=CASE
   WHEN NEW.attachment_type='audio' OR NEW.attachment_mime LIKE 'audio/%' THEN 'Röstmeddelande'
   WHEN NEW.attachment_type='image' OR NEW.attachment_mime LIKE 'image/%' THEN 'Bild'
   WHEN NEW.attachment_type='video' OR NEW.attachment_mime LIKE 'video/%' THEN 'Videoklipp'
   WHEN NEW.attachment_path IS NOT NULL OR NEW.attachment_url IS NOT NULL THEN 'Dokument'
   WHEN NEW.linked_work_order_id IS NOT NULL THEN 'Delad arbetsorder'
   WHEN NEW.linked_project_id IS NOT NULL THEN 'Delat projekt'
   ELSE 'Nytt meddelande'
  END;
 END IF;
 IF length(preview)>180 THEN preview:=left(preview,179)||'…'; END IF;
 FOR recipient IN
  SELECT p.user_id,p.notification_mode FROM public.vihem_chat_participants p
  JOIN public.vihem_profiles u ON u.id=p.user_id
  WHERE p.thread_id=NEW.thread_id AND p.left_at IS NULL
   AND p.user_id<>NEW.sender_id AND u.active AND u.organisation_id=org
 LOOP
  IF kind='group' AND COALESCE((SELECT mute_groups FROM public.vihem_chat_preferences WHERE user_id=recipient.user_id),false) THEN CONTINUE; END IF;
  mention:=recipient.user_id=ANY(NEW.mentions);
  IF recipient.notification_mode='none' OR (recipient.notification_mode='mentions' AND NOT mention) THEN CONTINUE; END IF;
  heading:=sender_name||CASE WHEN mention THEN ' omnämnde dig' ELSE '' END;
  IF kind='group' AND group_name<>'' THEN heading:=heading||' · '||group_name; END IF;
  PERFORM public.create_notification(recipient.user_id,org,heading,preview,
   'chat','chat/'||NEW.thread_id||'/'||NEW.id,'chat_message');
 END LOOP;
 RETURN NEW;
END $$;
COMMIT;
