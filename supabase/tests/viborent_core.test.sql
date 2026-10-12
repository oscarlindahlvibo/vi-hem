-- ViboRent 2.0 kärntester. Körs i en transaktion som alltid rullas tillbaka (ändrar ingen riktig data):
--   cat migration.sql-utan-commit + detta test | psql  (se scripts/test_viborent_sql.sh)
-- Förutsätter att en organisation med modulen rental_management finns.
create or replace function pg_temp.expect(p_name text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'TEST FAILED: % %', p_name, p_detail; end if;
  raise notice 'ok - %', p_name;
end $$;

create or replace function pg_temp.expect_error(p_name text, p_sql text, p_code text) returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then v_msg := SQLERRM;
  end;
  if v_msg is null or position(p_code in v_msg) = 0 then raise exception 'TEST FAILED: % (förväntade %, fick %)', p_name, p_code, coalesce(v_msg, 'inget fel'); end if;
  raise notice 'ok - % (%)', p_name, p_code;
end $$;

do $$
declare
  v_org uuid; v_prod uuid; v_prod2 uuid; v_prod3 uuid; v_a1 uuid; v_a2 uuid; v_a3 uuid; v_lock uuid;
  q jsonb; r jsonb; r2 jsonb; v_b uuid; v_start timestamptz; fri timestamptz;
  v_count integer;
begin
  select organisation_id into v_org from public.vihem_organisation_modules where module_key = 'rental_management' and enabled limit 1;
  perform pg_temp.expect('organisation med uthyrning finns', v_org is not null);
  insert into public.vihem_rental_settings (organisation_id, minimum_advance_hours, default_return_buffer_minutes, access_enabled)
    values (v_org, 0, 0, true) on conflict (organisation_id) do update set minimum_advance_hours = 0, default_return_buffer_minutes = 0, access_enabled = true;
  insert into public.vihem_rental_contract_versions (organisation_id, version, body, status, published_at)
    values (v_org, 9001, 'Testavtal', 'draft', null) on conflict do nothing;

  insert into public.vihem_rental_products (organisation_id, name, slug, active, visible_publicly, deposit, vat_rate) values (v_org, 'T1', 'test-t1-' || gen_random_uuid(), true, true, 100, 25) returning id into v_prod;
  insert into public.vihem_rental_products (organisation_id, name, slug, active, visible_publicly) values (v_org, 'T2', 'test-t2-' || gen_random_uuid(), true, true) returning id into v_prod2;
  insert into public.vihem_rental_assets (organisation_id, product_id, name, internal_identifier) values (v_org, v_prod, 'A1', 'tt-' || gen_random_uuid()) returning id into v_a1;
  insert into public.vihem_rental_assets (organisation_id, product_id, name, internal_identifier) values (v_org, v_prod, 'A2', 'tt-' || gen_random_uuid()) returning id into v_a2;
  insert into public.vihem_rental_assets (organisation_id, product_id, name, internal_identifier) values (v_org, v_prod2, 'B1', 'tt-' || gen_random_uuid()) returning id into v_a3;
  insert into public.vihem_rental_pricing_rules (organisation_id, product_id, rule_type, price, duration, duration_unit)
    values (v_org, v_prod, 'hourly', 100, 1, 'hour'), (v_org, v_prod, 'daily', 380, 1, 'day'), (v_org, v_prod, 'weekly', 2000, 1, 'week'),
           (v_org, v_prod, 'weekend', 500, 1, 'day');
  insert into public.vihem_rental_pricing_rules (organisation_id, product_id, rule_type, price, duration, duration_unit)
    values (v_org, v_prod2, 'daily', 1000, 1, 'day');

  -- ===== PRISMOTOR =====
  v_start := date_trunc('day', now() + interval '10 days') + interval '10 hours';
  -- v_start = måndag? Säkerställ en måndag lokal tid för förutsägbarhet.
  v_start := (date_trunc('week', (now() + interval '14 days') at time zone 'Europe/Stockholm') + interval '10 hours') at time zone 'Europe/Stockholm';
  q := public.vihem_rental_quote(v_prod, v_start, v_start + interval '3 hours', 1);
  perform pg_temp.expect('3 h = 3 timmar à 100 = 300 + moms', (q ->> 'subtotal')::numeric = 300 and (q ->> 'total')::numeric = 375, q::text);
  q := public.vihem_rental_quote(v_prod, v_start, v_start + interval '5 hours', 1);
  perform pg_temp.expect('5 h = en dag (380) är billigare än 500', (q ->> 'subtotal')::numeric = 380, q::text);
  q := public.vihem_rental_quote(v_prod, v_start, v_start + interval '25 hours', 1);
  perform pg_temp.expect('25 h = dag + timme = 480', (q ->> 'subtotal')::numeric = 480, q::text);
  q := public.vihem_rental_quote(v_prod, v_start, v_start + interval '8 days', 1);
  perform pg_temp.expect('8 dygn = vecka + dag = 2380', (q ->> 'subtotal')::numeric = 2380, q::text);
  q := public.vihem_rental_quote(v_prod, v_start, v_start + interval '6 days', 1);
  perform pg_temp.expect('6 dygn = vecka (2000) är billigare än 6 dagar (2280)', (q ->> 'subtotal')::numeric = 2000, q::text);
  q := public.vihem_rental_quote(v_prod, v_start, v_start + interval '2 days', 2);
  perform pg_temp.expect('antal 2 dubblar priset', (q ->> 'subtotal')::numeric = 1520, q::text);
  perform pg_temp.expect('deposition multipliceras', (q ->> 'deposit')::numeric = 200);
  fri := v_start + interval '4 days';   -- fredag 10:00
  q := public.vihem_rental_quote(v_prod, fri, fri + interval '60 hours', 1);
  perform pg_temp.expect('helgpaket 500 när fredag-start och billigare', (q ->> 'subtotal')::numeric = 500, q::text);
  q := public.vihem_rental_quote(v_prod, v_start, v_start + interval '60 hours', 1);
  perform pg_temp.expect('helgpaket gäller inte vardagsstart', (q ->> 'subtotal')::numeric > 500, q::text);
  insert into public.vihem_rental_pricing_rules (organisation_id, product_id, rule_type, price, duration, duration_unit, priority, valid_from, valid_until)
    values (v_org, v_prod, 'daily', 999, 1, 'day', 10, (v_start at time zone 'Europe/Stockholm')::date, (v_start at time zone 'Europe/Stockholm')::date + 2);
  q := public.vihem_rental_quote(v_prod, v_start, v_start + interval '24 hours', 1);
  perform pg_temp.expect('högre prioritet (säsong) går före lägre pris', (q ->> 'subtotal')::numeric = 999, q::text);
  insert into public.vihem_rental_products (organisation_id, name, slug, active, visible_publicly) values (v_org, 'T3', 'test-t3-' || gen_random_uuid(), true, true) returning id into v_prod3;
  perform pg_temp.expect_error('produkt utan prisregel -> E_NO_PRICE', format('select public.vihem_rental_quote(%L, now(), now() + interval ''1 day'', 1)', v_prod3), 'E_NO_PRICE');

  -- ===== BOKNING + TILLGÄNGLIGHET =====
  delete from public.vihem_rental_pricing_rules where product_id = v_prod and priority = 10;
  v_start := v_start + interval '20 days';
  r := public.vihem_rental_create_booking_v2(jsonb_build_array(jsonb_build_object('product_id', v_prod, 'start_at', v_start, 'end_at', v_start + interval '1 day', 'quantity', 2)),
        '{"first_name":"Test","last_name":"Testsson","email":"test@example.com","phone":"+46700000000"}', 'viborent.se', 'pending', '', '{"public":true,"hold":true}');
  perform pg_temp.expect('bokning av 2 objekt skapas med reservation', (r ->> 'hold_expires_at') is not null and (r ->> 'id') is not null, r::text);
  select count(*) into v_count from public.vihem_rental_booking_items where booking_id = (r ->> 'id')::uuid;
  perform pg_temp.expect('två bokningsrader (ett objekt vardera)', v_count = 2);
  perform pg_temp.expect_error('dubbelbokning nekas (alla objekt upptagna)',
    format('select public.vihem_rental_create_booking_v2(%L::jsonb, ''{}''::jsonb, ''viborent.se'', ''pending'', '''', ''{"public":true}'')',
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'start_at', v_start + interval '2 hours', 'end_at', v_start + interval '5 hours', 'quantity', 1))), 'E_UNAVAILABLE');
  perform pg_temp.expect('inga lediga objekt under perioden', not exists (select 1 from public.vihem_rental_free_assets(v_prod, v_start, v_start + interval '1 day')));

  -- Utgången reservation släpper objekten
  update public.vihem_rental_bookings set hold_expires_at = now() - interval '1 minute' where id = (r ->> 'id')::uuid;
  perform pg_temp.expect('objekten är lediga när reservationen gått ut (före cron)', (select count(*) from public.vihem_rental_free_assets(v_prod, v_start, v_start + interval '1 day')) = 2);
  perform public.vihem_rental_expire_holds();
  perform pg_temp.expect('cron markerar förfallen bokning som avbokad', (select status from public.vihem_rental_bookings where id = (r ->> 'id')::uuid) = 'cancelled');

  -- Produktövergripande blockering (asset_id null)
  insert into public.vihem_rental_blocks (organisation_id, product_id, asset_id, start_at, end_at, block_type) values (v_org, v_prod, null, v_start, v_start + interval '1 day', 'admin_block');
  perform pg_temp.expect('produktövergripande block stänger alla objekt', not exists (select 1 from public.vihem_rental_free_assets(v_prod, v_start, v_start + interval '1 day')));
  perform pg_temp.expect('block påverkar inte annan produkt', exists (select 1 from public.vihem_rental_free_assets(v_prod2, v_start, v_start + interval '1 day')));
  delete from public.vihem_rental_blocks where product_id = v_prod;
  -- Objektspecifikt block
  insert into public.vihem_rental_blocks (organisation_id, product_id, asset_id, start_at, end_at, block_type) values (v_org, v_prod, v_a1, v_start, v_start + interval '1 day', 'maintenance');
  perform pg_temp.expect('objektspecifikt block lämnar det andra objektet ledigt', (select count(*) from public.vihem_rental_free_assets(v_prod, v_start, v_start + interval '1 day')) = 1);
  delete from public.vihem_rental_blocks where product_id = v_prod;

  -- Buffert
  update public.vihem_rental_products set buffer_minutes = 120 where id = v_prod2;
  r := public.vihem_rental_create_booking_v2(jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'start_at', v_start, 'end_at', v_start + interval '1 day', 'quantity', 1)),
        '{"email":"b@example.com"}', 'viborent.se', 'pending', '', '{"public":true,"hold":true}');
  perform pg_temp.expect('buffert: start 1 h efter slut är fortfarande upptaget', not exists (select 1 from public.vihem_rental_free_assets(v_prod2, v_start + interval '25 hours', v_start + interval '30 hours')));
  perform pg_temp.expect('buffert: start 3 h efter slut är ledigt', exists (select 1 from public.vihem_rental_free_assets(v_prod2, v_start + interval '27 hours', v_start + interval '30 hours')));

  -- Kort varsel
  insert into public.vihem_rental_locks (organisation_id, external_device_id, name) values (v_org, 'TESTLOCK', 'Testlås') returning id into v_lock;
  update public.vihem_rental_assets set lock_id = v_lock where id = v_a3;
  perform pg_temp.expect_error('kort varsel kräver bekräftelse',
    format('select public.vihem_rental_create_booking_v2(%L::jsonb, ''{}''::jsonb, ''viborent.se'', ''pending'', '''', ''{"public":true}'')',
      jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'start_at', now() + interval '20 minutes', 'end_at', now() + interval '3 hours', 'quantity', 1))), 'E_SHORT_NOTICE');
  r2 := public.vihem_rental_create_booking_v2(jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'start_at', now() + interval '20 minutes', 'end_at', now() + interval '3 hours', 'quantity', 1)),
        '{"email":"c@example.com"}', 'viborent.se', 'pending', '', '{"public":true,"hold":true,"acknowledge_short_notice":true}');
  perform pg_temp.expect('kort varsel med bekräftelse markeras', (r2 ->> 'short_notice')::boolean);
  perform pg_temp.expect_error('kund kan inte avboka kort-varsel-bokning', format('select public.vihem_rental_cancel_booking(%L, ''customer'', null, null, %L, null)', (r2 ->> 'id')::uuid, (select public_lookup_token from public.vihem_rental_bookings where id = (r2 ->> 'id')::uuid)), 'E_CANCEL_CLOSED');

  -- ===== BETALNING + ÅTKOMSTKOD + AVBOKNING =====
  v_b := (r ->> 'id')::uuid;
  r := public.vihem_rental_mark_paid(v_b, 'cs_test', 'pi_test');
  perform pg_temp.expect('betalning bekräftar bokningen', (select status || payment_status from public.vihem_rental_bookings where id = v_b) = 'confirmedpaid', r::text);
  r := public.vihem_rental_mark_paid(v_b, 'cs_test', 'pi_test');
  perform pg_temp.expect('mark_paid är idempotent', (r ->> 'already_paid')::boolean);
  perform pg_temp.expect('kod schemalagd 60 min före start', (select scheduled_for from public.vihem_rental_access_codes where booking_id = v_b) = v_start - interval '60 minutes');
  perform pg_temp.expect('kod ej utfärdad före tid', (select status from public.vihem_rental_access_codes where booking_id = v_b) = 'scheduled' and (select pin_encrypted from public.vihem_rental_access_codes where booking_id = v_b) is null);
  r := public.vihem_rental_cancel_booking(v_b, 'customer', 'Ändrade mig', null, (select public_lookup_token from public.vihem_rental_bookings where id = v_b), null);
  perform pg_temp.expect('kund avbokar i tid: full återbetalning', (r ->> 'refund_amount')::numeric = (select total from public.vihem_rental_bookings where id = v_b), r::text);
  perform pg_temp.expect('schemalagd kod avbruten', (select status from public.vihem_rental_access_codes where booking_id = v_b) = 'cancelled');
  r := public.vihem_rental_cancel_booking(v_b, 'customer', null, null, (select public_lookup_token from public.vihem_rental_bookings where id = v_b), null);
  perform pg_temp.expect('avbokning är idempotent', (r ->> 'already_cancelled')::boolean);

  -- Utfärdad kod: kund nekas, admin får varning
  r := public.vihem_rental_create_booking_v2(jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'start_at', v_start + interval '3 days', 'end_at', v_start + interval '4 days', 'quantity', 1)),
        '{"email":"d@example.com"}', 'viborent.se', 'pending', '', '{"public":true,"hold":true}');
  v_b := (r ->> 'id')::uuid;
  perform public.vihem_rental_mark_paid(v_b, 'cs_t2', 'pi_t2');
  update public.vihem_rental_access_codes set status = 'issued', pin_encrypted = 'x', issued_at = now() where booking_id = v_b;
  perform pg_temp.expect_error('kund nekas när kod utfärdats', format('select public.vihem_rental_cancel_booking(%L, ''customer'', null, null, %L, null)', v_b, (select public_lookup_token from public.vihem_rental_bookings where id = v_b)), 'E_CANCEL_CLOSED');
  r := public.vihem_rental_cancel_booking(v_b, 'admin', 'Test', null, null, null);
  perform pg_temp.expect('admin kan avboka men får offline-PIN-varning', (r ->> 'offline_pin_warning') is not null and (select status from public.vihem_rental_access_codes where booking_id = v_b) = 'issued', r::text);

  -- Obetald bokning släpper reservation och kan inte återbetalas
  -- Sen betalning efter förfallen reservation: objektet fortfarande ledigt -> bokningen återställs
  r := public.vihem_rental_create_booking_v2(jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'start_at', v_start + interval '8 days', 'end_at', v_start + interval '9 days', 'quantity', 1)),
        '{"email":"e@example.com"}', 'viborent.se', 'pending', '', '{"public":true,"hold":true}');
  v_b := (r ->> 'id')::uuid;
  update public.vihem_rental_bookings set hold_expires_at = now() - interval '1 minute' where id = v_b;
  perform public.vihem_rental_expire_holds();
  r2 := public.vihem_rental_mark_paid(v_b, 'cs_late', 'pi_late');
  perform pg_temp.expect('sen betalning återställer bokning om objektet är ledigt', (select status from public.vihem_rental_bookings where id = v_b) = 'confirmed', r2::text);
  -- ...men om någon annan hunnit boka: återbetalning krävs
  r := public.vihem_rental_create_booking_v2(jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'start_at', v_start + interval '12 days', 'end_at', v_start + interval '13 days', 'quantity', 1)),
        '{"email":"f@example.com"}', 'viborent.se', 'pending', '', '{"public":true,"hold":true}');
  v_b := (r ->> 'id')::uuid;
  update public.vihem_rental_bookings set hold_expires_at = now() - interval '1 minute' where id = v_b;
  perform public.vihem_rental_expire_holds();
  perform public.vihem_rental_create_booking_v2(jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'start_at', v_start + interval '12 days', 'end_at', v_start + interval '13 days', 'quantity', 1)),
        '{"email":"g@example.com"}', 'viborent.se', 'pending', '', '{"public":true,"hold":true}');
  r2 := public.vihem_rental_mark_paid(v_b, 'cs_late2', 'pi_late2');
  perform pg_temp.expect('sen betalning när objektet tagits kräver återbetalning', (r2 ->> 'refund_required')::boolean, r2::text);

  -- ===== AVTAL =====
  begin
    update public.vihem_rental_contract_versions set body = 'ändrat' where organisation_id = v_org and version = 1;
    perform pg_temp.expect('publicerat avtal kan inte ändras', false);
  exception when others then
    perform pg_temp.expect('publicerat avtal kan inte ändras', position('E_CONTRACT_LOCKED' in SQLERRM) > 0, SQLERRM);
  end;
  perform pg_temp.expect('kund kan inte styra avtalstext', (select contract_terms_snapshot from public.vihem_rental_bookings where id = v_b) not like '%Avtalskomplettering%');

  -- ===== FLYTTA BOKNING + AVBOKNINGSTRIGGER =====
  r := public.vihem_rental_create_booking_v2(jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'start_at', v_start + interval '30 days', 'end_at', v_start + interval '31 days', 'quantity', 1)),
        '{"email":"h@example.com"}', 'viborent.se', 'pending', '', '{"public":true,"hold":true}');
  v_b := (r ->> 'id')::uuid;
  perform public.vihem_rental_mark_paid(v_b, 'cs_mv', 'pi_mv');
  perform public.vihem_rental_change_booking_period(v_b, v_start + interval '32 days', v_start + interval '33 days');
  perform pg_temp.expect('flytt uppdaterar bokning och rader', (select start_at from public.vihem_rental_bookings where id = v_b) = v_start + interval '32 days'
    and (select count(*) from public.vihem_rental_booking_items where booking_id = v_b and start_at = v_start + interval '32 days') = 1);
  perform pg_temp.expect('kodschema följer med flytten', (select valid_from from public.vihem_rental_access_codes where booking_id = v_b) = v_start + interval '32 days');
  r2 := public.vihem_rental_create_booking_v2(jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'start_at', v_start + interval '34 days', 'end_at', v_start + interval '35 days', 'quantity', 1)),
        '{"email":"i@example.com"}', 'viborent.se', 'pending', '', '{"public":true,"hold":true}');
  perform pg_temp.expect_error('flytt till upptagen tid nekas', format('select public.vihem_rental_change_booking_period(%L, %L, %L)', v_b, v_start + interval '34 days', v_start + interval '35 days 1 hour'), 'E_UNAVAILABLE');
  update public.vihem_rental_bookings set status = 'cancelled' where id = v_b;
  perform pg_temp.expect('direkt statusändring till avbokad stoppar schemalagd kod', (select status from public.vihem_rental_access_codes where booking_id = v_b) = 'cancelled');

  -- ===== AVTALSADMIN (simulerad inloggad admin) =====
  perform set_config('request.jwt.claims', json_build_object('sub', 'c03d0d59-4641-4baa-a45b-adadbc5d162b', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', 'c03d0d59-4641-4baa-a45b-adadbc5d162b', true);
  delete from public.vihem_rental_contract_versions where organisation_id = v_org and version = 9001;
  declare v_draft uuid; v_v integer;
  begin
    v_draft := public.vihem_rental_new_contract_draft();
    perform pg_temp.expect('utkast skapas som kopia av aktivt avtal', (select body from public.vihem_rental_contract_versions where id = v_draft) = (select body from public.vihem_rental_contract_versions where organisation_id = v_org and status = 'active'));
    perform pg_temp.expect_error('bara ett utkast åt gången', 'select public.vihem_rental_new_contract_draft()', 'E_STATE');
    update public.vihem_rental_contract_versions set body = 'kort' where id = v_draft;
    perform pg_temp.expect_error('för kort avtal kan inte publiceras', format('select public.vihem_rental_publish_contract(%L)', v_draft), 'E_STATE');
    update public.vihem_rental_contract_versions set body = 'Nytt hyresavtal version 2 – hyrestagaren ansvarar för utrustningen.' where id = v_draft;
    perform public.vihem_rental_publish_contract(v_draft);
    perform pg_temp.expect('publicering byter aktiv version', (select count(*) from public.vihem_rental_contract_versions where organisation_id = v_org and status = 'active') = 1 and (select status from public.vihem_rental_contract_versions where id = v_draft) = 'active');
    r := public.vihem_rental_create_booking_v2(jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'start_at', v_start + interval '40 days', 'end_at', v_start + interval '41 days', 'quantity', 1)),
          '{"email":"j@example.com"}', 'viborent.se', 'pending', '', '{"public":true,"hold":true}');
    perform pg_temp.expect('ny bokning får den nya avtalsversionen och texten', (select contract_terms_snapshot from public.vihem_rental_bookings where id = (r ->> 'id')::uuid) like 'Nytt hyresavtal version 2%' and (select contract_terms_version from public.vihem_rental_bookings where id = (r ->> 'id')::uuid) = 'v' || (select version from public.vihem_rental_contract_versions where id = v_draft));
  end;

  raise notice 'ALLA TESTER GODKÄNDA';
end $$;
