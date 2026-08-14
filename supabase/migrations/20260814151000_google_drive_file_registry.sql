create table if not exists public.vihem_google_drive_files (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  source_type text not null,
  source_id uuid,
  source_key text not null,
  filename text not null,
  mime_type text,
  drive_file_id text not null,
  drive_web_url text,
  drive_folder_id text,
  created_by uuid references public.vihem_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organisation_id, source_type, source_key)
);

create index if not exists vihem_google_drive_files_org_source_idx
  on public.vihem_google_drive_files (organisation_id, source_type, source_id);

alter table public.vihem_google_drive_files enable row level security;

drop policy if exists "VIHEM Drive files staff read" on public.vihem_google_drive_files;
create policy "VIHEM Drive files staff read"
  on public.vihem_google_drive_files for select
  using (public.vihem_is_staff_or_admin() and organisation_id = public.vihem_current_organisation_id());

drop policy if exists "VIHEM Drive files staff insert" on public.vihem_google_drive_files;
create policy "VIHEM Drive files staff insert"
  on public.vihem_google_drive_files for insert
  with check (public.vihem_is_staff_or_admin() and organisation_id = public.vihem_current_organisation_id());

comment on table public.vihem_google_drive_files is 'Metadata registry for VI-HEM files copied to an organisation Google Drive.';
