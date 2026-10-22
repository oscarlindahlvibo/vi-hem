-- Test av driftmeddelanden för egna appar och sajter (20261022120000_vibogruppen_notice_surfaces.sql). Allt rullas tillbaka.
BEGIN;
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end$$;
create function pg_temp.reject(label text, stmt text) returns void language plpgsql as $$declare failed boolean:=false; begin begin execute stmt; exception when others then failed:=true; end; if not failed then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end$$;
create temp table f(org uuid, admin uuid, c1 uuid, k1 text, h1 text, n_site uuid, n_both uuid, n_cust uuid);
grant all on f to authenticated, service_role, anon;
do $$ declare o uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); begin
  insert into public.vihem_organisations(id,name,slug) values (o,'Vibogruppen','v-'||o);
  insert into auth.users(id,email) values (a,a||'@t.invalid');
  insert into public.vihem_profiles(id,organisation_id,name,email,role,active) values (a,o,'Admin',a||'@t.invalid','admin',true);
  insert into vihem_vibogruppen_private.site(organisation_id) values (o);
  insert into f(org,admin) values (o,a);
end $$;
select set_config('request.jwt.claim.sub',(select admin::text from f),true);
set local role authenticated;
update f set c1 = public.vihem_vibogruppen_billing_save_customer('{"name":"Kund Ett"}'::jsonb);
update f set k1 = public.vihem_vibogruppen_billing_create_client(c1,'sys');
update f set n_site = public.vihem_vibogruppen_notice_save(jsonb_build_object('title','Bara viborent och vibofast','severity','warning','show_from',now()-interval '1 hour','show_until',now()+interval '1 day','all_customers',false,'surfaces',jsonb_build_array('viborent','vibofast')));
update f set n_both = public.vihem_vibogruppen_notice_save(jsonb_build_object('title','Alla ytor och kunder','severity','critical','show_from',now()-interval '1 hour','show_until',now()+interval '1 day','all_customers',true,'surfaces',jsonb_build_array('vihem-app','kompetensportalen','vibogruppen','vihem-site','viborent','vibofast')));
update f set n_cust = public.vihem_vibogruppen_notice_save(jsonb_build_object('title','Bara kundsystem','show_from',now()-interval '1 hour','show_until',now()+interval '1 day'));
select pg_temp.reject('okänd yta nekas', $$select public.vihem_vibogruppen_notice_save('{"title":"x","surfaces":["facebook"],"show_from":"2026-01-01T00:00:00Z","show_until":"2026-12-31T00:00:00Z"}'::jsonb)$$);
select pg_temp.reject('ingen mottagare alls nekas', $$select public.vihem_vibogruppen_notice_save('{"title":"x","all_customers":false,"show_from":"2026-01-01T00:00:00Z","show_until":"2026-12-31T00:00:00Z"}'::jsonb)$$);
select pg_temp.expect('listan innehåller ytorna', (select (e->'surfaces') @> '["viborent","vibofast"]'::jsonb from jsonb_array_elements(public.vihem_vibogruppen_notices_list()) e where e->>'title'='Bara viborent och vibofast'));
reset role;
update f set h1 = encode(sha256(convert_to(k1,'UTF8')),'hex');

set local role anon;
select pg_temp.expect('anon ser meddelanden för viborent, kritiskt först', (select jsonb_array_length(n)=2 and n->0->>'severity'='critical' and n->1->>'title'='Bara viborent och vibofast' from (select public.vihem_public_notices('viborent') n) q));
select pg_temp.expect('anon ser bara det riktade för vibofast och det gemensamma', (select jsonb_array_length(n)=2 from (select public.vihem_public_notices('vibofast') n) q));
select pg_temp.expect('kompetensportalen ser bara det gemensamma', (select jsonb_array_length(n)=1 and n->0->>'title'='Alla ytor och kunder' from (select public.vihem_public_notices('kompetensportalen') n) q));
select pg_temp.expect('okänd yta ger tom lista', (select public.vihem_public_notices('annat')='[]'::jsonb));
select pg_temp.expect('publika svaret läcker inga kunduppgifter', (select not (n::text like '%customer%') and not (n::text like '%created_by%') from (select public.vihem_public_notices('viborent') n) q));
select pg_temp.reject('anon kan inte lista alla meddelanden', $$select public.vihem_vibogruppen_notices_list()$$);
reset role;
set local role service_role;
select pg_temp.expect('kundsystem ser inte meddelanden som bara gäller ytor', (select jsonb_array_length(n)=2 and not (n::text like '%Bara viborent%') from (select public.vihem_notices_for_client(h1) n from f) q));
reset role;
ROLLBACK;
