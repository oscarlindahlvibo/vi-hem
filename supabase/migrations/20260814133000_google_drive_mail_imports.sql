create table if not exists public.vihem_google_drive_settings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  folder_id text not null default '',
  enabled boolean not null default false,
  auto_import boolean not null default false,
  updated_by uuid references public.vihem_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id)
);

create table if not exists public.vihem_mail_drive_imports (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  mail_account_id uuid not null references public.vihem_mail_accounts(id) on delete cascade,
  watch_hit_id uuid references public.vihem_mail_watch_hits(id) on delete set null,
  gmail_message_id text not null,
  gmail_attachment_id text not null,
  original_filename text not null default '',
  stored_filename text not null default '',
  drive_file_id text,
  drive_web_url text,
  status text not null default 'uploaded' check (status in ('uploaded', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mail_account_id, gmail_message_id, gmail_attachment_id)
);

create index if not exists vihem_mail_drive_imports_org_idx on public.vihem_mail_drive_imports(organisation_id, created_at desc);
alter table public.vihem_google_drive_settings enable row level security;
alter table public.vihem_mail_drive_imports enable row level security;
revoke all on public.vihem_google_drive_settings from anon, authenticated;
revoke all on public.vihem_mail_drive_imports from anon, authenticated;

alter table public.vihem_mail_audit_events drop constraint if exists vihem_mail_audit_events_action_check;
alter table public.vihem_mail_audit_events add constraint vihem_mail_audit_events_action_check check (action in (
  'account_created', 'account_updated', 'account_deleted', 'connection_tested',
  'search', 'message_read', 'attachment_downloaded', 'attachment_linked',
  'watch_rule_created', 'watch_rule_updated', 'watch_rule_deleted', 'watch_run',
  'drive_settings_updated'
));
