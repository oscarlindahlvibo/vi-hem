-- Påminnelser för kalenderhändelser: regler per händelsetyp (source_type) med valbara mottagare, antal dagar före och klockslag.
-- Första regeln: sophämtning, dagen före kl. 07:30. Utskicket sker som app-/pushnotis via create_notification och loggas så att ingen får samma påminnelse två gånger.
begin;

create table if not exists public.vihem_calendar_reminder_rules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  name text not null,
  source_type text not null,
  days_before integer not null default 1 check (days_before between 0 and 30),
  remind_time time not null default '07:30',
  recipient_ids uuid[] not null default '{}'::uuid[],
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, source_type)
);
create table if not exists public.vihem_calendar_reminder_log (
  rule_id uuid not null references public.vihem_calendar_reminder_rules(id) on delete cascade,
  event_id uuid not null references public.vihem_calendar_events(id) on delete cascade,
  user_id uuid not null,
  sent_at timestamptz not null default now(),
  primary key (rule_id, event_id, user_id)
);
drop trigger if exists set_updated_at on public.vihem_calendar_reminder_rules;
create trigger set_updated_at before update on public.vihem_calendar_reminder_rules for each row execute function public.vihem_touch_updated_at();

alter table public.vihem_calendar_reminder_rules enable row level security;
alter table public.vihem_calendar_reminder_log enable row level security;
revoke all on public.vihem_calendar_reminder_log from anon, authenticated;
drop policy if exists "calendar reminder rules readable by staff" on public.vihem_calendar_reminder_rules;
create policy "calendar reminder rules readable by staff" on public.vihem_calendar_reminder_rules for select to authenticated
  using (public.vihem_get_my_role() = 'superadmin' or (organisation_id = public.vihem_get_my_org_id() and public.vihem_get_my_role() in ('staff', 'admin')));
drop policy if exists "calendar reminder rules managed by admin" on public.vihem_calendar_reminder_rules;
create policy "calendar reminder rules managed by admin" on public.vihem_calendar_reminder_rules for all to authenticated
  using (public.vihem_get_my_role() = 'superadmin' or (organisation_id = public.vihem_get_my_org_id() and public.vihem_get_my_role() = 'admin'))
  with check (public.vihem_get_my_role() = 'superadmin' or (organisation_id = public.vihem_get_my_org_id() and public.vihem_get_my_role() = 'admin'));

insert into public.vihem_calendar_reminder_rules (organisation_id, name, source_type, days_before, remind_time, recipient_ids, enabled)
  values ('38fe702d-e72c-49a2-9750-5e0b6934959b', 'Sophämtning', 'waste_schedule_2026', 1, '07:30', '{}', true)
  on conflict (organisation_id, source_type) do nothing;

create or replace function public.vihem_dispatch_calendar_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; e record; v_user uuid; v_sent integer := 0; v_today date := (now() at time zone 'Europe/Stockholm')::date; v_now time := (now() at time zone 'Europe/Stockholm')::time; v_new boolean; v_when text; v_day text;
  v_days text[] := array['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];
begin
  for r in select * from public.vihem_calendar_reminder_rules where enabled and cardinality(recipient_ids) > 0 and v_now >= remind_time loop
    for e in select * from public.vihem_calendar_events where organisation_id = r.organisation_id and source_type = r.source_type and (starts_at at time zone 'Europe/Stockholm')::date = v_today + r.days_before loop
      v_when := case r.days_before when 0 then 'Idag' when 1 then 'Imorgon' else 'Om ' || r.days_before || ' dagar' end;
      v_day := v_days[extract(isodow from (e.starts_at at time zone 'Europe/Stockholm')::date)::int] || ' ' || to_char((e.starts_at at time zone 'Europe/Stockholm')::date, 'FMDD/FMMM');
      foreach v_user in array r.recipient_ids loop
        if not exists (select 1 from public.vihem_profiles p where p.id = v_user and p.organisation_id = r.organisation_id and p.active) then continue; end if;
        insert into public.vihem_calendar_reminder_log (rule_id, event_id, user_id) values (r.id, e.id, v_user) on conflict do nothing;
        get diagnostics v_sent = row_count; v_new := v_sent > 0;
        if v_new then
          perform public.create_notification(v_user, r.organisation_id, v_when || ': ' || e.title, v_day || (case when e.location <> '' then ' · ' || e.location else '' end), 'info', 'calendar', null);
        end if;
      end loop;
    end loop;
  end loop;
  select count(*) into v_sent from public.vihem_calendar_reminder_log where sent_at > now() - interval '1 minute';
  return v_sent;
end;
$$;
revoke all on function public.vihem_dispatch_calendar_reminders() from public, anon, authenticated;
grant execute on function public.vihem_dispatch_calendar_reminders() to service_role;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'vihem-calendar-reminders') then perform cron.unschedule('vihem-calendar-reminders'); end if;
  perform cron.schedule('vihem-calendar-reminders', '* * * * *', $job$ select public.vihem_dispatch_calendar_reminders(); $job$);
end $$;

commit;
