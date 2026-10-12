-- ViboRent 2.0 – administration av avtalsversioner: nytt utkast (kopia av aktivt avtal) och publicering (atomärt byte av aktiv version).
-- Publicerade versioner är oföränderliga (trigger i 20261017100000); bokningar behåller texten de godkände.
begin;

create or replace function public.vihem_rental_new_contract_draft(p_body text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.get_my_org_id(); v_next integer; v_body text; v_id uuid;
begin
  if public.get_my_role() <> 'admin' or not public.vihem_rental_enabled(v_org) then raise exception '[E_FORBIDDEN] Administratörsbehörighet krävs.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rental_contract:' || v_org::text, 0));
  if exists (select 1 from public.vihem_rental_contract_versions where organisation_id = v_org and status = 'draft') then
    raise exception '[E_STATE] Det finns redan ett utkast. Publicera eller radera det först.';
  end if;
  select coalesce(max(version), 0) + 1 into v_next from public.vihem_rental_contract_versions where organisation_id = v_org;
  select coalesce(p_body, (select body from public.vihem_rental_contract_versions where organisation_id = v_org and status = 'active'), '') into v_body;
  insert into public.vihem_rental_contract_versions (organisation_id, version, title, body, status, created_by)
    values (v_org, v_next, 'Uthyrningsavtal', v_body, 'draft', auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.vihem_rental_publish_contract(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.get_my_org_id(); v_row public.vihem_rental_contract_versions%rowtype;
begin
  if public.get_my_role() <> 'admin' or not public.vihem_rental_enabled(v_org) then raise exception '[E_FORBIDDEN] Administratörsbehörighet krävs.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rental_contract:' || v_org::text, 0));
  select * into v_row from public.vihem_rental_contract_versions where id = p_id and organisation_id = v_org for update;
  if v_row.id is null then raise exception '[E_NOT_FOUND] Avtalet hittades inte.'; end if;
  if v_row.status <> 'draft' then raise exception '[E_STATE] Bara utkast kan publiceras.'; end if;
  if length(trim(v_row.body)) < 20 then raise exception '[E_STATE] Avtalstexten är för kort för att publiceras.'; end if;
  update public.vihem_rental_contract_versions set status = 'retired' where organisation_id = v_org and status = 'active';
  update public.vihem_rental_contract_versions set status = 'active', published_at = now() where id = p_id;
end;
$$;

revoke all on function public.vihem_rental_new_contract_draft(text) from public, anon;
revoke all on function public.vihem_rental_publish_contract(uuid) from public, anon;
grant execute on function public.vihem_rental_new_contract_draft(text) to authenticated;
grant execute on function public.vihem_rental_publish_contract(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Personal flyttar en bokning: servern kontrollerar att objekten är lediga (ignorerar bokningen själv), låser per produkt och
-- uppdaterar alla rader. Kodschemat följer med via triggern på bokningen (utfärdad kod får varning i stället för tyst ändring).
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_rental_change_booking_period(p_booking uuid, p_start timestamptz, p_end timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare b public.vihem_rental_bookings%rowtype; i record;
begin
  select * into b from public.vihem_rental_bookings where id = p_booking for update;
  if b.id is null then raise exception '[E_NOT_FOUND] Bokningen hittades inte.'; end if;
  perform public.vihem_rental_assert_access(b.organisation_id);
  if p_end <= p_start then raise exception '[E_PERIOD] Slutet måste vara efter starten.'; end if;
  if b.status in ('cancelled', 'completed') then raise exception '[E_STATE] Bokningen går inte att flytta.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vihem_rental:' || x.product_id::text, 0))
    from (select distinct product_id from public.vihem_rental_booking_items where booking_id = b.id order by 1) x;
  for i in select distinct product_id, asset_id from public.vihem_rental_booking_items where booking_id = b.id loop
    if not exists (select 1 from public.vihem_rental_free_assets(i.product_id, p_start, p_end, b.id) f where f.asset_id = i.asset_id) then
      raise exception '[E_UNAVAILABLE] Objektet är inte ledigt under den nya perioden.';
    end if;
  end loop;
  update public.vihem_rental_booking_items set start_at = p_start, end_at = p_end where booking_id = b.id;
  update public.vihem_rental_bookings set start_at = p_start, end_at = p_end, updated_at = now() where id = b.id;
end;
$$;
revoke all on function public.vihem_rental_change_booking_period(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.vihem_rental_change_booking_period(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- Säkerhetsnät: vilken väg en avbokning än tas (t.ex. statusändring direkt i tabellen) stoppas kommande koder och utfärdade markeras.
create or replace function public.vihem_rental_booking_cancel_effects() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'cancelled' and OLD.status is distinct from 'cancelled' then
    update public.vihem_rental_access_codes set status = 'cancelled', cancelled_at = now(), next_attempt_at = null, updated_at = now()
     where booking_id = NEW.id and status in ('scheduled', 'failed');
    update public.vihem_rental_access_codes set warning = 'Bokningen avbokades efter att koden utfärdats. Offline-koden kan fortfarande fungera tills den löper ut – vidta manuell säkerhetsåtgärd vid behov.', updated_at = now()
     where booking_id = NEW.id and status in ('issuing', 'issued', 'sent');
    if NEW.cancelled_at is null then NEW.cancelled_at := now(); end if;
  end if;
  return NEW;
end;
$$;
drop trigger if exists vihem_rental_booking_cancel_effects on public.vihem_rental_bookings;
create trigger vihem_rental_booking_cancel_effects before update of status on public.vihem_rental_bookings
  for each row execute function public.vihem_rental_booking_cancel_effects();

commit;
