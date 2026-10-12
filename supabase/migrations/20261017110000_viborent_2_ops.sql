-- ViboRent 2.0 – driftstabeller: hastighetsbegränsning för publika anrop och idempotent hantering av Stripe-händelser.
begin;

create table if not exists public.vihem_rental_rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 1,
  primary key (key, window_start)
);
alter table public.vihem_rental_rate_limits enable row level security;

-- Returnerar true om anropet är tillåtet. Nyckeln är ett HMAC-fingeravtryck (aldrig rå IP).
create or replace function public.vihem_rental_rate_limit(p_key text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_window timestamptz; v_count integer;
begin
  v_window := to_timestamp(floor(extract(epoch from now()) / greatest(p_window_seconds, 1)) * greatest(p_window_seconds, 1));
  insert into public.vihem_rental_rate_limits (key, window_start, count) values (p_key, v_window, 1)
    on conflict (key, window_start) do update set count = vihem_rental_rate_limits.count + 1
    returning count into v_count;
  return v_count <= p_limit;
end;
$$;
revoke all on function public.vihem_rental_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.vihem_rental_rate_limit(text, integer, integer) to service_role;

create table if not exists public.vihem_rental_stripe_events (
  event_id text primary key,
  event_type text not null,
  booking_id uuid,
  outcome text,
  processed_at timestamptz not null default now()
);
alter table public.vihem_rental_stripe_events enable row level security;

-- true = första gången vi ser händelsen (bearbeta), false = redan hanterad.
create or replace function public.vihem_rental_claim_stripe_event(p_event text, p_type text, p_booking uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows integer;
begin
  insert into public.vihem_rental_stripe_events (event_id, event_type, booking_id) values (p_event, p_type, p_booking) on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;
revoke all on function public.vihem_rental_claim_stripe_event(text, text, uuid) from public, anon, authenticated;
grant execute on function public.vihem_rental_claim_stripe_event(text, text, uuid) to service_role;

-- Rensa gamla rader tillsammans med reservationsstädningen.
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
  delete from public.vihem_rental_rate_limits where window_start < now() - interval '1 day';
  delete from public.vihem_rental_stripe_events where processed_at < now() - interval '90 days';
  return v_count;
end;
$$;
revoke all on function public.vihem_rental_expire_holds() from public, anon, authenticated;
grant execute on function public.vihem_rental_expire_holds() to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Kodjobb: claim med SKIP LOCKED (ingen dubbel utfärdning vid samtidiga körningar) och bara för betalda/bekräftade bokningar.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_rental_claim_access_jobs(p_limit integer default 10)
returns table (id uuid, organisation_id uuid, booking_id uuid, asset_id uuid, lock_id uuid, valid_from timestamptz, valid_until timestamptz, attempts integer)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select c.id from public.vihem_rental_access_codes c
    join public.vihem_rental_bookings b on b.id = c.booking_id
    where ((c.status in ('scheduled', 'failed') and c.scheduled_for <= now() and coalesce(c.next_attempt_at, now()) <= now())
           or (c.status = 'issuing' and c.locked_until < now()))
      and b.status in ('confirmed', 'active') and b.payment_status in ('paid') and b.cancelled_at is null
      and c.valid_until > now()
    order by c.scheduled_for
    limit p_limit
    for update of c skip locked
  )
  update public.vihem_rental_access_codes c
     set status = 'issuing', attempts = c.attempts + 1, locked_until = now() + interval '4 minutes', updated_at = now()
    from due where c.id = due.id
  returning c.id, c.organisation_id, c.booking_id, c.asset_id, c.lock_id, c.valid_from, c.valid_until, c.attempts;
end;
$$;
revoke all on function public.vihem_rental_claim_access_jobs(integer) from public, anon, authenticated;
grant execute on function public.vihem_rental_claim_access_jobs(integer) to service_role;

-- Cron-trigger: samma mönster som övriga schemalagda funktioner (url + hemlighet i vihem_system_settings, nyckel 'rental_worker').
create or replace function public.vihem_trigger_rental_worker() returns void
language plpgsql security definer set search_path = public, extensions, net as $$
declare cfg jsonb;
begin
  select value into cfg from public.vihem_system_settings where key = 'rental_worker';
  if cfg is null or coalesce((cfg ->> 'enabled')::boolean, false) is not true or coalesce(cfg ->> 'function_url', '') = '' or coalesce(cfg ->> 'secret', '') = '' then return; end if;
  perform net.http_post(url := cfg ->> 'function_url',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-vihem-rental-worker-secret', cfg ->> 'secret'),
    body := jsonb_build_object('scheduled', true, 'time', now()), timeout_milliseconds := 55000);
end;
$$;
revoke all on function public.vihem_trigger_rental_worker() from public, anon, authenticated;

create or replace function public.vihem_rental_worker_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vihem_system_settings where key = 'rental_worker' and value ->> 'secret' = p_secret and p_secret <> '');
$$;
revoke all on function public.vihem_rental_worker_secret_ok(text) from public, anon, authenticated;
grant execute on function public.vihem_rental_worker_secret_ok(text) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'vihem-rental-worker') then perform cron.unschedule('vihem-rental-worker'); end if;
  perform cron.schedule('vihem-rental-worker', '* * * * *', $job$ SELECT public.vihem_trigger_rental_worker(); $job$);
end $$;

commit;
