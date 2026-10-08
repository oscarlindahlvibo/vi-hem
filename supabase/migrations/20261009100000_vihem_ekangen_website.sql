-- Ekängens vandrarhem: publik hemsida + direktbokning, administrerad från VI-HEM.
-- Additivt. Samma modell som vibofast.se: eget privat schema, publika RPC-funktioner utan direkt tabellåtkomst.
-- Bokningar och priser läses från befintliga korttidstabeller (vihem_short_stay_*); inget av dem ändras.
begin;

create schema if not exists vihem_ekangen_private;
revoke all on schema vihem_ekangen_private from public, anon, authenticated;

-- ── Innehåll (företagsuppgifter, texter, vanliga frågor) ─────────────────────
create table vihem_ekangen_private.site_content (
  id boolean primary key default true check (id),
  organisation_id uuid not null references public.vihem_organisations(id),
  content jsonb not null default '{}' check (jsonb_typeof(content) = 'object'),
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

-- ── Inställningar för direktbokning ──────────────────────────────────────────
create table vihem_ekangen_private.settings (
  id boolean primary key default true check (id),
  booking_enabled boolean not null default false,
  discount_percent numeric(5,2) not null default 8 check (discount_percent >= 0 and discount_percent <= 50),
  free_cancel_days integer not null default 7 check (free_cancel_days >= 0 and free_cancel_days <= 365),
  hold_minutes integer not null default 30 check (hold_minutes between 15 and 120),
  min_nights integer not null default 1 check (min_nights >= 1),
  max_nights integer not null default 30 check (max_nights >= 1),
  check_in_time text not null default '15:00',
  check_out_time text not null default '11:00',
  notification_email text not null default '',
  sender_email text not null default '',
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

-- ── Vilka enheter som visas, och deras annonstext/bilder ─────────────────────
create table vihem_ekangen_private.unit_listings (
  unit_id uuid primary key references public.vihem_short_stay_units(id) on delete cascade,
  published boolean not null default false,
  sort_order integer not null default 0,
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  check (not published or (
    coalesce(length(payload->>'title'), 0) > 0
    and coalesce(length(payload->>'description'), 0) > 0
    and jsonb_typeof(payload->'images') = 'array' and jsonb_array_length(payload->'images') > 0
  ) is true)
);

-- ── Direktbokningar (från betalning påbörjas tills de blivit korttidsbokningar) ──
create table vihem_ekangen_private.bookings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id),
  unit_id uuid not null references public.vihem_short_stay_units(id),
  reference text not null unique,
  access_token text not null,
  start_date date not null,
  end_date date not null,
  guests integer not null check (guests >= 1),
  guest_name text not null,
  guest_email text not null,
  guest_phone text not null default '',
  message text not null default '',
  currency text not null default 'SEK',
  base_total numeric(12,2) not null,
  discount_percent numeric(5,2) not null default 0,
  total numeric(12,2) not null check (total > 0),
  price_breakdown jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','paid','expired','cancelled','refunded','conflict')),
  stripe_session_id text,
  stripe_payment_intent text,
  short_stay_booking_id uuid references public.vihem_short_stay_bookings(id) on delete set null,
  free_cancel_until date,
  expires_at timestamptz not null,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date > start_date)
);
create index vihem_ekangen_bookings_hold_idx on vihem_ekangen_private.bookings (unit_id, start_date, end_date) where status in ('pending', 'paid');
create unique index vihem_ekangen_bookings_session_idx on vihem_ekangen_private.bookings (stripe_session_id) where stripe_session_id is not null;

alter table vihem_ekangen_private.site_content enable row level security;
alter table vihem_ekangen_private.settings enable row level security;
alter table vihem_ekangen_private.unit_listings enable row level security;
alter table vihem_ekangen_private.bookings enable row level security;

-- ── Behörighet: aktiva admins i den bundna organisationen ────────────────────
create function public.vihem_ekangen_is_editor() returns boolean language sql stable security definer
set search_path = '' as $$
  select exists(select 1 from public.vihem_profiles p
    join vihem_ekangen_private.site_content c on c.organisation_id = p.organisation_id
    where p.id = (select auth.uid()) and p.active and p.role = 'admin');
$$;
revoke all on function public.vihem_ekangen_is_editor() from public, anon;
grant execute on function public.vihem_ekangen_is_editor() to authenticated;

