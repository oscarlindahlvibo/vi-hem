-- Manual sync always starts a complete property pass, even after a partial scheduled run.
BEGIN;
CREATE OR REPLACE FUNCTION public.vihem_vibofast_drive_worker(p_action text,p_data jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s vihem_vibofast_private.drive_settings; prop public.vihem_properties; v_entity uuid; v_kind text; previous jsonb; token uuid; batch_offset integer;
BEGIN
 IF p_action='secret' THEN RETURN (SELECT jsonb_build_object('secret',secret) FROM vihem_vibofast_private.drive_schedule); END IF;
 IF p_action='site' THEN RETURN (SELECT jsonb_build_object('organisation_id',organisation_id) FROM vihem_vibofast_private.site_content); END IF;
 IF p_action='claim' THEN
  SELECT * INTO s FROM vihem_vibofast_private.drive_settings WHERE id FOR UPDATE;
  IF NOT s.enabled THEN RETURN jsonb_build_object('status','disabled'); END IF;
  IF s.lease_until>now() THEN RETURN jsonb_build_object('status','busy'); END IF;
  SELECT p.* INTO prop FROM public.vihem_properties p JOIN vihem_vibofast_private.site_content c ON c.organisation_id=p.organisation_id
   LEFT JOIN vihem_vibofast_private.drive_runs r ON r.property_id=p.id
   WHERE (p_data->>'property_id' IS NULL OR p.id=(p_data->>'property_id')::uuid)
   ORDER BY (coalesce(r.next_offset,0)>0) DESC,r.last_attempt NULLS FIRST,p.id LIMIT 1;
  IF prop.id IS NULL THEN RETURN jsonb_build_object('status','empty'); END IF;
  SELECT coalesce(r.next_offset,0) INTO batch_offset FROM vihem_vibofast_private.drive_runs r WHERE r.property_id=prop.id;
  batch_offset:=CASE WHEN coalesce((p_data->>'restart')::boolean,false) THEN 0 ELSE coalesce(batch_offset,0) END;token:=gen_random_uuid();
  UPDATE vihem_vibofast_private.drive_settings SET lease=token,lease_until=now()+interval '3 minutes',property_id=prop.id WHERE id;
  INSERT INTO vihem_vibofast_private.drive_runs(property_id) VALUES(prop.id) ON CONFLICT(property_id) DO UPDATE SET last_attempt=now();
  RETURN jsonb_build_object('status','claimed','lease',token,'settings',to_jsonb(s)-'lease','property',to_jsonb(prop),'organisation_id',prop.organisation_id,'offset',batch_offset,'total',(SELECT count(*) FROM public.vihem_apartments a WHERE a.property_id=prop.id AND a.organisation_id=prop.organisation_id),
   'apartments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'apartment_number',a.apartment_number)) FROM (SELECT * FROM public.vihem_apartments WHERE property_id=prop.id AND organisation_id=prop.organisation_id ORDER BY id LIMIT 6 OFFSET batch_offset) a),'[]'),
   'folders',coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM vihem_vibofast_private.drive_folders f),'[]'),
   'images',coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM vihem_vibofast_private.drive_images i),'[]'));
 END IF;
 SELECT * INTO s FROM vihem_vibofast_private.drive_settings WHERE id FOR UPDATE;
 IF s.lease IS NULL OR s.lease IS DISTINCT FROM (p_data->>'lease')::uuid OR s.lease_until<now() THEN RAISE EXCEPTION 'Sync lease expired'; END IF;
 IF p_action='finish' THEN
  UPDATE vihem_vibofast_private.drive_runs SET error=p_data->>'error',next_offset=coalesce((p_data->>'next_offset')::integer,0),last_success=CASE WHEN p_data->>'error' IS NULL AND coalesce((p_data->>'next_offset')::integer,0)=0 THEN now() ELSE last_success END WHERE property_id=s.property_id;
  UPDATE vihem_vibofast_private.drive_settings SET lease=NULL,lease_until=NULL,property_id=NULL,last_error=p_data->>'error' WHERE id;
  RETURN '{}';
 END IF;
 UPDATE vihem_vibofast_private.drive_settings SET lease_until=now()+interval '3 minutes' WHERE id;
 IF p_action='heartbeat' THEN RETURN '{}'; END IF;
 v_kind:=p_data->>'kind';v_entity:=(p_data->>'entity_id')::uuid;
 IF ((v_kind='property' AND v_entity=s.property_id) OR (v_kind='apartment' AND EXISTS(SELECT 1 FROM public.vihem_apartments a JOIN vihem_vibofast_private.site_content c ON c.organisation_id=a.organisation_id WHERE a.id=v_entity AND a.property_id=s.property_id))) IS NOT TRUE THEN RAISE EXCEPTION 'Wrong entity'; END IF;
 IF p_action='folder' THEN
  IF p_data->>'folder_id' !~ '^[a-zA-Z0-9_-]+$' THEN RAISE EXCEPTION 'Invalid folder id'; END IF;
  INSERT INTO vihem_vibofast_private.drive_folders(kind,entity_id,folder_id,extra) VALUES(v_kind,v_entity,p_data->>'folder_id',coalesce(p_data->'extra','{}'))
   ON CONFLICT(kind,entity_id) DO UPDATE SET folder_id=excluded.folder_id,extra=excluded.extra;
  RETURN '{}';
 END IF;
 IF p_action='images' THEN
  IF jsonb_typeof(p_data->'images') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid images'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'images') x WHERE x->>'storage_path' IS NULL OR x->>'storage_path' NOT LIKE v_kind||'/'||v_entity::text||'/%' OR x->>'storage_path' ~ '\.\.' OR x->>'file_id' IS NULL) THEN RAISE EXCEPTION 'Invalid image path'; END IF;
  SELECT coalesce(jsonb_agg(i.storage_path),'[]') INTO previous FROM vihem_vibofast_private.drive_images i WHERE i.kind=v_kind AND i.entity_id=v_entity AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'images') x WHERE x->>'storage_path'=i.storage_path);
  DELETE FROM vihem_vibofast_private.drive_images i WHERE i.kind=v_kind AND i.entity_id=v_entity;
  INSERT INTO vihem_vibofast_private.drive_images(kind,entity_id,file_id,name,version,storage_path,position)
   SELECT v_kind,v_entity,x->>'file_id',x->>'name',x->>'version',x->>'storage_path',ordinality::integer FROM jsonb_array_elements(p_data->'images') WITH ORDINALITY AS list(x,ordinality);
  RETURN jsonb_build_object('obsolete',previous);
 END IF;
 RAISE EXCEPTION 'Unknown action';
END;
$$;

COMMIT;
