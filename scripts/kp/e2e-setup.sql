-- Förbereder testdata för scripts/kp/e2e.mjs (körs mot produktionsdatabasen; allt märks E2E och tas bort av e2e-cleanup.sql).
-- Villkorssidor publiceras tillfälligt (kassan kräver det) och återställs av cleanup. Inställningar sparas och återställs.
\set ON_ERROR_STOP on
begin;
do $$
declare
  v_org uuid := '38fe702d-e72c-49a2-9750-5e0b6934959b'; v_course uuid; v_ver uuid; v_mod uuid; v_asset uuid; v_l1 uuid; v_l2 uuid; v_exam uuid; v_prod uuid; v_course2 uuid; v_ver2 uuid; v_prod2 uuid; v_sess uuid; v_qid uuid; v_i integer; v_out jsonb;
begin
  perform vihem_kp_seed_defaults(v_org);
  insert into public.vihem_system_settings (key, value) values ('kp_e2e_backup', jsonb_build_object('settings', (select to_jsonb(s) from public.vihem_kp_settings s where organisation_id = v_org), 'pages', (select jsonb_agg(to_jsonb(p)) from public.vihem_kp_site_pages p where organisation_id = v_org and kind in ('terms', 'privacy', 'withdrawal', 'invoice_terms'))))
    on conflict (key) do update set value = excluded.value;
  update public.vihem_kp_settings set invoice_enabled = true, invoice_requires_approval = false, invoice_access_mode = 'after_payment' where organisation_id = v_org;
  update public.vihem_kp_site_pages set status = 'published', version = 1, published_at = now() where organisation_id = v_org and kind in ('terms', 'privacy', 'withdrawal', 'invoice_terms');
  insert into public.vihem_kp_site_page_versions (organisation_id, page_id, version, title, body) select organisation_id, id, 1, title, body from public.vihem_kp_site_pages where organisation_id = v_org and kind in ('terms', 'privacy', 'withdrawal', 'invoice_terms') on conflict do nothing;

  -- Kurs A: digital, video + läsning + slutprov, ID06
  insert into public.vihem_kp_courses (organisation_id, code, slug, title, estimated_minutes, validity_months, id06_enabled, id06_competence_code, status) values (v_org, 'E2E-A', 'e2e-a', 'E2E digital kurs', 20, 60, true, 'E2E-1', 'draft') returning id into v_course;
  insert into public.vihem_kp_course_versions (organisation_id, course_id, version, status) values (v_org, v_course, 1, 'draft') returning id into v_ver;
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Kapitel 1', 1) returning id into v_mod;
  insert into public.vihem_kp_media_assets (organisation_id, kind, bucket, storage_path, duration_seconds, mime_type) values (v_org, 'video', 'vihem-kp-private', 'e2e/' || gen_random_uuid() || '.mp4', 12, 'video/mp4') returning id into v_asset;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, completion_rule) values (v_org, v_ver, v_mod, 'Video', 'video', 1, '{"type":"video_watch","min_percent":90}') returning id into v_l1;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, completion_rule) values (v_org, v_ver, v_mod, 'Läsning', 'content', 2, '{"type":"view","min_seconds":1}') returning id into v_l2;
  insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content) values (v_org, v_ver, v_l1, 'video', 1, jsonb_build_object('asset_id', v_asset, 'title', 'E2E-video')), (v_org, v_ver, v_l2, 'text', 1, '{"markdown":"## Hej\nText"}');
  insert into public.vihem_kp_exams (organisation_id, version_id, kind, title, question_count, pass_percent, max_attempts, cooldown_seconds, time_limit_seconds, feedback_mode) values (v_org, v_ver, 'final', 'E2E-slutprov', 4, 75, 3, 0, 600, 'after_attempt') returning id into v_exam;
  for v_i in 1..4 loop
    insert into public.vihem_kp_questions (organisation_id, topic, type, prompt, explanation) values (v_org, 'E2E', 'single', 'E2E-fråga ' || v_i, 'E2E-förklaring ' || v_i) returning id into v_qid;
    insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, sort_order) values (v_org, v_qid, 'Rätt', true, 1), (v_org, v_qid, 'Fel', false, 2);
  end loop;
  insert into public.vihem_kp_exam_topic_rules (exam_id, organisation_id, topic, question_count) values (v_exam, v_org, 'E2E', 4);
  perform set_config('request.jwt.claims', json_build_object('sub', 'c03d0d59-4641-4baa-a45b-adadbc5d162b', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', 'c03d0d59-4641-4baa-a45b-adadbc5d162b', true);
  perform vihem_kp_publish_version(v_ver);
  insert into public.vihem_kp_products (organisation_id, kind, course_id, sku, name, price, vat_rate) values (v_org, 'course', v_course, 'E2E-A', 'E2E digital kurs', 1000, 25) returning id into v_prod;
  insert into public.vihem_kp_price_rules (organisation_id, product_id, label, min_quantity, unit_price) values (v_org, v_prod, 'Volym 10+', 10, 800);

  -- Kurs B: lärarledd, ett tillfälle med 2 platser
  insert into public.vihem_kp_courses (organisation_id, code, slug, title, delivery_form, estimated_minutes, status) values (v_org, 'E2E-L', 'e2e-l', 'E2E lärarledd kurs', 'instructor_led', 240, 'draft') returning id into v_course2;
  insert into public.vihem_kp_course_versions (organisation_id, course_id, version, status) values (v_org, v_course2, 1, 'draft') returning id into v_ver2;
  perform vihem_kp_publish_version(v_ver2);
  insert into public.vihem_kp_products (organisation_id, kind, course_id, sku, name, price, vat_rate) values (v_org, 'course', v_course2, 'E2E-L', 'E2E lärarledd kurs', 500, 25) returning id into v_prod2;
  insert into public.vihem_kp_sessions (organisation_id, course_id, product_id, title, starts_at, ends_at, capacity, status) values (v_org, v_course2, v_prod2, 'E2E-tillfälle', now() + interval '10 days', now() + interval '10 days 4 hours', 2, 'open') returning id into v_sess;
  insert into public.vihem_kp_discount_codes (organisation_id, code, kind, value) values (v_org, 'E2E100', 'percent', 100);
  v_out := jsonb_build_object('course', v_course, 'version', v_ver, 'product', v_prod, 'lesson_video', v_l1, 'lesson_view', v_l2, 'asset', v_asset, 'exam', v_exam, 'course2', v_course2, 'product2', v_prod2, 'session', v_sess);
  perform set_config('kp.e2e', v_out::text, false);
  insert into public.vihem_system_settings (key, value) values ('kp_e2e_ids', v_out) on conflict (key) do update set value = excluded.value;
end $$;
commit;
select value from public.vihem_system_settings where key = 'kp_e2e_ids';
