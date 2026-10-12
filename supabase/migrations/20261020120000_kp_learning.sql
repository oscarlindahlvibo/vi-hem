-- Kompetensportalen 2.0 – del C: lärande (serverbaserad uppföljning), prov (serverrättning), certifikat och extern registrering (ID06).
-- Klienten kan aldrig själv markera något som genomfört eller godkänt: allt avgörs av SECURITY DEFINER-funktioner som bara service_role anropar.
begin;

alter table public.vihem_kp_enrollments drop constraint if exists vihem_kp_enrollments_status_check;
alter table public.vihem_kp_enrollments add constraint vihem_kp_enrollments_status_check check (status in ('not_started', 'in_progress', 'awaiting_identity', 'completed', 'expired', 'cancelled', 'revoked'));

create table if not exists public.vihem_kp_lesson_progress (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  enrollment_id uuid not null references public.vihem_kp_enrollments(id) on delete cascade,
  lesson_id uuid not null references public.vihem_kp_lessons(id),
  status text not null default 'started' check (status in ('started', 'completed')),
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  completed_at timestamptz,
  completion_source text check (completion_source in ('server_video', 'server_quiz', 'server_view', 'staff')),
  coverage int4multirange not null default '{}'::int4multirange,
  watched_seconds integer not null default 0,
  resume_position integer not null default 0,
  unique (enrollment_id, lesson_id)
);
create table if not exists public.vihem_kp_video_sessions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  enrollment_id uuid not null references public.vihem_kp_enrollments(id) on delete cascade,
  lesson_id uuid not null,
  asset_id uuid not null,
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  last_position numeric not null default 0,
  ended_at timestamptz
);
create index if not exists vihem_kp_video_sessions_enr on public.vihem_kp_video_sessions (enrollment_id, lesson_id);

create table if not exists public.vihem_kp_exam_attempts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  exam_id uuid not null references public.vihem_kp_exams(id),
  enrollment_id uuid not null references public.vihem_kp_enrollments(id) on delete cascade,
  course_version_id uuid not null,
  attempt_no integer not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'graded', 'expired', 'void')),
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  submitted_at timestamptz,
  score_points integer,
  max_points integer,
  percent numeric(5,2),
  passed boolean,
  pass_percent_snapshot integer not null,
  -- frågor, svarsalternativ och facit vid provtillfället. Tabellen har ingen klientåtkomst.
  snapshot jsonb not null,
  unique (enrollment_id, exam_id, attempt_no)
);
create unique index if not exists vihem_kp_one_open_attempt on public.vihem_kp_exam_attempts (enrollment_id, exam_id) where status = 'in_progress';
create table if not exists public.vihem_kp_attempt_answers (
  attempt_id uuid not null references public.vihem_kp_exam_attempts(id) on delete cascade,
  question_id uuid not null,
  option_ids uuid[] not null default '{}',
  correct boolean,
  points integer,
  answered_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);
create table if not exists public.vihem_kp_attempt_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.vihem_kp_exam_attempts(id) on delete cascade,
  organisation_id uuid not null,
  event_type text not null,
  actor_user_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.vihem_kp_certificate_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  name text not null,
  kind text not null default 'training_certificate' check (kind in ('training_certificate', 'competence_proof')),
  title text not null default 'Utbildningsintyg',
  body_text text not null default 'har genomfört och godkänts i utbildningen',
  footer_text text not null default '',
  accent_color text not null default '#0b6b4c',
  logo_asset_id uuid references public.vihem_kp_media_assets(id),
  signer_name text not null default '',
  signer_title text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.vihem_kp_courses add constraint vihem_kp_courses_template_fk foreign key (certificate_template_id) references public.vihem_kp_certificate_templates(id);

create sequence if not exists public.vihem_kp_cert_seq;
create table if not exists public.vihem_kp_certificates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  certificate_number text not null unique,
  verification_code text not null unique,
  enrollment_id uuid not null references public.vihem_kp_enrollments(id),
  user_id uuid not null references auth.users(id),
  course_id uuid not null references public.vihem_kp_courses(id),
  course_version_id uuid not null references public.vihem_kp_course_versions(id),
  template_id uuid references public.vihem_kp_certificate_templates(id),
  kind text not null check (kind in ('training_certificate', 'competence_proof')),
  status text not null default 'issued' check (status in ('issued', 'revoked', 'superseded')),
  holder_name text not null,
  course_title text not null,
  course_code text not null,
  issuer_name text not null,
  completed_on date not null,
  issued_at timestamptz not null default now(),
  valid_until date,
  exam_summary jsonb not null default '{}'::jsonb,
  pdf_path text,
  pdf_sha256 text,
  superseded_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  renewal_notified jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists vihem_kp_one_active_cert on public.vihem_kp_certificates (enrollment_id) where status = 'issued';
