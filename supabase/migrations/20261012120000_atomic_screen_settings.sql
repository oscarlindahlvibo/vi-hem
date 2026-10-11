-- Backend before the premium frontend. Existing readers/clients remain compatible.
CREATE OR REPLACE FUNCTION public.vihem_save_screen_settings(p_settings jsonb, p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
 actor public.vihem_profiles%ROWTYPE;
 root jsonb;
 item jsonb;
 keys text[] := ARRAY[]::text[];
BEGIN
 SELECT * INTO actor FROM public.vihem_profiles WHERE id=auth.uid();
 IF actor.id IS NULL OR NOT actor.active OR actor.role NOT IN ('admin','superadmin') OR actor.organisation_id IS NULL THEN
   RAISE EXCEPTION 'Screen administrator required' USING ERRCODE='42501';
 END IF;
 IF p_settings IS NULL OR jsonb_typeof(p_settings->'screens') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Invalid screen configuration' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(p_settings->'screens') NOT BETWEEN 1 AND 50 THEN
   RAISE EXCEPTION 'Configure between 1 and 50 screens' USING ERRCODE='22023';
 END IF;
 SELECT COALESCE(settings,'{}'::jsonb) INTO root FROM public.vihem_organisations
 WHERE id=actor.organisation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Organisation unavailable' USING ERRCODE='42501'; END IF;
 IF COALESCE(root->'screen_settings','null'::jsonb) IS DISTINCT FROM COALESCE(p_expected,'null'::jsonb) THEN
   -- Lost-response retry of the exact confirmed configuration is a read-only replay.
   IF root->'screen_settings'=p_settings THEN RETURN root; END IF;
   RAISE EXCEPTION 'Screen settings changed; reload before saving' USING ERRCODE='PT409';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_settings->'screens') LOOP
   IF COALESCE(item->>'screen_key','') !~ '^[a-zA-Z0-9_-]{1,80}$'
     OR item->>'screen_key'=ANY(keys)
     OR COALESCE(btrim(item->>'name'),'')=''
     OR length(item->>'name')>160
     OR COALESCE(item->>'screen_view','') NOT IN ('presentation','short-stay','work-orders','meeting','laundry')
     OR jsonb_typeof(item->'presentation_settings') IS DISTINCT FROM 'object'
     OR COALESCE(item->>'meeting_part','full') NOT IN ('full','part-1','part-2') THEN
     RAISE EXCEPTION 'Invalid screen configuration' USING ERRCODE='22023';
   END IF;
   IF COALESCE(item->>'laundry_room_id','')<>'' AND NOT EXISTS (
     SELECT 1 FROM public.vihem_laundry_rooms WHERE id::text=item->>'laundry_room_id' AND organisation_id=actor.organisation_id
   ) THEN RAISE EXCEPTION 'Laundry room outside organisation' USING ERRCODE='42501'; END IF;
   IF COALESCE(item->>'meeting_id','')<>'' AND NOT EXISTS (
     SELECT 1 FROM public.vihem_meetings WHERE id::text=item->>'meeting_id' AND organisation_id=actor.organisation_id
   ) THEN RAISE EXCEPTION 'Meeting outside organisation' USING ERRCODE='42501'; END IF;
   keys := array_append(keys,item->>'screen_key');
   INSERT INTO public.vihem_screen_settings(organisation_id,screen_key,screen_view,presentation_settings,created_by,updated_by,updated_at)
   VALUES(actor.organisation_id,item->>'screen_key',item->>'screen_view',
     (item->'presentation_settings') || jsonb_build_object('screen_name',item->>'name','laundry_room_id',COALESCE(item->>'laundry_room_id',''),'meeting_id',COALESCE(item->>'meeting_id',''),'meeting_part',COALESCE(item->>'meeting_part','full')),
     actor.id,actor.id,now())
   ON CONFLICT(organisation_id,screen_key) DO UPDATE SET screen_view=EXCLUDED.screen_view,
     presentation_settings=EXCLUDED.presentation_settings,updated_by=actor.id,updated_at=now();
 END LOOP;
 DELETE FROM public.vihem_screen_settings WHERE organisation_id=actor.organisation_id AND NOT(screen_key=ANY(keys));
 -- Merge ONLY this module's key into the latest locked settings: unrelated integrations survive.
 root := root || jsonb_build_object('screen_settings',p_settings);
 UPDATE public.vihem_organisations SET settings=root WHERE id=actor.organisation_id;
 RETURN root;
END;
$$;
REVOKE ALL ON FUNCTION public.vihem_save_screen_settings(jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vihem_save_screen_settings(jsonb,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
