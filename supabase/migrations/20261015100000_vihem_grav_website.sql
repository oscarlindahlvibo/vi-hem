-- Gräv & Allservice i Virserum AB: publik hemsida (gavirserum.se) med offertförfrågningar, administrerad från VI-HEM.
-- Additivt. Samma modell som vibofast.se / Ekängen: eget privat schema, publika RPC:er utan direkt tabellåtkomst,
-- formulärinlämning går via edge-funktionen vihem-grav-quote (service_role).
begin;

create schema if not exists vihem_grav_private;
revoke all on schema vihem_grav_private from public, anon, authenticated;

create table vihem_grav_private.site_content (
  id boolean primary key default true check (id),
  organisation_id uuid not null references public.vihem_organisations(id),
  content jsonb not null default '{}' check (jsonb_typeof(content) = 'object'),
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table vihem_grav_private.settings (
  id boolean primary key default true check (id),
  form_enabled boolean not null default true,
  confirm_customer boolean not null default true,
  notification_email text not null default '',
  sender_email text not null default '',
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table vihem_grav_private.quote_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id),
  reference text not null unique,
  name text not null,
  email text not null,
  phone text not null default '',
  location text not null default '',
  service text not null default '',
  message text not null,
  preferred_time text not null default '',
  images jsonb not null default '[]' check (jsonb_typeof(images) = 'array'),
  status text not null default 'new' check (status in ('new', 'contacted', 'quoted', 'won', 'lost', 'spam')),
  internal_note text not null default '',
  fingerprint text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vihem_grav_requests_created_idx on vihem_grav_private.quote_requests (created_at desc);
create index vihem_grav_requests_fp_idx on vihem_grav_private.quote_requests (fingerprint, created_at);

alter table vihem_grav_private.site_content enable row level security;
alter table vihem_grav_private.settings enable row level security;
alter table vihem_grav_private.quote_requests enable row level security;

-- ── Behörighet: aktiva admins i den bundna organisationen ────────────────────
create function public.vihem_grav_is_editor() returns boolean language sql stable security definer
set search_path = '' as $$
  select exists(select 1 from public.vihem_profiles p
    join vihem_grav_private.site_content c on c.organisation_id = p.organisation_id
    where p.id = (select auth.uid()) and p.active and p.role = 'admin');
$$;
revoke all on function public.vihem_grav_is_editor() from public, anon;
grant execute on function public.vihem_grav_is_editor() to authenticated;

-- ── Publikt innehåll ─────────────────────────────────────────────────────────
create function public.vihem_grav_public_site() returns jsonb language sql stable security definer
set search_path = '' as $$
  select jsonb_build_object(
    'content', coalesce((select content from vihem_grav_private.site_content where id), '{}'::jsonb),
    'settings', (select jsonb_build_object('formEnabled', s.form_enabled) from vihem_grav_private.settings s where s.id));
$$;
revoke all on function public.vihem_grav_public_site() from public;
grant execute on function public.vihem_grav_public_site() to anon, authenticated;

-- ── Admin: läsning ───────────────────────────────────────────────────────────
create function public.vihem_grav_admin_site() returns jsonb language plpgsql stable security definer
set search_path = '' as $$
begin
  if not public.vihem_grav_is_editor() then raise exception 'Forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'content', (select to_jsonb(c) from vihem_grav_private.site_content c where id),
    'settings', (select to_jsonb(s) from vihem_grav_private.settings s where id),
    'counts', (select jsonb_object_agg(status, n) from (select status, count(*) n from vihem_grav_private.quote_requests group by status) x));
end;
$$;
revoke all on function public.vihem_grav_admin_site() from public, anon;
grant execute on function public.vihem_grav_admin_site() to authenticated;

create function public.vihem_grav_admin_requests() returns jsonb language plpgsql stable security definer
set search_path = '' as $$
begin
  if not public.vihem_grav_is_editor() then raise exception 'Forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'reference', r.reference, 'name', r.name, 'email', r.email, 'phone', r.phone, 'location', r.location,
      'service', r.service, 'message', r.message, 'preferred_time', r.preferred_time, 'images', r.images,
      'status', r.status, 'internal_note', r.internal_note, 'created_at', r.created_at, 'updated_at', r.updated_at
    ) order by r.created_at desc) from vihem_grav_private.quote_requests r), '[]'::jsonb);
end;
$$;
revoke all on function public.vihem_grav_admin_requests() from public, anon;
grant execute on function public.vihem_grav_admin_requests() to authenticated;

