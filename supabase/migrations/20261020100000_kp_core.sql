-- Kompetensportalen 2.0 – del A: kurskatalog, kursversioner, innehåll, frågebank, prov, produkter/priser.
-- Allt är additivt. Affärsdata ligger i public.vihem_kp_* med RLS per organisation och modulen 'kompetensportalen'.
-- Skrivningar av känsliga flöden (order, betalning, prov, certifikat) sker endast via SECURITY DEFINER-funktioner som service_role anropar.
begin;

-- Modulregister (en ny modul, av som standard; aktiveras per organisation av VI-HEM-administratör)
insert into public.vihem_module_registry (module_key, name, description, category, default_enabled, default_limits, default_settings, sort_order)
values ('kompetensportalen', 'Kompetensportalen', 'Kurser, kursbyggare, order, deltagare, prov och certifikat för WPE Sweden AB.', 'education', false, '{}'::jsonb, '{}'::jsonb, 185)
on conflict (module_key) do update set name = excluded.name, description = excluded.description, category = excluded.category;

-- ---------------------------------------------------------------------------------------------------------
-- Behörighetshjälpare
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_kp_enabled(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vihem_organisation_modules where organisation_id = p_org and module_key = 'kompetensportalen' and enabled);
$$;

create or replace function public.vihem_kp_is_staff(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_org is not null and p_org = public.get_my_org_id() and public.vihem_kp_enabled(p_org) and public.get_my_role() = any (array['staff', 'admin', 'superadmin']);
$$;

create or replace function public.vihem_kp_is_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_org is not null and p_org = public.get_my_org_id() and public.vihem_kp_enabled(p_org) and public.get_my_role() = any (array['admin', 'superadmin']);
$$;

create or replace function public.vihem_kp_touch() returns trigger language plpgsql as $$
begin NEW.updated_at := now(); return NEW; end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Inställningar (en rad per organisation)
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.vihem_kp_settings (
  organisation_id uuid primary key references public.vihem_organisations(id) on delete cascade,
  finance_company_id uuid references public.vihem_companies(id),
  seller_name text not null default 'WPE Sweden AB',
  seller_org_number text not null default '',
  seller_vat_number text not null default '',
  seller_address text not null default '',
  seller_email text not null default '',
  seller_phone text not null default '',
  public_base_url text not null default 'https://kompetensportalen.se',
  support_email text not null default '',
  sender_email text not null default '',
  sender_name text not null default 'Kompetensportalen',
  default_vat_rate numeric(5,2) not null default 25,
  invoice_enabled boolean not null default false,
  invoice_payment_terms_days integer not null default 30 check (invoice_payment_terms_days between 1 and 120),
  invoice_access_mode text not null default 'after_payment' check (invoice_access_mode in ('immediate', 'after_payment')),
  invoice_requires_approval boolean not null default true,
  stripe_enabled boolean not null default false,
  id06_mode text not null default 'manual' check (id06_mode in ('manual', 'api')),
  seat_transfer_allowed boolean not null default true,
  refund_revokes_access boolean not null default true,
  dispute_revokes_access boolean not null default true,
  withdrawal_notice text not null default '',
  data_retention_months integer not null default 120,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger vihem_kp_settings_touch before update on public.vihem_kp_settings for each row execute function public.vihem_kp_touch();

-- ---------------------------------------------------------------------------------------------------------
-- Kurser och kursversioner
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.vihem_kp_courses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  code text not null,
  slug text not null,
  title text not null,
  subtitle text not null default '',
  summary text not null default '',
  description text not null default '',
  category text not null default '',
  tags text[] not null default '{}',
  delivery_form text not null default 'self_paced' check (delivery_form in ('self_paced', 'instructor_led', 'hybrid')),
  language text not null default 'sv',
  target_audience text not null default '',
  objectives text[] not null default '{}',
  prerequisites text not null default '',
  exam_info text not null default '',
  estimated_minutes integer not null default 60 check (estimated_minutes >= 0),
  validity_months integer check (validity_months is null or validity_months > 0),
  renewal_notice_days integer[] not null default '{90,30}',
  requires_identity_verification boolean not null default false,
  certificate_kind text not null default 'training_certificate' check (certificate_kind in ('training_certificate', 'competence_proof')),
  id06_enabled boolean not null default false,
  id06_competence_code text,
  certificate_template_id uuid,
  image_url text,
  og_image_url text,
  seo_title text not null default '',
  seo_description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'coming_soon', 'published', 'archived')),
  published_version_id uuid,
  sort_order integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, code),
  unique (organisation_id, slug)
);
create trigger vihem_kp_courses_touch before update on public.vihem_kp_courses for each row execute function public.vihem_kp_touch();

