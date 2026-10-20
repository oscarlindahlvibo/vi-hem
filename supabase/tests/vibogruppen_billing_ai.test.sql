-- Test av AI-tolkningsloggen och månadsunderlaget (20261022100000_vibogruppen_billing_ai.sql).
-- Körs mot en tillfällig databas via scripts/test_billing_ai_sql.sh. Allt rullas tillbaka.
BEGIN;
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end$$;
create function pg_temp.reject(label text, stmt text) returns void language plpgsql as $$declare failed boolean:=false; begin begin execute stmt; exception when others then failed:=true; end; if not failed then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end$$;
create temp table f(org uuid, other_org uuid, admin uuid, staff uuid, outsider uuid, cust uuid, key text, hash text, req uuid, iid uuid);
grant all on f to authenticated, service_role, anon;
do $$ declare o uuid:=gen_random_uuid(); o2 uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); x uuid:=gen_random_uuid(); begin
  insert into public.vihem_organisations(id,name,slug) values (o,'Vibogruppen','v-'||o),(o2,'Annan','a-'||o2);
  insert into auth.users(id,email) values (a,a||'@t.invalid'),(s,s||'@t.invalid'),(x,x||'@t.invalid');
  insert into public.vihem_profiles(id,organisation_id,name,email,role,active) values (a,o,'Admin',a||'@t.invalid','admin',true),(s,o,'Staff',s||'@t.invalid','staff',true),(x,o2,'Annan admin',x||'@t.invalid','admin',true);
  insert into vihem_vibogruppen_private.site(organisation_id) values (o);
  insert into f(org,other_org,admin,staff,outsider) values (o,o2,a,s,x);
end $$;

-- ===== Behörighet =====
select set_config('request.jwt.claim.sub',(select staff::text from f),true);
set local role authenticated;
select pg_temp.reject('personal som inte är admin nekas', $$select public.vihem_vibogruppen_billing_overview(current_date)$$);
reset role;
select set_config('request.jwt.claim.sub',(select outsider::text from f),true);
set local role authenticated;
select pg_temp.reject('admin i annan organisation nekas', $$select public.vihem_vibogruppen_billing_overview(current_date)$$);
reset role;

-- ===== Admin skapar kund, prislista och nyckel =====
select set_config('request.jwt.claim.sub',(select admin::text from f),true);
set local role authenticated;
update f set cust = public.vihem_vibogruppen_billing_save_customer('{"name":"JK Projektlogistik AB","org_number":"556000-0000","billing_email":"ekonomi@jk.test"}'::jsonb);
update f set key = public.vihem_vibogruppen_billing_create_client(cust, 'JK affärssystem');
select public.vihem_vibogruppen_billing_save_price_item(jsonb_build_object('customer_id',cust,'kind','hosting','name','Hosting JK affärssystem','unit','månad','quantity',1,'unit_price',1000,'valid_from','2026-01-01')) from f;
select public.vihem_vibogruppen_billing_save_price_item(jsonb_build_object('customer_id',cust,'kind','addon','name','Extra backup','unit','månad','quantity',1,'unit_price',200,'valid_from','2026-09-01','valid_to','2026-09-30')) from f;
reset role;
update f set hash = encode(sha256(convert_to(key,'UTF8')),'hex');
select pg_temp.expect('kunden får 5 kr per sida, 25 % moms och 10 sidor som gräns', (select c.ai_page_price=5 and c.vat_rate=25 and c.ai_max_pages_per_request=10 from vihem_vibogruppen_private.billing_customers c join f on f.cust=c.id));
select pg_temp.expect('nyckeln börjar på vhk_ och lagras bara som hash', (select key like 'vhk_%' and exists (select 1 from vihem_vibogruppen_private.ai_clients where key_hash=hash and key_hint<>key) and not exists (select 1 from vihem_vibogruppen_private.ai_clients where key_hash=key) from f));

-- ===== Behörighet för serverfunktionerna =====
set local role authenticated;
select pg_temp.reject('inloggad användare kan inte anropa vihem_ai_begin direkt', format($$select public.vihem_ai_begin(%L,'x',1,'t','u','f.pdf','')$$, (select hash from f)));
reset role;
set local role anon;
select pg_temp.reject('anon kan inte anropa vihem_ai_client_info', format($$select public.vihem_ai_client_info(%L)$$, (select hash from f)));
reset role;

