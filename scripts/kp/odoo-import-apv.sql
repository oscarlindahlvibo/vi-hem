-- Skapar ett UTKAST av kursen "APV 1.1–1.3 Arbete på väg (grundkompetens)" med den struktur som den gamla Odoo-sajten visar publikt (11 delar, 33 avsnitt).
-- Innehåll (video, texter, provfrågor) ligger bakom Odoos inloggning och är INTE importerat – lägg in det i kursbyggaren eller via Odoo-export. Idempotent: hoppar över om kurskoden redan finns.
begin;
do $$
declare v_org uuid := '38fe702d-e72c-49a2-9750-5e0b6934959b'; v_course uuid; v_ver uuid; v_mod uuid;
begin
  if exists (select 1 from public.vihem_kp_courses where organisation_id = v_org and code = 'APV-113') then raise notice 'APV-113 finns redan – hoppar över'; return; end if;
  insert into public.vihem_kp_courses (organisation_id, code, slug, title, subtitle, summary, description, category, delivery_form, estimated_minutes, status, tags, seo_title)
    values (v_org, 'APV-113', 'apv-1-1-1-3-arbete-pa-vag-grundkompetens', 'APV 1.1–1.3 Arbete på väg (grundkompetens)', 'Helt digital grundkompetens för arbete på väg',
      'Grundläggande kompetens för att få arbeta på eller i anslutning till vägarbetsplatser. Helt digital kurs för APV nivå 1.1–1.3.',
      'Den här utbildningen ger dig den grundläggande kompetens som krävs för att få arbeta på eller i anslutning till vägarbetsplatser. Kursen är helt digital och riktar sig till alla som behöver APV nivå 1.1–1.3, vilket omfattar både arbetare, maskinförare och förare av väghållningsfordon.',
      'Säkerhet', 'self_paced', 435, 'draft', array['apv','arbete på väg','bygg'], 'APV 1.1–1.3 Arbete på väg – digital grundkompetens') returning id into v_course;
  insert into public.vihem_kp_course_versions (organisation_id, course_id, version, status, sequential) values (v_org, v_course, 1, 'draft', false) returning id into v_ver;
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 1 – Trafiksäkerhet & olycksförebyggande', 1) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Trafiksäkerhet & olycksförebyggande', 'content', 1, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Trafiksäkerhet & Olycksförebyggande', 'video', 2, 11, '{"type":"video_watch","min_percent":90}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Trafiksäkerhet & Olycksförebyggande', 'content', 3, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 1', 'quiz', 4, 11, '{"type":"quiz_pass"}'::jsonb);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 2 - Lagar och regler', 2) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Lagar och regler', 'content', 1, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Lagar och regler', 'content', 2, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 2', 'quiz', 3, 11, '{"type":"quiz_pass"}'::jsonb);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 3 - Arbetsmiljö, roller och ansvar', 3) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Arbetsmiljö, roller och ansvar', 'content', 1, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Arbetsmiljö, roller och ansvar', 'content', 2, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 3', 'quiz', 3, 11, '{"type":"quiz_pass"}'::jsonb);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 4 – Personlig skyddsutrustning', 4) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Personlig skyddsutrustning', 'content', 1, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Personlig skyddsutrustning', 'content', 2, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 4', 'quiz', 3, 11, '{"type":"quiz_pass"}'::jsonb);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 5 - Riskanalys', 5) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Riskanalys', 'content', 1, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Riskanalys', 'content', 2, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 5', 'quiz', 3, 11, '{"type":"quiz_pass"}'::jsonb);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 6 – Typer av vägarbeten', 6) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Typer av vägarbeten', 'content', 1, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Typer av vägarbeten', 'content', 2, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 6', 'quiz', 3, 11, '{"type":"quiz_pass"}'::jsonb);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 7 – Begränsningar av arbetsplatsen', 7) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Begränsningar av arbetsplatsen', 'content', 1, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Begränsningar av arbetsplatsen', 'content', 2, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 7', 'quiz', 3, 11, '{"type":"quiz_pass"}'::jsonb);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 8 – Vägmärken och skydd', 8) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Vägmärken och skydd', 'content', 1, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Vägmärken och skydd', 'content', 2, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 8', 'quiz', 3, 11, '{"type":"quiz_pass"}'::jsonb);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 9 – Fordon och utrustning', 9) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Fordon och utrustning', 'content', 1, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Fordon och utrustning', 'content', 2, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 9', 'quiz', 3, 11, '{"type":"quiz_pass"}'::jsonb);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 10 – Trafikdirigering', 10) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Mål: Trafikdirigering', 'content', 1, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Trafikdirigering', 'content', 2, 11, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Diagnostiskt prov Del 10', 'quiz', 3, 11, '{"type":"quiz_pass"}'::jsonb);
  insert into public.vihem_kp_modules (organisation_id, version_id, title, sort_order) values (v_org, v_ver, 'Del 11 – Avslutning och slutprov', 11) returning id into v_mod;
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'Avslutning', 'content', 1, 37, '{"type":"view"}'::jsonb);
  insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, sort_order, estimated_minutes, completion_rule) values (v_org, v_ver, v_mod, 'APV 1.1–1.3 Slutprov / Certifikat', 'quiz', 2, 37, '{"type":"quiz_pass"}'::jsonb);
  raise notice 'Skapade utkast APV-113 med % delar', (select count(*) from public.vihem_kp_modules where version_id = v_ver);
end $$;
commit;
