-- Test av driftmeddelanden (20261022110000_vibogruppen_system_notices.sql). Körs via scripts/test_billing_ai_sql.sh. Allt rullas tillbaka.
BEGIN;
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end$$;
create function pg_temp.reject(label text, stmt text) returns void language plpgsql as $$declare failed boolean:=false; begin begin execute stmt; exception when others then failed:=true; end; if not failed then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end$$;
create temp table f(org uuid, admin uuid, staff uuid, c1 uuid, c2 uuid, k1 text, k2 text, h1 text, h2 text, n_all uuid, n_c1 uuid, n_future uuid, n_past uuid, n_off uuid);
grant all on f to authenticated, service_role, anon;
do $$ declare o uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); begin
  insert into public.vihem_organisations(id,name,slug) values (o,'Vibogruppen','v-'||o);
  insert into auth.users(id,email) values (a,a||'@t.invalid'),(s,s||'@t.invalid');
  insert into public.vihem_profiles(id,organisation_id,name,email,role,active) values (a,o,'Admin',a||'@t.invalid','admin',true),(s,o,'Staff',s||'@t.invalid','staff',true);
  insert into vihem_vibogruppen_private.site(organisation_id) values (o);
  insert into f(org,admin,staff) values (o,a,s);
end $$;

select set_config('request.jwt.claim.sub',(select staff::text from f),true);
set local role authenticated;
select pg_temp.reject('personal som inte är admin kan inte lista meddelanden', $$select public.vihem_vibogruppen_notices_list()$$);
select pg_temp.reject('personal som inte är admin kan inte skapa meddelanden', $$select public.vihem_vibogruppen_notice_save('{"title":"x","show_from":"2026-01-01T00:00:00Z","show_until":"2026-12-31T00:00:00Z"}'::jsonb)$$);
reset role;

select set_config('request.jwt.claim.sub',(select admin::text from f),true);
set local role authenticated;
update f set c1 = public.vihem_vibogruppen_billing_save_customer('{"name":"Kund Ett"}'::jsonb), c2 = public.vihem_vibogruppen_billing_save_customer('{"name":"Kund Två"}'::jsonb);
update f set k1 = public.vihem_vibogruppen_billing_create_client(c1,'sys1'), k2 = public.vihem_vibogruppen_billing_create_client(c2,'sys2');
update f set n_all = public.vihem_vibogruppen_notice_save(jsonb_build_object('title','Planerat underhåll','body','Servern startas om.','severity','critical','kind','maintenance','show_from',now()-interval '1 hour','show_until',now()+interval '2 days','event_starts_at',now()+interval '1 day','event_ends_at',now()+interval '1 day 2 hours','all_customers',true));
update f set n_c1 = public.vihem_vibogruppen_notice_save(jsonb_build_object('title','Bara för kund ett','severity','info','kind','update','show_from',now()-interval '1 hour','show_until',now()+interval '1 day','all_customers',false,'customer_ids',jsonb_build_array(c1)));
update f set n_future = public.vihem_vibogruppen_notice_save(jsonb_build_object('title','Kommande','show_from',now()+interval '1 day','show_until',now()+interval '2 days'));
update f set n_past = public.vihem_vibogruppen_notice_save(jsonb_build_object('title','Gammalt','show_from',now()-interval '3 days','show_until',now()-interval '1 day'));
update f set n_off = public.vihem_vibogruppen_notice_save(jsonb_build_object('title','Avstängt','show_from',now()-interval '1 hour','show_until',now()+interval '1 day','active',false));
select pg_temp.reject('slut före start nekas', $$select public.vihem_vibogruppen_notice_save('{"title":"x","show_from":"2026-12-31T00:00:00Z","show_until":"2026-01-01T00:00:00Z"}'::jsonb)$$);
select pg_temp.reject('tom rubrik nekas', $$select public.vihem_vibogruppen_notice_save('{"title":"  ","show_from":"2026-01-01T00:00:00Z","show_until":"2026-12-31T00:00:00Z"}'::jsonb)$$);
select pg_temp.reject('ogiltig allvarlighetsgrad nekas', $$select public.vihem_vibogruppen_notice_save('{"title":"x","severity":"panik","show_from":"2026-01-01T00:00:00Z","show_until":"2026-12-31T00:00:00Z"}'::jsonb)$$);
select pg_temp.reject('utvalda kunder utan kunder nekas', $$select public.vihem_vibogruppen_notice_save('{"title":"x","all_customers":false,"customer_ids":[],"show_from":"2026-01-01T00:00:00Z","show_until":"2026-12-31T00:00:00Z"}'::jsonb)$$);
select pg_temp.reject('okänd kund nekas', format($$select public.vihem_vibogruppen_notice_save('{"title":"x","all_customers":false,"customer_ids":["%s"],"show_from":"2026-01-01T00:00:00Z","show_until":"2026-12-31T00:00:00Z"}'::jsonb)$$, gen_random_uuid()));
select pg_temp.expect('listan visar alla meddelanden och markerar vilka som är live', (select jsonb_array_length(l)=5 and (select count(*) from jsonb_array_elements(l) e where (e->>'live')::boolean)=2 from (select public.vihem_vibogruppen_notices_list() l) q));
reset role;
update f set h1 = encode(sha256(convert_to(k1,'UTF8')),'hex'), h2 = encode(sha256(convert_to(k2,'UTF8')),'hex');

set local role authenticated;
select pg_temp.reject('inloggad användare kan inte anropa klientfunktionen direkt', format($$select public.vihem_notices_for_client(%L)$$, (select h1 from f)));
reset role;
set local role anon;
select pg_temp.reject('anon kan inte anropa klientfunktionen', format($$select public.vihem_notices_for_client(%L)$$, (select h1 from f)));
reset role;

set local role service_role;
select pg_temp.reject('ogiltig nyckel nekas', $$select public.vihem_notices_for_client(repeat('0',64))$$);
select pg_temp.expect('kund ett ser sina två aktiva meddelanden, kritiskt först', (select jsonb_array_length(n)=2 and n->0->>'severity'='critical' and n->1->>'title'='Bara för kund ett' from (select public.vihem_notices_for_client(h1) n from f) q));
select pg_temp.expect('kund två ser bara det som gäller alla', (select jsonb_array_length(n)=1 and n->0->>'title'='Planerat underhåll' from (select public.vihem_notices_for_client(h2) n from f) q));
select pg_temp.expect('underhållsfönstret följer med', (select n->0->>'event_starts_at' is not null and n->0->>'event_ends_at' is not null from (select public.vihem_notices_for_client(h2) n from f) q));
reset role;

select set_config('request.jwt.claim.sub',(select admin::text from f),true);
set local role authenticated;
select public.vihem_vibogruppen_notice_save(jsonb_build_object('id',n_off,'active',true)) from f;
select public.vihem_vibogruppen_notice_delete(n_all) from f;
reset role;
set local role service_role;
select pg_temp.expect('kund två ser nu bara det aktiverade', (select jsonb_array_length(n)=1 and n->0->>'title'='Avstängt' from (select public.vihem_notices_for_client(h2) n from f) q));
reset role;
set local role authenticated;
select public.vihem_vibogruppen_billing_save_customer(jsonb_build_object('id',c2,'active',false)) from f;
reset role;
set local role service_role;
select pg_temp.reject('inaktiv kund nekas', format($$select public.vihem_notices_for_client(%L)$$, (select h2 from f)));
reset role;
ROLLBACK;