create table if not exists public.vihem_kp_course_versions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  course_id uuid not null references public.vihem_kp_courses(id) on delete cascade,
  version integer not null,
  label text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  changelog text not null default '',
  sequential boolean not null default false,
  published_at timestamptz,
  published_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (course_id, version)
);
create unique index if not exists vihem_kp_one_draft on public.vihem_kp_course_versions (course_id) where status = 'draft';
create unique index if not exists vihem_kp_one_published on public.vihem_kp_course_versions (course_id) where status = 'published';
alter table public.vihem_kp_courses add constraint vihem_kp_courses_published_fk foreign key (published_version_id) references public.vihem_kp_course_versions(id) deferrable initially deferred;

create table if not exists public.vihem_kp_media_assets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  kind text not null check (kind in ('video', 'audio', 'image', 'document')),
  bucket text not null,
  storage_path text not null,
  original_name text not null default '',
  mime_type text not null default '',
  size_bytes bigint not null default 0,
  duration_seconds integer,
  poster_path text,
  captions jsonb not null default '[]'::jsonb,
  alt_text text not null default '',
  status text not null default 'ready' check (status in ('uploading', 'ready', 'failed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (bucket, storage_path)
);

create table if not exists public.vihem_kp_modules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  version_id uuid not null references public.vihem_kp_course_versions(id) on delete cascade,
  title text not null,
  description text not null default '',
  sort_order integer not null default 0
);
create index if not exists vihem_kp_modules_version on public.vihem_kp_modules (version_id, sort_order);

create table if not exists public.vihem_kp_lessons (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  version_id uuid not null references public.vihem_kp_course_versions(id) on delete cascade,
  module_id uuid not null references public.vihem_kp_modules(id) on delete cascade,
  title text not null,
  kind text not null default 'content' check (kind in ('content', 'video', 'quiz')),
  required boolean not null default true,
  sort_order integer not null default 0,
  estimated_minutes integer not null default 5,
  -- {"type":"view"} | {"type":"video_watch","min_percent":90} | {"type":"quiz_pass"}
  completion_rule jsonb not null default '{"type":"view"}'::jsonb,
  check (completion_rule ? 'type')
);
create index if not exists vihem_kp_lessons_module on public.vihem_kp_lessons (module_id, sort_order);
create index if not exists vihem_kp_lessons_version on public.vihem_kp_lessons (version_id);

create table if not exists public.vihem_kp_lesson_blocks (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  version_id uuid not null references public.vihem_kp_course_versions(id) on delete cascade,
  lesson_id uuid not null references public.vihem_kp_lessons(id) on delete cascade,
  kind text not null check (kind in ('text', 'video', 'image', 'document', 'audio', 'link', 'knowledge_check')),
  sort_order integer not null default 0,
  -- text: {"markdown": "..."}; video/audio/image/document: {"asset_id": "..", "title": ".."}; link: {"url": "..", "title": ".."};
  -- knowledge_check: {"question_ids": ["..."]}  (svar rättas på servern, rätt svar lämnar aldrig databasen)
  content jsonb not null default '{}'::jsonb
);
create index if not exists vihem_kp_blocks_lesson on public.vihem_kp_lesson_blocks (lesson_id, sort_order);

-- Publicerade versioner är oföränderliga: ingen ändring av struktur, innehåll eller prov när versionen inte är utkast.
create or replace function public.vihem_kp_guard_version_content() returns trigger language plpgsql as $$
declare v_version uuid; v_status text;
begin
  v_version := coalesce(case when TG_OP = 'DELETE' then OLD.version_id else NEW.version_id end, null);
  select status into v_status from public.vihem_kp_course_versions where id = v_version;
  if v_status is not null and v_status <> 'draft' and coalesce(current_setting('vihem.kp_clone', true), '') <> 'on' then
    raise exception '[E_VERSION_LOCKED] Publicerade kursversioner kan inte ändras. Skapa ett nytt utkast.';
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;
create trigger vihem_kp_guard_modules before insert or update or delete on public.vihem_kp_modules for each row execute function public.vihem_kp_guard_version_content();
create trigger vihem_kp_guard_lessons before insert or update or delete on public.vihem_kp_lessons for each row execute function public.vihem_kp_guard_version_content();
create trigger vihem_kp_guard_blocks before insert or update or delete on public.vihem_kp_lesson_blocks for each row execute function public.vihem_kp_guard_version_content();