-- ── Publikt innehåll (anon): bara fält som får visas ─────────────────────────
create function public.vihem_ekangen_public_site() returns jsonb language sql stable security definer
set search_path = '' as $$
  select jsonb_build_object(
    'content', coalesce((select content from vihem_ekangen_private.site_content where id), '{}'::jsonb),
    'settings', (select jsonb_build_object(
        'bookingEnabled', s.booking_enabled, 'discountPercent', s.discount_percent,
        'freeCancelDays', s.free_cancel_days, 'minNights', s.min_nights, 'maxNights', s.max_nights,
        'checkInTime', s.check_in_time, 'checkOutTime', s.check_out_time)
      from vihem_ekangen_private.settings s where s.id),
    'units', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.unit_id, 'maxGuests', u.max_guests, 'sortOrder', l.sort_order,
        'title', l.payload->>'title', 'slug', coalesce(nullif(l.payload->>'slug', ''), l.unit_id::text),
        'kind', coalesce(l.payload->>'kind', 'room'),
        'shortDescription', coalesce(l.payload->>'shortDescription', ''), 'description', l.payload->>'description',
        'features', coalesce(l.payload->'features', '[]'::jsonb), 'images', l.payload->'images',
        'beds', coalesce(l.payload->>'beds', '')
      ) order by l.sort_order, u.name)
      from vihem_ekangen_private.unit_listings l
      join public.vihem_short_stay_units u on u.id = l.unit_id
      join vihem_ekangen_private.site_content c on c.organisation_id = u.organisation_id
      where l.published and u.is_active), '[]'::jsonb));
$$;
revoke all on function public.vihem_ekangen_public_site() from public;
grant execute on function public.vihem_ekangen_public_site() to anon, authenticated;

-- ── Admin-läsning ────────────────────────────────────────────────────────────
create function public.vihem_ekangen_admin_site() returns jsonb language plpgsql stable security definer
set search_path = '' as $$
begin
  if not public.vihem_ekangen_is_editor() then raise exception 'Forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'content', (select to_jsonb(c) from vihem_ekangen_private.site_content c where id),
    'settings', (select to_jsonb(s) from vihem_ekangen_private.settings s where id),
    'units', coalesce((select jsonb_agg(jsonb_build_object(
        'unit_id', u.id, 'name', u.name, 'max_guests', u.max_guests, 'is_active', u.is_active,
        'published', coalesce(l.published, false), 'sort_order', coalesce(l.sort_order, 0),
        'payload', coalesce(l.payload, '{}'::jsonb), 'revision', coalesce(l.revision, 0),
        'has_prices', exists(select 1 from public.vihem_short_stay_rates r where r.unit_id = u.id)
      ) order by coalesce(l.sort_order, 0), u.name)
      from public.vihem_short_stay_units u
      join vihem_ekangen_private.site_content c on c.organisation_id = u.organisation_id
      left join vihem_ekangen_private.unit_listings l on l.unit_id = u.id), '[]'::jsonb));
end;
$$;
revoke all on function public.vihem_ekangen_admin_site() from public, anon;
grant execute on function public.vihem_ekangen_admin_site() to authenticated;

-- ── Admin-skrivning (med revisionskontroll mot samtidiga ändringar) ──────────
create function public.vihem_ekangen_save_content(p_content jsonb, p_revision bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare new_revision bigint;
begin
  if not public.vihem_ekangen_is_editor() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_content->'company') is distinct from 'object'
     or jsonb_typeof(p_content->'faq') is distinct from 'array'
     or jsonb_typeof(p_content->'text') is distinct from 'object' then
    raise exception 'Invalid content' using errcode = '22023';
  end if;
  update vihem_ekangen_private.site_content set content = p_content, revision = revision + 1, updated_at = now()
    where id and revision = p_revision returning revision into new_revision;
  if new_revision is null then raise exception 'Conflict' using errcode = '40001'; end if;
  return new_revision;
end;
$$;
revoke all on function public.vihem_ekangen_save_content(jsonb, bigint) from public, anon;
grant execute on function public.vihem_ekangen_save_content(jsonb, bigint) to authenticated;

