-- Frågor hör till en kurs. Frågebanken blir per kurs (ämne = underrubrik inom kursen), prov kan bara använda sin egen kurs frågor,
-- och ämnesregler slumpar bara bland kursens frågor. course_id är nullable endast för äldre frågor som inte kunde kopplas entydigt;
-- gränssnittet kräver kurs för alla nya frågor.
begin;

alter table public.vihem_kp_questions add column if not exists course_id uuid references public.vihem_kp_courses(id) on delete restrict;
create index if not exists vihem_kp_questions_course on public.vihem_kp_questions (organisation_id, course_id, topic);

-- Koppla befintliga frågor: de som används i prov för exakt en kurs, samt Odoo-importen (APV-113)
update public.vihem_kp_questions q set course_id = x.course_id
from (select eq.question_id, min(v.course_id::text)::uuid as course_id from public.vihem_kp_exam_questions eq join public.vihem_kp_exams e on e.id = eq.exam_id join public.vihem_kp_course_versions v on v.id = e.version_id
      group by eq.question_id having count(distinct v.course_id) = 1) x
where q.id = x.question_id and q.course_id is null;
update public.vihem_kp_questions q set course_id = c.id from public.vihem_kp_courses c where q.course_id is null and 'odoo-apv' = any (q.tags) and c.organisation_id = q.organisation_id and c.code = 'APV-113';

-- En fråga i ett provs urval måste höra till provets kurs (eller vara en äldre frånkopplad fråga)
create or replace function public.vihem_kp_check_exam_question_course() returns trigger language plpgsql as $$
declare v_qc uuid; v_ec uuid;
begin
  if coalesce(current_setting('vihem.kp_clone', true), '') = 'on' then return new; end if;
  select course_id into v_qc from public.vihem_kp_questions where id = new.question_id;
  select v.course_id into v_ec from public.vihem_kp_exams e join public.vihem_kp_course_versions v on v.id = e.version_id where e.id = new.exam_id;
  if v_qc is not null and v_ec is not null and v_qc <> v_ec then raise exception '[E_INVALID] Frågan hör till en annan kurs.'; end if;
  return new;
end $$;
drop trigger if exists vihem_kp_exam_question_course on public.vihem_kp_exam_questions;
create trigger vihem_kp_exam_question_course before insert or update on public.vihem_kp_exam_questions for each row execute function public.vihem_kp_check_exam_question_course();

-- Ämnesregler och poolräkning begränsas till provets kurs
do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.vihem_kp_exam_start(uuid,uuid,uuid)'::regprocedure) into d;
  n := replace(d, 'and q.active and q.topic = r.topic and not (q.id = any (v_ids))', 'and q.active and q.topic = r.topic and (q.course_id is null or q.course_id = (select course_id from public.vihem_kp_course_versions where id = x.version_id)) and not (q.id = any (v_ids))');
  n := replace(n, 'or q.topic in (select topic from public.vihem_kp_exam_topic_rules where exam_id = x.id))', 'or (q.topic in (select topic from public.vihem_kp_exam_topic_rules where exam_id = x.id) and (q.course_id is null or q.course_id = (select course_id from public.vihem_kp_course_versions where id = x.version_id))))');
  if n = d or n not like '%x.version_id))))%' then raise exception 'exam_start kunde inte uppdateras'; end if;
  execute n;
  select pg_get_functiondef('public.vihem_kp_publish_version(uuid)'::regprocedure) into d;
  n := replace(d, 'or q.topic in (select topic from public.vihem_kp_exam_topic_rules where exam_id = e.id))', 'or (q.topic in (select topic from public.vihem_kp_exam_topic_rules where exam_id = e.id) and (q.course_id is null or q.course_id = v.course_id)))');
  if n = d then raise exception 'publish_version kunde inte uppdateras'; end if;
  execute n;
  select pg_get_functiondef('public.vihem_kp_live_edit(text,uuid,jsonb,text)'::regprocedure) into d;
  n := replace(d, 'or q.topic in (select topic from public.vihem_kp_exam_topic_rules where exam_id = p_id))', 'or (q.topic in (select topic from public.vihem_kp_exam_topic_rules where exam_id = p_id) and (q.course_id is null or q.course_id = (select course_id from public.vihem_kp_course_versions where id = v_version))))');
  if n = d then raise exception 'live_edit kunde inte uppdateras'; end if;
  execute n;
