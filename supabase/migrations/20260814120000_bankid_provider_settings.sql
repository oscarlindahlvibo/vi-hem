create table if not exists public.vihem_bankid_settings (
  organisation_id uuid primary key references public.vihem_organisations(id) on delete cascade,
  environment text not null default 'test' check (environment in ('test', 'production')),
  enabled boolean not null default false,
  login_enabled boolean not null default false,
  signing_enabled boolean not null default false,
  encrypted_api_user text not null default '',
  encrypted_password text not null default '',
  encrypted_company_api_guid text not null default '',
  api_user_hint text not null default '',
  company_api_guid_hint text not null default '',
  provider_note text not null default '',
  updated_by uuid references public.vihem_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vihem_bankid_orders (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  order_ref text not null unique,
  flow text not null check (flow in ('auth', 'sign')),
  requested_email text,
  user_id uuid references public.vihem_profiles(id) on delete set null,
  contract_id uuid references public.vihem_contract_signatures(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'complete', 'failed', 'cancelled')),
  completion_data jsonb,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vihem_bankid_settings enable row level security;
alter table public.vihem_bankid_orders enable row level security;
revoke all on public.vihem_bankid_settings from anon, authenticated;
revoke all on public.vihem_bankid_orders from anon, authenticated;

comment on table public.vihem_bankid_settings is 'Encrypted BankSignering credentials. Plaintext is never exposed to clients.';
comment on table public.vihem_bankid_orders is 'Short-lived server-side BankID order state.';
