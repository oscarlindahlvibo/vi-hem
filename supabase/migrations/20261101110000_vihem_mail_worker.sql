-- Schemalagd körning för VI-HEM Mail (schemalagda utskick, snooze, notiser). Gör ingenting förrän raden 'mail_worker' i vihem_system_settings
-- finns med enabled = true, function_url och secret (samma mönster som övriga arbetare). Se docs/mail/DRIFT.md.
begin;
create or replace function public.vihem_trigger_mail_worker() returns void
language plpgsql security definer set search_path = public, extensions, net as $$
declare cfg jsonb;
begin
  select value into cfg from public.vihem_system_settings where key = 'mail_worker';
  if cfg is null or coalesce((cfg ->> 'enabled')::boolean, false) is not true or coalesce(cfg ->> 'function_url', '') = '' or coalesce(cfg ->> 'secret', '') = '' then return; end if;
  perform net.http_post(url := cfg ->> 'function_url', headers := jsonb_build_object('Content-Type', 'application/json', 'x-vihem-mail-worker-secret', cfg ->> 'secret'),
    body := jsonb_build_object('scheduled', true, 'time', now()), timeout_milliseconds := 55000);
end;
$$;
revoke all on function public.vihem_trigger_mail_worker() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'vihem-mail-worker') then perform cron.unschedule('vihem-mail-worker'); end if;
  perform cron.schedule('vihem-mail-worker', '* * * * *', $job$ select public.vihem_trigger_mail_worker(); $job$);
end $$;
commit;