create function public.vihem_ekangen_save_settings(p_settings jsonb, p_revision bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare new_revision bigint;
begin
  if not public.vihem_ekangen_is_editor() then raise exception 'Forbidden' using errcode = '42501'; end if;
  update vihem_ekangen_private.settings set
    booking_enabled = coalesce((p_settings->>'booking_enabled')::boolean, booking_enabled),
    discount_percent = coalesce((p_settings->>'discount_percent')::numeric, discount_percent),
    free_cancel_days = coalesce((p_settings->>'free_cancel_days')::integer, free_cancel_days),
    hold_minutes = coalesce((p_settings->>'hold_minutes')::integer, hold_minutes),
    min_nights = coalesce((p_settings->>'min_nights')::integer, min_nights),
    max_nights = coalesce((p_settings->>'max_nights')::integer, max_nights),
    check_in_time = coalesce(nullif(p_settings->>'check_in_time', ''), check_in_time),
    check_out_time = coalesce(nullif(p_settings->>'check_out_time', ''), check_out_time),
    notification_email = coalesce(p_settings->>'notification_email', notification_email),
    sender_email = coalesce(p_settings->>'sender_email', sender_email),
    revision = revision + 1, updated_at = now()
  where id and revision = p_revision returning revision into new_revision;
  if new_revision is null then raise exception 'Conflict' using errcode = '40001'; end if;
  return new_revision;
end;
$$;
revoke all on function public.vihem_ekangen_save_settings(jsonb, bigint) from public, anon;
grant execute on function public.vihem_ekangen_save_settings(jsonb, bigint) to authenticated;

create function public.vihem_ekangen_save_unit(p_unit_id uuid, p_published boolean, p_payload jsonb, p_sort integer, p_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare new_revision bigint;
begin
  if not public.vihem_ekangen_is_editor() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid payload' using errcode = '22023'; end if;
  if not exists(select 1 from public.vihem_short_stay_units u
      join vihem_ekangen_private.site_content c on c.organisation_id = u.organisation_id where u.id = p_unit_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_published and not exists(select 1 from public.vihem_short_stay_rates r where r.unit_id = p_unit_id) then
    raise exception 'Missing prices' using errcode = '22023';
  end if;
  if p_revision = 0 then
    insert into vihem_ekangen_private.unit_listings(unit_id, published, sort_order, payload)
      values (p_unit_id, p_published, coalesce(p_sort, 0), p_payload)
      on conflict (unit_id) do nothing returning revision into new_revision;
  else
    update vihem_ekangen_private.unit_listings set published = p_published, sort_order = coalesce(p_sort, 0), payload = p_payload,
      revision = revision + 1, updated_at = now()
      where unit_id = p_unit_id and revision = p_revision returning revision into new_revision;
  end if;
  if new_revision is null then raise exception 'Conflict' using errcode = '40001'; end if;
  return new_revision;
end;
$$;
revoke all on function public.vihem_ekangen_save_unit(uuid, boolean, jsonb, integer, bigint) from public, anon;
grant execute on function public.vihem_ekangen_save_unit(uuid, boolean, jsonb, integer, bigint) to authenticated;

-- ── Bokningslista för admin ──────────────────────────────────────────────────
create function public.vihem_ekangen_admin_bookings() returns jsonb language plpgsql stable security definer
set search_path = '' as $$
begin
  if not public.vihem_ekangen_is_editor() then raise exception 'Forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'reference', b.reference, 'unit', u.name, 'start_date', b.start_date, 'end_date', b.end_date,
      'guests', b.guests, 'guest_name', b.guest_name, 'guest_email', b.guest_email, 'guest_phone', b.guest_phone,
      'message', b.message, 'total', b.total, 'currency', b.currency, 'status', b.status,
      'free_cancel_until', b.free_cancel_until, 'paid_at', b.paid_at, 'created_at', b.created_at,
      'short_stay_booking_id', b.short_stay_booking_id
    ) order by b.created_at desc)
    from vihem_ekangen_private.bookings b join public.vihem_short_stay_units u on u.id = b.unit_id), '[]'::jsonb);
end;
$$;
revoke all on function public.vihem_ekangen_admin_bookings() from public, anon;
grant execute on function public.vihem_ekangen_admin_bookings() to authenticated;