-- ===== Tolkning: start, dubblett, avslut =====
set local role service_role;
select pg_temp.reject('ogiltig nyckel nekas', $$select public.vihem_ai_client_info(repeat('0',64))$$);
select pg_temp.expect('klientinfo ger pris, moms och gränser', (select (i->>'price_per_page')::numeric=5 and (i->>'vat_rate')::numeric=25 and (i->>'max_pages_per_request')::int=10 from (select public.vihem_ai_client_info(hash) i from f) q));
update f set req = gen_random_uuid();
select pg_temp.expect('start av tolkning (2 sidor) reserveras', (public.vihem_ai_begin(hash, req::text, 2, 'jk-affarssystem', 'Jens', 'LTC.pdf', repeat('a',64)) ->> 'status') = 'processing') from f;
select pg_temp.expect('samma request_id medan den pågår ger processing utan ny rad', (public.vihem_ai_begin(hash, req::text, 2, 'jk-affarssystem', 'Jens', 'LTC.pdf', repeat('a',64)) ->> 'status') = 'processing') from f;
select pg_temp.reject('för många sidor nekas', format($$select public.vihem_ai_begin(%L,'big',11,'t','u','f.pdf','')$$, (select hash from f)));
reset role;
select pg_temp.expect('exakt en rad finns och den är inte debiterbar än', (select count(*)=1 and bool_and(not billable) from vihem_vibogruppen_private.ai_interpretations));
update f set iid = (select id from vihem_vibogruppen_private.ai_interpretations limit 1);
set local role service_role;
select public.vihem_ai_complete((select iid from f), 'success', '{"orders":[{"documentNumber":"LTC0020553"}]}'::jsonb, 'gpt-5-mini', 'google_vision', 'ocr+ai', 2, 1200, 300, 0.2, 4100, '');
reset role;
select pg_temp.expect('lyckad tolkning är debiterbar och resultatet cachas', (select status='success' and billable and result is not null and result_expires_at > now() from vihem_vibogruppen_private.ai_interpretations));
set local role service_role;
select pg_temp.expect('omförsök efter lyckad tolkning ger resultatet utan ny debitering', (select (r->>'duplicate')::boolean and r->>'status'='success' and r->'result' is not null from (select public.vihem_ai_begin(hash, req::text, 2, 'jk-affarssystem','Jens','LTC.pdf',repeat('a',64)) r from f) q));
reset role;
select pg_temp.expect('fortfarande bara en debiterad tolkning', (select count(*)=1 from vihem_vibogruppen_private.ai_interpretations where billable));

-- Misslyckad tolkning debiteras inte och kan göras om med samma id
set local role service_role;
select public.vihem_ai_begin(hash, 'fail-1', 1, 'jk', 'Jens', 'x.pdf', '') from f;
reset role;
update f set iid = (select id from vihem_vibogruppen_private.ai_interpretations where request_id='fail-1');
set local role service_role;
select public.vihem_ai_complete((select iid from f), 'failed', null, 'gpt-5-mini','','', 1, 100, 10, 0.1, 900, 'AI svarade inte');
reset role;
select pg_temp.expect('misslyckad tolkning är inte debiterbar', (select status='failed' and not billable from vihem_vibogruppen_private.ai_interpretations where request_id='fail-1'));
set local role service_role;
select pg_temp.expect('misslyckat id kan göras om', (public.vihem_ai_begin((select hash from f), 'fail-1', 1, 'jk','Jens','x.pdf','') ->> 'status') = 'processing');
select public.vihem_ai_complete((select iid from f), 'success', '{"orders":[]}'::jsonb, 'gpt-5-mini','','', 1, 100, 10, 0.1, 900, '');
reset role;

-- Månadsgräns
select set_config('request.jwt.claim.sub',(select admin::text from f),true);
set local role authenticated;
select public.vihem_vibogruppen_billing_save_customer(jsonb_build_object('id',cust,'ai_monthly_page_limit',4)) from f;
reset role;
set local role service_role;
select pg_temp.reject('månadens sidgräns stoppar ny tolkning', format($$select public.vihem_ai_begin(%L,'quota-1',2,'jk','Jens','q.pdf','')$$, (select hash from f)));
reset role;
select set_config('request.jwt.claim.sub',(select admin::text from f),true);
set local role authenticated;
select public.vihem_vibogruppen_billing_save_customer(jsonb_build_object('id',cust,'ai_monthly_page_limit',null)) from f;
reset role;

