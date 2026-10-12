-- Isolated umbrella portal; existing website schemas and enquiries are untouched.
CREATE SCHEMA IF NOT EXISTS vihem_vibogruppen_private;
REVOKE ALL ON SCHEMA vihem_vibogruppen_private FROM public,anon,authenticated;
CREATE TABLE vihem_vibogruppen_private.site (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), organisation_id uuid NOT NULL REFERENCES vihem_organisations(id),
 content jsonb NOT NULL, revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vihem_vibogruppen_private.enquiries (
 id uuid PRIMARY KEY, payload jsonb NOT NULL, fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','done')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON vihem_vibogruppen_private.enquiries(created_at DESC);
CREATE INDEX ON vihem_vibogruppen_private.enquiries(fingerprint,created_at DESC);
ALTER TABLE vihem_vibogruppen_private.site ENABLE ROW LEVEL SECURITY;
ALTER TABLE vihem_vibogruppen_private.enquiries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA vihem_vibogruppen_private FROM public,anon,authenticated;
CREATE FUNCTION public.vihem_vibogruppen_require_admin() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.vihem_profiles p JOIN vihem_vibogruppen_private.site s ON s.organisation_id=p.organisation_id WHERE p.id=auth.uid() AND p.active AND p.role='admin') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION public.vihem_vibogruppen_public_site() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT content FROM vihem_vibogruppen_private.site WHERE id $$;
CREATE FUNCTION public.vihem_vibogruppen_admin_site(p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.vihem_vibogruppen_require_admin();
 IF p_offset<0 OR p_offset>100000 THEN RAISE EXCEPTION 'Invalid page';END IF;
 RETURN jsonb_build_object('content',(SELECT content FROM vihem_vibogruppen_private.site),'revision',(SELECT revision FROM vihem_vibogruppen_private.site),'total',(SELECT count(*) FROM vihem_vibogruppen_private.enquiries),'enquiries',coalesce((SELECT jsonb_agg(e) FROM (SELECT id,payload,status,created_at,updated_at FROM vihem_vibogruppen_private.enquiries ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET p_offset)e),'[]'::jsonb));
END $$;
CREATE FUNCTION public.vihem_vibogruppen_save_content(p_content jsonb,p_revision integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE field text; b jsonb; next_revision integer;
BEGIN
 PERFORM public.vihem_vibogruppen_require_admin();
 IF jsonb_typeof(p_content) IS DISTINCT FROM 'object' OR octet_length(p_content::text)>64000 THEN RAISE EXCEPTION 'Invalid content';END IF;
 FOREACH field IN ARRAY ARRAY['heroTitle','heroText','aboutTitle','aboutText','email','phone'] LOOP
 IF jsonb_typeof(p_content->field) IS DISTINCT FROM 'string' OR length(p_content->>field)>6000 THEN RAISE EXCEPTION 'Invalid field %',field;END IF;
 END LOOP;
 IF length(p_content->>'heroTitle')<1 OR (p_content->>'email') !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' THEN RAISE EXCEPTION 'Invalid title/email';END IF;
 IF jsonb_typeof(p_content->'businesses') IS DISTINCT FROM 'array' OR jsonb_array_length(p_content->'businesses')>20 THEN RAISE EXCEPTION 'Invalid businesses';END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p_content->'businesses') LOOP
 IF jsonb_typeof(b->'id') IS DISTINCT FROM 'string' OR (b->>'id') !~ '^[a-z0-9-]{1,64}$' OR coalesce(length(b->>'name'),0)=0 OR jsonb_typeof(b->'visible') IS DISTINCT FROM 'boolean' OR jsonb_typeof(b->'tagline') IS DISTINCT FROM 'string' OR jsonb_typeof(b->'description') IS DISTINCT FROM 'string' OR (b->>'url') IS NULL OR ((b->>'url')<>'#kontakt' AND (b->>'url') !~ '^https://[a-zA-Z0-9][a-zA-Z0-9.-]+(/[^[:space:]]*)?$') THEN RAISE EXCEPTION 'Invalid business';END IF;
 END LOOP;
 IF (SELECT count(*)<>count(DISTINCT value->>'id') FROM jsonb_array_elements(p_content->'businesses')) THEN RAISE EXCEPTION 'Duplicate businesses';END IF;
 UPDATE vihem_vibogruppen_private.site SET content=p_content,revision=revision+1,updated_at=now() WHERE id AND revision=p_revision RETURNING revision INTO next_revision;
 IF next_revision IS NULL THEN RAISE EXCEPTION 'Content changed; reload before saving' USING ERRCODE='PT409';END IF;
 RETURN next_revision;
END $$;
CREATE FUNCTION public.vihem_vibogruppen_update_enquiry(p_id uuid,p_status text,p_updated_at timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.vihem_vibogruppen_require_admin();
 IF p_status NOT IN ('new','in_progress','done') THEN RAISE EXCEPTION 'Invalid status';END IF;
 UPDATE vihem_vibogruppen_private.enquiries SET status=p_status,updated_at=clock_timestamp() WHERE id=p_id AND updated_at=p_updated_at;
 IF NOT FOUND THEN RAISE EXCEPTION 'Enquiry changed; reload' USING ERRCODE='PT409';END IF;
END $$;
CREATE FUNCTION public.vihem_vibogruppen_store_enquiry(p_id uuid,p_payload jsonb,p_fingerprint text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous jsonb; field text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM vihem_vibogruppen_private.site WHERE id) THEN RAISE EXCEPTION 'Site not configured';END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>30000 OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid enquiry';END IF;
 FOREACH field IN ARRAY ARRAY['name','email','phone','company','subject','message'] LOOP
 IF jsonb_typeof(p_payload->field) IS DISTINCT FROM 'string' OR length(p_payload->>field)>5000 THEN RAISE EXCEPTION 'Invalid field';END IF;
 END LOOP;
 IF length(trim(p_payload->>'name'))<1 OR length(trim(p_payload->>'message'))<1 OR (p_payload->>'email') !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' THEN RAISE EXCEPTION 'Invalid enquiry';END IF;
 IF (p_payload->>'subject')<>'vibogruppen' AND NOT EXISTS(SELECT 1 FROM vihem_vibogruppen_private.site s,jsonb_array_elements(s.content->'businesses')b WHERE b->>'id'=p_payload->>'subject' AND b->>'visible'='true') THEN RAISE EXCEPTION 'Invalid subject';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vibogruppen-contact-global',0));
 SELECT payload INTO previous FROM vihem_vibogruppen_private.enquiries WHERE id=p_id;
 IF FOUND THEN IF previous<>p_payload THEN RAISE EXCEPTION 'Operation already used';END IF;RETURN;END IF;
 IF (SELECT count(*) FROM vihem_vibogruppen_private.enquiries WHERE created_at>now()-interval '5 minutes')>=100 OR (SELECT count(*) FROM vihem_vibogruppen_private.enquiries WHERE fingerprint=p_fingerprint AND created_at>now()-interval '5 minutes')>=5 THEN RAISE EXCEPTION 'Rate limit';END IF;
 INSERT INTO vihem_vibogruppen_private.enquiries(id,payload,fingerprint) VALUES(p_id,p_payload,p_fingerprint);
END $$;
REVOKE ALL ON FUNCTION public.vihem_vibogruppen_require_admin(),public.vihem_vibogruppen_public_site(),public.vihem_vibogruppen_admin_site(integer),public.vihem_vibogruppen_save_content(jsonb,integer),public.vihem_vibogruppen_update_enquiry(uuid,text,timestamptz),public.vihem_vibogruppen_store_enquiry(uuid,jsonb,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_vibogruppen_public_site() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_vibogruppen_admin_site(integer),public.vihem_vibogruppen_save_content(jsonb,integer),public.vihem_vibogruppen_update_enquiry(uuid,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_vibogruppen_store_enquiry(uuid,jsonb,text) TO service_role;
NOTIFY pgrst,'reload schema';

INSERT INTO vihem_vibogruppen_private.site(organisation_id,content) SELECT id,'{"heroTitle":"Flera verksamheter.\nEn gemensam drivkraft.","heroText":"Fastigheter, entreprenad, uthyrning, energi och evenemang. Vi bygger långsiktigt, arbetar nära och tar vara på möjligheterna tillsammans.","aboutTitle":"Förankrade i Småland.\nMed blicken framåt.","aboutText":"Vibogruppen är en entreprenörsdriven grupp med bas i Virserum. Här samlar vi företag, kunskap och resurser som gör nytta tillsammans – från boende och fastigheter till entreprenad, uthyrning och evenemang.","email":"kontakt@vibogruppen.se","phone":"","businesses":[{"id":"vibo-fastigheter","name":"Vibo Fastigheter","tagline":"Förvaltning och uthyrning av fastigheter","description":"Förvaltning och uthyrning av bostäder och lokaler med bas i Virserum. Långsiktigt ägande och skötsel av fastigheter i Småland.","category":"property","icon":"Building2","logo":"/assets/logos/vibo-fastigheter/logo-svart-vibo.png","url":"https://vibofast.se","visible":true},{"id":"vibo-charge","name":"Vibo Charge","tagline":"Snabbladdning för elbil i Virserum","description":"Publik snabbladdning för elbil i Virserum. Ladda och betala smidigt — se tillgänglighet och pris i realtid.","category":"energy","icon":"Zap","logo":"/assets/logos/vibo-charge/Vibo-charge-logo-1400x700.png","url":"https://chargefinder.com/se/ladda-elbil-virserum-ekangsvagen-1/nwmrg7","visible":true},{"id":"viborent","name":"ViboRent","tagline":"Uthyrning av maskiner, verktyg och utrustning","description":"Hyra av maskiner, verktyg, släp, evenemangsutrustning och annan utrustning. Det du behöver för jobbet — utan att äga.","category":"rental","icon":"Truck","logo":"/assets/logos/vibo-rent/Vibo_rent_Logo.png","url":"https://viborent.se","visible":true},{"id":"grav-allservice","name":"Gräv & Allservice","tagline":"Entreprenad, schakt och fastighetsservice","description":"Mark- och anläggningsarbete, schakt, entreprenad och fastighetsservice i Virserum och omnejd. Vi tar hand om jobbet från grund till färdig mark.","category":"construction","icon":"Construction","url":"https://gavirserum.se","visible":true},{"id":"aseda-truckmeet","name":"Åseda Truckmeet","tagline":"Truckträff och evenemang i Småland","description":"En truckträff och ett evenemang vi arrangerar. En helg fylld av fordon, gemenskap och Småländsk stämning.","category":"events","icon":"Flame","logo":"/assets/logos/aseda-truckmeet/aseda-truckmeet-logo.png","url":"https://asedatruckmeet.se","visible":true},{"id":"ekangens-vandrarhem","name":"Ekängens Vandrarhem","tagline":"Övernattning i Virserum","description":"Bo över i Virserum. Boka direkt hos oss eller via Booking.com, Expedia och Airbnb.","category":"accommodation","icon":"BedDouble","url":"https://ekangensvandrarhem.se","visible":true},{"id":"kunskapsportalen","name":"Kunskapsportalen","tagline":"Onlineutbildningar och kurser","description":"Webbaserade utbildningar — till exempel Arbete på väg 1.1–1.3. Studera i din egen takt, när och var du vill.","category":"education","icon":"GraduationCap","url":"https://kunskapsportalen.se","visible":true},{"id":"vi-hem","name":"Vi-Hem","tagline":"Fastighetssystem för hyresgäster och personal","description":"Ett fastighetssystem som förenar hyresgäster och personal. Hantera ärenden, information och kommunikation på ett ställe.","category":"tech","icon":"Home","url":"https://vi-hem.se","visible":true}]}'::jsonb FROM public.vihem_organisations WHERE id='38fe702d-e72c-49a2-9750-5e0b6934959b';