-- ── Atomiska bokningsfunktioner (bara service_role: anropas av edge-funktionerna) ──
create function public.vihem_ekangen_create_hold(
  p_unit_id uuid, p_start date, p_end date, p_guests integer, p_name text, p_email text, p_phone text, p_message text,
  p_base_total numeric, p_discount_percent numeric, p_total numeric, p_breakdown jsonb, p_reference text, p_token text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_settings vihem_ekangen_private.settings%rowtype;
  v_unit public.vihem_short_stay_units%rowtype;
  v_id uuid;
begin
  select * into v_settings from vihem_ekangen_private.settings where id;
  if not found or not v_settings.booking_enabled then raise exception 'booking_disabled' using errcode = 'P0001'; end if;
  select u.* into v_unit from public.vihem_short_stay_units u
    join vihem_ekangen_private.unit_listings l on l.unit_id = u.id and l.published
    join vihem_ekangen_private.site_content c on c.organisation_id = u.organisation_id
    where u.id = p_unit_id and u.is_active;
  if not found then raise exception 'unit_unavailable' using errcode = 'P0001'; end if;
  if p_guests > v_unit.max_guests then raise exception 'too_many_guests' using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(hashtext('ekangen:' || p_unit_id::text));

  if exists(select 1 from public.vihem_short_stay_bookings b
      where b.unit_id = p_unit_id and b.start_date < p_end and b.end_date > p_start)
     or exists(select 1 from vihem_ekangen_private.bookings h
      where h.unit_id = p_unit_id and h.start_date < p_end and h.end_date > p_start
        and (h.status = 'paid' or (h.status = 'pending' and h.expires_at > now()))) then
    raise exception 'dates_unavailable' using errcode = 'P0001';
  end if;

  -- Skydd mot att spärra lagret: högst 3 olösta betalningar per e-postadress och timme, 40 totalt.
  if (select count(*) from vihem_ekangen_private.bookings h where h.status = 'pending' and h.expires_at > now()
        and lower(h.guest_email) = lower(p_email) and h.created_at > now() - interval '1 hour') >= 3
     or (select count(*) from vihem_ekangen_private.bookings h where h.status = 'pending' and h.expires_at > now()) >= 40 then
    raise exception 'too_many_pending' using errcode = 'P0001';
  end if;

  insert into vihem_ekangen_private.bookings(organisation_id, unit_id, reference, access_token, start_date, end_date, guests,
      guest_name, guest_email, guest_phone, message, base_total, discount_percent, total, price_breakdown,
      free_cancel_until, expires_at)
    values (v_unit.organisation_id, p_unit_id, p_reference, p_token, p_start, p_end, p_guests,
      p_name, p_email, coalesce(p_phone, ''), coalesce(p_message, ''), p_base_total, p_discount_percent, p_total, coalesce(p_breakdown, '{}'),
      p_start - v_settings.free_cancel_days, now() + make_interval(mins => greatest(v_settings.hold_minutes, 30) + 2))
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.vihem_ekangen_create_hold(uuid, date, date, integer, text, text, text, text, numeric, numeric, numeric, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.vihem_ekangen_create_hold(uuid, date, date, integer, text, text, text, text, numeric, numeric, numeric, jsonb, text, text) to service_role;

-- Markera betald och skapa korttidsbokningen. Idempotent (webhooks kan komma flera gånger).
create function public.vihem_ekangen_complete_booking(p_session_id text, p_payment_intent text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b vihem_ekangen_private.bookings%rowtype;
  v_settings vihem_ekangen_private.settings%rowtype;
  v_unit public.vihem_short_stay_units%rowtype;
  v_ss uuid;
begin
  select * into b from vihem_ekangen_private.bookings where stripe_session_id = p_session_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if b.status = 'paid' then return jsonb_build_object('status', 'paid', 'booking_id', b.id, 'short_stay_booking_id', b.short_stay_booking_id, 'already', true); end if;
  if b.status in ('conflict', 'refunded', 'cancelled') then return jsonb_build_object('status', b.status, 'booking_id', b.id); end if;

  perform pg_advisory_xact_lock(hashtext('ekangen:' || b.unit_id::text));
  select * into v_settings from vihem_ekangen_private.settings where id;
  select * into v_unit from public.vihem_short_stay_units where id = b.unit_id;

  -- Pengarna är redan dragna. Hann någon annan ta datumen (t.ex. via en kanal) flaggas bokningen för manuell hantering/återbetalning.
  if exists(select 1 from public.vihem_short_stay_bookings x
      where x.unit_id = b.unit_id and x.start_date < b.end_date and x.end_date > b.start_date)
     or exists(select 1 from vihem_ekangen_private.bookings h
      where h.id <> b.id and h.unit_id = b.unit_id and h.start_date < b.end_date and h.end_date > b.start_date and h.status = 'paid') then
    update vihem_ekangen_private.bookings set status = 'conflict', stripe_payment_intent = p_payment_intent, paid_at = now() where id = b.id;
    return jsonb_build_object('status', 'conflict', 'booking_id', b.id);
  end if;

  insert into public.vihem_short_stay_bookings(organisation_id, unit_id, external_uid, channel_name, title, description, start_date, end_date,
      is_manual, booking_type, guest_name, guest_email, guest_phone, guest_count, payment_status, notes,
      arrival_time, departure_time, total_price, paid_amount, balance_due, currency, price_breakdown, source_payload)
    values (b.organisation_id, b.unit_id, 'ekangen:' || b.reference, 'VI-HEM', b.guest_name, b.message, b.start_date, b.end_date,
      true, 'booking', b.guest_name, b.guest_email, b.guest_phone, b.guests, 'paid',
      'Direktbokning via hemsidan (' || b.reference || ')',
      nullif(v_settings.check_in_time, '')::time, nullif(v_settings.check_out_time, '')::time,
      b.total, b.total, 0, b.currency, b.price_breakdown,
      jsonb_build_object('source', 'ekangen-website', 'reference', b.reference))
    returning id into v_ss;

  update vihem_ekangen_private.bookings set status = 'paid', paid_at = now(), stripe_payment_intent = p_payment_intent, short_stay_booking_id = v_ss where id = b.id;
  return jsonb_build_object('status', 'paid', 'booking_id', b.id, 'short_stay_booking_id', v_ss);
end;
$$;
revoke all on function public.vihem_ekangen_complete_booking(text, text) from public, anon, authenticated;
grant execute on function public.vihem_ekangen_complete_booking(text, text) to service_role;


-- ── Service-RPC:er för edge-funktionerna (privata tabeller nås inte via PostgREST) ──
create function public.vihem_ekangen_service_context() returns jsonb language sql stable security definer
set search_path = '' as $$
  select jsonb_build_object(
    'organisation_id', c.organisation_id,
    'settings', to_jsonb(s),
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'max_guests', u.max_guests,
        'title', l.payload->>'title', 'beds24_enabled', u.beds24_enabled, 'beds24_room_id', u.beds24_room_id))
      from vihem_ekangen_private.unit_listings l join public.vihem_short_stay_units u on u.id = l.unit_id
      where l.published and u.is_active), '[]'::jsonb))
  from vihem_ekangen_private.site_content c, vihem_ekangen_private.settings s where c.id and s.id;
