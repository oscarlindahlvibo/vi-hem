-- VI-HEM Mail: brevlådebehörigheter, utskicksregister, synkstatus, ärendehantering, kopplingar, mallar och inställningar.
-- Gmail är auktoritativ källa för meddelanden – inget mejlinnehåll lagras här. Allt som rör klienten går via edge function `vihem-mail`
-- (servicenyckel); klienten har ingen direktåtkomst till tabellerna nedan. Se docs/mail/PLAN.md.
-- Additiv och bakåtkompatibel: befintlig sökning/bevakning/Drive-import (vihem-gmail) fortsätter fungera oförändrad.
begin;

-- 1) Befintlig brevlådetabell: typ, ägare och åtkomstläge
alter table public.vihem_mail_accounts add column if not exists kind text not null default 'shared';
alter table public.vihem_mail_accounts add column if not exists owner_user_id uuid references public.vihem_profiles(id) on delete set null;
alter table public.vihem_mail_accounts add column if not exists access_mode text not null default 'org_shared';
alter table public.vihem_mail_accounts add column if not exists client_enabled boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vihem_mail_accounts_kind_check') then
    alter table public.vihem_mail_accounts add constraint vihem_mail_accounts_kind_check check (kind in ('personal', 'shared'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vihem_mail_accounts_access_mode_check') then
    alter table public.vihem_mail_accounts add constraint vihem_mail_accounts_access_mode_check check (access_mode in ('org_shared', 'restricted'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vihem_mail_accounts_personal_owner_check') then
    alter table public.vihem_mail_accounts add constraint vihem_mail_accounts_personal_owner_check check (kind <> 'personal' or access_mode = 'restricted');
  end if;
end $$;

-- 2) Revisionsloggen får fler åtgärder (befintliga värden bevaras)
alter table public.vihem_mail_audit_events drop constraint if exists vihem_mail_audit_events_action_check;
alter table public.vihem_mail_audit_events add constraint vihem_mail_audit_events_action_check check (action in (
  'account_created', 'account_updated', 'account_deleted', 'connection_tested', 'search', 'message_read', 'attachment_downloaded', 'attachment_linked',
  'watch_rule_created', 'watch_rule_updated', 'watch_rule_deleted', 'watch_run', 'watch_hit_updated', 'mail_listed', 'thread_read', 'thread_modified', 'mail_sent', 'mail_send_unknown', 'draft_saved', 'draft_deleted', 'label_changed',
  'permission_granted', 'permission_changed', 'permission_revoked', 'access_denied', 'link_created', 'link_deleted', 'thread_assigned', 'comment_added',
  'template_changed', 'attachment_saved', 'mailbox_settings_changed', 'sync_failed'));
alter table public.vihem_mail_audit_events add column if not exists thread_id text;
create index if not exists vihem_mail_audit_account_idx on public.vihem_mail_audit_events (mail_account_id, created_at desc);

-- 3) Behörigheter per användare och brevlåda
create table if not exists public.vihem_mail_permissions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  mail_account_id uuid not null references public.vihem_mail_accounts(id) on delete cascade,
  user_id uuid not null references public.vihem_profiles(id) on delete cascade,
  can_read boolean not null default true,
  can_send boolean not null default false,
  can_manage boolean not null default false,
  can_admin boolean not null default false,
  reason text not null default '',
  granted_by uuid references public.vihem_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.vihem_profiles(id) on delete set null,
  check (can_read or not (can_send or can_manage or can_admin))
);
create unique index if not exists vihem_mail_permissions_active_uniq on public.vihem_mail_permissions (mail_account_id, user_id) where revoked_at is null;
create index if not exists vihem_mail_permissions_user_idx on public.vihem_mail_permissions (user_id) where revoked_at is null;

-- Auktoriseringsfunktion. Nivåer: read | send | manage | admin. Samma organisation krävs. Ingen roll ger automatiskt åtkomst.
create or replace function public.vihem_mail_authorize(p_user uuid, p_account uuid, p_level text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.vihem_mail_permissions p
    join public.vihem_mail_accounts a on a.id = p.mail_account_id and a.organisation_id = p.organisation_id
    join public.vihem_profiles u on u.id = p.user_id and u.organisation_id = a.organisation_id
    where p.mail_account_id = p_account and p.user_id = p_user and p.revoked_at is null and a.active and u.active
      and p.can_read
      and case p_level when 'read' then true when 'send' then p.can_send when 'manage' then p.can_manage when 'admin' then p.can_admin else false end
  );
$$;
revoke all on function public.vihem_mail_authorize(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.vihem_mail_authorize(uuid, uuid, text) to service_role;

-- Tilldela/ändra behörighet. Regler: samma organisation, personlig brevlåda kräver orsak, ingen självtilldelning på någon annans personliga brevlåda.
create or replace function public.vihem_mail_grant(p_actor uuid, p_account uuid, p_user uuid, p_read boolean, p_send boolean, p_manage boolean, p_admin boolean, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.vihem_mail_accounts%rowtype; actor public.vihem_profiles%rowtype; target public.vihem_profiles%rowtype; v_id uuid;
begin
  select * into a from public.vihem_mail_accounts where id = p_account;
  select * into actor from public.vihem_profiles where id = p_actor and active;
  select * into target from public.vihem_profiles where id = p_user and active;
  if a.id is null or actor.id is null or target.id is null then raise exception '[E_NOT_FOUND] Brevlåda eller användare finns inte.'; end if;
  if actor.organisation_id <> a.organisation_id or target.organisation_id <> a.organisation_id then raise exception '[E_FORBIDDEN] Fel organisation.'; end if;
  if actor.role <> 'admin' and not public.vihem_mail_authorize(p_actor, p_account, 'admin') then raise exception '[E_FORBIDDEN] Endast administratör kan tilldela brevlådebehörighet.'; end if;
  if target.role not in ('admin', 'staff') then raise exception '[E_INVALID] Brevlådor kan bara tilldelas personal och administratörer.'; end if;
  if (p_send or p_manage or p_admin) and not p_read then raise exception '[E_INVALID] Skicka, hantera och administrera förutsätter läsbehörighet.'; end if;
  if a.kind = 'personal' and a.owner_user_id is distinct from p_user then
    if length(trim(coalesce(p_reason, ''))) < 5 then raise exception '[E_INVALID] Ange en orsak (minst 5 tecken) när någon får åtkomst till en personlig brevlåda.'; end if;
    if p_actor = p_user and not public.vihem_mail_authorize(p_actor, p_account, 'admin') then raise exception '[E_FORBIDDEN] Du kan inte ge dig själv åtkomst till någon annans personliga brevlåda – en annan administratör måste göra det.'; end if;
  end if;
  update public.vihem_mail_permissions set revoked_at = now(), revoked_by = p_actor where mail_account_id = p_account and user_id = p_user and revoked_at is null;
  if p_read then
    insert into public.vihem_mail_permissions (organisation_id, mail_account_id, user_id, can_read, can_send, can_manage, can_admin, reason, granted_by)
      values (a.organisation_id, p_account, p_user, true, coalesce(p_send, false), coalesce(p_manage, false), coalesce(p_admin, false), coalesce(trim(p_reason), ''), p_actor) returning id into v_id;
  end if;
  insert into public.vihem_mail_audit_events (organisation_id, user_id, action, mail_account_id, result, metadata)
    values (a.organisation_id, p_actor, case when p_read then 'permission_granted' else 'permission_revoked' end, p_account, 'ok',
      jsonb_build_object('target_user', p_user, 'read', p_read, 'send', p_send, 'manage', p_manage, 'admin', p_admin, 'reason', coalesce(trim(p_reason), '')));
  return v_id;
end;
$$;
revoke all on function public.vihem_mail_grant(uuid, uuid, uuid, boolean, boolean, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.vihem_mail_grant(uuid, uuid, uuid, boolean, boolean, boolean, boolean, text) to service_role;

-- 4) Utskicksregister (idempotens, ångra/schemalagt, osäkra utfall)
create table if not exists public.vihem_mail_send_ledger (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  mail_account_id uuid not null references public.vihem_mail_accounts(id) on delete cascade,
  user_id uuid not null references public.vihem_profiles(id) on delete cascade,
  client_request_id uuid not null,
  status text not null default 'sending' check (status in ('scheduled', 'sending', 'sent', 'unknown', 'failed', 'cancelled')),
  from_email text not null,
  to_emails text[] not null default '{}',
  subject text not null default '',
  message_id_header text not null,
  thread_id text,
  gmail_message_id text,
  request_hash text not null,
  payload jsonb,
  scheduled_for timestamptz,
  attempts integer not null default 0,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (mail_account_id, client_request_id)
);
create index if not exists vihem_mail_send_ledger_due_idx on public.vihem_mail_send_ledger (scheduled_for) where status = 'scheduled';

-- 5) Synkstatus per brevlåda
create table if not exists public.vihem_mail_sync_state (
  mail_account_id uuid primary key references public.vihem_mail_accounts(id) on delete cascade,
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  history_id text,
  last_sync_at timestamptz,
  last_full_sync_at timestamptz,
  status text not null default 'idle' check (status in ('idle', 'ok', 'error')),
  last_error text not null default '',
  consecutive_failures integer not null default 0,
  watch_expiration timestamptz,
  updated_at timestamptz not null default now()
);

-- 6) Ärendehantering för delade brevlådor
create table if not exists public.vihem_mail_thread_meta (
  mail_account_id uuid not null references public.vihem_mail_accounts(id) on delete cascade,
  thread_id text not null,
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  assigned_to uuid references public.vihem_profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  updated_by uuid references public.vihem_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (mail_account_id, thread_id)
);
create index if not exists vihem_mail_thread_meta_assignee_idx on public.vihem_mail_thread_meta (assigned_to, status);
create table if not exists public.vihem_mail_thread_comments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  mail_account_id uuid not null references public.vihem_mail_accounts(id) on delete cascade,
  thread_id text not null,
  author_id uuid not null references public.vihem_profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists vihem_mail_thread_comments_thread_idx on public.vihem_mail_thread_comments (mail_account_id, thread_id, created_at);
create table if not exists public.vihem_mail_presence (
  mail_account_id uuid not null references public.vihem_mail_accounts(id) on delete cascade,
  thread_id text not null,
  user_id uuid not null references public.vihem_profiles(id) on delete cascade,
  mode text not null check (mode in ('viewing', 'replying')),
  expires_at timestamptz not null,
  primary key (mail_account_id, thread_id, user_id)
);

-- 7) Generella kopplingar mellan mejltrådar och VI-HEM-objekt
create table if not exists public.vihem_mail_thread_links (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  mail_account_id uuid not null references public.vihem_mail_accounts(id) on delete cascade,
  thread_id text not null,
  object_type text not null check (object_type in ('work_order', 'property', 'apartment', 'tenant', 'project', 'document', 'note', 'reminder', 'customer', 'other')),
  object_id text not null,
  label text not null default '',
  created_by uuid references public.vihem_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (mail_account_id, thread_id, object_type, object_id)
);
create index if not exists vihem_mail_thread_links_object_idx on public.vihem_mail_thread_links (organisation_id, object_type, object_id);

