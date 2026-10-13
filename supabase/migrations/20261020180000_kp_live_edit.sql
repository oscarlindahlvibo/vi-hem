-- Rättningar i publicerade kurser: texter, rubriker, länkar, bilder/dokument och provinställningar kan ändras direkt utan nytt utkast.
-- Det som redan är avklarat påverkas aldrig: framsteg, godkända försök, certifikat och enrollments pekar på id:n (inte på innehållet) och
-- reglerna för vad som krävs (typ, obligatorisk, slutförandekrav, struktur) kan inte ändras här – sådant kräver ett nytt utkast/ny version.
-- Varje ändring loggas med före/efter i audit-loggen.
begin;

create or replace function public.vihem_kp_live_edit(p_kind text, p_id uuid, p_patch jsonb, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_version uuid; v_status text; v_before jsonb; v_actor uuid := auth.uid(); b public.vihem_kp_lesson_blocks%rowtype; e public.vihem_kp_exams%rowtype; k text; v_pool integer;
  v_exam_keys text[] := array['title', 'pass_percent', 'time_limit_seconds', 'max_attempts', 'cooldown_seconds', 'randomize_questions', 'randomize_options', 'feedback_mode', 'reveal_correct_answers', 'question_count'];
begin
  if p_kind not in ('module', 'lesson', 'block', 'exam') then raise exception '[E_INVALID] Okänd typ.'; end if;
  if p_kind = 'module' then select organisation_id, version_id, to_jsonb(m) into v_org, v_version, v_before from public.vihem_kp_modules m where id = p_id;
  elsif p_kind = 'lesson' then select organisation_id, version_id, to_jsonb(l) into v_org, v_version, v_before from public.vihem_kp_lessons l where id = p_id;
  elsif p_kind = 'block' then select * into b from public.vihem_kp_lesson_blocks where id = p_id; v_org := b.organisation_id; v_version := b.version_id; v_before := to_jsonb(b);
  else select * into e from public.vihem_kp_exams where id = p_id; v_org := e.organisation_id; v_version := e.version_id; v_before := to_jsonb(e); end if;
  if v_org is null then raise exception '[E_NOT_FOUND] Innehållet finns inte.'; end if;
  if not public.vihem_kp_is_admin(v_org) then raise exception '[E_FORBIDDEN] Behörighet saknas.'; end if;
  select status into v_status from public.vihem_kp_course_versions where id = v_version;
  if v_status = 'draft' then raise exception '[E_STATE] Utkast ändras direkt i kursbyggaren.'; end if;

  perform set_config('vihem.kp_clone', 'on', true);
  if p_kind = 'module' then
    update public.vihem_kp_modules set title = coalesce(nullif(trim(p_patch ->> 'title'), ''), title), description = coalesce(p_patch ->> 'description', description) where id = p_id;
  elsif p_kind = 'lesson' then
    update public.vihem_kp_lessons set title = coalesce(nullif(trim(p_patch ->> 'title'), ''), title), estimated_minutes = coalesce((p_patch ->> 'estimated_minutes')::integer, estimated_minutes) where id = p_id;
  elsif p_kind = 'block' then
    if b.kind = 'text' then update public.vihem_kp_lesson_blocks set content = jsonb_build_object('markdown', coalesce(p_patch ->> 'markdown', '')) where id = p_id;
    elsif b.kind = 'link' then update public.vihem_kp_lesson_blocks set content = content || jsonb_build_object('url', coalesce(p_patch ->> 'url', content ->> 'url'), 'title', coalesce(p_patch ->> 'title', content ->> 'title')) where id = p_id;
    elsif b.kind in ('image', 'document') then update public.vihem_kp_lesson_blocks set content = content || (p_patch - 'markdown' - 'url') where id = p_id;
    elsif b.kind in ('video', 'audio') then
      if p_patch ? 'asset_id' and (p_patch ->> 'asset_id') is distinct from (b.content ->> 'asset_id') then raise exception '[E_STATE] Byte av film/ljud ändrar vad deltagare redan har sett – gör det i ett nytt utkast.'; end if;
      update public.vihem_kp_lesson_blocks set content = content || jsonb_build_object('title', coalesce(p_patch ->> 'title', content ->> 'title')) where id = p_id;
    else raise exception '[E_STATE] Den här blocktypen ändras i ett nytt utkast.'; end if;
  else
    for k in select jsonb_object_keys(p_patch) loop if not (k = any (v_exam_keys)) then raise exception '[E_INVALID] Fältet % kan inte ändras i en publicerad kurs.', k; end if; end loop;
    update public.vihem_kp_exams set
      title = coalesce(nullif(trim(p_patch ->> 'title'), ''), title),
      pass_percent = coalesce((p_patch ->> 'pass_percent')::integer, pass_percent),
      time_limit_seconds = case when p_patch ? 'time_limit_seconds' then (p_patch ->> 'time_limit_seconds')::integer else time_limit_seconds end,
      max_attempts = case when p_patch ? 'max_attempts' then (p_patch ->> 'max_attempts')::integer else max_attempts end,
      cooldown_seconds = coalesce((p_patch ->> 'cooldown_seconds')::integer, cooldown_seconds),
      randomize_questions = coalesce((p_patch ->> 'randomize_questions')::boolean, randomize_questions),
      randomize_options = coalesce((p_patch ->> 'randomize_options')::boolean, randomize_options),
      feedback_mode = coalesce(p_patch ->> 'feedback_mode', feedback_mode),
      reveal_correct_answers = coalesce((p_patch ->> 'reveal_correct_answers')::boolean, reveal_correct_answers),
      question_count = coalesce((p_patch ->> 'question_count')::integer, question_count)
    where id = p_id;
    select count(distinct q.id) into v_pool from public.vihem_kp_questions q where q.active and q.organisation_id = v_org
      and (q.id in (select question_id from public.vihem_kp_exam_questions where exam_id = p_id) or q.topic in (select topic from public.vihem_kp_exam_topic_rules where exam_id = p_id));
    if v_pool < (select question_count from public.vihem_kp_exams where id = p_id) then raise exception '[E_INVALID] Provet har för få aktiva frågor för det antalet.'; end if;
  end if;
  perform set_config('vihem.kp_clone', 'off', true);
  perform public.vihem_kp_audit(v_org, v_actor, 'staff', 'live_edit', p_kind, p_id::text, jsonb_build_object('version_id', v_version, 'version_status', v_status, 'note', p_note, 'before', v_before, 'patch', p_patch));
end;
$$;
revoke all on function public.vihem_kp_live_edit(text, uuid, jsonb, text) from public, anon;
grant execute on function public.vihem_kp_live_edit(text, uuid, jsonb, text) to authenticated, service_role;

commit;
