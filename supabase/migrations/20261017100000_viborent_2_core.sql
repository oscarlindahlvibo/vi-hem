-- ViboRent 2.0 – kärna: prismotor, tillgänglighet, atomär bokning med betalningsreservation, avbokning,
-- versionshanterade avtal samt schema för lås (igloohome) och åtkomstkoder.
-- Alla ändringar är additiva och bakåtkompatibla: befintliga funktioner behåller sina signaturer.
-- Felmeddelanden som kunden får se har formen "[E_KOD] text"; edge-funktionen släpper bara igenom kända koder.
begin;

-- ---------------------------------------------------------------------------------------------------------
-- 1. Inställningar och nya kolumner
-- ---------------------------------------------------------------------------------------------------------
alter table public.vihem_rental_settings
  add column if not exists free_cancellation_minutes integer not null default 60 check (free_cancellation_minutes >= 0),
  add column if not exists access_dispatch_minutes integer not null default 60 check (access_dispatch_minutes >= 0),
  add column if not exists booking_hold_minutes integer not null default 30 check (booking_hold_minutes between 5 and 240),
  add column if not exists access_enabled boolean not null default false,
  add column if not exists access_sms_template text not null default 'Hej {{name}}! Din kod till {{asset}} är {{pin}}. Giltig {{from}} – {{until}}. Bokning {{reference}}.';

alter table public.vihem_rental_products
  add column if not exists buffer_minutes integer check (buffer_minutes is null or buffer_minutes >= 0),
  add column if not exists requires_access boolean not null default true;

alter table public.vihem_rental_bookings
  add column if not exists hold_expires_at timestamptz,
  add column if not exists short_notice boolean not null default false,
  add column if not exists short_notice_acknowledged_at timestamptz,
  add column if not exists contract_terms_version_id uuid,
  add column if not exists contract_acceptance jsonb,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid,
  add column if not exists cancellation_source text,
  add column if not exists cancellation_reason text,
  add column if not exists refund_status text not null default 'none' check (refund_status in ('none', 'pending', 'succeeded', 'failed', 'manual')),
  add column if not exists refund_amount numeric(12, 2) not null default 0,
  add column if not exists access_warning text;

create index if not exists vihem_rental_bookings_hold_idx on public.vihem_rental_bookings (hold_expires_at) where status = 'pending';
create index if not exists vihem_rental_bookings_org_period_idx on public.vihem_rental_bookings (organisation_id, start_at, end_at);
create index if not exists vihem_rental_booking_items_asset_idx on public.vihem_rental_booking_items (asset_id, start_at, end_at);

-- ---------------------------------------------------------------------------------------------------------
-- 2. Versionshanterade uthyrningsavtal (kunden kan aldrig skriva egna tillägg)
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.vihem_rental_contract_versions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  version integer not null,
  title text not null default 'Uthyrningsavtal',
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (organisation_id, version)
);
create unique index if not exists vihem_rental_contract_one_active on public.vihem_rental_contract_versions (organisation_id) where status = 'active';

create or replace function public.vihem_rental_contract_immutable() returns trigger language plpgsql as $$
begin
  if OLD.status <> 'draft' and (NEW.body is distinct from OLD.body or NEW.title is distinct from OLD.title or NEW.version is distinct from OLD.version) then
    raise exception '[E_CONTRACT_LOCKED] Ett publicerat avtal kan inte ändras. Skapa en ny version.';
  end if;
  return NEW;
end;
$$;
drop trigger if exists vihem_rental_contract_immutable on public.vihem_rental_contract_versions;
create trigger vihem_rental_contract_immutable before update on public.vihem_rental_contract_versions
  for each row execute function public.vihem_rental_contract_immutable();

alter table public.vihem_rental_contract_versions enable row level security;
drop policy if exists "Rental contracts read" on public.vihem_rental_contract_versions;
create policy "Rental contracts read" on public.vihem_rental_contract_versions for select to authenticated
  using (organisation_id = public.get_my_org_id() and public.vihem_rental_enabled(organisation_id));
drop policy if exists "Rental contracts manage" on public.vihem_rental_contract_versions;
create policy "Rental contracts manage" on public.vihem_rental_contract_versions for all to authenticated
  using (organisation_id = public.get_my_org_id() and public.vihem_rental_enabled(organisation_id) and public.get_my_role() = any (array['admin']))
  with check (organisation_id = public.get_my_org_id() and public.vihem_rental_enabled(organisation_id) and public.get_my_role() = any (array['admin']));

-- Version 1 för varje organisation som redan använder uthyrning = exakt den text som redan sparas i bokningarna idag.
insert into public.vihem_rental_contract_versions (organisation_id, version, title, body, status, published_at)
select m.organisation_id, 1, 'Uthyrningsavtal',
       'ViboRent uthyrningsavtal v1' || coalesce(nullif('. Villkor: ' || s.terms_url, '. Villkor: '), ''), 'active', now()