-- ── Admin: skrivning ─────────────────────────────────────────────────────────
create function public.vihem_grav_save_content(p_content jsonb, p_revision bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare new_revision bigint;
begin
  if not public.vihem_grav_is_editor() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_content->'company') is distinct from 'object'
     or jsonb_typeof(p_content->'services') is distinct from 'array'
     or jsonb_typeof(p_content->'text') is distinct from 'object' then
    raise exception 'Invalid content' using errcode = '22023';
  end if;
  update vihem_grav_private.site_content set content = p_content, revision = revision + 1, updated_at = now()
    where id and revision = p_revision returning revision into new_revision;
  if new_revision is null then raise exception 'Conflict' using errcode = '40001'; end if;
  return new_revision;
end;
$$;
revoke all on function public.vihem_grav_save_content(jsonb, bigint) from public, anon;
grant execute on function public.vihem_grav_save_content(jsonb, bigint) to authenticated;

create function public.vihem_grav_save_settings(p_settings jsonb, p_revision bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare new_revision bigint;
begin
  if not public.vihem_grav_is_editor() then raise exception 'Forbidden' using errcode = '42501'; end if;
  update vihem_grav_private.settings set
    form_enabled = coalesce((p_settings->>'form_enabled')::boolean, form_enabled),
    confirm_customer = coalesce((p_settings->>'confirm_customer')::boolean, confirm_customer),
    notification_email = coalesce(p_settings->>'notification_email', notification_email),
    sender_email = coalesce(p_settings->>'sender_email', sender_email),
    revision = revision + 1, updated_at = now()
  where id and revision = p_revision returning revision into new_revision;
  if new_revision is null then raise exception 'Conflict' using errcode = '40001'; end if;
  return new_revision;
end;
$$;
revoke all on function public.vihem_grav_save_settings(jsonb, bigint) from public, anon;
grant execute on function public.vihem_grav_save_settings(jsonb, bigint) to authenticated;

create function public.vihem_grav_update_request(p_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.vihem_grav_is_editor() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_status not in ('new', 'contacted', 'quoted', 'won', 'lost', 'spam') then raise exception 'Invalid status' using errcode = '22023'; end if;
  update vihem_grav_private.quote_requests set status = p_status, internal_note = left(coalesce(p_note, ''), 4000), updated_at = now() where id = p_id;
end;
$$;
revoke all on function public.vihem_grav_update_request(uuid, text, text) from public, anon;
grant execute on function public.vihem_grav_update_request(uuid, text, text) to authenticated;

-- Radering (GDPR): returnerar bildernas sökvägar så att klienten kan ta bort filerna ur lagringen.
create function public.vihem_grav_delete_request(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_images jsonb;
begin
  if not public.vihem_grav_is_editor() then raise exception 'Forbidden' using errcode = '42501'; end if;
  delete from vihem_grav_private.quote_requests where id = p_id returning images into v_images;
  return coalesce(v_images, '[]'::jsonb);
end;
$$;
revoke all on function public.vihem_grav_delete_request(uuid) from public, anon;
grant execute on function public.vihem_grav_delete_request(uuid) to authenticated;

-- ── Service-RPC:er för edge-funktionen (endast service_role) ─────────────────
create function public.vihem_grav_service_context() returns jsonb language sql stable security definer
set search_path = '' as $$
  select jsonb_build_object('organisation_id', c.organisation_id, 'settings', to_jsonb(s),
    'company_name', coalesce(c.content->'company'->>'name', 'Gräv & Allservice i Virserum AB'))
  from vihem_grav_private.site_content c, vihem_grav_private.settings s where c.id and s.id;
$$;
revoke all on function public.vihem_grav_service_context() from public, anon, authenticated;
grant execute on function public.vihem_grav_service_context() to service_role;

create function public.vihem_grav_store_request(
  p_reference text, p_name text, p_email text, p_phone text, p_location text, p_service text, p_message text,
  p_preferred_time text, p_images jsonb, p_fingerprint text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_id uuid;
begin
  select organisation_id into v_org from vihem_grav_private.site_content where id;
  if v_org is null then raise exception 'Not configured'; end if;
  -- Skydd mot översvämning: högst 5 förfrågningar per avsändare och timme, och 200 per dygn totalt.
  if (select count(*) from vihem_grav_private.quote_requests where fingerprint = p_fingerprint and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from vihem_grav_private.quote_requests where created_at > now() - interval '1 day') >= 200 then
    raise exception 'Rate limit exceeded';
  end if;
  insert into vihem_grav_private.quote_requests(organisation_id, reference, name, email, phone, location, service, message, preferred_time, images, fingerprint)
    values (v_org, p_reference, p_name, p_email, coalesce(p_phone, ''), coalesce(p_location, ''), coalesce(p_service, ''), p_message,
      coalesce(p_preferred_time, ''), coalesce(p_images, '[]'::jsonb), coalesce(p_fingerprint, ''))
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.vihem_grav_store_request(text, text, text, text, text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.vihem_grav_store_request(text, text, text, text, text, text, text, text, jsonb, text) to service_role;

-- ── Lagring ──────────────────────────────────────────────────────────────────
-- Publika bilder (galleri/start): läsning för alla, skrivning bara för editors.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('vihem-grav-images', 'vihem-grav-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "Grav public images" on storage.objects for select to anon, authenticated using (bucket_id = 'vihem-grav-images');
create policy "Grav editor image insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'vihem-grav-images' and public.vihem_grav_is_editor());
create policy "Grav editor image update" on storage.objects for update to authenticated
  using (bucket_id = 'vihem-grav-images' and public.vihem_grav_is_editor())
  with check (bucket_id = 'vihem-grav-images' and public.vihem_grav_is_editor());
create policy "Grav editor image delete" on storage.objects for delete to authenticated
  using (bucket_id = 'vihem-grav-images' and public.vihem_grav_is_editor());

-- Kundernas bifogade bilder: privat bucket. Edge-funktionen skriver (service_role); bara editors får läsa/ta bort.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('vihem-grav-requests', 'vihem-grav-requests', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "Grav editor reads request images" on storage.objects for select to authenticated
  using (bucket_id = 'vihem-grav-requests' and public.vihem_grav_is_editor());
create policy "Grav editor deletes request images" on storage.objects for delete to authenticated
  using (bucket_id = 'vihem-grav-requests' and public.vihem_grav_is_editor());

-- ── Startdata ────────────────────────────────────────────────────────────────
-- OBS: texterna är neutrala platshållare utan påståenden om företaget; de redigeras i VI-HEM innan sajten lanseras.
insert into vihem_grav_private.site_content(id, organisation_id, content)
select true, o.id, jsonb_build_object(
  'company', jsonb_build_object(
    'name', 'Gräv & Allservice i Virserum AB', 'tagline', 'Grävning och allservice i Virserum med omnejd',
    'phone', '0495-76 60 65', 'email', 'kontakt@gavirserum.se', 'city', 'Virserum', 'address', '', 'postalCode', '', 'orgNumber', '',
    'openingHours', '', 'serviceArea', 'Virserum med omnejd'),
  'text', jsonb_build_object(
    'heroTitle', 'Grävning och allservice i Virserum',
    'heroText', 'Berätta vad du behöver hjälp med så återkommer vi med en offert.',
    'aboutTitle', 'Om oss',
    'aboutText', 'Fyll i en presentation av företaget under Hemsida i VI-HEM.',
    'quoteIntro', 'Beskriv jobbet så gott du kan, gärna med bilder, så återkommer vi med offert eller frågor.',
    'quoteThanks', 'Tack! Vi har tagit emot din förfrågan och återkommer så snart vi kan.',
    'privacy', 'Vi använder de uppgifter du lämnar i formuläret för att kunna svara på din förfrågan och lämna offert. Uppgifterna sparas så länge det behövs för ärendet och delas inte med någon annan. Du kan när som helst be oss ta bort dina uppgifter genom att kontakta oss.'),
  'services', jsonb_build_array(
    jsonb_build_object('title', 'Grävarbeten', 'description', 'Fyll i vilka grävarbeten ni utför under Hemsida i VI-HEM.', 'icon', 'shovel'),
    jsonb_build_object('title', 'Markarbeten', 'description', 'Fyll i vilka markarbeten ni utför under Hemsida i VI-HEM.', 'icon', 'mountain'),
    jsonb_build_object('title', 'Allservice', 'description', 'Fyll i vilken service och vilka hjälpinsatser ni erbjuder under Hemsida i VI-HEM.', 'icon', 'wrench')),
  'faq', '[]'::jsonb,
  'images', jsonb_build_object('hero', '', 'about', '', 'gallery', '[]'::jsonb))
from public.vihem_organisations o where o.id = '38fe702d-e72c-49a2-9750-5e0b6934959b'
on conflict (id) do nothing;

insert into vihem_grav_private.settings(id) values (true) on conflict (id) do nothing;

commit;
