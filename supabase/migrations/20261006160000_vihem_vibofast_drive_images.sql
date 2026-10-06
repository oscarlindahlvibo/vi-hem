-- Own private schema only; Google documents/storage configuration is not changed.
BEGIN;
CREATE TABLE vihem_vibofast_private.drive_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), root_folder_id text NOT NULL DEFAULT '', site_folder_id text NOT NULL DEFAULT '',
 shared_drive_id text NOT NULL DEFAULT '', delegated_user text NOT NULL DEFAULT '', enabled boolean NOT NULL DEFAULT false,
 revision bigint NOT NULL DEFAULT 1, lease uuid, lease_until timestamptz, property_id uuid, last_error text,
 CHECK(NOT enabled OR (root_folder_id<>'' AND site_folder_id<>''))
);
INSERT INTO vihem_vibofast_private.drive_settings(id) VALUES(true);
CREATE TABLE vihem_vibofast_private.drive_folders (
 kind text NOT NULL CHECK(kind IN('property','apartment')), entity_id uuid NOT NULL, folder_id text NOT NULL,
 extra jsonb NOT NULL DEFAULT '{}', PRIMARY KEY(kind,entity_id)
);
CREATE TABLE vihem_vibofast_private.drive_images (
 kind text NOT NULL,entity_id uuid NOT NULL,file_id text NOT NULL,name text NOT NULL,version text NOT NULL,
 storage_path text NOT NULL,position integer NOT NULL,
 PRIMARY KEY(kind,entity_id,file_id),FOREIGN KEY(kind,entity_id) REFERENCES vihem_vibofast_private.drive_folders ON DELETE CASCADE
);
CREATE TABLE vihem_vibofast_private.drive_runs (property_id uuid PRIMARY KEY,last_attempt timestamptz NOT NULL DEFAULT now(),last_success timestamptz,error text,next_offset integer NOT NULL DEFAULT 0);
CREATE TABLE vihem_vibofast_private.drive_schedule (id boolean PRIMARY KEY DEFAULT true CHECK(id),secret text NOT NULL DEFAULT encode(gen_random_bytes(32),'hex'));
INSERT INTO vihem_vibofast_private.drive_schedule(id) VALUES(true);
ALTER TABLE vihem_vibofast_private.drive_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vihem_vibofast_private.drive_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE vihem_vibofast_private.drive_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE vihem_vibofast_private.drive_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vihem_vibofast_private.drive_schedule ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION vihem_vibofast_private.effective_images(p_apartment uuid,p_manual jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce((SELECT jsonb_agg(url ORDER BY priority,position,url) FROM (
  SELECT DISTINCT ON(url) url,priority,position FROM (
   SELECT value #>> '{}' AS url,0 AS priority,ordinality::integer AS position FROM jsonb_array_elements(coalesce(p_manual,'[]')) WITH ORDINALITY WHERE jsonb_typeof(value)='string'
   UNION ALL
   SELECT 'https://supabase.asedatruckmeet.se/storage/v1/object/public/vihem-vibofast-drive-images/'||i.storage_path,
    CASE i.kind WHEN 'apartment' THEN 1 ELSE 2 END,i.position
   FROM vihem_vibofast_private.drive_images i
   JOIN public.vihem_apartments a ON a.id=p_apartment
   JOIN vihem_vibofast_private.site_content c ON c.organisation_id=a.organisation_id
   JOIN vihem_vibofast_private.drive_settings s ON s.enabled
   WHERE (i.kind='apartment' AND i.entity_id=a.id) OR (i.kind='property' AND i.entity_id=a.property_id)
  ) images ORDER BY url,priority,position
 ) unique_images),'[]');
$$;

CREATE FUNCTION public.vihem_vibofast_drive_state() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.vihem_vibofast_is_editor() THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
 RETURN jsonb_build_object('settings',(SELECT to_jsonb(s)-'lease' FROM vihem_vibofast_private.drive_settings s),
 'properties',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'address',p.address) ORDER BY p.address) FROM public.vihem_properties p JOIN vihem_vibofast_private.site_content c ON c.organisation_id=p.organisation_id),'[]'),
 'apartments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'property_id',a.property_id)) FROM public.vihem_apartments a JOIN vihem_vibofast_private.site_content c ON c.organisation_id=a.organisation_id),'[]'),
 'folders',coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM vihem_vibofast_private.drive_folders f),'[]'),
 'images',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',i.kind,'entity_id',i.entity_id,'name',i.name,'position',i.position,'url','https://supabase.asedatruckmeet.se/storage/v1/object/public/vihem-vibofast-drive-images/'||i.storage_path) ORDER BY i.kind,i.position) FROM vihem_vibofast_private.drive_images i),'[]'),
 'runs',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM vihem_vibofast_private.drive_runs r),'[]'));