from public.vihem_organisation_modules m
left join public.vihem_rental_settings s on s.organisation_id = m.organisation_id
where m.module_key = 'rental_management' and m.enabled
on conflict (organisation_id, version) do nothing;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Hjälpfunktioner
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_rental_assert_access(p_org uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' or current_user in ('postgres', 'supabase_admin') then return; end if;
  if p_org is not distinct from public.get_my_org_id() and public.get_my_role() = any (array['staff', 'admin', 'superadmin']) then return; end if;
  raise exception '[E_FORBIDDEN] Behörighet saknas.';
end;
$$;
revoke all on function public.vihem_rental_assert_access(uuid) from public, anon;

create or replace function public.vihem_rental_org_timezone(p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from public.vihem_rental_settings where organisation_id = p_org), 'Europe/Stockholm');
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Prismotor
--    * Lägsta möjliga pris för perioden bland giltiga regler (aldrig dyrare för att en annan regeltyp råkar prioriteras).
--    * Regler med högre prioritet vinner som grupp (t.ex. säsongspris); inom en prioritetsnivå gäller lägsta pris.
--    * Paketpriser (fixed_period/custom/weekend) och tidsenheter (hourly/daily/weekly, valfri längd) jämförs mot varandra.
--    * Tidsenheter kombineras optimalt (t.ex. 1 vecka + 2 dagar + 3 timmar) och får täcka perioden uppåt.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_rental_quote(
  target_product_id uuid, target_start_at timestamptz, target_end_at timestamptz, target_quantity integer default 1
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  product_row public.vihem_rental_products%rowtype;
  setting_row public.vihem_rental_settings%rowtype;
  tz text;
  vat_rate numeric;
  hours numeric;
  need integer;
  local_start timestamp;
  start_isodow integer;
  tier integer;
  best_total numeric;
  best_lines jsonb;
  pkg record;
  block_ids uuid[]; block_len integer[]; block_price numeric[]; block_type text[];
  dp numeric[]; pick integer[];
  n integer; j integer; k integer; prev integer; cand numeric;
  counts jsonb; cursor_j integer; line_total numeric;
  subtotal numeric; vat numeric;
begin
  select * into product_row from public.vihem_rental_products where id = target_product_id;
  if product_row.id is null then raise exception '[E_PRODUCT] Produkten hittades inte.'; end if;
  if not public.vihem_rental_enabled(product_row.organisation_id) then raise exception '[E_DISABLED] Uthyrning är inte aktiverad.'; end if;
  if target_start_at is null or target_end_at is null or target_end_at <= target_start_at or coalesce(target_quantity, 0) < 1 then
    raise exception '[E_PERIOD] Ogiltig uthyrningsperiod.';
  end if;
  perform public.vihem_rental_assert_access(product_row.organisation_id);
  select * into setting_row from public.vihem_rental_settings where organisation_id = product_row.organisation_id;
  tz := coalesce(setting_row.timezone, 'Europe/Stockholm');
  vat_rate := coalesce(product_row.vat_rate, setting_row.vat_rate, 25);
  hours := extract(epoch from (target_end_at - target_start_at)) / 3600;
  if hours > 24 * 366 then raise exception '[E_PERIOD] Hyrestiden är för lång för onlinebokning.'; end if;
  need := ceil(hours)::integer;
  local_start := target_start_at at time zone tz;
  start_isodow := extract(isodow from local_start)::integer;

  for tier in
    select distinct priority from public.vihem_rental_pricing_rules
    where organisation_id = product_row.organisation_id and product_id = product_row.id and asset_id is null and active
    order by priority desc
  loop
    best_total := null; best_lines := null;

    -- Paketpriser
    for pkg in
      select * from public.vihem_rental_pricing_rules r
      where r.organisation_id = product_row.organisation_id and r.product_id = product_row.id and r.asset_id is null and r.active
        and r.priority = tier and r.rule_type in ('fixed_period', 'custom', 'weekend')
        and (r.valid_from is null or local_start::date >= r.valid_from) and (r.valid_until is null or local_start::date <= r.valid_until)
        and (r.minimum_duration is null or hours >= r.minimum_duration) and (r.maximum_duration is null or hours <= r.maximum_duration)
        and (coalesce(cardinality(r.day_of_week), 0) = 0 or start_isodow = any (r.day_of_week::integer[]))
        and (r.rule_type <> 'weekend' or (start_isodow in (5, 6) and hours <= coalesce(r.maximum_duration, 72)))
      order by r.price asc
    loop
      if best_total is null or pkg.price < best_total then
        best_total := pkg.price;
        best_lines := jsonb_build_array(jsonb_build_object('rule_id', pkg.id, 'rule_type', pkg.rule_type, 'count', 1, 'unit_price', pkg.price, 'line_total', pkg.price));
      end if;
    end loop;

    -- Tidsenheter (täcker perioden med lägsta möjliga kostnad)
    select array_agg(r.id), array_agg(r.len), array_agg(r.price), array_agg(r.rule_type)
      into block_ids, block_len, block_price, block_type
    from (
      select id, rule_type, price,
             greatest(coalesce(duration, 1), 1) * case rule_type when 'hourly' then 1 when 'daily' then 24 else 168 end as len
      from public.vihem_rental_pricing_rules r
      where r.organisation_id = product_row.organisation_id and r.product_id = product_row.id and r.asset_id is null and r.active
        and r.priority = tier and r.rule_type in ('hourly', 'daily', 'weekly')
        and (r.valid_from is null or local_start::date >= r.valid_from) and (r.valid_until is null or local_start::date <= r.valid_until)
        and (r.minimum_duration is null or hours >= r.minimum_duration) and (r.maximum_duration is null or hours <= r.maximum_duration)
        and (coalesce(cardinality(r.day_of_week), 0) = 0 or start_isodow = any (r.day_of_week::integer[]))
    ) r;
    n := coalesce(cardinality(block_ids), 0);
    if n > 0 then
      dp := array_fill(0::numeric, array[need + 1]);
      pick := array_fill(0, array[need + 1]);
      for j in 1..need loop
        dp[j + 1] := null;
        for k in 1..n loop
          prev := greatest(0, j - block_len[k]);
          cand := dp[prev + 1] + block_price[k];
          if dp[j + 1] is null or cand < dp[j + 1] then dp[j + 1] := cand; pick[j + 1] := k; end if;
        end loop;
      end loop;
      if best_total is null or dp[need + 1] < best_total then
        best_total := dp[need + 1];
        counts := '{}'::jsonb; cursor_j := need;
        while cursor_j > 0 loop
          k := pick[cursor_j + 1];
          counts := jsonb_set(counts, array[k::text], to_jsonb(coalesce((counts ->> k::text)::integer, 0) + 1));
          cursor_j := greatest(0, cursor_j - block_len[k]);
        end loop;
        best_lines := '[]'::jsonb;
        for k in 1..n loop
          if counts ? k::text then
            line_total := block_price[k] * (counts ->> k::text)::integer;
            best_lines := best_lines || jsonb_build_array(jsonb_build_object(
              'rule_id', block_ids[k], 'rule_type', block_type[k], 'count', (counts ->> k::text)::integer,
              'unit_price', block_price[k], 'unit_hours', block_len[k], 'line_total', line_total));
          end if;
        end loop;
      end if;
    end if;

    exit when best_total is not null;
  end loop;

  if best_total is null then raise exception '[E_NO_PRICE] Ingen prisregel gäller för den valda perioden.'; end if;

  subtotal := round(best_total * target_quantity, 2);
  vat := round(subtotal * vat_rate / 100, 2);
  return jsonb_build_object(
    'subtotal', subtotal, 'vat_amount', vat, 'total', subtotal + vat,
    'deposit', coalesce(product_row.deposit, 0) * target_quantity,
    'currency', coalesce(setting_row.currency, 'SEK'), 'vat_rate', vat_rate,
    'hours', round(hours, 2), 'quantity', target_quantity,
    'unit_total', best_total,
    'rules', best_lines,
    'rule', best_lines -> 0
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Regler för period (min/max längd, framförhållning) – används av både pris och bokning
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_rental_check_period(p_product uuid, p_start timestamptz, p_end timestamptz, p_enforce_advance boolean default true)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  product_row public.vihem_rental_products%rowtype;
  setting_row public.vihem_rental_settings%rowtype;
  hours numeric;
begin
  select * into product_row from public.vihem_rental_products where id = p_product;
  if product_row.id is null then return '[E_PRODUCT] Produkten hittades inte.'; end if;
  select * into setting_row from public.vihem_rental_settings where organisation_id = product_row.organisation_id;
  if p_end <= p_start then return '[E_PERIOD] Slutet måste vara efter starten.'; end if;
  hours := extract(epoch from (p_end - p_start)) / 3600;
  if product_row.minimum_duration is not null and product_row.minimum_duration > 1 and hours < product_row.minimum_duration then
    return format('[E_MIN_DURATION] Minsta hyrestid är %s timmar.', product_row.minimum_duration);
  end if;
  if product_row.maximum_duration is not null and hours > product_row.maximum_duration then
    return format('[E_MAX_DURATION] Längsta hyrestid är %s timmar.', product_row.maximum_duration);
  end if;
  if p_enforce_advance then
    if p_start < now() - interval '5 minutes' then return '[E_PAST] Starten ligger i det förflutna.'; end if;
    if coalesce(setting_row.minimum_advance_hours, 0) > 0 and p_start < now() + make_interval(hours => setting_row.minimum_advance_hours) then
      return format('[E_ADVANCE] Bokning måste göras minst %s timmar i förväg.', setting_row.minimum_advance_hours);
    end if;
    if p_start > now() + make_interval(days => coalesce(setting_row.maximum_advance_days, 730)) then
      return '[E_ADVANCE_MAX] Starten ligger för långt fram i tiden.';
    end if;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 6. Tillgänglighet: objektspecifika och produktövergripande blockeringar, buffert före/efter, utgångna reservationer
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_rental_free_assets(p_product uuid, p_start timestamptz, p_end timestamptz, p_exclude_booking uuid default null)
returns table (asset_id uuid, asset_name text)
language sql stable security definer set search_path = public as $$
  with prod as (
    select p.id, p.organisation_id,
           make_interval(mins => coalesce(p.buffer_minutes, s.default_return_buffer_minutes, 0)) as buf
    from public.vihem_rental_products p
    left join public.vihem_rental_settings s on s.organisation_id = p.organisation_id
    where p.id = p_product
  )
  select a.id, a.name
  from prod
  join public.vihem_rental_assets a on a.product_id = prod.id and a.organisation_id = prod.organisation_id
  where a.active and a.status = 'available'
    and public.vihem_rental_enabled(a.organisation_id)
    and not exists (
      select 1 from public.vihem_rental_booking_items i
      join public.vihem_rental_bookings b on b.id = i.booking_id
      where i.asset_id = a.id
        and (p_exclude_booking is null or b.id <> p_exclude_booking)
        and b.status in ('pending', 'confirmed', 'active')
        and (b.status <> 'pending' or b.hold_expires_at is null or b.hold_expires_at > now())
        and i.start_at < p_end + prod.buf and i.end_at + prod.buf > p_start
    )
    and not exists (
      select 1 from public.vihem_rental_blocks x
      where x.organisation_id = a.organisation_id
        and (x.asset_id = a.id or (x.asset_id is null and (x.product_id is null or x.product_id = a.product_id)))
        and x.start_at < p_end and x.end_at > p_start
    )
  order by a.name;
$$;

create or replace function public.vihem_rental_available_assets(target_product_id uuid, target_start_at timestamptz, target_end_at timestamptz)
returns table (asset_id uuid, asset_name text)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  select organisation_id into v_org from public.vihem_rental_products where id = target_product_id;
  perform public.vihem_rental_assert_access(v_org);
  return query select f.asset_id, f.asset_name from public.vihem_rental_free_assets(target_product_id, target_start_at, target_end_at) f;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 7. Atomär bokning. Alla berörda produkter låses (i fast ordning) så att två samtidiga bokningar aldrig kan få samma objekt.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_rental_create_booking_v2(
  target_items jsonb,
  target_customer jsonb default '{}'::jsonb,
  target_source text default 'viborent.se',
  target_status text default 'pending',
  target_customer_notes text default '',
  target_options jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  v_item_count integer;
  v_prod public.vihem_rental_products%rowtype;
  v_setting public.vihem_rental_settings%rowtype;
  v_org uuid;
  v_product uuid;
  v_qty integer;
  v_start timestamptz; v_end timestamptz;
  v_min_start timestamptz; v_max_end timestamptz;
  v_err text;
  v_quote jsonb;
  v_customer uuid;
  v_booking uuid;
  v_reference text;
  v_subtotal numeric := 0; v_vat numeric := 0; v_deposit numeric := 0;
  v_currency text := 'SEK';
  v_count integer;
  a record;
  v_hold boolean := coalesce((target_options ->> 'hold')::boolean, false);
  v_ack boolean := coalesce((target_options ->> 'acknowledge_short_notice')::boolean, false);
  v_public boolean := coalesce((target_options ->> 'public')::boolean, false);
  v_enforce boolean := coalesce((target_options ->> 'enforce_rules')::boolean, true) or coalesce((target_options ->> 'public')::boolean, false);
  v_contract public.vihem_rental_contract_versions%rowtype;
  v_snapshot text;
  v_short boolean := false;
  v_dispatch integer;
  v_has_lock boolean := false;
  v_email text;
begin
  if target_items is null or jsonb_typeof(target_items) <> 'array' or jsonb_array_length(target_items) = 0 then
    raise exception '[E_EMPTY] Varukorgen är tom.';
  end if;
  v_item_count := jsonb_array_length(target_items);
  if v_item_count > 20 then raise exception '[E_TOO_MANY] Varukorgen innehåller för många rader.'; end if;
  if target_status not in ('pending', 'confirmed') or (coalesce((target_options ->> 'public')::boolean, false) and target_status <> 'pending') then
    raise exception '[E_STATUS] Ogiltig bokningsstatus.';
  end if;

  -- Pass 1: validera rader och härled organisation.
  for it in select * from jsonb_array_elements(target_items) loop
    begin
      v_product := nullif(it ->> 'product_id', '')::uuid;
      v_start := nullif(it ->> 'start_at', '')::timestamptz;
      v_end := nullif(it ->> 'end_at', '')::timestamptz;
      v_qty := coalesce((it ->> 'quantity')::integer, 1);
    exception when others then
      raise exception '[E_ITEM] En rad i varukorgen är ogiltig.';
    end;
    if v_product is null or v_start is null or v_end is null or v_end <= v_start or v_qty < 1 or v_qty > 50 then
      raise exception '[E_ITEM] En rad i varukorgen är ogiltig.';
    end if;
    select * into v_prod from public.vihem_rental_products where id = v_product and active;
    if v_prod.id is null or (v_public and not v_prod.visible_publicly) then
      raise exception '[E_PRODUCT] Produkten hittades inte.';
    end if;
    if v_org is null then v_org := v_prod.organisation_id;
    elsif v_org <> v_prod.organisation_id then raise exception '[E_ORG] Varukorgen innehåller produkter från olika uthyrare.'; end if;
    v_err := public.vihem_rental_check_period(v_product, v_start, v_end, v_enforce);
    if v_err is not null then raise exception '%', v_err; end if;
    v_min_start := least(coalesce(v_min_start, v_start), v_start);
    v_max_end := greatest(coalesce(v_max_end, v_end), v_end);
  end loop;

  perform public.vihem_rental_assert_access(v_org);
  if not public.vihem_rental_enabled(v_org) then raise exception '[E_DISABLED] Uthyrning är inte aktiverad.'; end if;
  select * into v_setting from public.vihem_rental_settings where organisation_id = v_org;

  -- Lås alla berörda produkter i fast ordning.
  perform pg_advisory_xact_lock(hashtextextended('vihem_rental:' || p::text, 0))
  from (select distinct (e ->> 'product_id') as p from jsonb_array_elements(target_items) e order by 1) s;

  -- Kund
  v_email := lower(trim(coalesce(target_customer ->> 'email', '')));
  select id into v_customer from public.vihem_rental_customers
   where organisation_id = v_org and v_email <> '' and lower(email) = v_email order by created_at desc limit 1;
  if v_customer is null then
    insert into public.vihem_rental_customers (organisation_id, first_name, last_name, company_name, identifier, email, phone, address, postal_code, city, country, notes)
    values (v_org, left(coalesce(target_customer ->> 'first_name', ''), 120), left(coalesce(target_customer ->> 'last_name', ''), 120),
            left(coalesce(target_customer ->> 'company_name', ''), 200), left(coalesce(target_customer ->> 'identifier', ''), 40),
            left(v_email, 200), left(coalesce(target_customer ->> 'phone', ''), 40), left(coalesce(target_customer ->> 'address', ''), 200),
            left(coalesce(target_customer ->> 'postal_code', ''), 20), left(coalesce(target_customer ->> 'city', ''), 120),
            left(coalesce(target_customer ->> 'country', 'SE'), 2), '')
    returning id into v_customer;
  end if;

  -- Avtal: alltid organisationens aktiva version, aldrig kundtext.
  select * into v_contract from public.vihem_rental_contract_versions where organisation_id = v_org and status = 'active';
  v_snapshot := coalesce(v_contract.body, 'ViboRent uthyrningsavtal v1');

  v_reference := coalesce(v_setting.booking_prefix, 'VR') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_dispatch := coalesce(v_setting.access_dispatch_minutes, 60);

  insert into public.vihem_rental_bookings (
    public_reference, organisation_id, customer_id, status, payment_status, start_at, end_at,
    subtotal, vat_amount, deposit, total, currency, customer_notes, source, created_by,
    contract_status, contract_terms_snapshot, contract_terms_version, contract_terms_version_id, hold_expires_at
  ) values (
    v_reference, v_org, v_customer, target_status, 'unpaid', v_min_start, v_max_end,
    0, 0, 0, 0, 'SEK', left(coalesce(target_customer_notes, ''), 2000), left(coalesce(nullif(trim(target_source), ''), 'viborent.se'), 60),
    auth.uid(), 'pending_signature', v_snapshot, coalesce('v' || v_contract.version, 'v1'), v_contract.id,
    case when v_hold and target_status = 'pending' then now() + make_interval(mins => coalesce(v_setting.booking_hold_minutes, 30)) else null end
  ) returning id into v_booking;

  -- Pass 2: välj objekt och beräkna pris (se bokningen som redan finns i transaktionen, så rader i samma varukorg krockar inte).
  for it in select * from jsonb_array_elements(target_items) loop
    v_product := (it ->> 'product_id')::uuid;
    v_start := (it ->> 'start_at')::timestamptz;
    v_end := (it ->> 'end_at')::timestamptz;
    v_qty := coalesce((it ->> 'quantity')::integer, 1);
    v_quote := public.vihem_rental_quote(v_product, v_start, v_end, v_qty);
    v_subtotal := v_subtotal + (v_quote ->> 'subtotal')::numeric;
    v_vat := v_vat + (v_quote ->> 'vat_amount')::numeric;
    v_deposit := v_deposit + (v_quote ->> 'deposit')::numeric;
    v_currency := coalesce(v_quote ->> 'currency', v_currency);
    v_count := 0;
    for a in
      select f.asset_id, f.asset_name from public.vihem_rental_free_assets(v_product, v_start, v_end) f
      join public.vihem_rental_assets x on x.id = f.asset_id
      order by f.asset_name
    loop
      insert into public.vihem_rental_booking_items (organisation_id, booking_id, product_id, asset_id, quantity, unit_price, total_price, pricing_snapshot, start_at, end_at)
      values (v_org, v_booking, v_product, a.asset_id, 1, round((v_quote ->> 'subtotal')::numeric / v_qty, 2), round((v_quote ->> 'subtotal')::numeric / v_qty, 2), v_quote, v_start, v_end);
      v_count := v_count + 1;
      exit when v_count >= v_qty;
    end loop;
    if v_count < v_qty then
      raise exception '[E_UNAVAILABLE] Produkten är inte längre tillgänglig under vald period.';
    end if;
  end loop;

  -- Kort varsel: kod skickas direkt och ordinarie avbokning gäller inte. Kunden måste ha fått veta det före betalning.
  select exists (
    select 1 from public.vihem_rental_booking_items i
    join public.vihem_rental_assets x on x.id = i.asset_id
    join public.vihem_rental_products p on p.id = i.product_id
    where i.booking_id = v_booking and x.lock_id is not null and p.requires_access
  ) into v_has_lock;
  v_short := coalesce(v_setting.access_enabled, false) and v_has_lock and v_min_start < now() + make_interval(mins => v_dispatch);
  if v_short and not v_ack and target_status = 'pending' and v_enforce then
    raise exception '[E_SHORT_NOTICE] Bokningen startar inom % minuter. Låskoden skickas direkt och avbokning enligt ordinarie regler gäller inte. Bekräfta för att fortsätta.', v_dispatch;
  end if;

  update public.vihem_rental_bookings
     set subtotal = v_subtotal, vat_amount = v_vat, deposit = v_deposit, total = v_subtotal + v_vat, currency = v_currency,
         short_notice = v_short, short_notice_acknowledged_at = case when v_short and v_ack then now() end
   where id = v_booking;

  return jsonb_build_object(
    'id', v_booking, 'public_reference', v_reference, 'organisation_id', v_org, 'customer_id', v_customer,
    'contract_status', 'pending_signature', 'short_notice', v_short,
    'hold_expires_at', (select hold_expires_at from public.vihem_rental_bookings where id = v_booking),
    'quote', jsonb_build_object('subtotal', v_subtotal, 'vat_amount', v_vat, 'deposit', v_deposit, 'total', v_subtotal + v_vat, 'currency', v_currency)
  );
end;
$$;

-- Äldre signaturer finns kvar men går via samma motor. target_additional_terms ignoreras medvetet (kunden får inte skriva avtalstillägg).
create or replace function public.vihem_create_rental_booking_multi(
  target_items jsonb, target_customer jsonb default '{}'::jsonb, target_source text default 'viborent.se',
  target_status text default 'pending', target_customer_notes text default '', target_additional_terms text default ''
) returns jsonb language sql security definer set search_path = public as $$
  select public.vihem_rental_create_booking_v2(target_items, target_customer, target_source, target_status, target_customer_notes, '{}'::jsonb);
$$;

create or replace function public.vihem_create_rental_booking_multi(
  target_items jsonb, target_start_at timestamptz, target_end_at timestamptz, target_customer jsonb default '{}'::jsonb,
  target_source text default 'viborent.se', target_status text default 'pending', target_customer_notes text default ''
) returns jsonb language sql security definer set search_path = public as $$
  select public.vihem_rental_create_booking_v2(
    (select jsonb_agg(e || jsonb_build_object('start_at', target_start_at, 'end_at', target_end_at)) from jsonb_array_elements(target_items) e),
    target_customer, target_source, target_status, target_customer_notes, '{}'::jsonb);
$$;

create or replace function public.vihem_create_rental_booking(
  target_product_id uuid, target_start_at timestamptz, target_end_at timestamptz, target_quantity integer default 1,
  target_customer jsonb default '{}'::jsonb, target_source text default 'viborent.se', target_status text default 'pending',
  target_customer_notes text default '', target_internal_notes text default ''
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  v_result := public.vihem_rental_create_booking_v2(
    jsonb_build_array(jsonb_build_object('product_id', target_product_id, 'start_at', target_start_at, 'end_at', target_end_at, 'quantity', target_quantity)),
    target_customer, target_source, target_status, target_customer_notes,
    -- bokning i VI-HEM (personal) får göras med kort varsel och utan framförhållningskrav
    case when coalesce(target_source, '') = 'vihem' then '{"enforce_rules": false}'::jsonb else '{}'::jsonb end);
  if nullif(trim(target_internal_notes), '') is not null then
    update public.vihem_rental_bookings set internal_notes = left(target_internal_notes, 4000) where id = (v_result ->> 'id')::uuid;
  end if;
  return v_result;
end;
$$;

-- Skydda funktionerna: bara service_role (edge) och inloggad personal i rätt organisation (kontrolleras i funktionerna).
revoke all on function public.vihem_rental_create_booking_v2(jsonb, jsonb, text, text, text, jsonb) from public, anon;
grant execute on function public.vihem_rental_create_booking_v2(jsonb, jsonb, text, text, text, jsonb) to authenticated, service_role;
revoke all on function public.vihem_rental_free_assets(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.vihem_rental_free_assets(uuid, timestamptz, timestamptz, uuid) to service_role;
revoke all on function public.vihem_rental_check_period(uuid, timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.vihem_rental_check_period(uuid, timestamptz, timestamptz, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 8. Lås och åtkomstkoder (schema). Koder lagras krypterade och kan aldrig läsas av webbläsaren.
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.vihem_rental_locks (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  provider text not null default 'igloohome',
  external_device_id text not null,
  name text not null,
  model text,
  timezone text,
  active boolean not null default true,
  notes text,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, provider, external_device_id)
);
alter table public.vihem_rental_assets add column if not exists lock_id uuid references public.vihem_rental_locks(id) on delete set null;

create table if not exists public.vihem_rental_access_codes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  booking_id uuid not null references public.vihem_rental_bookings(id) on delete cascade,
  asset_id uuid not null references public.vihem_rental_assets(id) on delete cascade,
  lock_id uuid not null references public.vihem_rental_locks(id) on delete restrict,
  status text not null default 'scheduled' check (status in ('scheduled', 'issuing', 'issued', 'sent', 'failed', 'cancelled', 'manual')),
  scheduled_for timestamptz not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  pin_type text,
  pin_encrypted text,
  external_pin_id text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  locked_until timestamptz,
  sms_status text not null default 'not_sent' check (sms_status in ('not_sent', 'pending', 'sent', 'delivered', 'failed', 'unknown')),
  sms_attempts integer not null default 0,
  sms_sent_at timestamptz,
  sms_message_id uuid,
  warning text,
  issued_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, asset_id)
);
create index if not exists vihem_rental_access_codes_due_idx on public.vihem_rental_access_codes (scheduled_for) where status in ('scheduled', 'failed', 'issued');

create table if not exists public.vihem_rental_access_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  booking_id uuid,
  access_code_id uuid,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists vihem_rental_access_events_booking_idx on public.vihem_rental_access_events (booking_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['vihem_rental_locks', 'vihem_rental_access_codes', 'vihem_rental_access_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Rental org read" on public.%I', t);
    execute format('create policy "Rental org read" on public.%I for select to authenticated using (organisation_id = public.get_my_org_id() and public.vihem_rental_enabled(organisation_id) and public.get_my_role() = any (array[''staff'',''admin'',''superadmin'']))', t);
  end loop;
  drop policy if exists "Rental locks manage" on public.vihem_rental_locks;
  create policy "Rental locks manage" on public.vihem_rental_locks for all to authenticated
    using (organisation_id = public.get_my_org_id() and public.vihem_rental_enabled(organisation_id) and public.get_my_role() = 'admin')
    with check (organisation_id = public.get_my_org_id() and public.vihem_rental_enabled(organisation_id) and public.get_my_role() = 'admin');
end $$;

-- Åtkomstkoder skrivs bara av servern. Läsning för personal sker utan kolumnerna med krypterad kod.
revoke all on public.vihem_rental_access_codes from anon, authenticated;
grant select (id, organisation_id, booking_id, asset_id, lock_id, status, scheduled_for, valid_from, valid_until, pin_type, attempts, next_attempt_at,
              last_error, sms_status, sms_attempts, sms_sent_at, warning, issued_at, cancelled_at, created_at, updated_at)
  on public.vihem_rental_access_codes to authenticated;
revoke all on public.vihem_rental_access_events from anon, authenticated;
grant select on public.vihem_rental_access_events to authenticated;

create or replace function public.vihem_rental_log_access_event(p_org uuid, p_booking uuid, p_code uuid, p_type text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.vihem_rental_access_events (organisation_id, booking_id, access_code_id, event_type, detail) values (p_org, p_booking, p_code, p_type, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function public.vihem_rental_log_access_event(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.vihem_rental_log_access_event(uuid, uuid, uuid, text, jsonb) to service_role;

-- Schemalägg koder när en bokning blir bekräftad (idempotent) och håll dem i takt med bokningens tider.
create or replace function public.vihem_rental_schedule_access(p_booking uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  b public.vihem_rental_bookings%rowtype;
  s public.vihem_rental_settings%rowtype;
  r record;
  v_count integer := 0;
  v_when timestamptz;
begin
  select * into b from public.vihem_rental_bookings where id = p_booking;
  if b.id is null or b.status not in ('confirmed', 'active') then return 0; end if;
  select * into s from public.vihem_rental_settings where organisation_id = b.organisation_id;
  if not coalesce(s.access_enabled, false) then return 0; end if;
  for r in
    select i.asset_id, a.lock_id, min(i.start_at) as s_at, max(i.end_at) as e_at
    from public.vihem_rental_booking_items i
    join public.vihem_rental_assets a on a.id = i.asset_id
    join public.vihem_rental_products p on p.id = i.product_id
    where i.booking_id = b.id and a.lock_id is not null and p.requires_access
    group by i.asset_id, a.lock_id
  loop
    v_when := greatest(now(), r.s_at - make_interval(mins => coalesce(s.access_dispatch_minutes, 60)));
    insert into public.vihem_rental_access_codes (organisation_id, booking_id, asset_id, lock_id, scheduled_for, valid_from, valid_until)
    values (b.organisation_id, b.id, r.asset_id, r.lock_id, v_when, r.s_at, r.e_at)
    on conflict (booking_id, asset_id) do update
      set scheduled_for = case when vihem_rental_access_codes.status = 'scheduled' then excluded.scheduled_for else vihem_rental_access_codes.scheduled_for end,
          valid_from = case when vihem_rental_access_codes.status = 'scheduled' then excluded.valid_from else vihem_rental_access_codes.valid_from end,
          valid_until = case when vihem_rental_access_codes.status = 'scheduled' then excluded.valid_until else vihem_rental_access_codes.valid_until end,
          warning = case when vihem_rental_access_codes.status in ('issuing', 'issued', 'sent')
                          and (vihem_rental_access_codes.valid_from <> excluded.valid_from or vihem_rental_access_codes.valid_until <> excluded.valid_until)
                         then 'Bokningens tider har ändrats efter att koden utfärdades. Koden gäller fortfarande de gamla tiderna – utfärda ny kod manuellt.'
                         else vihem_rental_access_codes.warning end,
          updated_at = now()
    where vihem_rental_access_codes.status in ('scheduled', 'issuing', 'issued', 'sent');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.vihem_rental_schedule_access(uuid) from public, anon, authenticated;
grant execute on function public.vihem_rental_schedule_access(uuid) to service_role;

create or replace function public.vihem_rental_booking_access_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.status in ('confirmed', 'active') and (TG_OP = 'INSERT' or OLD.status is distinct from NEW.status or OLD.start_at is distinct from NEW.start_at or OLD.end_at is distinct from NEW.end_at) then
    perform public.vihem_rental_schedule_access(NEW.id);
  end if;
  return NEW;
exception when others then
  -- schemaläggning av kod får aldrig stoppa själva bokningen; felet syns i åtkomstlogg
  perform public.vihem_rental_log_access_event(NEW.organisation_id, NEW.id, null, 'schedule_error', jsonb_build_object('error', left(SQLERRM, 300)));
  return NEW;
end;
$$;
drop trigger if exists vihem_rental_booking_access on public.vihem_rental_bookings;
create trigger vihem_rental_booking_access after insert or update of status, start_at, end_at on public.vihem_rental_bookings
  for each row execute function public.vihem_rental_booking_access_trigger();

-- ---------------------------------------------------------------------------------------------------------
-- 9. Avbokning (serverstyrd, race-säker mot kodjobben) och utgångna reservationer
--    Kunden får avboka till start minus fristen, om ingen kod redan utfärdats/är på väg att utfärdas. Personal kan alltid avboka,
--    men en redan utfärdad offline-PIN kan inte återkallas: bokningen får en tydlig varning i stället för ett falskt "återkallad".
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_rental_cancel_booking(
  p_booking uuid, p_actor text, p_reason text default null, p_actor_user uuid default null, p_token uuid default null, p_customer uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.vihem_rental_bookings%rowtype;
  s public.vihem_rental_settings%rowtype;
  v_cutoff timestamptz;
  v_issued integer;
  v_refund numeric := 0;
  v_paid boolean;
  v_warning text;
begin
  if p_actor not in ('customer', 'admin', 'system') then raise exception '[E_ACTOR] Ogiltig aktör.'; end if;
  select * into b from public.vihem_rental_bookings where id = p_booking for update;
  if b.id is null then raise exception '[E_NOT_FOUND] Bokningen hittades inte.'; end if;
  if p_actor = 'admin' then perform public.vihem_rental_assert_access(b.organisation_id); end if;
  if p_actor = 'customer' and not ((p_token is not null and b.public_lookup_token = p_token) or (p_customer is not null and b.customer_id = p_customer)) then
    raise exception '[E_NOT_FOUND] Bokningen hittades inte.';
  end if;
  if b.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already_cancelled', true, 'refund_amount', b.refund_amount);
  end if;
  if b.status in ('completed') then raise exception '[E_STATE] Bokningen är redan genomförd.'; end if;

  select * into s from public.vihem_rental_settings where organisation_id = b.organisation_id;
  v_cutoff := b.start_at - make_interval(mins => coalesce(s.free_cancellation_minutes, 60));
  select count(*) into v_issued from public.vihem_rental_access_codes where booking_id = b.id and status in ('issuing', 'issued', 'sent');

  if p_actor = 'customer' then
    if b.status = 'active' or now() >= v_cutoff or b.short_notice or v_issued > 0 then
      raise exception '[E_CANCEL_CLOSED] Bokningen kan inte längre avbokas online. Kontakta uthyraren.';
    end if;
  end if;

  v_paid := b.payment_status in ('paid', 'partially_refunded');
  if v_paid and (p_actor = 'system' or p_actor = 'admin' or now() < v_cutoff) then
    v_refund := greatest(0, b.total - b.refund_amount);
  end if;

  update public.vihem_rental_access_codes
     set status = 'cancelled', cancelled_at = now(), updated_at = now(), next_attempt_at = null
   where booking_id = b.id and status in ('scheduled', 'failed');

  if v_issued > 0 then
    v_warning := 'En åtkomstkod har redan utfärdats för denna bokning. Offline-koder kan inte återkallas på distans och kan fortfarande fungera tills de löper ut. Vidta manuell säkerhetsåtgärd (byt/blockera kod i låsets app) om det behövs.';
    update public.vihem_rental_access_codes set warning = v_warning, updated_at = now() where booking_id = b.id and status in ('issuing', 'issued', 'sent');
  end if;

  update public.vihem_rental_bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor_user, cancellation_source = p_actor,
         cancellation_reason = left(coalesce(p_reason, ''), 1000), hold_expires_at = null,
         refund_status = case when v_refund > 0 then 'pending' else refund_status end,
         access_warning = coalesce(v_warning, access_warning), updated_at = now()
   where id = b.id;
  perform public.vihem_rental_log_access_event(b.organisation_id, b.id, null, 'booking_cancelled',
    jsonb_build_object('actor', p_actor, 'refund_amount', v_refund, 'issued_codes', v_issued));

  return jsonb_build_object('ok', true, 'refund_amount', v_refund, 'payment_intent', b.stripe_payment_intent_id, 'currency', b.currency,
                            'offline_pin_warning', v_warning, 'organisation_id', b.organisation_id);
end;
$$;
revoke all on function public.vihem_rental_cancel_booking(uuid, text, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.vihem_rental_cancel_booking(uuid, text, text, uuid, uuid, uuid) to service_role;

-- Admin-vägen via RPC från VI-HEM-appen
create or replace function public.vihem_rental_admin_cancel_booking(p_booking uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.vihem_rental_cancel_booking(p_booking, 'admin', p_reason, auth.uid(), null, null);
end;
$$;
revoke all on function public.vihem_rental_admin_cancel_booking(uuid, text) from public, anon;
grant execute on function public.vihem_rental_admin_cancel_booking(uuid, text) to authenticated;

-- Betalning registrerad av Stripe-webhooken (idempotent).
create or replace function public.vihem_rental_mark_paid(p_booking uuid, p_session text, p_intent text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.vihem_rental_bookings%rowtype;
begin
  select * into b from public.vihem_rental_bookings where id = p_booking for update;
  if b.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if b.payment_status = 'paid' then return jsonb_build_object('ok', true, 'already_paid', true); end if;
  if b.status = 'cancelled' then
    -- betalning kom in efter att reservationen förfallit: återställ om objekten fortfarande är lediga, annars måste den återbetalas.
    if exists (
      select 1 from public.vihem_rental_booking_items i
      where i.booking_id = b.id and not exists (select 1 from public.vihem_rental_free_assets(i.product_id, i.start_at, i.end_at) f where f.asset_id = i.asset_id)
    ) then
      update public.vihem_rental_bookings set payment_status = 'paid', stripe_checkout_session_id = coalesce(p_session, stripe_checkout_session_id),
        stripe_payment_intent_id = coalesce(p_intent, stripe_payment_intent_id), refund_status = 'pending', refund_amount = 0, updated_at = now() where id = b.id;
      return jsonb_build_object('ok', true, 'refund_required', true, 'amount', b.total, 'currency', b.currency, 'payment_intent', p_intent);
    end if;
  end if;
  update public.vihem_rental_bookings
     set status = 'confirmed', payment_status = 'paid', hold_expires_at = null,
         stripe_checkout_session_id = coalesce(p_session, stripe_checkout_session_id),
         stripe_payment_intent_id = coalesce(p_intent, stripe_payment_intent_id),
         cancelled_at = null, cancellation_source = null, cancellation_reason = null, updated_at = now()
   where id = b.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.vihem_rental_mark_paid(uuid, text, text) from public, anon, authenticated;
grant execute on function public.vihem_rental_mark_paid(uuid, text, text) to service_role;

-- Förfallna reservationer släpps varje minut.
create or replace function public.vihem_rental_expire_holds() returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  with expired as (
    update public.vihem_rental_bookings
       set status = 'cancelled', cancelled_at = now(), cancellation_source = 'system', cancellation_reason = 'Reservationen förföll utan betalning.',
           hold_expires_at = null, contract_status = 'cancelled', updated_at = now()
     where status = 'pending' and payment_status in ('unpaid', 'pending') and hold_expires_at is not null and hold_expires_at < now()
    returning id
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;
revoke all on function public.vihem_rental_expire_holds() from public, anon, authenticated;
grant execute on function public.vihem_rental_expire_holds() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'vihem-rental-expire-holds') then perform cron.unschedule('vihem-rental-expire-holds'); end if;
  perform cron.schedule('vihem-rental-expire-holds', '* * * * *', $job$ SELECT public.vihem_rental_expire_holds(); $job$);
end $$;

commit;
