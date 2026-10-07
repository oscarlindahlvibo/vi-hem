DO $$
DECLARE editor uuid; item jsonb; apartment uuid; revision bigint; payload jsonb;
BEGIN
 SELECT p.id INTO editor FROM public.vihem_profiles p JOIN vihem_vibofast_private.site_content c USING(organisation_id) WHERE p.active AND p.role='admin' LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',editor::text,true);
 SELECT a INTO item FROM jsonb_array_elements(public.vihem_vibofast_admin_site()->'adverts') a
 WHERE a->>'source_id'='9c979707-f908-4e1a-927d-860f85b504d9';
 IF item IS NULL OR (item->>'revision')::bigint<>0 THEN RAISE EXCEPTION 'Target advert changed; review test'; END IF;
 apartment:=(item->>'source_id')::uuid;
 payload:=(item->'payload')||'{"description":"Testbeskrivning","shortDescription":"Test"}'::jsonb;
 revision:=public.vihem_vibofast_save_advert(apartment,payload,true,0,null);
 IF revision<>1 THEN RAISE EXCEPTION 'First save failed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.vihem_vibofast_public_site()->'listings') l WHERE l->>'id'=apartment::text) THEN RAISE EXCEPTION 'Image-less advert was published'; END IF;
 revision:=public.vihem_vibofast_save_advert(apartment,payload,true,revision,'2027-02-01');
 IF revision<>2 THEN RAISE EXCEPTION 'Update failed'; END IF;
 payload:=payload||jsonb_build_object('images',jsonb_build_array('https://supabase.asedatruckmeet.se/storage/v1/object/public/vihem-vibofast-images/rollback-test.jpg'));
 revision:=public.vihem_vibofast_save_advert(apartment,payload,true,revision,'2027-02-01');
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.vihem_vibofast_public_site()->'listings') l WHERE l->>'id'=apartment::text AND l->>'available'='2027-02-01' AND jsonb_array_length(l->'images')=1) THEN RAISE EXCEPTION 'Advert with image missing or wrong termination date'; END IF;
 RAISE NOTICE 'PASS: image-less save/update accepted, hidden until image added, termination yields 2027-02-01. All test data must roll back.';
END $$;