-- ---------------------------------------------------------------------------------------------------------
-- Frågebank och prov
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.vihem_kp_questions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  topic text not null default '',
  type text not null check (type in ('single', 'multiple', 'true_false', 'image')),
  prompt text not null,
  explanation text not null default '',
  image_asset_id uuid references public.vihem_kp_media_assets(id),
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  points integer not null default 1 check (points > 0),
  active boolean not null default true,
  tags text[] not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger vihem_kp_questions_touch before update on public.vihem_kp_questions for each row execute function public.vihem_kp_touch();
create index if not exists vihem_kp_questions_topic on public.vihem_kp_questions (organisation_id, topic);

create table if not exists public.vihem_kp_question_options (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  question_id uuid not null references public.vihem_kp_questions(id) on delete cascade,
  label text not null,
  is_correct boolean not null default false,
  feedback text not null default '',
  sort_order integer not null default 0
);
create index if not exists vihem_kp_options_question on public.vihem_kp_question_options (question_id, sort_order);

create table if not exists public.vihem_kp_exams (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  version_id uuid not null references public.vihem_kp_course_versions(id) on delete cascade,
  lesson_id uuid references public.vihem_kp_lessons(id) on delete cascade,
  kind text not null default 'final' check (kind in ('quiz', 'final')),
  title text not null default 'Slutprov',
  question_count integer not null default 10 check (question_count > 0),
  pass_percent integer not null default 80 check (pass_percent between 1 and 100),
  time_limit_seconds integer check (time_limit_seconds is null or time_limit_seconds >= 30),
  max_attempts integer check (max_attempts is null or max_attempts >= 1),
  cooldown_seconds integer not null default 0 check (cooldown_seconds >= 0),
  randomize_questions boolean not null default true,
  randomize_options boolean not null default true,
  feedback_mode text not null default 'after_attempt' check (feedback_mode in ('none', 'per_question', 'after_attempt')),
  reveal_correct_answers boolean not null default false,
  require_lessons_complete boolean not null default true,
  require_identity boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists vihem_kp_exams_version on public.vihem_kp_exams (version_id);
create unique index if not exists vihem_kp_one_final on public.vihem_kp_exams (version_id) where kind = 'final';
create trigger vihem_kp_guard_exams before insert or update or delete on public.vihem_kp_exams for each row execute function public.vihem_kp_guard_version_content();

-- Frågor som ingår i provet: fasta frågor och/eller ämnesregler (slumpas ur frågebanken)
create table if not exists public.vihem_kp_exam_questions (
  exam_id uuid not null references public.vihem_kp_exams(id) on delete cascade,
  question_id uuid not null references public.vihem_kp_questions(id) on delete restrict,
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  fixed boolean not null default false,
  sort_order integer not null default 0,
  primary key (exam_id, question_id)
);
create table if not exists public.vihem_kp_exam_topic_rules (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.vihem_kp_exams(id) on delete cascade,
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  topic text not null,
  question_count integer not null check (question_count > 0)
);

-- ---------------------------------------------------------------------------------------------------------
-- Produkter, priser, rabatter, paket
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.vihem_kp_products (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  kind text not null default 'course' check (kind in ('course', 'bundle', 'session')),
  course_id uuid references public.vihem_kp_courses(id) on delete restrict,
  sku text not null,
  name text not null,
  description text not null default '',
  price numeric(12,2) not null check (price >= 0),
  vat_rate numeric(5,2) not null default 25 check (vat_rate between 0 and 100),
  active boolean not null default true,
  sellable_from timestamptz,
  sellable_until timestamptz,
  max_quantity_per_order integer not null default 500,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, sku),
  check ((kind = 'bundle') or course_id is not null)
);
create trigger vihem_kp_products_touch before update on public.vihem_kp_products for each row execute function public.vihem_kp_touch();

