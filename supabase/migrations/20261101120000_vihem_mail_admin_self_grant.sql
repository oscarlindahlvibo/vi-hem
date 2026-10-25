-- En organisationsadmin får ge sig själv åtkomst till en annan persons personliga brevlåda, men bara med en orsak (minst 5 tecken).
-- Åtgärden loggas i audit (permission_granted med orsak) och ägaren notifieras av edge function. Ersätter spärren mot självtilldelning från 20261101100000.
begin;
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
commit;
