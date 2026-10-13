-- Kompetensportalen kärntester (databasnivå). Körs i en transaktion som alltid rullas tillbaka: scripts/test_kp_sql.sh
create or replace function pg_temp.expect(p_name text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'TEST FAILED: % %', p_name, p_detail; end if;
  raise notice 'ok - %', p_name;
end $$;
create or replace function pg_temp.expect_error(p_name text, p_sql text, p_code text) returns void language plpgsql as $$
declare v_msg text;
begin
  begin execute p_sql; exception when others then v_msg := SQLERRM; end;
  if v_msg is null or position(p_code in v_msg) = 0 then raise exception 'TEST FAILED: % (förväntade %, fick %)', p_name, p_code, coalesce(v_msg, 'inget fel'); end if;
  raise notice 'ok - % (%)', p_name, p_code;
end $$;
create or replace function pg_temp.mkuser(p_first text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_org uuid := '38fe702d-e72c-49a2-9750-5e0b6934959b';
begin
  insert into auth.users (id, email) values (v_id, lower(p_first) || '-' || substr(v_id::text, 1, 6) || '@example.test');
  insert into public.vihem_kp_participants (user_id, organisation_id, email, first_name, last_name) values (v_id, v_org, lower(p_first) || '-' || substr(v_id::text, 1, 6) || '@example.test', p_first, 'Testsson');
  return v_id;
end $$;

do $$
declare
  v_org uuid := '38fe702d-e72c-49a2-9750-5e0b6934959b';
  v_course uuid; v_ver uuid; v_mod uuid; v_l_video uuid; v_l_view uuid; v_asset uuid; v_exam uuid; v_prod uuid; v_q uuid[] := '{}'; v_qid uuid; v_cust uuid;
  r jsonb; v_order uuid; v_u1 uuid; v_u2 uuid; v_enr uuid; v_seat uuid; v_sess uuid; v_attempt uuid; v_cert uuid; i integer; v_users uuid[] := '{}'; v_u uuid; o jsonb; v_tmp uuid; v_code text;
  v_view jsonb; v_pick jsonb; v_opt uuid; v_ver2 uuid; v_n integer; v_sess2 uuid; v_booking uuid; v_course2 uuid; v_prod2 uuid; v_ver3 uuid; v_reg uuid; v_bk uuid;
begin
  insert into public.vihem_organisation_modules (organisation_id, module_key, enabled) values (v_org, 'kompetensportalen', true) on conflict (organisation_id, module_key) do update set enabled = true;
  perform public.vihem_kp_seed_defaults(v_org);
  update public.vihem_kp_settings set invoice_enabled = true, invoice_access_mode = 'after_payment' where organisation_id = v_org;
  perform pg_temp.expect('standardinställningar och mallar skapas', (select count(*) from public.vihem_kp_email_templates where organisation_id = v_org) >= 13 and (select finance_company_id from public.vihem_kp_settings where organisation_id = v_org) is not null);

  -- ===== KURS, INNEHÅLL, PROV, PUBLICERING =====
  insert into public.vihem_kp_courses (organisation_id, code, slug, title, estimated_minutes, validity_months, id06_enabled, id06_competence_code, status)
    values (v_org, 'TST1', 'test-kurs-1', 'Testkurs 1', 60, 60, true, 'TST-1', 'draft') returning id into v_course;
  insert into public.vihem_kp_course_versions (organisation_id, course_id, version, status, sequential) values (v_org, v_course, 1, 'draft', false) returning id into v_ver;
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Kapitel 1', 1) returning id into v_mod;
  insert into public.vihem_kp_media_assets (organisation_id, kind, bucket, storage_path, duration_seconds) values (v_org, 'video', 'vihem-kp-private', 'test/' || gen_random_uuid() || '.mp4', 100) returning id into v_asset;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, completion_rule) values (v_org, v_ver, v_mod, 'Video', 'video', 1, '{"type":"video_watch","min_percent":90}') returning id into v_l_video;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, completion_rule) values (v_org, v_ver, v_mod, 'Text', 'content', 2, '{"type":"view","min_seconds":30}') returning id into v_l_view;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_l_video, 'video', 1, jsonb_build_object('asset_id', v_asset));
  insert into public.vihem_kp_exams (organisation_id, version_id, kind, title, question_count, pass_percent, max_attempts, cooldown_seconds, time_limit_seconds, feedback_mode) values (v_org, v_ver, 'final', 'Slutprov', 4, 75, 3, 0, 600, 'after_attempt') returning id into v_exam;
  for i in 1..3 loop
    insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, explanation) values (v_org, 'Ämne', 'single', 'Fråga ' || i, 'Förklaring ' || i) returning id into v_qid;
    insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_qid, 'Rätt', true, 1), (v_org, v_qid, 'Fel', false, 2);
    v_q := v_q || v_qid;
  end loop;
  insert into public.vihem_kp_exam_topic_rules (exam_id, organisation_id, topic, question_count) values (v_exam, v_org, 'Ämne', 4);
  perform set_config('request.jwt.claims', json_build_object('sub', 'c03d0d59-4641-4baa-a45b-adadbc5d162b', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', 'c03d0d59-4641-4baa-a45b-adadbc5d162b', true);
  perform pg_temp.expect_error('publicering nekas när provet har för få frågor', format('select public.vihem_kp_publish_version(%L)', v_ver), 'E_INVALID');
  insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, explanation) values (v_org, 'Ämne', 'multiple', 'Fråga 4 (flera)', 'Förklaring 4') returning id into v_qid;
  insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_qid, 'A', true, 1), (v_org, v_qid, 'B', true, 2), (v_org, v_qid, 'C', false, 3);
  perform public.vihem_kp_publish_version(v_ver);
  perform pg_temp.expect('kursen är publicerad med låst version', (select status from public.vihem_kp_courses where id = v_course) = 'published' and (select published_version_id from public.vihem_kp_courses where id = v_course) = v_ver);
  perform pg_temp.expect_error('publicerad version kan inte ändras', format('insert into public.vihem_kp_modules (organisation_id, version_id, title) values (%L, %L, ''x'')', v_org, v_ver), 'E_VERSION_LOCKED');
  perform pg_temp.expect_error('publicerad version kan inte raderas ur', format('delete from public.vihem_kp_lessons where id = %L', v_l_view), 'E_VERSION_LOCKED');
  v_ver2 := public.vihem_kp_new_draft(v_course, 'v2');
  perform pg_temp.expect('nytt utkast klonar innehållet', (select count(*) from public.vihem_kp_lessons where version_id = v_ver2) = 2 and (select count(*) from public.vihem_kp_exams where version_id = v_ver2) = 1);
  perform public.vihem_kp_publish_version(v_ver2);
  perform pg_temp.expect('ny version ersätter den gamla (som behålls)', (select status from public.vihem_kp_course_versions where id = v_ver) = 'retired' and (select published_version_id from public.vihem_kp_courses where id = v_course) = v_ver2);
  -- återställ till v1-logik i testet: pinna enrollment mot version 2 (aktuell)
  v_ver := v_ver2;
  select id into v_l_video from public.vihem_kp_lessons where version_id = v_ver and kind = 'video';
  select id into v_l_view from public.vihem_kp_lessons where version_id = v_ver and kind = 'content';
  select id into v_exam from public.vihem_kp_exams where version_id = v_ver;
  select (content ->> 'asset_id')::uuid into v_asset from public.vihem_kp_lesson_blocks where lesson_id = v_l_video;

  -- ===== PRODUKT, PRIS, RABATT =====
  insert into public.vihem_kp_products (organisation_id, kind, course_id, sku, name, price, vat_rate) values (v_org, 'course', v_course, 'TST1', 'Testkurs 1', 2495, 25) returning id into v_prod;
  insert into public.vihem_kp_price_rules (organisation_id, product_id, label, min_quantity, unit_price) values (v_org, v_prod, 'Volym 10+', 10, 2000);
  insert into public.vihem_kp_discount_codes (organisation_id, code, kind, value) values (v_org, 'TEST10', 'percent', 10);
  r := public.vihem_kp_quote(v_org, jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)), null, null);
  perform pg_temp.expect('pris 1 st = 2495 + 25 % moms', (r ->> 'subtotal')::numeric = 2495 and (r ->> 'vat_total')::numeric = 623.75 and (r ->> 'total')::numeric = 3118.75, r::text);
  r := public.vihem_kp_quote(v_org, jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 10)), null, null);
  perform pg_temp.expect('volympris från 10 st', (r ->> 'subtotal')::numeric = 20000, r::text);
  r := public.vihem_kp_quote(v_org, jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 2)), null, 'TEST10');
  perform pg_temp.expect('rabattkod 10 %: moms på rabatterat belopp', (r ->> 'discount_total')::numeric = 499 and (r ->> 'total')::numeric = round((4990 - 499) * 1.25, 2), r::text);
  perform pg_temp.expect_error('ogiltig rabattkod', format('select public.vihem_kp_quote(%L, %L::jsonb, null, ''NOPE'')', v_org, jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1))), 'E_CODE');
  insert into public.vihem_kp_customers (organisation_id, name, org_number, invoice_purchase_allowed, invoice_email, invoice_access_mode) values (v_org, 'Testbolaget AB', '556000-0001', true, 'faktura@testbolaget.test', 'inherit') returning id into v_cust;
  insert into public.vihem_kp_price_rules (organisation_id, product_id, customer_id, label, min_quantity, unit_price) values (v_org, v_prod, v_cust, 'Avtalspris', 1, 1900);
  r := public.vihem_kp_quote(v_org, jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)), v_cust, null);
  perform pg_temp.expect('företagsspecifikt pris gäller bara för företaget', (r ->> 'subtotal')::numeric = 1900 and (public.vihem_kp_quote(v_org, jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)), null, null) ->> 'subtotal')::numeric = 2495);

  -- ===== PRIVATKÖP: ingen åtkomst före verifierad betalning =====
  v_u1 := pg_temp.mkuser('Anna');
  o := public.vihem_kp_create_order(v_org, v_u1, null, 'private', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)), null, 'stripe', 'idem-1', 'anna@example.test', '{}', '{"terms_version":1}');
  v_order := (o ->> 'order_id')::uuid;
  perform pg_temp.expect('order skapas som väntande betalning utan platser eller enrollments', (select status from public.vihem_kp_orders where id = v_order) = 'pending_payment' and (select count(*) from public.vihem_kp_seats where order_id = v_order) = 0
    and (select count(*) from public.vihem_kp_enrollments where user_id = v_u1) = 0);
  perform pg_temp.expect('samma idempotensnyckel ger samma order', (public.vihem_kp_create_order(v_org, v_u1, null, 'private', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)), null, 'stripe', 'idem-1', 'anna@example.test', '{}', '{}') ->> 'order_id')::uuid = v_order);
  r := public.vihem_kp_apply_payment(v_order, 'stripe', 'pi_test_1', (o ->> 'total')::numeric, '{}');
  perform pg_temp.expect('verifierad betalning ger order paid/fulfilled, en plats och enrollment', (select status from public.vihem_kp_orders where id = v_order) = 'fulfilled' and (select count(*) from public.vihem_kp_seats where order_id = v_order and access_enabled) = 1
    and (select count(*) from public.vihem_kp_enrollments where user_id = v_u1 and access_enabled) = 1, r::text);
  r := public.vihem_kp_apply_payment(v_order, 'stripe', 'pi_test_1', (o ->> 'total')::numeric, '{}');
  perform pg_temp.expect('samma betalning två gånger (webhook-dubblett) skapar inga dubbletter', (r ->> 'duplicate')::boolean and (select count(*) from public.vihem_kp_seats where order_id = v_order) = 1 and (select count(*) from public.vihem_kp_payments where order_id = v_order) = 1);
  v_enr := (select id from public.vihem_kp_enrollments where user_id = v_u1);

  -- ===== AVBRUTEN BETALNING =====
  v_u2 := pg_temp.mkuser('Bertil');
  o := public.vihem_kp_create_order(v_org, v_u2, null, 'private', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)), null, 'stripe', 'idem-2', 'bertil@example.test', '{}', '{}');
  update public.vihem_kp_orders set expires_at = now() - interval '1 minute' where id = (o ->> 'order_id')::uuid;
  perform public.vihem_kp_expire_orders();
  perform pg_temp.expect('obetald order förfaller utan åtkomst', (select status from public.vihem_kp_orders where id = (o ->> 'order_id')::uuid) = 'expired' and (select count(*) from public.vihem_kp_enrollments where user_id = v_u2) = 0);
  r := public.vihem_kp_apply_payment((o ->> 'order_id')::uuid, 'stripe', 'pi_late', 3118.75, '{}');
  perform pg_temp.expect('sen betalning på förfallen order ger ingen åtkomst', (r ->> 'late_payment')::boolean and (select count(*) from public.vihem_kp_seats where order_id = (o ->> 'order_id')::uuid) = 0);

  -- ===== LÄRANDE: video, visning, sekvens =====
  v_view := public.vihem_kp_open_lesson(v_enr, v_u1, v_l_video);
  perform pg_temp.expect('öppna lektion startar enrollment', (select status from public.vihem_kp_enrollments where id = v_enr) = 'in_progress');
  perform pg_temp.expect_error('annan användare når inte min enrollment', format('select public.vihem_kp_open_lesson(%L, %L, %L)', v_enr, v_u2, v_l_video), 'E_NOT_FOUND');
  r := public.vihem_kp_video_start(v_enr, v_u1, v_l_video, v_asset);
  v_tmp := (r ->> 'session_id')::uuid;
  update public.vihem_kp_video_sessions set last_heartbeat_at = now() - interval '10 seconds' where id = v_tmp;
  r := public.vihem_kp_video_heartbeat(v_tmp, v_u1, 10, true);
  perform pg_temp.expect('uppspelning i realtid ger täckning', (r ->> 'watched_seconds')::integer = 10, r::text);
  update public.vihem_kp_video_sessions set last_heartbeat_at = now() - interval '10 seconds' where id = v_tmp;
  r := public.vihem_kp_video_heartbeat(v_tmp, v_u1, 90, true);
  perform pg_temp.expect('hopp framåt ger ingen täckning', (r ->> 'watched_seconds')::integer = 10 and not (r ->> 'completed')::boolean, r::text);
  update public.vihem_kp_video_sessions set last_heartbeat_at = now() - interval '10 seconds' where id = v_tmp;
  r := public.vihem_kp_video_heartbeat(v_tmp, v_u1, 100, false);
  perform pg_temp.expect('pausad uppspelning ger ingen täckning', (r ->> 'watched_seconds')::integer = 10);
  -- titta på riktigt: 9 hjärtslag à 10 s från 0 -> täckning av hela videon (omspelning av samma sekunder dubbelräknas inte)
  update public.vihem_kp_video_sessions set last_position = 0 where id = v_tmp;
  for i in 1..9 loop
    update public.vihem_kp_video_sessions set last_heartbeat_at = now() - interval '10 seconds' where id = v_tmp;
    r := public.vihem_kp_video_heartbeat(v_tmp, v_u1, i * 10, true);
  end loop;
  perform pg_temp.expect('90 % unikt tittad ger server-godkänd lektion', (r ->> 'completed')::boolean and (select completion_source from public.vihem_kp_lesson_progress where enrollment_id = v_enr and lesson_id = v_l_video) = 'server_video', r::text);
  perform pg_temp.expect_error('klienten kan inte slutföra videolektion själv', format('select public.vihem_kp_complete_view_lesson(%L, %L, %L)', v_enr, v_u1, v_l_video), 'E_RULE');
  perform public.vihem_kp_open_lesson(v_enr, v_u1, v_l_view);
  perform pg_temp.expect_error('visningslektion kan inte klaras för snabbt', format('select public.vihem_kp_complete_view_lesson(%L, %L, %L)', v_enr, v_u1, v_l_view), 'E_TOO_FAST');
  perform pg_temp.expect_error('prov kräver att lektioner är klara', format('select public.vihem_kp_exam_start(%L, %L, %L)', v_enr, v_u1, v_exam), 'E_PREREQ');
  update public.vihem_kp_lesson_progress set first_viewed_at = now() - interval '2 minutes' where enrollment_id = v_enr and lesson_id = v_l_view;
  perform public.vihem_kp_complete_view_lesson(v_enr, v_u1, v_l_view);
  perform pg_temp.expect('alla lektioner klara = 100 % framsteg', (select progress_percent from public.vihem_kp_enrollments where id = v_enr) = 100);

  -- ===== PROV: serverrättning, försök, utgång =====
  v_attempt := public.vihem_kp_exam_start(v_enr, v_u1, v_exam);
  r := public.vihem_kp_attempt_view(v_attempt, v_u1);
  perform pg_temp.expect('klientvyn innehåller inget facit', position('is_correct' in r::text) = 0 and position('Förklaring' in r::text) = 0 and jsonb_array_length(r -> 'questions') = 4, left(r::text, 300));
  perform pg_temp.expect('samma öppna försök återanvänds', public.vihem_kp_exam_start(v_enr, v_u1, v_exam) = v_attempt);
  perform pg_temp.expect_error('svar med främmande alternativ nekas', format('select public.vihem_kp_exam_answer(%L, %L, %L, array[%L::uuid])', v_attempt, v_u1, ((r -> 'questions' -> 0) ->> 'question_id')::uuid, gen_random_uuid()), 'E_INVALID');
  perform pg_temp.expect_error('andra användare når inte mitt försök', format('select public.vihem_kp_attempt_view(%L, %L)', v_attempt, v_u2), 'E_NOT_FOUND');
  r := public.vihem_kp_exam_submit(v_attempt, v_u1);
  perform pg_temp.expect('obesvarat prov underkänns (0 %) med 2 försök kvar', not (r ->> 'passed')::boolean and (r ->> 'percent')::numeric = 0 and (r ->> 'attempts_left')::integer = 2, r::text);
  perform pg_temp.expect('inget certifikat vid underkänt', (select count(*) from public.vihem_kp_certificates where enrollment_id = v_enr) = 0);
  -- försök 2: besvara allt rätt via facit i snapshot (testet får läsa som postgres)
  v_attempt := public.vihem_kp_exam_start(v_enr, v_u1, v_exam);
  perform pg_temp.expect('nytt försök har nummer 2', (select attempt_no from public.vihem_kp_exam_attempts where id = v_attempt) = 2);
  for r in select value from jsonb_array_elements((select snapshot from public.vihem_kp_exam_attempts where id = v_attempt)) loop
    perform public.vihem_kp_exam_answer(v_attempt, v_u1, (r ->> 'question_id')::uuid, (select array_agg((o2 ->> 'id')::uuid) from jsonb_array_elements(r -> 'options') o2 where (o2 ->> 'is_correct')::boolean));
  end loop;
  r := public.vihem_kp_exam_submit(v_attempt, v_u1);
  perform pg_temp.expect('rätt svar ger godkänt 100 %', (r ->> 'passed')::boolean and (r ->> 'percent')::numeric = 100, r::text);
  perform pg_temp.expect('godkänt prov slutför utbildningen och utfärdar certifikat', (select status from public.vihem_kp_enrollments where id = v_enr) = 'completed' and (select count(*) from public.vihem_kp_certificates where enrollment_id = v_enr and status = 'issued') = 1);
  v_cert := (select id from public.vihem_kp_certificates where enrollment_id = v_enr);
  perform pg_temp.expect('certifikatet knyts till kursversionen och har giltighet', (select course_version_id from public.vihem_kp_certificates where id = v_cert) = v_ver and (select valid_until from public.vihem_kp_certificates where id = v_cert) > current_date + 365 * 4);
  perform pg_temp.expect('samma certifikat utfärdas inte två gånger', public.vihem_kp_issue_certificate(v_enr, null) = v_cert);
  perform pg_temp.expect('ID06-ärende skapas men markeras som kräver åtgärd utan verifierat personnummer (ingen simulerad registrering)',
    (select status from public.vihem_kp_external_registrations where certificate_id = v_cert) = 'needs_action');

  -- ===== CERTIFIKATVERIFIERING OCH SPÅRBARHET =====
  v_code := (select verification_code from public.vihem_kp_certificates where id = v_cert);
  r := public.vihem_kp_verify_certificate(v_code);
  perform pg_temp.expect('verifiering visar minimiuppgifter', (r ->> 'status') = 'valid' and (r ->> 'holder_name') = 'Anna Testsson' and position('email' in r::text) = 0 and position('personal' in r::text) = 0, r::text);
  perform pg_temp.expect('okänd kod ger found=false', (public.vihem_kp_verify_certificate('ZZZZZZZZZZZZ') ->> 'found')::boolean = false);
  v_tmp := public.vihem_kp_reissue_certificate(v_cert, 'Namnkorrigering', null);
  perform pg_temp.expect('ersatt certifikat länkar gammalt till nytt', (public.vihem_kp_verify_certificate(v_code) ->> 'status') = 'superseded' and (select certificate_number from public.vihem_kp_certificates where id = v_tmp) = (public.vihem_kp_verify_certificate(v_code) ->> 'replaced_by_number'));
  perform public.vihem_kp_revoke_certificate(v_tmp, 'Utfärdat av misstag', null);
  perform pg_temp.expect('återkallat certifikat visas som återkallat', (public.vihem_kp_verify_certificate((select verification_code from public.vihem_kp_certificates where id = v_tmp)) ->> 'status') = 'revoked');
  perform pg_temp.expect('händelselogg bevarar hela historiken', (select count(*) from public.vihem_kp_certificate_events where certificate_id in (v_cert, v_tmp)) >= 4);

  -- ===== ID06: statusmaskin utan simulering =====
  select id into v_reg from public.vihem_kp_external_registrations where enrollment_id = v_enr and certificate_id = v_tmp;
  perform pg_temp.expect('ID06-ärendet följde med det ersatta certifikatet', v_reg is not null);
  perform pg_temp.expect_error('registrerad kräver referens', format('select public.vihem_kp_id06_result(%L, ''registered'', null, null, null)', v_reg), 'E_INVALID');
  perform public.vihem_kp_id06_result(v_reg, 'failed', null, 'API svarade 500', null);
  perform public.vihem_kp_id06_result(v_reg, 'pending', null, null, null);
  perform pg_temp.expect('återförsök återställer till pending utan dubblett', (select count(*) from public.vihem_kp_external_registrations where enrollment_id = v_enr) = 1 and (select status from public.vihem_kp_external_registrations where id = v_reg) = 'pending');
  perform public.vihem_kp_id06_result(v_reg, 'registered', 'ID06-REF-1', null, c.id) from (select 'c03d0d59-4641-4baa-a45b-adadbc5d162b'::uuid id) c;
  perform pg_temp.expect_error('registrerade ärenden kan inte ändras', format('select public.vihem_kp_id06_result(%L, ''failed'', null, ''x'', null)', v_reg), 'E_STATE');

  -- ===== PROV: försöksgräns, tidsgräns, justering med revisionsspår =====
  v_u := pg_temp.mkuser('Cecilia');
  o := public.vihem_kp_create_order(v_org, v_u, null, 'private', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)), null, 'stripe', 'idem-3', 'c@example.test', '{}', '{}');
  perform public.vihem_kp_apply_payment((o ->> 'order_id')::uuid, 'stripe', 'pi_test_3', (o ->> 'total')::numeric, '{}');
  v_enr := (select id from public.vihem_kp_enrollments where user_id = v_u);
  perform set_config('vihem.kp_clone', 'on', true); update public.vihem_kp_exams set require_lessons_complete = false where id = v_exam; perform set_config('vihem.kp_clone', 'off', true);  -- bara testet kringgår låset
  for i in 1..3 loop
    v_attempt := public.vihem_kp_exam_start(v_enr, v_u, v_exam);
    if i = 1 then update public.vihem_kp_exam_attempts set expires_at = now() - interval '2 minutes' where id = v_attempt; end if;
    r := public.vihem_kp_exam_submit(v_attempt, v_u);
    if i = 1 then perform pg_temp.expect('inlämning efter tidsgräns underkänns som utgången', (r ->> 'status') = 'expired' and not (r ->> 'passed')::boolean, r::text); end if;
  end loop;
  perform pg_temp.expect_error('max antal försök', format('select public.vihem_kp_exam_start(%L, %L, %L)', v_enr, v_u, v_exam), 'E_ATTEMPTS');
  perform public.vihem_kp_exam_override(v_attempt, true, 'Felaktig fråga i provet, rättad manuellt', null);
  perform pg_temp.expect('justering sparar original i revisionsspåret', (select count(*) from public.vihem_kp_attempt_events where attempt_id = v_attempt and event_type = 'override') = 1 and (select detail -> 'before' ->> 'passed' from public.vihem_kp_attempt_events where attempt_id = v_attempt and event_type = 'override') = 'false');

  -- ===== FÖRETAG: 10 platser mot faktura, fördelning, återtagande =====
  o := public.vihem_kp_create_order(v_org, v_u1, v_cust, 'company', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 10)), null, 'invoice', 'idem-co-1', 'faktura@testbolaget.test', '{}', '{}');
  v_order := (o ->> 'order_id')::uuid;
  perform pg_temp.expect('fakturaorder väntar på godkännande utan platser', (o ->> 'status') = 'awaiting_invoice_approval' and (select count(*) from public.vihem_kp_seats where order_id = v_order) = 0);
  perform pg_temp.expect_error('fakturaköp nekas för kund utan tillstånd', format('select public.vihem_kp_create_order(%L, %L, %L, ''company'', %L::jsonb, null, ''invoice'', ''idem-co-x'', ''a@b.test'', ''{}'', ''{}'')', v_org, v_u1,
    (select id from public.vihem_kp_customers where id <> v_cust limit 1) , jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1))), 'E_');
  perform public.vihem_kp_approve_invoice_order(v_order, null);
  perform pg_temp.expect('godkänd faktura (efter betalning-läge): 10 platser skapas men är låsta', (select count(*) from public.vihem_kp_seats where order_id = v_order) = 10 and (select count(*) from public.vihem_kp_seats where order_id = v_order and access_enabled) = 0);
  for i in 1..10 loop v_users := v_users || pg_temp.mkuser('Anst' || i); end loop;
  i := 0;
  for v_seat in select id from public.vihem_kp_seats where order_id = v_order order by created_at, id loop
    i := i + 1;
    perform public.vihem_kp_assign_seat_internal(v_seat, v_users[i], null, null);
  end loop;
  perform pg_temp.expect('alla 10 platser tilldelade med varsin enrollment (ännu utan åtkomst)', (select count(*) from public.vihem_kp_enrollments where sponsor_customer_id = v_cust and not access_enabled) = 10);
  perform pg_temp.expect_error('ingen åtkomst före betalning (after_payment)', format('select public.vihem_kp_open_lesson(%L, %L, %L)', (select id from public.vihem_kp_enrollments where user_id = v_users[1]), v_users[1], v_l_video), 'E_ACCESS');
  perform public.vihem_kp_apply_payment(v_order, 'invoice', 'faktura-1', (o ->> 'total')::numeric, '{}');
  perform pg_temp.expect('betald faktura öppnar alla platser och enrollments', (select count(*) from public.vihem_kp_enrollments where sponsor_customer_id = v_cust and access_enabled) = 10 and (select status from public.vihem_kp_orders where id = v_order) = 'fulfilled');
  perform public.vihem_kp_open_lesson((select id from public.vihem_kp_enrollments where user_id = v_users[1]), v_users[1], v_l_video);
  perform pg_temp.expect_error('påbörjad plats kan inte återtas', format('select public.vihem_kp_reclaim_seat(%L, null)', (select seat_id from public.vihem_kp_enrollments where user_id = v_users[1])), 'E_STATE');
  v_seat := (select seat_id from public.vihem_kp_enrollments where user_id = v_users[2]);
  perform public.vihem_kp_reclaim_seat(v_seat, null);
  perform pg_temp.expect('ostartad plats återtas och är ledig igen', (select status from public.vihem_kp_seats where id = v_seat) = 'available' and (select count(*) from public.vihem_kp_enrollments where seat_id = v_seat) = 0);
  v_u2 := pg_temp.mkuser('Ersättare');
  perform public.vihem_kp_assign_seat_internal(v_seat, v_u2, null, null);
  perform pg_temp.expect('platsen tilldelas en annan deltagare', (select user_id from public.vihem_kp_enrollments where seat_id = v_seat) = v_u2 and (select access_enabled from public.vihem_kp_enrollments where seat_id = v_seat));

  -- ===== ARBETSGIVARBYTE: personlig historik följer personen =====
  insert into public.vihem_kp_company_members (organisation_id, customer_id, user_id, email, role, status) values (v_org, v_cust, v_u1, 'anna@example.test', 'employee', 'active');
  update public.vihem_kp_company_members set status = 'removed', left_at = now() where user_id = v_u1;
  perform pg_temp.expect('certifikat och enrollment ligger kvar hos personen efter att anställningen avslutats', (select count(*) from public.vihem_kp_certificates where user_id = v_u1 and status <> 'revoked') >= 1 and (select count(*) from public.vihem_kp_enrollments where user_id = v_u1) >= 1);

  -- ===== ÅTERBETALNING =====
  o := public.vihem_kp_create_order(v_org, pg_temp.mkuser('Dan'), null, 'private', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)), null, 'stripe', 'idem-4', 'd@example.test', '{}', '{}');
  v_order := (o ->> 'order_id')::uuid;
  perform public.vihem_kp_apply_payment(v_order, 'stripe', 'pi_test_4', (o ->> 'total')::numeric, '{}');
  r := public.vihem_kp_record_refund(v_order, 100, 're_1', 'Delåterbetalning', 'refund', null, false);
  perform pg_temp.expect('delåterbetalning återkallar inte åtkomst', not (r ->> 'full')::boolean and (select status from public.vihem_kp_orders where id = v_order) = 'partially_refunded' and (select count(*) from public.vihem_kp_seats where order_id = v_order and access_enabled) = 1);
  r := public.vihem_kp_record_refund(v_order, (o ->> 'total')::numeric - 100, 're_2', 'Resterande', 'refund', null, false);
  perform pg_temp.expect('full återbetalning återkallar åtkomst och enrollment', (r ->> 'full')::boolean and (select status from public.vihem_kp_orders where id = v_order) = 'refunded' and (select count(*) from public.vihem_kp_seats where order_id = v_order and status = 'revoked') = 1
    and (select count(*) from public.vihem_kp_enrollments where seat_id in (select id from public.vihem_kp_seats where order_id = v_order) and status = 'revoked' and not access_enabled) = 1);
  r := public.vihem_kp_record_refund(v_order, 5, 're_2', 'dubblett', 'refund', null, false);
  perform pg_temp.expect('samma återbetalning två gånger registreras en gång', (r ->> 'duplicate')::boolean and (select count(*) from public.vihem_kp_refunds where order_id = v_order) = 2);

  -- ===== KURSTILLFÄLLE: överbokning omöjlig =====
  insert into public.vihem_kp_courses (organisation_id, code, slug, title, delivery_form, estimated_minutes, status) values (v_org, 'LED1', 'larledd-1', 'Lärarledd 1', 'instructor_led', 240, 'draft') returning id into v_course2;
  insert into public.vihem_kp_course_versions (organisation_id, course_id, version, status) values (v_org, v_course2, 1, 'draft') returning id into v_ver3;
  perform public.vihem_kp_publish_version(v_ver3);
  insert into public.vihem_kp_products (organisation_id, kind, course_id, sku, name, price, vat_rate) values (v_org, 'course', v_course2, 'LED1', 'Lärarledd 1', 1000, 25) returning id into v_prod2;
  insert into public.vihem_kp_sessions (organisation_id, course_id, product_id, title, starts_at, ends_at, capacity, status, free_cancellation_hours) values (v_org, v_course2, v_prod2, 'Tillfälle 1', now() + interval '10 days', now() + interval '10 days 4 hours', 2, 'open', 48) returning id into v_sess;
  insert into public.vihem_kp_sessions (organisation_id, course_id, product_id, title, starts_at, ends_at, capacity, status, free_cancellation_hours) values (v_org, v_course2, v_prod2, 'Tillfälle 2', now() + interval '20 days', now() + interval '20 days 4 hours', 5, 'open', 48) returning id into v_sess2;
  o := public.vihem_kp_create_order(v_org, pg_temp.mkuser('Eva'), null, 'private', jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'quantity', 2, 'session_id', v_sess)), null, 'stripe', 'idem-s1', 'e@example.test', '{}', '{}');
  perform pg_temp.expect_error('fullbokat tillfälle säljer inga fler platser (reservationer räknas)', format('select public.vihem_kp_create_order(%L, null, null, ''private'', %L::jsonb, null, ''stripe'', ''idem-s2'', ''f@example.test'', ''{}'', ''{}'')', v_org, jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'quantity', 1, 'session_id', v_sess))), 'E_FULL');
  perform pg_temp.expect('publik visning visar 0 lediga platser', ((public.vihem_kp_session_public(v_org, v_course2) -> 0) ->> 'seats_left')::integer = 0);
  perform public.vihem_kp_apply_payment((o ->> 'order_id')::uuid, 'stripe', 'pi_s1', (o ->> 'total')::numeric, '{}');
  perform pg_temp.expect('betalning bekräftar bokningarna och kopplar platser', (select count(*) from public.vihem_kp_session_bookings where session_id = v_sess and status = 'booked' and seat_id is not null) = 2);
  v_bk := (select id from public.vihem_kp_session_bookings where session_id = v_sess and status = 'booked' limit 1);
  v_tmp := public.vihem_kp_session_rebook(v_bk, v_sess2, null, false);
  perform pg_temp.expect('ombokning flyttar platsen till nytt tillfälle', (select status from public.vihem_kp_session_bookings where id = v_bk) = 'cancelled' and (select status from public.vihem_kp_session_bookings where id = v_tmp) = 'booked' and ((public.vihem_kp_session_public(v_org, v_course2) -> 0) ->> 'seats_left')::integer = 1);
  perform pg_temp.expect_error('resultat godkänt kräver tilldelad deltagare', format('select public.vihem_kp_session_set_result(%L, ''passed'', null, ''ok'')', v_tmp), 'E_STATE');
  perform public.vihem_kp_waitlist_join(v_sess, 'vantar@example.test', null);
  perform pg_temp.expect_error('dubbel väntelisteanmälan nekas', format('select public.vihem_kp_waitlist_join(%L, ''vantar@example.test'', null)', v_sess), 'E_STATE');
  v_seat := (select seat_id from public.vihem_kp_session_bookings where id = v_tmp);
  v_u := pg_temp.mkuser('Elev');
  perform public.vihem_kp_assign_seat_internal(v_seat, v_u, null, null);
  r := public.vihem_kp_session_set_result(v_tmp, 'passed', null, 'Godkänd praktiskt');
  perform pg_temp.expect('godkänd närvaro/bedömning slutför lärarledd utbildning och ger certifikat', (r ->> 'enrollment_status') = 'completed' and (select count(*) from public.vihem_kp_certificates where user_id = v_u and status = 'issued') = 1, r::text);

  -- ===== E-POST: idempotent utkö =====
  perform public.vihem_kp_queue_email(v_org, 'order_confirmation', 'Kund@Example.test', 'Kund', '{"name":"Kund","order_number":"KP-1","lines":"1 x Kurs","total":"3118,75","portal_url":"https://x"}', 'order-KP-1-confirm', 'order', 'x');
  perform public.vihem_kp_queue_email(v_org, 'order_confirmation', 'Kund@Example.test', 'Kund', '{}', 'order-KP-1-confirm', 'order', 'x');
  perform pg_temp.expect('samma utskick köas bara en gång och mallvariabler ersätts', (select count(*) from public.vihem_kp_email_outbox where idempotency_key = 'order-KP-1-confirm') = 1 and (select subject from public.vihem_kp_email_outbox where idempotency_key = 'order-KP-1-confirm') = 'Orderbekräftelse KP-1');

  -- ===== RLS: personal i annan organisation når inget =====
  perform set_config('request.jwt.claims', json_build_object('sub', '23ae8600-fab7-4d0d-890f-3a576ce51c9a', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '23ae8600-fab7-4d0d-890f-3a576ce51c9a', true);
  set local role authenticated;
  select count(*) into v_n from public.vihem_kp_courses;
  perform pg_temp.expect('personal i annan organisation ser inga kurser', v_n = 0);
  select count(*) into v_n from public.vihem_kp_orders;
  perform pg_temp.expect('personal i annan organisation ser inga ordrar', v_n = 0);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', 'c03d0d59-4641-4baa-a45b-adadbc5d162b', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', 'c03d0d59-4641-4baa-a45b-adadbc5d162b', true);
  set local role authenticated;
  select count(*) into v_n from public.vihem_kp_courses;
  perform pg_temp.expect('administratör i rätt organisation ser kurser', v_n >= 2);
  begin
    perform 1 from public.vihem_kp_exam_attempts limit 1;
    perform pg_temp.expect('personal kan läsa försöksresultat men inte facit-snapshot', true);
    perform snapshot from public.vihem_kp_exam_attempts limit 1;
    raise exception 'TEST FAILED: snapshot var läsbar för authenticated';
  exception when insufficient_privilege then raise notice 'ok - snapshot/facit är inte läsbart för klienten';
  end;
  begin
    perform personal_number_enc from public.vihem_kp_participant_identity limit 1;
    raise exception 'TEST FAILED: personnummer var läsbart';
  exception when insufficient_privilege then raise notice 'ok - personnummer är inte läsbart för klienten';
  end;
  reset role;

  -- BankID-länkning: verifierar identitet, samma personnummer kan inte kopplas till två konton, återlänkning av samma konto är tillåten
  declare v_b1 uuid; v_b2 uuid; v_o uuid := '38fe702d-e72c-49a2-9750-5e0b6934959b';
  begin
    v_b1 := pg_temp.mkuser('Bankid1'); v_b2 := pg_temp.mkuser('Bankid2');
    perform public.vihem_kp_bankid_link(v_b1, v_o, 'enc1', '9876', 'hmac-a', 'Test Testsson');
    perform pg_temp.expect('BankID-länkning markerar identiteten som verifierad', (select identity_method = 'bankid' and identity_verified_at is not null from public.vihem_kp_participants where user_id = v_b1) and (select verified_method = 'bankid' and pno_hmac = 'hmac-a' from public.vihem_kp_participant_identity where user_id = v_b1));
    begin
      perform public.vihem_kp_bankid_link(v_b2, v_o, 'enc2', '9876', 'hmac-a', 'Test Testsson');
      raise exception 'TEST FAILED: samma personnummer kopplades till två konton';
    exception when others then perform pg_temp.expect('samma BankID kan inte kopplas till två konton', sqlerrm like '%E_CONFLICT%');
    end;
    perform public.vihem_kp_bankid_link(v_b1, v_o, 'enc3', '9876', 'hmac-a', 'Test Testsson');
    perform pg_temp.expect('återlänkning av samma konto är tillåten', (select personal_number_enc from public.vihem_kp_participant_identity where user_id = v_b1) = 'enc3');
    begin
      perform 1 from public.vihem_kp_bankid_orders limit 1; set local role authenticated; perform 1 from public.vihem_kp_bankid_orders limit 1;
      raise exception 'TEST FAILED: BankID-order läsbar för klient';
    exception when insufficient_privilege then reset role; raise notice 'ok - BankID-ordrar är inte läsbara för klienten';
    end;
  end;

  -- Rapportöversikten (regression: GROUP BY med aggregat) körs som administratör och returnerar alla delrapporter
  perform set_config('request.jwt.claims', json_build_object('sub', 'c03d0d59-4641-4baa-a45b-adadbc5d162b', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', 'c03d0d59-4641-4baa-a45b-adadbc5d162b', true);
  set local role authenticated;
  perform pg_temp.expect('översikten kan beräknas av administratör', public.vihem_kp_overview(current_date - 365, current_date) ?& array['orders_by_month', 'received_by_month', 'refunded_by_month', 'seats', 'learning', 'id06']);
  reset role;

  raise notice 'ALLA KP-TESTER GODKÄNDA';
end $$;
