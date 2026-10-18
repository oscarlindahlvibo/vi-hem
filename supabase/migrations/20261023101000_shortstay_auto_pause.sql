BEGIN;
-- Pausing must remain possible if the room's API connection or chosen translation has been removed.
DO $$DECLARE f text;needle text:='AND t.translations ? p_language AND u.beds24_enabled AND nullif(u.beds24_room_id,'''') IS NOT NULL AND nullif(u.beds24_property_id,'''') IS NOT NULL';BEGIN
 SELECT pg_get_functiondef('public.vihem_save_guest_message_rule(uuid,integer,uuid,uuid,text[],text,text,integer,time,boolean)'::regprocedure) INTO f;
 IF position(needle in f)=0 THEN RAISE EXCEPTION 'Unexpected automatic-message rule definition; inspect before changing';END IF;
 f:=replace(f,needle,'AND (NOT p_enabled OR (t.translations ? p_language AND u.beds24_enabled AND nullif(u.beds24_room_id,'''') IS NOT NULL AND nullif(u.beds24_property_id,'''') IS NOT NULL))');
 EXECUTE f;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