-- ===== Prisändring påverkar inte redan gjorda tolkningar =====
select set_config('request.jwt.claim.sub',(select admin::text from f),true);
set local role authenticated;
select public.vihem_vibogruppen_billing_save_customer(jsonb_build_object('id',cust,'ai_page_price',7.5)) from f;
reset role;
select pg_temp.expect('tidigare tolkningar behåller priset 5 kr per sida', (select bool_and(unit_price=5) from vihem_vibogruppen_private.ai_interpretations));
select set_config('request.jwt.claim.sub',(select admin::text from f),true);
set local role authenticated;
select public.vihem_vibogruppen_billing_save_customer(jsonb_build_object('id',cust,'ai_page_price',5)) from f;
reset role;

-- ===== Månadsunderlag =====
-- Lägg tolkningarna i september 2026 (kalenderkontroll i svensk tid) för att kunna låsa en avslutad månad.
update vihem_vibogruppen_private.ai_interpretations set created_at = '2026-09-15 10:00+02';
select set_config('request.jwt.claim.sub',(select admin::text from f),true);
set local role authenticated;
select pg_temp.expect('underlag september: hosting 1000 + extra 200 + AI 3 sidor à 5 = 1215 kr exkl. moms',
  (select (s->>'total_ex_vat')::numeric=1215 and (s->>'ai_pages')::int=3 and (s->>'ai_interpretations')::int=2 and (s->>'vat_amount')::numeric=303.75 and (s->>'total_inc_vat')::numeric=1518.75 from (select public.vihem_vibogruppen_billing_statement(cust,'2026-09-01') s from f) q));
select pg_temp.expect('underlag oktober: bara hosting (extra backup gällde bara i september), inga tolkningar',
  (select (s->>'total_ex_vat')::numeric=1000 and (s->>'ai_pages')::int=0 from (select public.vihem_vibogruppen_billing_statement(cust,'2026-10-01') s from f) q));
select pg_temp.reject('innevarande månad kan inte låsas', format($$select public.vihem_vibogruppen_billing_lock(%L, date_trunc('month', current_date)::date)$$, (select cust from f)));
update f set req = public.vihem_vibogruppen_billing_lock(cust,'2026-09-01');
select pg_temp.reject('samma månad kan inte låsas två gånger', format($$select public.vihem_vibogruppen_billing_lock(%L,'2026-09-01')$$, (select cust from f)));
reset role;
select pg_temp.expect('tolkningarna är knutna till underlaget', (select count(*)=2 and bool_and(statement_id=(select req from f)) from vihem_vibogruppen_private.ai_interpretations where billable));
select set_config('request.jwt.claim.sub',(select admin::text from f),true);
set local role authenticated;
select pg_temp.expect('låst underlag visar samma summor', (select (s->>'total_ex_vat')::numeric=1215 and s->'statement'->>'status'='locked' from (select public.vihem_vibogruppen_billing_statement(cust,'2026-09-01') s from f) q));
select public.vihem_vibogruppen_billing_mark_invoiced(req, 'F-1001') from f;
select pg_temp.reject('fakturerat underlag kan inte öppnas igen', format($$select public.vihem_vibogruppen_billing_unlock(%L)$$, (select req from f)));
reset role;
select pg_temp.expect('fakturan är markerad med referens', (select status='invoiced' and invoice_reference='F-1001' from vihem_vibogruppen_private.billing_statements));

-- Avstängd kund kan inte tolka
select set_config('request.jwt.claim.sub',(select admin::text from f),true);
set local role authenticated;
select public.vihem_vibogruppen_billing_save_customer(jsonb_build_object('id',cust,'ai_enabled',false)) from f;
reset role;
set local role service_role;
select pg_temp.reject('avstängd AI-tolkning nekas', format($$select public.vihem_ai_begin(%L,'off-1',1,'jk','Jens','o.pdf','')$$, (select hash from f)));
reset role;
select set_config('request.jwt.claim.sub',(select admin::text from f),true);
set local role authenticated;
select public.vihem_vibogruppen_billing_save_customer(jsonb_build_object('id',cust,'ai_enabled',true)) from f;
reset role;
update f set iid = (select id from vihem_vibogruppen_private.ai_clients limit 1);
select set_config('request.jwt.claim.sub',(select admin::text from f),true);
set local role authenticated;
select public.vihem_vibogruppen_billing_revoke_client((select iid from f));
reset role;
set local role service_role;
select pg_temp.reject('återkallad nyckel nekas', format($$select public.vihem_ai_client_info(%L)$$, (select hash from f)));
reset role;
ROLLBACK;
