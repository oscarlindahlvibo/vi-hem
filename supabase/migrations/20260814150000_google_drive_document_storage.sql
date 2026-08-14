-- Organisation-scoped Google Drive storage metadata.
-- Supabase storage remains available as a controlled fallback for legacy files.
alter table public.vihem_google_workspace_settings
  add column if not exists drive_root_folder_id text not null default '',
  add column if not exists drive_shared_drive_id text not null default '',
  add column if not exists drive_delegated_user text not null default '',
  add column if not exists drive_storage_enabled boolean not null default false,
  add column if not exists drive_fallback_enabled boolean not null default true;

alter table public.vihem_documents
  add column if not exists storage_provider text not null default 'supabase',
  add column if not exists drive_file_id text,
  add column if not exists drive_web_url text,
  add column if not exists drive_folder_id text,
  add column if not exists drive_synced_at timestamptz;

do $$
begin
  alter table public.vihem_documents
    add constraint vihem_documents_storage_provider_check
    check (storage_provider in ('supabase', 'google_drive'));
exception when duplicate_object then null;
end $$;

create index if not exists vihem_documents_drive_file_idx
  on public.vihem_documents(organisation_id, drive_file_id)
  where drive_file_id is not null;

comment on column public.vihem_documents.drive_file_id is 'Google Drive file id when storage_provider is google_drive.';
comment on column public.vihem_documents.storage_provider is 'Primary document storage provider; Supabase is retained for legacy/fallback files.';