-- 8) Mallar och användarinställningar
create table if not exists public.vihem_mail_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  owner_user_id uuid references public.vihem_profiles(id) on delete cascade,
  scope text not null default 'personal' check (scope in ('personal', 'organisation')),
  name text not null check (length(name) between 1 and 120),
  subject text not null default '',
  body_html text not null default '',
  created_by uuid references public.vihem_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'personal' and owner_user_id is not null) or scope = 'organisation')
);
create table if not exists public.vihem_mail_user_prefs (
  user_id uuid primary key references public.vihem_profiles(id) on delete cascade,
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  last_sender jsonb not null default '{}'::jsonb,        -- {account_id: sender_email}
  notify_mode text not null default 'none' check (notify_mode in ('none', 'all', 'important', 'shared', 'assigned')),
  notify_show_sender boolean not null default false,       -- visa avsändare/ämne i notistext (annars bara "Nytt mejl i <brevlåda>")
  load_remote_images text not null default 'ask' check (load_remote_images in ('never', 'ask', 'always')),
  important_senders text[] not null default '{}',
  default_account_id uuid references public.vihem_mail_accounts(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- RLS: aktiveras utan policies = ingen åtkomst för klienter. Edge function använder servicenyckeln och gör egen behörighetskontroll.
alter table public.vihem_mail_permissions enable row level security;
alter table public.vihem_mail_send_ledger enable row level security;
alter table public.vihem_mail_sync_state enable row level security;
alter table public.vihem_mail_thread_meta enable row level security;
alter table public.vihem_mail_thread_comments enable row level security;
alter table public.vihem_mail_presence enable row level security;
alter table public.vihem_mail_thread_links enable row level security;
alter table public.vihem_mail_templates enable row level security;
alter table public.vihem_mail_user_prefs enable row level security;
revoke all on public.vihem_mail_permissions, public.vihem_mail_send_ledger, public.vihem_mail_sync_state, public.vihem_mail_thread_meta, public.vihem_mail_thread_comments,
  public.vihem_mail_presence, public.vihem_mail_thread_links, public.vihem_mail_templates, public.vihem_mail_user_prefs from anon, authenticated;

commit;
