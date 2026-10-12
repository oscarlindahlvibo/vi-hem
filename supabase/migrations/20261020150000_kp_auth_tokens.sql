-- Kompetensportalen 2.0 – del F: egen e-postverifiering och lösenordsåterställning (märkta Kompetensportalen-mejl, inga beroenden på delade Auth-mallar/redirect-listor).
begin;

create table if not exists public.vihem_kp_auth_tokens (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('verify', 'reset')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.vihem_kp_auth_tokens enable row level security;
revoke all on public.vihem_kp_auth_tokens from anon, authenticated;

insert into public.vihem_kp_email_templates (organisation_id, key, name, subject, body)
select s.organisation_id, t.key, t.name, t.subject, t.body from public.vihem_kp_settings s cross join (values
  ('verify_email', 'Bekräfta e-postadress', 'Bekräfta din e-postadress hos Kompetensportalen', E'Hej {{name}},\n\nBekräfta din e-postadress för att aktivera ditt konto:\n{{link}}\n\nLänken gäller i 48 timmar. Om du inte har skapat något konto kan du bortse från detta mejl.\n\nVänliga hälsningar\nKompetensportalen / WPE Sweden AB'),
  ('password_reset', 'Återställ lösenord', 'Återställ ditt lösenord', E'Hej {{name}},\n\nDu har bett om att återställa ditt lösenord. Välj ett nytt lösenord här:\n{{link}}\n\nLänken gäller i 2 timmar. Om du inte har bett om detta kan du bortse från mejlet – ditt lösenord är oförändrat.\n\nVänliga hälsningar\nKompetensportalen / WPE Sweden AB')
) as t(key, name, subject, body) on conflict (organisation_id, key) do nothing;

-- Ger deltagare/kunder samma standardmallar vid nyinstallation
create or replace function public.vihem_kp_seed_auth_templates(p_org uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.vihem_kp_email_templates (organisation_id, key, name, subject, body)
  select p_org, key, name, subject, body from public.vihem_kp_email_templates where key in ('verify_email', 'password_reset') limit 2 on conflict (organisation_id, key) do nothing;
$$;
revoke all on function public.vihem_kp_seed_auth_templates(uuid) from public, anon, authenticated;


create or replace function public.vihem_kp_find_user(p_email text) returns table (id uuid, confirmed boolean, first_name text)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email_confirmed_at is not null, coalesce(u.raw_user_meta_data ->> 'first_name', '') from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
$$;
revoke all on function public.vihem_kp_find_user(text) from public, anon, authenticated;
grant execute on function public.vihem_kp_find_user(text) to service_role;

commit;