end $$;

-- Kopiera en kurs: frågorna kopieras också så att den nya kursen har sin egen frågebank
create or replace function public.vihem_kp_duplicate_course(p_course uuid, p_code text, p_slug text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.vihem_kp_courses%rowtype; v_new uuid; v_ver uuid; v_src uuid; q record; v_new_q uuid; v_map jsonb := '{}'::jsonb;
begin
  select * into c from public.vihem_kp_courses where id = p_course;
  if c.id is null or not public.vihem_kp_is_admin(c.organisation_id) then raise exception '[E_FORBIDDEN] Behörighet saknas.'; end if;
  insert into public.vihem_kp_courses (organisation_id, code, slug, title, subtitle, summary, description, category, tags, delivery_form, language, target_audience, objectives, prerequisites, exam_info,
      estimated_minutes, validity_months, renewal_notice_days, requires_identity_verification, certificate_kind, id06_enabled, id06_competence_code, certificate_template_id, image_url, og_image_url, seo_title, seo_description, status, created_by)
    select c.organisation_id, p_code, p_slug, c.title || ' (kopia)', c.subtitle, c.summary, c.description, c.category, c.tags, c.delivery_form, c.language, c.target_audience, c.objectives, c.prerequisites, c.exam_info,
      c.estimated_minutes, c.validity_months, c.renewal_notice_days, c.requires_identity_verification, c.certificate_kind, c.id06_enabled, c.id06_competence_code, c.certificate_template_id, c.image_url, c.og_image_url, c.seo_title, c.seo_description, 'draft', auth.uid()
    returning id into v_new;
  v_src := coalesce(c.published_version_id, (select id from public.vihem_kp_course_versions where course_id = p_course order by version desc limit 1));
  insert into public.vihem_kp_course_versions (organisation_id, course_id, version, status, created_by, sequential)
    values (c.organisation_id, v_new, 1, 'draft', auth.uid(), coalesce((select sequential from public.vihem_kp_course_versions where id = v_src), false)) returning id into v_ver;
  if v_src is not null then perform public.vihem_kp_clone_version_content(v_src, v_ver); end if;
  -- egen frågebank för kopian
  perform set_config('vihem.kp_clone', 'on', true);
  for q in select * from public.vihem_kp_questions where course_id = p_course loop
    insert into public.vihem_kp_questions (organisation_id, course_id, topic, type, prompt, explanation, image_asset_id, difficulty, points, active, tags, created_by)
      values (q.organisation_id, v_new, q.topic, q.type, q.prompt, q.explanation, q.image_asset_id, q.difficulty, q.points, q.active, q.tags, auth.uid()) returning id into v_new_q;
    insert into public.vihem_kp_question_options (organisation_id, question_id, label, is_correct, feedback, sort_order) select organisation_id, v_new_q, label, is_correct, feedback, sort_order from public.vihem_kp_question_options where question_id = q.id;
    v_map := v_map || jsonb_build_object(q.id::text, v_new_q);
  end loop;
  update public.vihem_kp_exam_questions eq set question_id = (v_map ->> eq.question_id::text)::uuid
    where eq.exam_id in (select id from public.vihem_kp_exams where version_id = v_ver) and v_map ? eq.question_id::text;
  update public.vihem_kp_lesson_blocks b set content = jsonb_build_object('question_ids', (select coalesce(jsonb_agg(coalesce(v_map ->> qid, qid)), '[]'::jsonb) from jsonb_array_elements_text(b.content -> 'question_ids') qid))
    where b.version_id = v_ver and b.kind = 'knowledge_check';
  perform set_config('vihem.kp_clone', 'off', true);
  return v_new;
end;
$$;
revoke all on function public.vihem_kp_duplicate_course(uuid, text, text) from public, anon;
grant execute on function public.vihem_kp_duplicate_course(uuid, text, text) to authenticated, service_role;

commit;