$$;
revoke all on function public.vihem_ekangen_service_context() from public, anon, authenticated;
grant execute on function public.vihem_ekangen_service_context() to service_role;

create function public.vihem_ekangen_taken_units(p_start date, p_end date) returns uuid[] language sql stable security definer
set search_path = '' as $$
  select coalesce(array_agg(distinct x.unit_id), '{}') from (
    select b.unit_id from public.vihem_short_stay_bookings b where b.start_date < p_end and b.end_date > p_start
    union all
    select h.unit_id from vihem_ekangen_private.bookings h where h.start_date < p_end and h.end_date > p_start
      and (h.status = 'paid' or (h.status = 'pending' and h.expires_at > now()))
  ) x;
$$;
revoke all on function public.vihem_ekangen_taken_units(date, date) from public, anon, authenticated;
grant execute on function public.vihem_ekangen_taken_units(date, date) to service_role;

create function public.vihem_ekangen_booking_by_ref(p_reference text) returns jsonb language sql stable security definer
set search_path = '' as $$
  select to_jsonb(b) || jsonb_build_object('unit_name', u.name, 'unit_title', l.payload->>'title')
  from vihem_ekangen_private.bookings b
  join public.vihem_short_stay_units u on u.id = b.unit_id
  left join vihem_ekangen_private.unit_listings l on l.unit_id = b.unit_id
  where b.reference = p_reference;
$$;
revoke all on function public.vihem_ekangen_booking_by_ref(text) from public, anon, authenticated;
grant execute on function public.vihem_ekangen_booking_by_ref(text) to service_role;

create function public.vihem_ekangen_attach_session(p_booking_id uuid, p_session_id text) returns void language sql security definer
set search_path = '' as $$
  update vihem_ekangen_private.bookings set stripe_session_id = p_session_id where id = p_booking_id and status = 'pending';
$$;
revoke all on function public.vihem_ekangen_attach_session(uuid, text) from public, anon, authenticated;
grant execute on function public.vihem_ekangen_attach_session(uuid, text) to service_role;