create table if not exists public.vihem_kp_bundle_items (
  bundle_product_id uuid not null references public.vihem_kp_products(id) on delete cascade,
  course_product_id uuid not null references public.vihem_kp_products(id) on delete restrict,
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  primary key (bundle_product_id, course_product_id)
);

-- Pris-regler: volym, kampanj och företagsspecifika priser. Lägst pris bland giltiga regler vinner; prioritet bryter lika.
create table if not exists public.vihem_kp_price_rules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  product_id uuid not null references public.vihem_kp_products(id) on delete cascade,
  customer_id uuid,
  label text not null default '',
  min_quantity integer not null default 1 check (min_quantity >= 1),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  valid_from timestamptz,
  valid_until timestamptz,
  priority integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists vihem_kp_price_rules_product on public.vihem_kp_price_rules (product_id) where active;

create table if not exists public.vihem_kp_discount_codes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  code text not null,
  description text not null default '',
  kind text not null check (kind in ('percent', 'amount')),
  value numeric(12,2) not null check (value > 0),
  product_ids uuid[] not null default '{}',
  min_order_amount numeric(12,2) not null default 0,
  max_uses integer,
  used_count integer not null default 0,
  valid_from timestamptz,
  valid_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, code)
);

-- ---------------------------------------------------------------------------------------------------------
-- Publicering och kloning av kursversioner
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_kp_clone_version_content(p_from uuid, p_to uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m record; l record; e record; v_new_module uuid; v_new_lesson uuid; v_new_exam uuid; v_lesson_map jsonb := '{}'::jsonb;
begin
  perform set_config('vihem.kp_clone', 'on', true);
  for m in select * from public.vihem_kp_modules where version_id = p_from order by sort_order loop
    insert into public.vihem_kp_modules (organisation_id, version_id, title, description, sort_order) values (m.organisation_id, p_to, m.title, m.description, m.sort_order) returning id into v_new_module;
    for l in select * from public.vihem_kp_lessons where module_id = m.id order by sort_order loop
      insert into public.vihem_kp_lessons (organisation_id, version_id, module_id, title, kind, required, sort_order, estimated_minutes, completion_rule)
        values (l.organisation_id, p_to, v_new_module, l.title, l.kind, l.required, l.sort_order, l.estimated_minutes, l.completion_rule) returning id into v_new_lesson;
      v_lesson_map := v_lesson_map || jsonb_build_object(l.id::text, v_new_lesson);
      insert into public.vihem_kp_lesson_blocks (organisation_id, version_id, lesson_id, kind, sort_order, content)
        select organisation_id, p_to, v_new_lesson, kind, sort_order, content from public.vihem_kp_lesson_blocks where lesson_id = l.id;
    end loop;
  end loop;
  for e in select * from public.vihem_kp_exams where version_id = p_from loop
    insert into public.vihem_kp_exams (organisation_id, version_id, lesson_id, kind, title, question_count, pass_percent, time_limit_seconds, max_attempts, cooldown_seconds,
        randomize_questions, randomize_options, feedback_mode, reveal_correct_answers, require_lessons_complete, require_identity)
      values (e.organisation_id, p_to, (v_lesson_map ->> e.lesson_id::text)::uuid, e.kind, e.title, e.question_count, e.pass_percent, e.time_limit_seconds, e.max_attempts, e.cooldown_seconds,
        e.randomize_questions, e.randomize_options, e.feedback_mode, e.reveal_correct_answers, e.require_lessons_complete, e.require_identity) returning id into v_new_exam;
    insert into public.vihem_kp_exam_questions (exam_id, question_id, organisation_id, fixed, sort_order) select v_new_exam, question_id, organisation_id, fixed, sort_order from public.vihem_kp_exam_questions where exam_id = e.id;
    insert into public.vihem_kp_exam_topic_rules (exam_id, organisation_id, topic, question_count) select v_new_exam, organisation_id, topic, question_count from public.vihem_kp_exam_topic_rules where exam_id = e.id;
  end loop;
  perform set_config('vihem.kp_clone', 'off', true);
end;
$$;
revoke all on function public.vihem_kp_clone_version_content(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vihem_kp_clone_version_content(uuid, uuid) to service_role;

-- Nytt utkast: kopia av publicerad version (eller senaste). Bara ett utkast per kurs.
create or replace function public.vihem_kp_new_draft(p_course uuid, p_changelog text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.vihem_kp_courses%rowtype; v_src uuid; v_next integer; v_id uuid;
begin
  select * into c from public.vihem_kp_courses where id = p_course;
  if c.id is null or not public.vihem_kp_is_admin(c.organisation_id) then raise exception '[E_FORBIDDEN] Behörighet saknas.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kp_course:' || p_course::text, 0));
  if exists (select 1 from public.vihem_kp_course_versions where course_id = p_course and status = 'draft') then raise exception '[E_STATE] Det finns redan ett utkast för kursen.'; end if;
  select coalesce(c.published_version_id, (select id from public.vihem_kp_course_versions where course_id = p_course order by version desc limit 1)) into v_src;
  select coalesce(max(version), 0) + 1 into v_next from public.vihem_kp_course_versions where course_id = p_course;
  insert into public.vihem_kp_course_versions (organisation_id, course_id, version, status, changelog, created_by, sequential)
    values (c.organisation_id, p_course, v_next, 'draft', coalesce(p_changelog, ''), auth.uid(), coalesce((select sequential from public.vihem_kp_course_versions where id = v_src), false)) returning id into v_id;
  if v_src is not null then perform public.vihem_kp_clone_version_content(v_src, v_id); end if;
  return v_id;
end;
$$;

-- Publicera utkastet: validerar att kursen går att genomföra, fryser versionen och ersätter föregående.
create or replace function public.vihem_kp_publish_version(p_version uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.vihem_kp_course_versions%rowtype; c public.vihem_kp_courses%rowtype; n_lessons integer; n_final integer; v_bad integer; e record; v_pool integer;
begin
  select * into v from public.vihem_kp_course_versions where id = p_version for update;
  if v.id is null or not public.vihem_kp_is_admin(v.organisation_id) then raise exception '[E_FORBIDDEN] Behörighet saknas.'; end if;
  if v.status <> 'draft' then raise exception '[E_STATE] Bara utkast kan publiceras.'; end if;
  select * into c from public.vihem_kp_courses where id = v.course_id for update;
  select count(*) into n_lessons from public.vihem_kp_lessons where version_id = v.id;
  if c.delivery_form <> 'instructor_led' and n_lessons = 0 then raise exception '[E_INVALID] Kursen saknar lektioner.'; end if;
  select count(*) into n_final from public.vihem_kp_exams where version_id = v.id and kind = 'final';
  select count(*) into v_bad from public.vihem_kp_lessons l where l.version_id = v.id and not exists (select 1 from public.vihem_kp_modules m where m.id = l.module_id);
  if v_bad > 0 then raise exception '[E_INVALID] Lektion utan kapitel.'; end if;
  for e in select * from public.vihem_kp_exams where version_id = v.id loop
    select count(distinct q.id) into v_pool from public.vihem_kp_questions q
      where q.active and q.organisation_id = v.organisation_id
        and (q.id in (select question_id from public.vihem_kp_exam_questions where exam_id = e.id)
             or q.topic in (select topic from public.vihem_kp_exam_topic_rules where exam_id = e.id));
    if v_pool < e.question_count then raise exception '[E_INVALID] Provet "%" har för få aktiva frågor (% av % behövs).', e.title, v_pool, e.question_count; end if;
    if exists (select 1 from public.vihem_kp_exam_questions eq join public.vihem_kp_questions q on q.id = eq.question_id
                where eq.exam_id = e.id and not exists (select 1 from public.vihem_kp_question_options o where o.question_id = q.id and o.is_correct)) then
      raise exception '[E_INVALID] Prov "%" innehåller fråga utan rätt svar.', e.title;
    end if;
  end loop;
  if c.requires_identity_verification and n_final = 0 and c.delivery_form <> 'instructor_led' then raise exception '[E_INVALID] Kurser med identitetskrav behöver ett slutprov.'; end if;
  update public.vihem_kp_course_versions set status = 'retired' where course_id = v.course_id and status = 'published';
  update public.vihem_kp_course_versions set status = 'published', published_at = now(), published_by = auth.uid() where id = v.id;
  update public.vihem_kp_courses set published_version_id = v.id, status = case when status = 'archived' then 'archived' else 'published' end, updated_at = now() where id = v.course_id;
end;
$$;

create or replace function public.vihem_kp_duplicate_course(p_course uuid, p_code text, p_slug text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.vihem_kp_courses%rowtype; v_new uuid; v_ver uuid; v_src uuid;
begin
  select * into c from public.vihem_kp_courses where id = p_course;
  if c.id is null or not public.vihem_kp_is_admin(c.organisation_id) then raise exception '[E_FORBIDDEN] Behörighet saknas.'; end if;
  insert into public.vihem_kp_courses (organisation_id, code, slug, title, subtitle, summary, description, category, tags, delivery_form, language, target_audience, objectives, prerequisites, exam_info,
      estimated_minutes, validity_months, renewal_notice_days, requires_identity_verification, certificate_kind, id06_enabled, id06_competence_code, certificate_template_id, image_url, og_image_url, seo_title, seo_description, status, created_by)
    values (c.organisation_id, p_code, p_slug, c.title || ' (kopia)', c.subtitle, c.summary, c.description, c.category, c.tags, c.delivery_form, c.language, c.target_audience, c.objectives, c.prerequisites, c.exam_info,
      c.estimated_minutes, c.validity_months, c.renewal_notice_days, c.requires_identity_verification, c.certificate_kind, c.id06_enabled, c.id06_competence_code, c.certificate_template_id, c.image_url, c.og_image_url, c.seo_title, c.seo_description, 'draft', auth.uid())
    returning id into v_new;
  v_src := coalesce(c.published_version_id, (select id from public.vihem_kp_course_versions where course_id = p_course order by version desc limit 1));
  insert into public.vihem_kp_course_versions (organisation_id, course_id, version, status, created_by, sequential)
    values (c.organisation_id, v_new, 1, 'draft', auth.uid(), coalesce((select sequential from public.vihem_kp_course_versions where id = v_src), false)) returning id into v_ver;
  if v_src is not null then perform public.vihem_kp_clone_version_content(v_src, v_ver); end if;
  return v_new;
end;
$$;
revoke all on function public.vihem_kp_new_draft(uuid, text), public.vihem_kp_publish_version(uuid), public.vihem_kp_duplicate_course(uuid, text, text) from public, anon;
grant execute on function public.vihem_kp_new_draft(uuid, text), public.vihem_kp_publish_version(uuid), public.vihem_kp_duplicate_course(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- RLS: personal läser, administratör skriver (kataloginnehåll). Publika/lärande flöden går via edge-funktioner.
-- ---------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['vihem_kp_settings','vihem_kp_courses','vihem_kp_course_versions','vihem_kp_media_assets','vihem_kp_modules','vihem_kp_lessons','vihem_kp_lesson_blocks',
                           'vihem_kp_questions','vihem_kp_question_options','vihem_kp_exams','vihem_kp_exam_questions','vihem_kp_exam_topic_rules','vihem_kp_products','vihem_kp_bundle_items',
                           'vihem_kp_price_rules','vihem_kp_discount_codes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "KP staff read" on public.%I', t);
    execute format('create policy "KP staff read" on public.%I for select to authenticated using (public.vihem_kp_is_staff(organisation_id))', t);
    execute format('drop policy if exists "KP admin write" on public.%I', t);
    execute format('create policy "KP admin write" on public.%I for all to authenticated using (public.vihem_kp_is_admin(organisation_id)) with check (public.vihem_kp_is_admin(organisation_id))', t);
  end loop;
end $$;
-- Kursversioner skapas/publiceras bara via funktioner (aldrig direkt statusändring från klienten).
drop policy if exists "KP admin write" on public.vihem_kp_course_versions;
create policy "KP admin edit draft meta" on public.vihem_kp_course_versions for update to authenticated
  using (public.vihem_kp_is_admin(organisation_id) and status = 'draft') with check (public.vihem_kp_is_admin(organisation_id) and status = 'draft');
create policy "KP admin delete draft" on public.vihem_kp_course_versions for delete to authenticated using (public.vihem_kp_is_admin(organisation_id) and status = 'draft');

-- Lagring: publika bilder (katalog) och privat material (video/dokument/ljud/intyg). Privata filer nås bara via signerade URL:er från edge-funktioner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('vihem-kp-public', 'vihem-kp-public', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']),
  ('vihem-kp-private', 'vihem-kp-private', false, 2147483648, null)
on conflict (id) do nothing;

commit;
