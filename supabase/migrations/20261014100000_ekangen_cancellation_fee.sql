-- Ekängens direktbokning: avbokningsavgift = betalleverantörens (Stripes) verkliga avgift.
-- Vid gratis avbokning återbetalas beloppet minus avgiften. Inställningen styrs i VI-HEM; beloppen sparas på bokningen.
-- Additivt: bara nya kolumner och ersatta funktioner i det egna schemat.
begin;

alter table vihem_ekangen_private.settings add column if not exists retain_stripe_fee_on_cancel boolean not null default true;
alter table vihem_ekangen_private.bookings add column if not exists refunded_amount numeric(12,2);
alter table vihem_ekangen_private.bookings add column if not exists retained_fee numeric(12,2);

create or replace function public.vihem_ekangen_public_site() returns jsonb language sql stable security definer
set search_path = '' as $$
  select jsonb_build_object(
    'content', coalesce((select content from vihem_ekangen_private.site_content where id), '{}'::jsonb),
    'settings', (select jsonb_build_object(
        'bookingEnabled', s.booking_enabled, 'discountPercent', s.discount_percent,
        'freeCancelDays', s.free_cancel_days, 'minNights', s.min_nights, 'maxNights', s.max_nights,
        'checkInTime', s.check_in_time, 'checkOutTime', s.check_out_time,
        'retainStripeFee', s.retain_stripe_fee_on_cancel)
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

create or replace function public.vihem_ekangen_save_settings(p_settings jsonb, p_revision bigint) returns bigint
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
    retain_stripe_fee_on_cancel = coalesce((p_settings->>'retain_stripe_fee_on_cancel')::boolean, retain_stripe_fee_on_cancel),
    revision = revision + 1, updated_at = now()
  where id and revision = p_revision returning revision into new_revision;
  if new_revision is null then raise exception 'Conflict' using errcode = '40001'; end if;
  return new_revision;
end;
$$;
revoke all on function public.vihem_ekangen_save_settings(jsonb, bigint) from public, anon;
grant execute on function public.vihem_ekangen_save_settings(jsonb, bigint) to authenticated;

create or replace function public.vihem_ekangen_admin_bookings() returns jsonb language plpgsql stable security definer
set search_path = '' as $$
begin
  if not public.vihem_ekangen_is_editor() then raise exception 'Forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'reference', b.reference, 'unit', u.name, 'start_date', b.start_date, 'end_date', b.end_date,
      'guests', b.guests, 'guest_name', b.guest_name, 'guest_email', b.guest_email, 'guest_phone', b.guest_phone,
      'message', b.message, 'total', b.total, 'currency', b.currency, 'status', b.status,
      'free_cancel_until', b.free_cancel_until, 'paid_at', b.paid_at, 'created_at', b.created_at,
      'short_stay_booking_id', b.short_stay_booking_id,
      'refunded_amount', b.refunded_amount, 'retained_fee', b.retained_fee
    ) order by b.created_at desc)
    from vihem_ekangen_private.bookings b join public.vihem_short_stay_units u on u.id = b.unit_id), '[]'::jsonb);
end;
$$;
revoke all on function public.vihem_ekangen_admin_bookings() from public, anon;
grant execute on function public.vihem_ekangen_admin_bookings() to authenticated;

-- Sparar vad som faktiskt återbetalades och vilken avgift som behölls (anropas av edge-funktionerna efter återbetalning).
create or replace function public.vihem_ekangen_record_refund(p_booking_id uuid, p_refunded numeric, p_fee numeric) returns void
language sql security definer set search_path = '' as $$
  update vihem_ekangen_private.bookings set refunded_amount = p_refunded, retained_fee = p_fee where id = p_booking_id;
$$;
revoke all on function public.vihem_ekangen_record_refund(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.vihem_ekangen_record_refund(uuid, numeric, numeric) to service_role;

commit;