create index if not exists vihem_kp_certs_user on public.vihem_kp_certificates (user_id);
create table if not exists public.vihem_kp_certificate_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  certificate_id uuid not null references public.vihem_kp_certificates(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.vihem_kp_external_registrations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  certificate_id uuid not null references public.vihem_kp_certificates(id),
  enrollment_id uuid not null,
  user_id uuid not null,
  kind text not null default 'id06' check (kind in ('id06')),
  competence_code text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'registered', 'needs_action', 'failed', 'cancelled')),
  attempts integer not null default 0,
  last_error text,
  external_reference text,
  next_attempt_at timestamptz,
  submitted_at timestamptz,
  registered_at timestamptz,
  handled_by uuid,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (certificate_id, kind)
);
create trigger vihem_kp_extreg_touch before update on public.vihem_kp_external_registrations for each row execute function public.vihem_kp_touch();
create table if not exists public.vihem_kp_external_registration_events (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.vihem_kp_external_registrations(id) on delete cascade,
  organisation_id uuid not null,
  event_type text not null,
  actor_user_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['vihem_kp_lesson_progress','vihem_kp_certificates','vihem_kp_certificate_events','vihem_kp_external_registrations','vihem_kp_external_registration_events','vihem_kp_certificate_templates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "KP staff read" on public.%I for select to authenticated using (public.vihem_kp_is_staff(organisation_id))', t);
  end loop;
  create policy "KP admin write" on public.vihem_kp_certificate_templates for all to authenticated using (public.vihem_kp_is_admin(organisation_id)) with check (public.vihem_kp_is_admin(organisation_id));
  -- Facit och provsvar: ingen policy = ingen klientåtkomst. Personal läser resultat via admin-funktionen.
  foreach t in array array['vihem_kp_exam_attempts','vihem_kp_attempt_answers','vihem_kp_attempt_events','vihem_kp_video_sessions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  -- Personal får se försöksresultat utan facit/snapshot via kolumnbehörighet.
  create policy "KP staff read results" on public.vihem_kp_exam_attempts for select to authenticated using (public.vihem_kp_is_staff(organisation_id));
  grant select (id, organisation_id, exam_id, enrollment_id, course_version_id, attempt_no, status, started_at, expires_at, submitted_at, score_points, max_points, percent, passed, pass_percent_snapshot)
    on public.vihem_kp_exam_attempts to authenticated;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Hjälp: åtkomstkontroll för en enrollment
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_kp_enrollment_for_user(p_enrollment uuid, p_user uuid, p_require_active boolean default true) returns public.vihem_kp_enrollments
language plpgsql security definer set search_path = public as $$
declare e public.vihem_kp_enrollments%rowtype;
begin
  select * into e from public.vihem_kp_enrollments where id = p_enrollment and user_id = p_user;
  if e.id is null then raise exception '[E_NOT_FOUND] Utbildningen hittades inte.'; end if;
  if p_require_active then
    if not e.access_enabled then raise exception '[E_ACCESS] Du har inte tillgång till utbildningen ännu.'; end if;
    if e.status in ('revoked', 'cancelled') then raise exception '[E_ACCESS] Tillgången är återkallad.'; end if;
    if e.valid_until is not null and e.valid_until < now() then raise exception '[E_ACCESS] Utbildningen har gått ut.'; end if;
  end if;
  return e;
end;
$$;

-- Sekventiell kurs: alla tidigare obligatoriska lektioner måste vara klara
create or replace function public.vihem_kp_lesson_unlocked(p_enrollment uuid, p_lesson uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare e public.vihem_kp_enrollments%rowtype; v public.vihem_kp_course_versions%rowtype; l public.vihem_kp_lessons%rowtype; v_missing integer;
begin
  select * into e from public.vihem_kp_enrollments where id = p_enrollment;
  select * into v from public.vihem_kp_course_versions where id = e.course_version_id;
  select * into l from public.vihem_kp_lessons where id = p_lesson and version_id = e.course_version_id;
  if l.id is null then return false; end if;
  if not v.sequential then return true; end if;
  select count(*) into v_missing from public.vihem_kp_lessons x join public.vihem_kp_modules mx on mx.id = x.module_id join public.vihem_kp_modules ml on ml.id = l.module_id
   where x.version_id = e.course_version_id and x.required and x.id <> l.id
     and (mx.sort_order < ml.sort_order or (mx.sort_order = ml.sort_order and x.sort_order < l.sort_order))
     and not exists (select 1 from public.vihem_kp_lesson_progress p where p.enrollment_id = p_enrollment and p.lesson_id = x.id and p.status = 'completed');
  return v_missing = 0;
end;
$$;

create or replace function public.vihem_kp_recompute_enrollment(p_enrollment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e public.vihem_kp_enrollments%rowtype; v_total integer; v_done integer; v_pct integer;
begin
  select * into e from public.vihem_kp_enrollments where id = p_enrollment for update;
  select count(*) into v_total from public.vihem_kp_lessons where version_id = e.course_version_id and required;
  select count(*) into v_done from public.vihem_kp_lessons l where l.version_id = e.course_version_id and l.required
    and exists (select 1 from public.vihem_kp_lesson_progress p where p.enrollment_id = p_enrollment and p.lesson_id = l.id and p.status = 'completed');
  v_pct := case when v_total = 0 then 0 else floor(v_done * 100.0 / v_total) end;
  update public.vihem_kp_enrollments set progress_percent = v_pct, last_activity_at = now(),
      started_at = coalesce(started_at, now()),
      status = case when status in ('not_started') then 'in_progress' else status end
    where id = p_enrollment;
  update public.vihem_kp_seats set status = 'active', activated_at = coalesce(activated_at, now()) where id = e.seat_id and status = 'assigned';
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Lektioner: öppna, visningsregel och videouppföljning (allt avgörs av servern)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_kp_open_lesson(p_enrollment uuid, p_user uuid, p_lesson uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.vihem_kp_enrollments%rowtype; pr public.vihem_kp_lesson_progress%rowtype;
begin
  e := public.vihem_kp_enrollment_for_user(p_enrollment, p_user);
  if not public.vihem_kp_lesson_unlocked(p_enrollment, p_lesson) then raise exception '[E_LOCKED] Lektionen låses upp när tidigare lektioner är klara.'; end if;
  insert into public.vihem_kp_lesson_progress (organisation_id, enrollment_id, lesson_id) values (e.organisation_id, p_enrollment, p_lesson)
    on conflict (enrollment_id, lesson_id) do update set last_viewed_at = now() returning * into pr;
  update public.vihem_kp_enrollments set last_lesson_id = p_lesson where id = p_enrollment;
  perform public.vihem_kp_recompute_enrollment(p_enrollment);
  return jsonb_build_object('status', pr.status, 'resume_position', pr.resume_position, 'watched_seconds', pr.watched_seconds, 'first_viewed_at', pr.first_viewed_at);
end;
$$;

create or replace function public.vihem_kp_complete_view_lesson(p_enrollment uuid, p_user uuid, p_lesson uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.vihem_kp_enrollments%rowtype; l public.vihem_kp_lessons%rowtype; pr public.vihem_kp_lesson_progress%rowtype; v_min integer;
begin
  e := public.vihem_kp_enrollment_for_user(p_enrollment, p_user);
  select * into l from public.vihem_kp_lessons where id = p_lesson and version_id = e.course_version_id;
  if l.id is null then raise exception '[E_NOT_FOUND] Lektionen finns inte.'; end if;
  if l.completion_rule ->> 'type' <> 'view' then raise exception '[E_RULE] Lektionen slutförs inte på detta sätt.'; end if;
  select * into pr from public.vihem_kp_lesson_progress where enrollment_id = p_enrollment and lesson_id = p_lesson;
  if pr.id is null then raise exception '[E_STATE] Öppna lektionen först.'; end if;
  v_min := coalesce((l.completion_rule ->> 'min_seconds')::integer, 0);
  if extract(epoch from now() - pr.first_viewed_at) < v_min then raise exception '[E_TOO_FAST] Lektionen kan markeras klar efter % sekunder.', v_min; end if;
  update public.vihem_kp_lesson_progress set status = 'completed', completed_at = coalesce(completed_at, now()), completion_source = coalesce(completion_source, 'server_view') where id = pr.id;
  perform public.vihem_kp_recompute_enrollment(p_enrollment);
  perform public.vihem_kp_try_complete_enrollment(p_enrollment);
  return jsonb_build_object('status', 'completed');
end;
$$;

create or replace function public.vihem_kp_video_start(p_enrollment uuid, p_user uuid, p_lesson uuid, p_asset uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.vihem_kp_enrollments%rowtype; v_id uuid; pr public.vihem_kp_lesson_progress%rowtype; a public.vihem_kp_media_assets%rowtype;
begin
  e := public.vihem_kp_enrollment_for_user(p_enrollment, p_user);
  if not public.vihem_kp_lesson_unlocked(p_enrollment, p_lesson) then raise exception '[E_LOCKED] Lektionen låses upp när tidigare lektioner är klara.'; end if;
  -- mediet måste tillhöra en videoblock i just denna lektion/version
  if not exists (select 1 from public.vihem_kp_lesson_blocks b where b.lesson_id = p_lesson and b.version_id = e.course_version_id and b.kind = 'video' and (b.content ->> 'asset_id')::uuid = p_asset) then
    raise exception '[E_NOT_FOUND] Videon hör inte till lektionen.';
  end if;
  select * into a from public.vihem_kp_media_assets where id = p_asset;
  insert into public.vihem_kp_lesson_progress (organisation_id, enrollment_id, lesson_id) values (e.organisation_id, p_enrollment, p_lesson) on conflict (enrollment_id, lesson_id) do update set last_viewed_at = now() returning * into pr;
  insert into public.vihem_kp_video_sessions (organisation_id, enrollment_id, lesson_id, asset_id, last_position) values (e.organisation_id, p_enrollment, p_lesson, p_asset, pr.resume_position) returning id into v_id;
  update public.vihem_kp_enrollments set last_lesson_id = p_lesson where id = p_enrollment;
  perform public.vihem_kp_recompute_enrollment(p_enrollment);
  return jsonb_build_object('session_id', v_id, 'resume_position', pr.resume_position, 'duration_seconds', a.duration_seconds, 'status', pr.status);
end;
$$;

-- Hjärtslag: servern avgör hur mycket som räknas. Bara sammanhängande uppspelning i realtid ger täckning;
-- hopp framåt, pausad uppspelning och stora luckor ger ingen täckning. Täckningen lagras som multiintervall (sekunder).
create or replace function public.vihem_kp_video_heartbeat(p_session uuid, p_user uuid, p_position numeric, p_playing boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.vihem_kp_video_sessions%rowtype; e public.vihem_kp_enrollments%rowtype; l public.vihem_kp_lessons%rowtype; a public.vihem_kp_media_assets%rowtype; pr public.vihem_kp_lesson_progress%rowtype;
  v_elapsed numeric; v_delta numeric; v_lo integer; v_hi integer; v_cov integer; v_need numeric; v_pct numeric; v_min integer; v_completed boolean := false;
begin
  select * into s from public.vihem_kp_video_sessions where id = p_session for update;
  if s.id is null or s.ended_at is not null then raise exception '[E_NOT_FOUND] Uppspelningssessionen finns inte.'; end if;
  e := public.vihem_kp_enrollment_for_user(s.enrollment_id, p_user);
  select * into l from public.vihem_kp_lessons where id = s.lesson_id;
  select * into a from public.vihem_kp_media_assets where id = s.asset_id;
  select * into pr from public.vihem_kp_lesson_progress where enrollment_id = s.enrollment_id and lesson_id = s.lesson_id for update;
  if p_position is null or p_position < 0 or (a.duration_seconds is not null and p_position > a.duration_seconds + 5) then raise exception '[E_INVALID] Ogiltig position.'; end if;
  v_elapsed := extract(epoch from now() - s.last_heartbeat_at);
  v_delta := p_position - s.last_position;
  if p_playing and v_elapsed <= 40 and v_delta > 0 and v_delta <= v_elapsed * 1.25 + 1 then
    v_lo := floor(s.last_position)::integer; v_hi := floor(p_position)::integer;
    if v_hi > v_lo then pr.coverage := pr.coverage + int4multirange(int4range(v_lo, v_hi, '[)')); end if;
  end if;
  select coalesce(sum(upper(r) - lower(r)), 0) into v_cov from unnest(pr.coverage) r;
  update public.vihem_kp_lesson_progress set coverage = pr.coverage, watched_seconds = v_cov, resume_position = case when p_position >= coalesce(a.duration_seconds, 1e9) - 3 then 0 else floor(p_position)::integer end, last_viewed_at = now() where id = pr.id;
  update public.vihem_kp_video_sessions set last_heartbeat_at = now(), last_position = p_position where id = p_session;
  if l.completion_rule ->> 'type' = 'video_watch' and pr.status <> 'completed' and a.duration_seconds is not null and a.duration_seconds > 0 then
    v_min := coalesce((l.completion_rule ->> 'min_percent')::integer, 90);
    v_pct := v_cov * 100.0 / a.duration_seconds;
    if v_pct >= v_min then
      update public.vihem_kp_lesson_progress set status = 'completed', completed_at = now(), completion_source = 'server_video' where id = pr.id;
      v_completed := true;
      perform public.vihem_kp_recompute_enrollment(s.enrollment_id);
      perform public.vihem_kp_try_complete_enrollment(s.enrollment_id);
    end if;
  end if;
  return jsonb_build_object('watched_seconds', v_cov, 'percent', case when coalesce(a.duration_seconds, 0) > 0 then round(v_cov * 100.0 / a.duration_seconds, 1) end, 'completed', v_completed or pr.status = 'completed');
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Prov
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_kp_exam_start(p_enrollment uuid, p_user uuid, p_exam uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.vihem_kp_enrollments%rowtype; x public.vihem_kp_exams%rowtype; open_attempt public.vihem_kp_exam_attempts%rowtype; v_count integer; v_last timestamptz; v_missing integer; p public.vihem_kp_participants%rowtype;
  v_ids uuid[] := '{}'; v_pick uuid[]; r record; v_snapshot jsonb := '[]'::jsonb; qr record; v_opts jsonb; v_attempt uuid; v_n integer;
begin
  e := public.vihem_kp_enrollment_for_user(p_enrollment, p_user);
  select * into x from public.vihem_kp_exams where id = p_exam and version_id = e.course_version_id;
  if x.id is null then raise exception '[E_NOT_FOUND] Provet finns inte.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kp_exam:' || p_enrollment::text || p_exam::text, 0));
  select * into open_attempt from public.vihem_kp_exam_attempts where enrollment_id = p_enrollment and exam_id = p_exam and status = 'in_progress';
  if open_attempt.id is not null then
    if open_attempt.expires_at is not null and open_attempt.expires_at + interval '30 seconds' < now() then
      update public.vihem_kp_exam_attempts set status = 'expired', submitted_at = now(), passed = false, percent = 0, score_points = 0, max_points = (select coalesce(sum((q ->> 'points')::integer), 0) from jsonb_array_elements(snapshot) q) where id = open_attempt.id;
      insert into public.vihem_kp_attempt_events (attempt_id, organisation_id, event_type) values (open_attempt.id, e.organisation_id, 'expired');
    else return open_attempt.id; end if;
  end if;
  if x.require_lessons_complete then
    select count(*) into v_missing from public.vihem_kp_lessons l where l.version_id = e.course_version_id and l.required and l.id is distinct from x.lesson_id
      and not exists (select 1 from public.vihem_kp_lesson_progress pr where pr.enrollment_id = p_enrollment and pr.lesson_id = l.id and pr.status = 'completed');
    if v_missing > 0 then raise exception '[E_PREREQ] Du måste genomföra alla obligatoriska lektioner innan provet (% kvar).', v_missing; end if;
  end if;
  if x.require_identity then
    select * into p from public.vihem_kp_participants where user_id = p_user;
    if p.identity_verified_at is null then raise exception '[E_IDENTITY] Provet kräver verifierad identitet.'; end if;
  end if;
  select count(*), max(submitted_at) into v_count, v_last from public.vihem_kp_exam_attempts where enrollment_id = p_enrollment and exam_id = p_exam and status in ('graded', 'expired');
  if x.max_attempts is not null and v_count >= x.max_attempts then raise exception '[E_ATTEMPTS] Du har använt alla försök (%).', x.max_attempts; end if;
  if v_last is not null and x.cooldown_seconds > 0 and v_last + make_interval(secs => x.cooldown_seconds) > now() then
    raise exception '[E_COOLDOWN] Nästa försök är möjligt om % minuter.', ceil(extract(epoch from (v_last + make_interval(secs => x.cooldown_seconds) - now())) / 60);
  end if;
  -- Urval: fasta frågor, ämnesregler, därefter slumpad påfyllning ur provets pool
  select coalesce(array_agg(question_id order by sort_order), '{}') into v_ids from public.vihem_kp_exam_questions eq join public.vihem_kp_questions q on q.id = eq.question_id where eq.exam_id = x.id and eq.fixed and q.active;
  for r in select * from public.vihem_kp_exam_topic_rules where exam_id = x.id loop
    select coalesce(array_agg(id), '{}') into v_pick from (select q.id from public.vihem_kp_questions q where q.organisation_id = e.organisation_id and q.active and q.topic = r.topic and not (q.id = any (v_ids)) order by random() limit r.question_count) s;
    v_ids := v_ids || v_pick;
  end loop;
  v_n := cardinality(v_ids);
  if v_n < x.question_count then
    select coalesce(array_agg(id), '{}') into v_pick from (select q.id from public.vihem_kp_questions q
      where q.organisation_id = e.organisation_id and q.active and not (q.id = any (v_ids))
        and (q.id in (select question_id from public.vihem_kp_exam_questions where exam_id = x.id) or q.topic in (select topic from public.vihem_kp_exam_topic_rules where exam_id = x.id))
      order by random() limit x.question_count - v_n) s;
    v_ids := v_ids || v_pick;
  end if;
  if cardinality(v_ids) < x.question_count then raise exception '[E_CONFIG] Provet har för få frågor.'; end if;
  if cardinality(v_ids) > x.question_count then v_ids := v_ids[1:x.question_count]; end if;
  if x.randomize_questions then select array_agg(id order by random()) into v_ids from unnest(v_ids) id; end if;
  for qr in select qq.*, u.ord from public.vihem_kp_questions qq join unnest(v_ids) with ordinality u(id, ord) on u.id = qq.id order by u.ord loop
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'is_correct', o.is_correct, 'feedback', o.feedback) order by case when x.randomize_options then random() else o.sort_order end), '[]'::jsonb)
      into v_opts from public.vihem_kp_question_options o where o.question_id = qr.id;
    v_snapshot := v_snapshot || jsonb_build_array(jsonb_build_object('question_id', qr.id, 'prompt', qr.prompt, 'type', qr.type, 'explanation', qr.explanation, 'points', qr.points, 'topic', qr.topic, 'image_asset_id', qr.image_asset_id, 'options', v_opts));
  end loop;
  insert into public.vihem_kp_exam_attempts (organisation_id, exam_id, enrollment_id, course_version_id, attempt_no, expires_at, pass_percent_snapshot, snapshot)
    values (e.organisation_id, x.id, p_enrollment, e.course_version_id, v_count + 1, case when x.time_limit_seconds is not null then now() + make_interval(secs => x.time_limit_seconds) end, x.pass_percent, v_snapshot)
    returning id into v_attempt;
  insert into public.vihem_kp_attempt_events (attempt_id, organisation_id, event_type, detail) values (v_attempt, e.organisation_id, 'started', jsonb_build_object('attempt_no', v_count + 1, 'questions', cardinality(v_ids)));
  perform public.vihem_kp_recompute_enrollment(p_enrollment);
  return v_attempt;
end;
$$;

-- Klientvy av ett försök: aldrig facit, förklaringar eller feedback
create or replace function public.vihem_kp_attempt_view(p_attempt uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.vihem_kp_exam_attempts%rowtype; x public.vihem_kp_exams%rowtype; v_q jsonb;
begin
  select a2.* into a from public.vihem_kp_exam_attempts a2 join public.vihem_kp_enrollments e on e.id = a2.enrollment_id where a2.id = p_attempt and e.user_id = p_user;
  if a.id is null then raise exception '[E_NOT_FOUND] Försöket finns inte.'; end if;
  select * into x from public.vihem_kp_exams where id = a.exam_id;
  select coalesce(jsonb_agg(jsonb_build_object('question_id', q ->> 'question_id', 'prompt', q ->> 'prompt', 'type', q ->> 'type', 'points', (q ->> 'points')::integer, 'image_asset_id', q ->> 'image_asset_id',
      'multiple', (q ->> 'type') = 'multiple',
      'options', (select jsonb_agg(jsonb_build_object('id', o ->> 'id', 'label', o ->> 'label')) from jsonb_array_elements(q -> 'options') o),
      'selected', coalesce((select to_jsonb(aa.option_ids) from public.vihem_kp_attempt_answers aa where aa.attempt_id = a.id and aa.question_id = (q ->> 'question_id')::uuid), '[]'::jsonb))), '[]'::jsonb)
    into v_q from jsonb_array_elements(a.snapshot) q;
  return jsonb_build_object('attempt_id', a.id, 'status', a.status, 'attempt_no', a.attempt_no, 'expires_at', a.expires_at, 'exam', jsonb_build_object('title', x.title, 'kind', x.kind, 'pass_percent', x.pass_percent, 'feedback_mode', x.feedback_mode),
    'questions', case when a.status = 'in_progress' then v_q else '[]'::jsonb end);
end;
$$;

create or replace function public.vihem_kp_exam_answer(p_attempt uuid, p_user uuid, p_question uuid, p_options uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.vihem_kp_exam_attempts%rowtype; x public.vihem_kp_exams%rowtype; q jsonb; v_valid uuid[]; v_correct uuid[]; v_ok boolean;
begin
  select a2.* into a from public.vihem_kp_exam_attempts a2 join public.vihem_kp_enrollments e on e.id = a2.enrollment_id where a2.id = p_attempt and e.user_id = p_user for update of a2;
  if a.id is null then raise exception '[E_NOT_FOUND] Försöket finns inte.'; end if;
  if a.status <> 'in_progress' or (a.expires_at is not null and a.expires_at < now()) then raise exception '[E_CLOSED] Provet är avslutat eller tiden har gått ut.'; end if;
  select value into q from jsonb_array_elements(a.snapshot) where (value ->> 'question_id')::uuid = p_question;
  if q is null then raise exception '[E_NOT_FOUND] Frågan ingår inte i provet.'; end if;
  select coalesce(array_agg((o ->> 'id')::uuid), '{}') into v_valid from jsonb_array_elements(q -> 'options') o;
  if exists (select 1 from unnest(coalesce(p_options, '{}')) u where not (u = any (v_valid))) then raise exception '[E_INVALID] Ogiltigt svarsalternativ.'; end if;
  if (q ->> 'type') <> 'multiple' and cardinality(coalesce(p_options, '{}')) > 1 then raise exception '[E_INVALID] Bara ett alternativ får väljas.'; end if;
  insert into public.vihem_kp_attempt_answers (attempt_id, question_id, option_ids) values (p_attempt, p_question, coalesce(p_options, '{}'))
    on conflict (attempt_id, question_id) do update set option_ids = excluded.option_ids, answered_at = now();
  select * into x from public.vihem_kp_exams where id = a.exam_id;
  if x.feedback_mode = 'per_question' then
    select coalesce(array_agg((o ->> 'id')::uuid), '{}') into v_correct from jsonb_array_elements(q -> 'options') o where (o ->> 'is_correct')::boolean;
    v_ok := (select array(select unnest(coalesce(p_options, '{}')) order by 1)) = (select array(select unnest(v_correct) order by 1));
    return jsonb_build_object('saved', true, 'correct', v_ok, 'explanation', q ->> 'explanation', 'correct_option_ids', case when x.reveal_correct_answers then to_jsonb(v_correct) end);
  end if;
  return jsonb_build_object('saved', true);
end;
$$;

create or replace function public.vihem_kp_exam_submit(p_attempt uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.vihem_kp_exam_attempts%rowtype; x public.vihem_kp_exams%rowtype; q jsonb; v_correct uuid[]; v_sel uuid[]; v_ok boolean; v_pts integer := 0; v_max integer := 0; v_pct numeric; v_passed boolean; v_late boolean;
  v_review jsonb := '[]'::jsonb; e public.vihem_kp_enrollments%rowtype; v_status text;
begin
  select a2.* into a from public.vihem_kp_exam_attempts a2 join public.vihem_kp_enrollments e2 on e2.id = a2.enrollment_id where a2.id = p_attempt and e2.user_id = p_user for update of a2;
  if a.id is null then raise exception '[E_NOT_FOUND] Försöket finns inte.'; end if;
  if a.status <> 'in_progress' then raise exception '[E_CLOSED] Provet är redan inlämnat.'; end if;
  select * into x from public.vihem_kp_exams where id = a.exam_id;
  v_late := a.expires_at is not null and a.expires_at + interval '30 seconds' < now();
  for q in select value from jsonb_array_elements(a.snapshot) loop
    v_max := v_max + (q ->> 'points')::integer;
    select coalesce(array_agg((o ->> 'id')::uuid order by (o ->> 'id')), '{}') into v_correct from jsonb_array_elements(q -> 'options') o where (o ->> 'is_correct')::boolean;
    select coalesce(array(select unnest(option_ids) order by 1), '{}') into v_sel from public.vihem_kp_attempt_answers where attempt_id = a.id and question_id = (q ->> 'question_id')::uuid;
    v_sel := coalesce(v_sel, '{}');
    v_ok := (not v_late) and cardinality(v_sel) > 0 and (select array(select unnest(v_sel) order by 1)) = (select array(select unnest(v_correct) order by 1));
    if v_ok then v_pts := v_pts + (q ->> 'points')::integer; end if;
    update public.vihem_kp_attempt_answers set correct = v_ok, points = case when v_ok then (q ->> 'points')::integer else 0 end where attempt_id = a.id and question_id = (q ->> 'question_id')::uuid;
    if x.feedback_mode <> 'none' then
      v_review := v_review || jsonb_build_array(jsonb_build_object('question_id', q ->> 'question_id', 'prompt', q ->> 'prompt', 'correct', v_ok, 'explanation', case when not v_ok then q ->> 'explanation' end,
        'correct_option_ids', case when x.reveal_correct_answers then to_jsonb(v_correct) end, 'selected', to_jsonb(v_sel)));
    end if;
  end loop;
  v_pct := case when v_max = 0 then 0 else round(v_pts * 100.0 / v_max, 2) end;
  v_passed := (not v_late) and v_pct >= a.pass_percent_snapshot;
  v_status := case when v_late then 'expired' else 'graded' end;
  update public.vihem_kp_exam_attempts set status = v_status, submitted_at = now(), score_points = v_pts, max_points = v_max, percent = v_pct, passed = v_passed where id = a.id;
  insert into public.vihem_kp_attempt_events (attempt_id, organisation_id, event_type, detail) values (a.id, a.organisation_id, case when v_late then 'expired_on_submit' else 'graded' end, jsonb_build_object('percent', v_pct, 'passed', v_passed));
  select * into e from public.vihem_kp_enrollments where id = a.enrollment_id;
  if v_passed and x.lesson_id is not null then
    insert into public.vihem_kp_lesson_progress (organisation_id, enrollment_id, lesson_id, status, completed_at, completion_source) values (a.organisation_id, a.enrollment_id, x.lesson_id, 'completed', now(), 'server_quiz')
      on conflict (enrollment_id, lesson_id) do update set status = 'completed', completed_at = coalesce(public.vihem_kp_lesson_progress.completed_at, now()), completion_source = coalesce(public.vihem_kp_lesson_progress.completion_source, 'server_quiz');
  end if;
  perform public.vihem_kp_recompute_enrollment(a.enrollment_id);
  if v_passed then perform public.vihem_kp_try_complete_enrollment(a.enrollment_id); end if;
  return jsonb_build_object('status', v_status, 'percent', v_pct, 'passed', v_passed, 'score_points', v_pts, 'max_points', v_max, 'pass_percent', a.pass_percent_snapshot, 'review', case when x.feedback_mode <> 'none' then v_review end,
    'attempts_left', case when x.max_attempts is null then null else greatest(0, x.max_attempts - a.attempt_no) end);
end;
$$;

-- Revisionsbar manuell justering (t.ex. felaktig fråga): original sparas i händelseloggen, ersätter inte historiken
create or replace function public.vihem_kp_exam_override(p_attempt uuid, p_passed boolean, p_reason text, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.vihem_kp_exam_attempts%rowtype;
begin
  select * into a from public.vihem_kp_exam_attempts where id = p_attempt for update;
  if a.id is null then raise exception '[E_NOT_FOUND] Försöket finns inte.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception '[E_INVALID] Ange en orsak.'; end if;
  insert into public.vihem_kp_attempt_events (attempt_id, organisation_id, event_type, actor_user_id, detail)
    values (a.id, a.organisation_id, 'override', p_actor, jsonb_build_object('before', jsonb_build_object('passed', a.passed, 'percent', a.percent), 'after_passed', p_passed, 'reason', p_reason));
  update public.vihem_kp_exam_attempts set passed = p_passed where id = a.id;
  if p_passed then perform public.vihem_kp_try_complete_enrollment(a.enrollment_id); end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Genomförd utbildning och certifikat
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_kp_enrollment_requirements(p_enrollment uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e public.vihem_kp_enrollments%rowtype; c public.vihem_kp_courses%rowtype; v_lessons_left integer; v_final public.vihem_kp_exams%rowtype; v_exam_ok boolean := true; v_identity boolean := true; v_session_ok boolean := true; p public.vihem_kp_participants%rowtype; v_best numeric;
begin
  select * into e from public.vihem_kp_enrollments where id = p_enrollment;
  select * into c from public.vihem_kp_courses where id = e.course_id;
  select count(*) into v_lessons_left from public.vihem_kp_lessons l where l.version_id = e.course_version_id and l.required
    and not exists (select 1 from public.vihem_kp_lesson_progress pr where pr.enrollment_id = p_enrollment and pr.lesson_id = l.id and pr.status = 'completed');
  select * into v_final from public.vihem_kp_exams where version_id = e.course_version_id and kind = 'final';
  if v_final.id is not null then
    select max(percent) into v_best from public.vihem_kp_exam_attempts where enrollment_id = p_enrollment and exam_id = v_final.id and passed;
    v_exam_ok := exists (select 1 from public.vihem_kp_exam_attempts where enrollment_id = p_enrollment and exam_id = v_final.id and passed);
  end if;
  if c.requires_identity_verification then
    select * into p from public.vihem_kp_participants where user_id = e.user_id;
    v_identity := p.identity_verified_at is not null;
  end if;
  if c.delivery_form = 'instructor_led' then
    v_session_ok := exists (select 1 from public.vihem_kp_session_bookings b where b.seat_id = e.seat_id and b.status = 'passed');
  elsif c.delivery_form = 'hybrid' then
    v_session_ok := exists (select 1 from public.vihem_kp_session_bookings b where b.seat_id = e.seat_id and b.status = 'passed');
  end if;
  return jsonb_build_object('lessons_left', v_lessons_left, 'exam_required', v_final.id is not null, 'exam_passed', v_exam_ok, 'best_percent', v_best, 'identity_required', c.requires_identity_verification, 'identity_ok', v_identity, 'session_ok', v_session_ok,
    'content_complete', v_lessons_left = 0 and v_exam_ok and v_session_ok, 'issuable', v_lessons_left = 0 and v_exam_ok and v_session_ok and v_identity);
end;
$$;

create or replace function public.vihem_kp_try_complete_enrollment(p_enrollment uuid) returns text
language plpgsql security definer set search_path = public as $$
declare e public.vihem_kp_enrollments%rowtype; r jsonb; v_status text;
begin
  select * into e from public.vihem_kp_enrollments where id = p_enrollment for update;
  if e.status in ('revoked', 'cancelled', 'completed') then return e.status; end if;
  r := public.vihem_kp_enrollment_requirements(p_enrollment);
  if not (r ->> 'content_complete')::boolean then return e.status; end if;
  if not (r ->> 'identity_ok')::boolean then
    update public.vihem_kp_enrollments set status = 'awaiting_identity' where id = p_enrollment;
    return 'awaiting_identity';
  end if;
  update public.vihem_kp_enrollments set status = 'completed', completed_at = coalesce(completed_at, now()), progress_percent = 100 where id = p_enrollment;
  update public.vihem_kp_seats set status = 'completed' where id = e.seat_id;
  perform public.vihem_kp_issue_certificate(p_enrollment, null);
  return 'completed';
end;
$$;

create or replace function public.vihem_kp_issue_certificate(p_enrollment uuid, p_actor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.vihem_kp_enrollments%rowtype; c public.vihem_kp_courses%rowtype; p public.vihem_kp_participants%rowtype; st public.vihem_kp_settings%rowtype; r jsonb; existing uuid; v_id uuid; v_num text; v_code text;
  v_valid date; v_done date; v_exam jsonb; v_final public.vihem_kp_exams%rowtype; v_att public.vihem_kp_exam_attempts%rowtype; v_tpl uuid; v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i integer;
begin
  select * into e from public.vihem_kp_enrollments where id = p_enrollment for update;
  if e.id is null then raise exception '[E_NOT_FOUND] Utbildningen finns inte.'; end if;
  select id into existing from public.vihem_kp_certificates where enrollment_id = p_enrollment and status = 'issued';
  if existing is not null then return existing; end if;
  r := public.vihem_kp_enrollment_requirements(p_enrollment);
  if not (r ->> 'issuable')::boolean then raise exception '[E_PREREQ] Kraven för certifikat är inte uppfyllda.'; end if;
  select * into c from public.vihem_kp_courses where id = e.course_id;
  select * into p from public.vihem_kp_participants where user_id = e.user_id;
  select * into st from public.vihem_kp_settings where organisation_id = e.organisation_id;
  v_done := coalesce(e.completed_at, now())::date;
  v_valid := case when c.validity_months is not null then (v_done + make_interval(months => c.validity_months))::date end;
  select * into v_final from public.vihem_kp_exams where version_id = e.course_version_id and kind = 'final';
  if v_final.id is not null then
    select * into v_att from public.vihem_kp_exam_attempts where enrollment_id = p_enrollment and exam_id = v_final.id and passed order by submitted_at desc nulls last limit 1;
    v_exam := jsonb_build_object('exam', v_final.title, 'percent', v_att.percent, 'pass_percent', v_att.pass_percent_snapshot, 'attempt_id', v_att.id, 'attempt_no', v_att.attempt_no);
  else v_exam := '{}'::jsonb; end if;
  select coalesce(c.certificate_template_id, (select id from public.vihem_kp_certificate_templates where organisation_id = e.organisation_id and active and kind = c.certificate_kind order by created_at limit 1)) into v_tpl;
  v_num := 'KP-' || upper(regexp_replace(c.code, '[^A-Za-z0-9]', '', 'g')) || '-' || to_char(now(), 'YY') || '-' || lpad(nextval('public.vihem_kp_cert_seq')::text, 6, '0');
  v_code := '';
  for i in 1..12 loop v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1); end loop;
  insert into public.vihem_kp_certificates (organisation_id, certificate_number, verification_code, enrollment_id, user_id, course_id, course_version_id, template_id, kind, holder_name, course_title, course_code, issuer_name, completed_on, valid_until, exam_summary)
    values (e.organisation_id, v_num, v_code, p_enrollment, e.user_id, e.course_id, e.course_version_id, v_tpl, c.certificate_kind, trim(p.first_name || ' ' || p.last_name), c.title, c.code, st.seller_name, v_done, v_valid, v_exam)
    returning id into v_id;
  insert into public.vihem_kp_certificate_events (organisation_id, certificate_id, event_type, actor_user_id, detail) values (e.organisation_id, v_id, 'issued', p_actor, jsonb_build_object('enrollment_id', p_enrollment));
  -- Extern registrering (ID06): skapas som ärende. Inget anrop görs här och inget påstås förrän ett verkligt resultat sparas.
  if c.id06_enabled then
    insert into public.vihem_kp_external_registrations (organisation_id, certificate_id, enrollment_id, user_id, competence_code, status, last_error, next_attempt_at)
      values (e.organisation_id, v_id, p_enrollment, e.user_id, c.id06_competence_code,
        case when exists (select 1 from public.vihem_kp_participant_identity pi where pi.user_id = e.user_id and pi.verified_at is not null) then 'pending' else 'needs_action' end,
        case when exists (select 1 from public.vihem_kp_participant_identity pi where pi.user_id = e.user_id and pi.verified_at is not null) then null else 'Verifierat personnummer saknas – krävs för ID06-registrering.' end,
        case when st.id06_mode = 'api' then now() end)
      on conflict (certificate_id, kind) do nothing;
  end if;
  perform public.vihem_kp_audit(e.organisation_id, p_actor, case when p_actor is null then 'system' else 'staff' end, 'certificate_issued', 'certificate', v_id::text, jsonb_build_object('number', v_num));
  return v_id;
end;
$$;

create or replace function public.vihem_kp_revoke_certificate(p_cert uuid, p_reason text, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.vihem_kp_certificates%rowtype;
begin
  select * into c from public.vihem_kp_certificates where id = p_cert for update;
  if c.id is null then raise exception '[E_NOT_FOUND] Certifikatet finns inte.'; end if;
  if c.status <> 'issued' then raise exception '[E_STATE] Certifikatet är redan % .', c.status; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception '[E_INVALID] Ange en orsak.'; end if;
  update public.vihem_kp_certificates set status = 'revoked', revoked_at = now(), revoked_by = p_actor, revoke_reason = p_reason where id = p_cert;
  insert into public.vihem_kp_certificate_events (organisation_id, certificate_id, event_type, actor_user_id, detail) values (c.organisation_id, p_cert, 'revoked', p_actor, jsonb_build_object('reason', p_reason));
  perform public.vihem_kp_audit(c.organisation_id, p_actor, 'staff', 'certificate_revoked', 'certificate', p_cert::text, jsonb_build_object('reason', p_reason));
end;
$$;

-- Ersätt (korrigera) ett certifikat: det gamla markeras ersatt och länkas till det nya (t.ex. namnändring)
create or replace function public.vihem_kp_reissue_certificate(p_cert uuid, p_reason text, p_actor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.vihem_kp_certificates%rowtype; p public.vihem_kp_participants%rowtype; v_id uuid; v_num text; v_code text; v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i integer; co public.vihem_kp_courses%rowtype;
begin
  select * into c from public.vihem_kp_certificates where id = p_cert for update;
  if c.id is null or c.status <> 'issued' then raise exception '[E_STATE] Bara utfärdade certifikat kan ersättas.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception '[E_INVALID] Ange en orsak.'; end if;
  select * into p from public.vihem_kp_participants where user_id = c.user_id;
  select * into co from public.vihem_kp_courses where id = c.course_id;
  update public.vihem_kp_certificates set status = 'superseded' where id = p_cert;
  v_num := 'KP-' || upper(regexp_replace(c.course_code, '[^A-Za-z0-9]', '', 'g')) || '-' || to_char(now(), 'YY') || '-' || lpad(nextval('public.vihem_kp_cert_seq')::text, 6, '0');
  v_code := ''; for i in 1..12 loop v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1); end loop;
  insert into public.vihem_kp_certificates (organisation_id, certificate_number, verification_code, enrollment_id, user_id, course_id, course_version_id, template_id, kind, holder_name, course_title, course_code, issuer_name, completed_on, valid_until, exam_summary)
    values (c.organisation_id, v_num, v_code, c.enrollment_id, c.user_id, c.course_id, c.course_version_id, c.template_id, c.kind, trim(p.first_name || ' ' || p.last_name), c.course_title, c.course_code, c.issuer_name, c.completed_on, c.valid_until, c.exam_summary)
    returning id into v_id;
  update public.vihem_kp_certificates set superseded_by = v_id where id = p_cert;
  insert into public.vihem_kp_certificate_events (organisation_id, certificate_id, event_type, actor_user_id, detail) values
    (c.organisation_id, p_cert, 'superseded', p_actor, jsonb_build_object('by', v_id, 'reason', p_reason)), (c.organisation_id, v_id, 'issued_as_replacement', p_actor, jsonb_build_object('replaces', p_cert, 'reason', p_reason));
  update public.vihem_kp_external_registrations set certificate_id = v_id where certificate_id = p_cert and status <> 'registered';
  perform public.vihem_kp_audit(c.organisation_id, p_actor, 'staff', 'certificate_reissued', 'certificate', v_id::text, jsonb_build_object('replaces', p_cert, 'reason', p_reason));
  return v_id;
end;
$$;

-- Publik verifiering: minsta möjliga uppgifter. Ger aldrig personnummer, e-post eller provresultat.
create or replace function public.vihem_kp_verify_certificate(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.vihem_kp_certificates%rowtype; v_status text; r public.vihem_kp_external_registrations%rowtype;
begin
  select * into c from public.vihem_kp_certificates where verification_code = upper(trim(p_code)) or certificate_number = upper(trim(p_code));
  if c.id is null then return jsonb_build_object('found', false); end if;
  v_status := case when c.status = 'revoked' then 'revoked' when c.status = 'superseded' then 'superseded' when c.valid_until is not null and c.valid_until < current_date then 'expired' else 'valid' end;
  select * into r from public.vihem_kp_external_registrations where certificate_id = c.id and kind = 'id06';
  return jsonb_build_object('found', true, 'status', v_status, 'certificate_number', c.certificate_number, 'holder_name', c.holder_name, 'course_title', c.course_title, 'kind', c.kind,
    'completed_on', c.completed_on, 'valid_until', c.valid_until, 'issuer', c.issuer_name, 'issued_at', c.issued_at, 'replaced_by_number', (select certificate_number from public.vihem_kp_certificates where id = c.superseded_by),
    'id06_registered', coalesce(r.status = 'registered', false));
end;
$$;

create or replace function public.vihem_kp_set_certificate_pdf(p_cert uuid, p_path text, p_sha text) returns void
language sql security definer set search_path = public as $$
  update public.vihem_kp_certificates set pdf_path = p_path, pdf_sha256 = p_sha where id = p_cert;
$$;

-- ID06: ärendekö. Statusmaskin: pending -> processing -> registered | failed | needs_action. Återförsök sker bara från failed/needs_action.
create or replace function public.vihem_kp_id06_claim(p_limit integer default 5) returns setof public.vihem_kp_external_registrations
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (select id from public.vihem_kp_external_registrations where status = 'pending' and (next_attempt_at is null or next_attempt_at <= now()) order by created_at limit p_limit for update skip locked)
  update public.vihem_kp_external_registrations r set status = 'processing', attempts = r.attempts + 1, submitted_at = now() from due where r.id = due.id returning r.*;
end;
$$;
create or replace function public.vihem_kp_id06_result(p_id uuid, p_status text, p_reference text, p_error text, p_actor uuid, p_notes text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r public.vihem_kp_external_registrations%rowtype;
begin
  select * into r from public.vihem_kp_external_registrations where id = p_id for update;
  if r.id is null then raise exception '[E_NOT_FOUND] Registreringsärendet finns inte.'; end if;
  if p_status not in ('registered', 'failed', 'needs_action', 'pending', 'cancelled') then raise exception '[E_INVALID] Ogiltig status.'; end if;
  if r.status = 'registered' and p_status <> 'registered' then raise exception '[E_STATE] Registrerade ärenden kan inte ändras.'; end if;
  if p_status = 'pending' and r.status not in ('failed', 'needs_action') then raise exception '[E_STATE] Återförsök kan bara göras på misslyckade ärenden.'; end if;
  if p_status = 'registered' and coalesce(trim(p_reference), '') = '' then raise exception '[E_INVALID] En registreringsreferens krävs för att markera som registrerad.'; end if;
  update public.vihem_kp_external_registrations set status = p_status, external_reference = coalesce(nullif(p_reference, ''), external_reference), last_error = nullif(p_error, ''), handled_by = coalesce(p_actor, handled_by),
      registered_at = case when p_status = 'registered' then now() else registered_at end, next_attempt_at = case when p_status = 'pending' then now() end, notes = case when p_notes <> '' then p_notes else notes end where id = p_id;
  insert into public.vihem_kp_external_registration_events (registration_id, organisation_id, event_type, actor_user_id, detail) values (p_id, r.organisation_id, 'status_' || p_status, p_actor, jsonb_build_object('reference', p_reference, 'error', p_error, 'manual', p_actor is not null));
end;
$$;

revoke all on function public.vihem_kp_enrollment_for_user(uuid, uuid, boolean), public.vihem_kp_lesson_unlocked(uuid, uuid), public.vihem_kp_recompute_enrollment(uuid), public.vihem_kp_open_lesson(uuid, uuid, uuid), public.vihem_kp_complete_view_lesson(uuid, uuid, uuid),
  public.vihem_kp_video_start(uuid, uuid, uuid, uuid), public.vihem_kp_video_heartbeat(uuid, uuid, numeric, boolean), public.vihem_kp_exam_start(uuid, uuid, uuid), public.vihem_kp_attempt_view(uuid, uuid),
  public.vihem_kp_exam_answer(uuid, uuid, uuid, uuid[]), public.vihem_kp_exam_submit(uuid, uuid), public.vihem_kp_exam_override(uuid, boolean, text, uuid), public.vihem_kp_enrollment_requirements(uuid),
  public.vihem_kp_try_complete_enrollment(uuid), public.vihem_kp_issue_certificate(uuid, uuid), public.vihem_kp_revoke_certificate(uuid, text, uuid), public.vihem_kp_reissue_certificate(uuid, text, uuid),
  public.vihem_kp_verify_certificate(text), public.vihem_kp_set_certificate_pdf(uuid, text, text), public.vihem_kp_id06_claim(integer), public.vihem_kp_id06_result(uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.vihem_kp_enrollment_for_user(uuid, uuid, boolean), public.vihem_kp_lesson_unlocked(uuid, uuid), public.vihem_kp_recompute_enrollment(uuid), public.vihem_kp_open_lesson(uuid, uuid, uuid), public.vihem_kp_complete_view_lesson(uuid, uuid, uuid),
  public.vihem_kp_video_start(uuid, uuid, uuid, uuid), public.vihem_kp_video_heartbeat(uuid, uuid, numeric, boolean), public.vihem_kp_exam_start(uuid, uuid, uuid), public.vihem_kp_attempt_view(uuid, uuid),
  public.vihem_kp_exam_answer(uuid, uuid, uuid, uuid[]), public.vihem_kp_exam_submit(uuid, uuid), public.vihem_kp_exam_override(uuid, boolean, text, uuid), public.vihem_kp_enrollment_requirements(uuid),
  public.vihem_kp_try_complete_enrollment(uuid), public.vihem_kp_issue_certificate(uuid, uuid), public.vihem_kp_revoke_certificate(uuid, text, uuid), public.vihem_kp_reissue_certificate(uuid, text, uuid),
  public.vihem_kp_verify_certificate(text), public.vihem_kp_set_certificate_pdf(uuid, text, text), public.vihem_kp_id06_claim(integer), public.vihem_kp_id06_result(uuid, text, text, text, uuid, text) to service_role;

commit;
