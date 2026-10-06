-- Required before enabling role-based Vibo website administration.
-- Additive INSERT/UPDATE guard on Vi-hem profiles; no data, grants or RLS policies are replaced.
begin;
create function public.vihem_vibofast_guard_profile_authority()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  caller_role text;
  caller_org uuid;
  caller_active boolean;
  connection_role text := current_setting('role',true);
begin
  if tg_op = 'UPDATE' then
    if new.id is not distinct from old.id
       and new.role is not distinct from old.role
       and new.organisation_id is not distinct from old.organisation_id
       and new.active is not distinct from old.active then return new; end if;
  end if;

  -- Trust PostgreSQL operators and the existing server-only service client.
  -- current_user cannot be used here: SECURITY DEFINER always changes it.
  if connection_role = 'service_role'
     or (coalesce(connection_role,'none') in ('none','postgres','supabase_admin')
         and session_user in ('postgres','supabase_admin')) then return new; end if;

  select p.role,p.organisation_id,p.active into caller_role,caller_org,caller_active
  from public.vihem_profiles p where p.id = (select auth.uid());

  if tg_op = 'INSERT' then
    if coalesce(caller_active,false) and (caller_role = 'superadmin'
       or (caller_role = 'admin' and new.organisation_id = caller_org and new.role <> 'superadmin'))
       then return new; end if;
  elsif coalesce(caller_active,false) and new.id = old.id then
    if caller_role = 'superadmin' then return new; end if;
    if caller_role = 'admin'
       and old.organisation_id = caller_org and new.organisation_id = caller_org
       and old.role <> 'superadmin' and new.role <> 'superadmin' then return new; end if;
  end if;
  raise exception 'Role, organisation, account identity and active status require an authorised administrator'
    using errcode = '42501';
end;
$$;
revoke all on function public.vihem_vibofast_guard_profile_authority() from public, anon, authenticated;
create trigger trg_vihem_vibofast_guard_profile_authority
before insert or update of id,role,organisation_id,active on public.vihem_profiles
for each row execute function public.vihem_vibofast_guard_profile_authority();
commit;
