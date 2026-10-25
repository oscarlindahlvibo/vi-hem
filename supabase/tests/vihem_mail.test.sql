-- SQL-tester för VI-HEM Mail (körs i transaktion som alltid rullas tillbaka: scripts/test_mail_sql.sh)
create or replace function pg_temp.expect(p_name text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'TEST FAILED: % %', p_name, p_detail; end if; raise notice 'ok - %', p_name; end $$;
create or replace function pg_temp.expect_error(p_name text, p_sql text, p_code text) returns void language plpgsql as $$
declare v_msg text;
begin begin execute p_sql; exception when others then v_msg := sqlerrm; end;
  if v_msg is null then raise exception 'TEST FAILED (ingen fel): %', p_name; end if;
  if position(p_code in v_msg) = 0 then raise exception 'TEST FAILED (fel kod, fick %): %', v_msg, p_name; end if;
  raise notice 'ok - % (%)', p_name, p_code; end $$;
create or replace function pg_temp.mkprofile(p_org uuid, p_name text, p_role text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, lower(p_name) || '-' || substr(v_id::text, 1, 6) || '@example.test');
  insert into public.vihem_profiles (id, name, email, role, active, organisation_id) values (v_id, p_name, lower(p_name) || '-' || substr(v_id::text, 1, 6) || '@example.test', p_role, true, p_org);
  return v_id; end $$;
create or replace function pg_temp.mkaccount(p_org uuid, p_email text, p_kind text, p_owner uuid) returns uuid language plpgsql as $$
declare v_id uuid;
begin insert into public.vihem_mail_accounts (organisation_id, email, kind, owner_user_id, access_mode, client_enabled) values (p_org, p_email, p_kind, p_owner, case when p_kind = 'personal' then 'restricted' else 'org_shared' end, true) returning id into v_id; return v_id; end $$;

do $$
declare
  v_org uuid := '38fe702d-e72c-49a2-9750-5e0b6934959b'; v_org2 uuid := gen_random_uuid();
  anna uuid; berit uuid; admin1 uuid; admin2 uuid; otherorg uuid; v_priv_anna uuid; v_shared uuid; v_priv_berit uuid; v_x uuid; v_n int;
begin
  insert into public.vihem_organisations (id, name, slug) values (v_org2, 'Testorg mail', 'testorg-mail-' || substr(v_org2::text, 1, 8)) on conflict do nothing;
  anna := pg_temp.mkprofile(v_org, 'Anna', 'staff'); berit := pg_temp.mkprofile(v_org, 'Berit', 'staff');
  admin1 := pg_temp.mkprofile(v_org, 'Admin1', 'admin'); admin2 := pg_temp.mkprofile(v_org, 'Admin2', 'admin'); otherorg := pg_temp.mkprofile(v_org2, 'Utomstaende', 'admin');
  v_priv_anna := pg_temp.mkaccount(v_org, 'anna-test@example.test', 'personal', anna);
  v_priv_berit := pg_temp.mkaccount(v_org, 'berit-test@example.test', 'personal', berit);
  v_shared := pg_temp.mkaccount(v_org, 'ekonomi-test@example.test', 'shared', null);

  -- Grundläge: ingen har åtkomst utan tilldelning
  perform pg_temp.expect('ingen åtkomst utan tilldelning', not public.vihem_mail_authorize(anna, v_priv_anna, 'read'));
  perform pg_temp.expect('admin har inte automatiskt åtkomst till personlig brevlåda', not public.vihem_mail_authorize(admin1, v_priv_anna, 'read'));

  -- Ägaren får full åtkomst via uttrycklig tilldelning (ingen orsak krävs för ägaren)
  perform public.vihem_mail_grant(admin1, v_priv_anna, anna, true, true, true, false, '');
  perform public.vihem_mail_grant(admin1, v_priv_berit, berit, true, true, true, false, '');
  perform pg_temp.expect('anställd ser sin egen brevlåda (läsa, skicka, hantera)', public.vihem_mail_authorize(anna, v_priv_anna, 'read') and public.vihem_mail_authorize(anna, v_priv_anna, 'send') and public.vihem_mail_authorize(anna, v_priv_anna, 'manage'));
  perform pg_temp.expect('anställd saknar adminrättighet i egen brevlåda', not public.vihem_mail_authorize(anna, v_priv_anna, 'admin'));
  perform pg_temp.expect('anställd ser inte annan anställds brevlåda', not public.vihem_mail_authorize(anna, v_priv_berit, 'read') and not public.vihem_mail_authorize(berit, v_priv_anna, 'read'));
  perform pg_temp.expect('okänd nivå nekas', not public.vihem_mail_authorize(anna, v_priv_anna, 'superuser'));

  -- Läsbehörighet ger inte skickabehörighet; flaggor kombineras
  perform public.vihem_mail_grant(admin1, v_shared, anna, true, false, false, false, '');
  perform pg_temp.expect('läsbehörighet ger inte skicka-behörighet', public.vihem_mail_authorize(anna, v_shared, 'read') and not public.vihem_mail_authorize(anna, v_shared, 'send') and not public.vihem_mail_authorize(anna, v_shared, 'manage'));
  perform public.vihem_mail_grant(admin1, v_shared, anna, true, true, false, false, '');
  perform pg_temp.expect('skicka utan hantera: radering/arkivering kräver egen rättighet', public.vihem_mail_authorize(anna, v_shared, 'send') and not public.vihem_mail_authorize(anna, v_shared, 'manage'));
  perform pg_temp.expect_error('skicka utan läsa avvisas', format('select public.vihem_mail_grant(%L, %L, %L, false, true, false, false, %L)', admin1, v_shared, anna, ''), 'E_INVALID');

  -- Återkallad behörighet gäller omedelbart
  perform public.vihem_mail_grant(admin1, v_shared, anna, false, false, false, false, '');
  perform pg_temp.expect('återkallad behörighet gäller omedelbart', not public.vihem_mail_authorize(anna, v_shared, 'read'));
  select count(*) into v_n from public.vihem_mail_audit_events where mail_account_id = v_shared and action = 'permission_revoked';
  perform pg_temp.expect('återkallning loggas', v_n = 1);

  -- Admin: personlig brevlåda kräver orsak; självtilldelning blockeras; annan admin kan tilldela
  perform pg_temp.expect_error('åtkomst till annans personliga brevlåda kräver orsak', format('select public.vihem_mail_grant(%L, %L, %L, true, false, false, false, %L)', admin1, v_priv_anna, admin2, ''), 'E_INVALID');
  perform pg_temp.expect_error('admin kan inte ge sig själv åtkomst till annans personliga brevlåda', format('select public.vihem_mail_grant(%L, %L, %L, true, false, false, false, %L)', admin1, v_priv_anna, admin1, 'Behöver läsa vid semester'), 'E_FORBIDDEN');
  perform public.vihem_mail_grant(admin2, v_priv_anna, admin1, true, false, false, false, 'Vikarie under semester, godkänt av ägaren');
  perform pg_temp.expect('annan admin kan ge uttryckligt läsrätt med orsak', public.vihem_mail_authorize(admin1, v_priv_anna, 'read') and not public.vihem_mail_authorize(admin1, v_priv_anna, 'send'));
  perform pg_temp.expect('orsaken sparas på tilldelningen', (select reason from public.vihem_mail_permissions where mail_account_id = v_priv_anna and user_id = admin1 and revoked_at is null) like 'Vikarie%');
  perform pg_temp.expect('admin ser fortfarande inte Berits personliga brevlåda', not public.vihem_mail_authorize(admin1, v_priv_berit, 'read'));

  -- Vanlig anställd kan inte tilldela
  perform pg_temp.expect_error('anställd kan inte tilldela behörighet', format('select public.vihem_mail_grant(%L, %L, %L, true, false, false, false, %L)', anna, v_shared, berit, 'x'), 'E_FORBIDDEN');
  -- Brevlådeadmin (can_admin) kan tilldela i sin brevlåda
  perform public.vihem_mail_grant(admin1, v_shared, anna, true, true, true, true, '');
  perform public.vihem_mail_grant(anna, v_shared, berit, true, false, false, false, '');
  perform pg_temp.expect('brevlådeadmin kan tilldela i sin brevlåda', public.vihem_mail_authorize(berit, v_shared, 'read'));

  -- Organisationsgränser
  perform pg_temp.expect_error('tilldelning över organisationsgräns nekas', format('select public.vihem_mail_grant(%L, %L, %L, true, false, false, false, %L)', admin1, v_shared, otherorg, 'x'), 'E_FORBIDDEN');
  perform pg_temp.expect('användare i annan organisation har ingen åtkomst', not public.vihem_mail_authorize(otherorg, v_shared, 'read'));
  perform pg_temp.expect_error('personliga brevlådor måste vara begränsade (constraint)', format('update public.vihem_mail_accounts set access_mode = %L where id = %L', 'org_shared', v_priv_anna), 'vihem_mail_accounts_personal_owner_check');

  -- Inaktiv användare/brevlåda förlorar åtkomst
  update public.vihem_profiles set active = false where id = berit;
  perform pg_temp.expect('inaktiverad användare förlorar åtkomst direkt', not public.vihem_mail_authorize(berit, v_shared, 'read'));
  update public.vihem_mail_accounts set active = false where id = v_shared;
  perform pg_temp.expect('inaktiverad brevlåda nekar alla', not public.vihem_mail_authorize(anna, v_shared, 'read'));

  -- Klienten har ingen direktåtkomst till tabellerna
  begin
    set local role authenticated;
    perform 1 from public.vihem_mail_permissions limit 1;
    reset role; raise exception 'TEST FAILED: klient kunde läsa behörigheter';
  exception when insufficient_privilege then reset role; raise notice 'ok - klienten kan inte läsa behörighetstabellen direkt';
  end;
  begin
    set local role authenticated;
    perform 1 from public.vihem_mail_send_ledger limit 1;
    reset role; raise exception 'TEST FAILED: klient kunde läsa utskicksregistret';
  exception when insufficient_privilege then reset role; raise notice 'ok - klienten kan inte läsa utskicksregistret direkt';
  end;

  -- Utskicksregister: idempotens (samma begäran-id går inte att registrera två gånger)
  update public.vihem_mail_accounts set active = true where id = v_shared;
  insert into public.vihem_mail_send_ledger (organisation_id, mail_account_id, user_id, client_request_id, from_email, message_id_header, request_hash)
    values (v_org, v_shared, anna, '11111111-1111-4111-8111-111111111111', 'ekonomi-test@example.test', '<a@example.test>', 'h');
  perform pg_temp.expect_error('samma client_request_id kan inte skicka två gånger', format('insert into public.vihem_mail_send_ledger (organisation_id, mail_account_id, user_id, client_request_id, from_email, message_id_header, request_hash) values (%L, %L, %L, %L, %L, %L, %L)', v_org, v_shared, anna, '11111111-1111-4111-8111-111111111111', 'x@example.test', '<b@example.test>', 'h'), 'duplicate key');

  raise notice 'ALLA MAIL-SQL-TESTER GODKÄNDA';
end $$;