-- Sätter status; avbokning/återbetalning tar även bort den skapade korttidsbokningen så att datumen blir lediga.
create function public.vihem_ekangen_set_status(p_booking_id uuid, p_status text) returns void language plpgsql security definer
set search_path = '' as $$
declare v_ss uuid;
begin
  if p_status not in ('expired', 'cancelled', 'refunded') then raise exception 'invalid status' using errcode = '22023'; end if;
  update vihem_ekangen_private.bookings set status = p_status,
      cancelled_at = case when p_status in ('cancelled', 'refunded') then now() else cancelled_at end
    where id = p_booking_id and status in ('pending', 'paid', 'conflict') returning short_stay_booking_id into v_ss;
  if v_ss is not null and p_status in ('cancelled', 'refunded') then
    delete from public.vihem_short_stay_bookings where id = v_ss;
  end if;
end;
$$;
revoke all on function public.vihem_ekangen_set_status(uuid, text) from public, anon, authenticated;
grant execute on function public.vihem_ekangen_set_status(uuid, text) to service_role;

create function public.vihem_ekangen_by_session(p_session_id text) returns jsonb language sql stable security definer
set search_path = '' as $$
  select to_jsonb(b) from vihem_ekangen_private.bookings b where b.stripe_session_id = p_session_id;
$$;
revoke all on function public.vihem_ekangen_by_session(text) from public, anon, authenticated;
grant execute on function public.vihem_ekangen_by_session(text) to service_role;

create function public.vihem_ekangen_by_payment_intent(p_intent text) returns jsonb language sql stable security definer
set search_path = '' as $$
  select to_jsonb(b) from vihem_ekangen_private.bookings b where b.stripe_payment_intent = p_intent;
$$;
revoke all on function public.vihem_ekangen_by_payment_intent(text) from public, anon, authenticated;
grant execute on function public.vihem_ekangen_by_payment_intent(text) to service_role;

-- ── Bildbucket (publik läsning, skrivning bara för editors) ──────────────────
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('vihem-ekangen-images', 'vihem-ekangen-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "Ekangen public images" on storage.objects for select to anon, authenticated using (bucket_id = 'vihem-ekangen-images');
create policy "Ekangen editor image insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'vihem-ekangen-images' and public.vihem_ekangen_is_editor());
create policy "Ekangen editor image update" on storage.objects for update to authenticated
  using (bucket_id = 'vihem-ekangen-images' and public.vihem_ekangen_is_editor())
  with check (bucket_id = 'vihem-ekangen-images' and public.vihem_ekangen_is_editor());
create policy "Ekangen editor image delete" on storage.objects for delete to authenticated
  using (bucket_id = 'vihem-ekangen-images' and public.vihem_ekangen_is_editor());

-- ── Startdata: bind Vibogruppen AB och lägg in redigerbart startinnehåll ─────
insert into vihem_ekangen_private.site_content(id, organisation_id, content)
select true, o.id, jsonb_build_object(
  'company', jsonb_build_object(
    'name', 'Ekängens vandrarhem', 'tagline', 'Enkelt och prisvärt boende i Virserum',
    'address', 'Ekängsvägen 1', 'postalCode', '577 71', 'city', 'Virserum',
    'phone', '', 'email', '', 'checkInInfo', 'Incheckning från 15:00. Utcheckning senast 11:00.'),
  'text', jsonb_build_object(
    'heroTitle', 'Välkommen till Ekängens vandrarhem',
    'heroText', 'Boka direkt hos oss och få ett lägre pris än på bokningssajterna.',
    'aboutTitle', 'Om vandrarhemmet',
    'aboutText', 'Fyll i en presentation av vandrarhemmet under Hemsida i VI-HEM.',
    'bookingIntro', 'Välj datum och antal gäster så visar vi lediga rum med direktpris.',
    'terms', 'Fyll i bokningsvillkor under Hemsida i VI-HEM.'),
  'faq', jsonb_build_array(
    jsonb_build_object('category', 'Bokning', 'question', 'Varför är det billigare att boka direkt?',
      'answer', 'Vi slipper provisionen till bokningssajterna och ger dig mellanskillnaden som rabatt.'),
    jsonb_build_object('category', 'Bokning', 'question', 'Kan jag avboka?',
      'answer', 'Avbokningsreglerna visas när du bokar. Fyll i detaljerna under Hemsida i VI-HEM.'),
    jsonb_build_object('category', 'Under vistelsen', 'question', 'När kan jag checka in och ut?',
      'answer', 'Incheckning från 15:00 och utcheckning senast 11:00, om inget annat avtalats.')))
from public.vihem_organisations o where o.id = '38fe702d-e72c-49a2-9750-5e0b6934959b'
on conflict (id) do nothing;

insert into vihem_ekangen_private.settings(id) values (true) on conflict (id) do nothing;

commit;
