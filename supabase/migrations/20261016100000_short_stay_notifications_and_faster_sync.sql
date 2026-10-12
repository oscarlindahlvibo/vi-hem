-- Korttid: notiser (med push via befintlig notiskedja) för nya bokningar och nya gästmeddelanden, samt tätare Beds24-synk.
-- Notiserna sker i databasen (triggers) så att synkfunktionerna inte behöver ändras och aldrig kan blockeras av dem.
-- Tätare synk är billig: varje körning gör bara en handfull Beds24-anrop (gränsen är 100 per 5 minuter).
begin;

-- Skydd mot dubbla notiser (t.ex. när en bokning raderas och importeras igen). Inga policies: bara SECURITY DEFINER-kod når den.
create table if not exists public.vihem_short_stay_notification_ledger (
  kind text not null,
  ref text not null,
  created_at timestamptz not null default now(),
  primary key (kind, ref)
);
alter table public.vihem_short_stay_notification_ledger enable row level security;

-- Notifierar all personal/admin i organisationen om korttid är aktiverat (respekterar varje användares egna notisinställning).
create or replace function public.vihem_notify_short_stay(p_org uuid, p_title text, p_message text, p_setting_key text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_short_stay_enabled(p_org) then return; end if;
  for r in select id from public.vihem_profiles where organisation_id = p_org and active and role in ('staff', 'admin') loop
    perform public.create_notification(r.id, p_org, p_title, p_message, 'info', 'short-stay', p_setting_key);
  end loop;
end;
$$;
revoke all on function public.vihem_notify_short_stay(uuid, text, text, text) from public, anon, authenticated;

-- Ny bokning från en kanal/Beds24 (importerad, inte manuellt skapad i VI-HEM).
create or replace function public.vihem_short_stay_notify_new_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_unit text; v_inserted int;
begin
  begin
    if NEW.booking_type <> 'booking' or NEW.is_manual or NEW.end_date < current_date then return NEW; end if;
    insert into public.vihem_short_stay_notification_ledger(kind, ref)
      values ('booking', NEW.organisation_id::text || ':' || coalesce(NEW.external_uid, NEW.id::text)) on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then return NEW; end if;
    select name into v_unit from public.vihem_short_stay_units where id = NEW.unit_id;
    perform public.vihem_notify_short_stay(NEW.organisation_id, 'Ny bokning',
      format('%s: %s, %s, %s–%s', coalesce(nullif(NEW.channel_name, ''), 'Kanal'), coalesce(nullif(NEW.guest_name, ''), nullif(NEW.title, ''), 'Gäst'),
        coalesce(v_unit, 'enhet'), NEW.start_date, NEW.end_date), 'short_stay_new_booking');
  exception when others then
    null; -- en notis får aldrig stoppa synken
  end;
  return NEW;
end;
$$;
drop trigger if exists trg_short_stay_notify_new_booking on public.vihem_short_stay_bookings;
create trigger trg_short_stay_notify_new_booking after insert on public.vihem_short_stay_bookings
  for each row execute function public.vihem_short_stay_notify_new_booking();

-- Nytt meddelande från en gäst (bara färska; äldre historik som importeras första gången ger inga notiser).
create or replace function public.vihem_short_stay_notify_new_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_unit text; v_guest text; v_inserted int;
begin
  begin
    if NEW.source <> 'guest' or NEW.sent_at < now() - interval '24 hours' then return NEW; end if;
    insert into public.vihem_short_stay_notification_ledger(kind, ref)
      values ('message', NEW.organisation_id::text || ':' || NEW.beds24_message_id) on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then return NEW; end if;
    select name into v_unit from public.vihem_short_stay_units where id = NEW.unit_id;
    select guest_name into v_guest from public.vihem_short_stay_bookings
      where organisation_id = NEW.organisation_id and external_uid = 'beds24:' || NEW.beds24_booking_id limit 1;
    perform public.vihem_notify_short_stay(NEW.organisation_id, 'Nytt gästmeddelande',
      format('%s%s: %s', coalesce(nullif(v_guest, ''), 'Gäst'), case when v_unit is not null then ' (' || v_unit || ')' else '' end, left(regexp_replace(NEW.message, '\s+', ' ', 'g'), 140)),
      'short_stay_new_message');
  exception when others then
    null;
  end;
  return NEW;
end;
$$;
drop trigger if exists trg_short_stay_notify_new_message on public.vihem_short_stay_messages;
create trigger trg_short_stay_notify_new_message after insert on public.vihem_short_stay_messages
  for each row execute function public.vihem_short_stay_notify_new_message();

-- Tätare schemalagd synk: bokningar var 5:e minut, meddelanden var 3:e minut (tidigare var 15:e).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'vihem-beds24-sync-every-15-minutes') then perform cron.unschedule('vihem-beds24-sync-every-15-minutes'); end if;
  if exists (select 1 from cron.job where jobname = 'vihem-beds24-messages-every-15-minutes') then perform cron.unschedule('vihem-beds24-messages-every-15-minutes'); end if;
  if exists (select 1 from cron.job where jobname = 'vihem-beds24-sync-every-5-minutes') then perform cron.unschedule('vihem-beds24-sync-every-5-minutes'); end if;
  if exists (select 1 from cron.job where jobname = 'vihem-beds24-messages-every-3-minutes') then perform cron.unschedule('vihem-beds24-messages-every-3-minutes'); end if;
  perform cron.schedule('vihem-beds24-sync-every-5-minutes', '*/5 * * * *', $job$ SELECT public.vihem_trigger_beds24_scheduled_sync(); $job$);
  perform cron.schedule('vihem-beds24-messages-every-3-minutes', '1-59/3 * * * *', $job$ SELECT public.vihem_trigger_beds24_message_sync(); $job$);
end $$;

-- Med tätare körningar växer loggen snabbare: rensa lyckade körningar äldre än 14 dagar (fel och varningar sparas) varje natt.
create or replace function public.vihem_beds24_prune_sync_logs() returns void
language sql security definer set search_path = public as $$
  delete from public.vihem_beds24_sync_logs where status = 'success' and created_at < now() - interval '14 days';
  delete from public.vihem_short_stay_notification_ledger where created_at < now() - interval '60 days';
$$;
revoke all on function public.vihem_beds24_prune_sync_logs() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'vihem-beds24-log-retention') then perform cron.unschedule('vihem-beds24-log-retention'); end if;
  perform cron.schedule('vihem-beds24-log-retention', '20 3 * * *', $job$ SELECT public.vihem_beds24_prune_sync_logs(); $job$);
end $$;

commit;
