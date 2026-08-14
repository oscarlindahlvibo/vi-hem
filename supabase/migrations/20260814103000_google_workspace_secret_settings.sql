create table if not exists public.vihem_google_workspace_settings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  encrypted_service_account_json text not null default '',
  service_account_hint text not null default '',
  rotated_at timestamptz,
  updated_by uuid references public.vihem_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id)
);

alter table public.vihem_google_workspace_settings enable row level security;
revoke all on public.vihem_google_workspace_settings from anon, authenticated;

comment on table public.vihem_google_workspace_settings is 'Encrypted Google Workspace service-account material. Plaintext is never exposed to clients.';