END;
$$;
CREATE FUNCTION public.vihem_vibofast_drive_configure(p_root text,p_site text,p_drive text,p_user text,p_enabled boolean,p_revision bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_root text;
BEGIN
 IF NOT public.vihem_vibofast_is_editor() THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
 IF p_root !~ '^[a-zA-Z0-9_-]+$' OR p_site !~ '^[a-zA-Z0-9_-]+$' THEN RAISE EXCEPTION 'Invalid folder'; END IF;
 SELECT root_folder_id INTO previous_root FROM vihem_vibofast_private.drive_settings WHERE id FOR UPDATE;
 UPDATE vihem_vibofast_private.drive_settings SET root_folder_id=p_root,site_folder_id=p_site,shared_drive_id=p_drive,delegated_user=p_user,enabled=p_enabled,revision=revision+1,last_error=NULL
 WHERE id AND revision=p_revision AND (lease_until IS NULL OR lease_until<now());
 IF NOT FOUND THEN RAISE EXCEPTION 'Inställningen har ändrats eller synkning pågår. Försök igen.' USING errcode='40001'; END IF;
 IF previous_root<>p_root THEN DELETE FROM vihem_vibofast_private.drive_folders; DELETE FROM vihem_vibofast_private.drive_runs; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.vihem_vibofast_drive_state() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.vihem_vibofast_drive_configure(text,text,text,text,boolean,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_vibofast_drive_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_vibofast_drive_configure(text,text,text,text,boolean,bigint) TO authenticated;

-- Service-only worker. The lease serialises manual/scheduled runs and binds every write to one Vibo property.
CREATE FUNCTION public.vihem_vibofast_drive_worker(p_action text,p_data jsonb DEFAULT '{}') RETURNS jsonb
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
  batch_offset:=coalesce(batch_offset,0);token:=gen_random_uuid();
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
REVOKE ALL ON FUNCTION public.vihem_vibofast_drive_worker(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_vibofast_drive_worker(text,jsonb) TO service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('vihem-vibofast-drive-images','vihem-vibofast-drive-images',true,10485760,ARRAY['image/jpeg','image/png','image/webp']);
CREATE POLICY "Vibo Drive cached images read" ON storage.objects FOR SELECT TO anon,authenticated USING(bucket_id='vihem-vibofast-drive-images');
-- Cache writes remain service-role only. No Drive sharing permissions are changed.

ALTER TABLE vihem_vibofast_private.adverts DROP CONSTRAINT adverts_check;
ALTER TABLE vihem_vibofast_private.adverts ADD CONSTRAINT adverts_check CHECK(NOT published OR (
 coalesce(length(payload->>'slug'),0)>0 AND coalesce(length(payload->>'title'),0)>0
 AND jsonb_typeof(payload->'images')='array'
 AND payload->>'listingType' IN ('apartment','commercial','office','retail','warehouse','storage','garage')
 AND payload->>'leaseType' IN ('tillsvidare','visstid') AND payload->>'rentType' IN ('warmhyra','kallhyra')
 AND jsonb_typeof(payload->'utilities')='object' AND jsonb_typeof(payload->'features')='array'
 AND coalesce(length(payload->>'description'),0)>0
) IS TRUE);

create or replace function public.vihem_vibofast_public_site() returns jsonb language sql stable security definer
set search_path = '' as $$
 select jsonb_build_object(
 'content', coalesce((select content from vihem_vibofast_private.site_content where id),'{}'::jsonb),
 'listings', coalesce((select jsonb_agg(s.payload || jsonb_build_object(
   'id',d.source_id,'available',a.available_from,'images',vihem_vibofast_private.effective_images(u.id,d.payload->'images'),
   'rent',u.rent,'area',u.size,'rooms',u.rooms,
   'address',pr.address,'city',pr.city,'postalCode',pr.zip,
   'rentLabel','kr/mån','areaLabel','kvm',
   'status',case when a.available_from > (now() at time zone 'Europe/Stockholm')::date then 'coming' else 'available' end
 ) order by a.available_from, d.source_id)
 from vihem_vibofast_private.adverts d
 join public.vihem_apartments u on u.id=d.source_id
 join public.vihem_properties pr on pr.id=u.property_id
 cross join lateral (select vihem_vibofast_private.available_from(u.id,(now() at time zone 'Europe/Stockholm')::date) as available_from) a
 cross join lateral (select jsonb_object_agg(key,value) as payload from jsonb_each(d.payload)
   where key = any(array['slug','title','region','listingType','leaseType','rentType',
   'bedrooms','bathrooms','description','shortDescription','features','utilities','images'])) s
 where d.published and jsonb_array_length(vihem_vibofast_private.effective_images(u.id,d.payload->'images'))>0 and a.available_from is not null and u.size > 0 and u.rent >= 0 and length(pr.address)>0 and length(pr.city)>0), '[]'::jsonb));
$$;

create or replace function public.vihem_vibofast_save_advert(p_source_id uuid,p_payload jsonb,p_published boolean,p_revision bigint,p_ready_from date default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare new_revision bigint;
begin
 if not public.vihem_vibofast_is_editor() then raise exception 'Forbidden' using errcode='42501'; end if;
 if not exists(select 1 from public.vihem_apartments a join public.vihem_properties pr on pr.id=a.property_id
   join vihem_vibofast_private.site_content c on c.organisation_id=a.organisation_id and c.organisation_id=pr.organisation_id
   where a.id=p_source_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_published and jsonb_array_length(vihem_vibofast_private.effective_images(p_source_id,p_payload->'images'))=0 then raise exception 'Annonsen behöver minst en bild från Drive eller en uppladdad bild.'; end if;
 if p_revision=0 then
   insert into vihem_vibofast_private.adverts(source_id,payload,published,ready_from)
   values(p_source_id,p_payload,p_published,p_ready_from) on conflict do nothing returning revision into new_revision;
 else
   update vihem_vibofast_private.adverts set payload=p_payload,published=p_published,ready_from=p_ready_from,revision=revision+1,updated_at=now()
   where source_id=p_source_id and revision=p_revision returning revision into new_revision;
 end if;
 if not found then raise exception 'Annonsen har ändrats. Ladda om innan du sparar.'; end if;
 return new_revision;
end;
$$;

CREATE FUNCTION public.vihem_vibofast_schedule_drive_sync() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM vihem_vibofast_private.drive_settings WHERE enabled) THEN RETURN; END IF;
 PERFORM net.http_post(url:='http://kong:8000/functions/v1/vihem-vibofast-drive',headers:=jsonb_build_object('Content-Type','application/json','x-vibo-drive-sync-secret',(SELECT secret FROM vihem_vibofast_private.drive_schedule)),body:='{"action":"sync"}'::jsonb,timeout_milliseconds:=55000);
END;
$$;
REVOKE ALL ON FUNCTION public.vihem_vibofast_schedule_drive_sync() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('vihem-vibofast-drive-images','* * * * *','SELECT public.vihem_vibofast_schedule_drive_sync();');
NOTIFY pgrst,'reload schema';
COMMIT;
