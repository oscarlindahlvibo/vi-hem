-- Preserve the established routing guard for every other notification.
BEGIN;
create or replace function public.vihem_notification_routing_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare target public.vihem_profiles; assigned boolean; derived text; begin
 -- Personal reminders are owned by a person, never assigned by an organisation.
 -- Validate against the actual due reminder before bypassing only organisation routing.
 if NEW.link ~ '^personal-workspace/reminders/[0-9a-f-]{36}$' and exists(
  select 1 from public.vihem_personal_reminders r join public.vihem_profiles p on p.id=r.owner_id
  where r.id::text=split_part(NEW.link,'/',3) and r.owner_id=NEW.user_id and p.active and p.role in ('staff','admin','superadmin')
  and r.completed_at is null and r.cancelled_at is null and r.due_at<=now()
  and (r.note_id is null or exists(select 1 from public.vihem_personal_notes n where n.id=r.note_id and n.owner_id=r.owner_id and n.deleted_at is null))
 ) then
  NEW.category:='other_notifications';NEW.title:='Min arbetsyta';
  select case when r.preview then r.title else 'Du har en personlig påminnelse.' end into NEW.message from public.vihem_personal_reminders r where r.id::text=split_part(NEW.link,'/',3) and r.owner_id=NEW.user_id;
  return NEW;
 end if;
 select * into target from public.vihem_profiles where id=NEW.user_id and organisation_id=NEW.organisation_id and active;
 if target.id is null then return null;end if;
 derived:=public.vihem_notification_category(NEW.type,NEW.link,NEW.title);
 -- Privilegierade verksamhetskategorier kan inte märkas om för att kringgå adminvalet.
 if derived in ('kompetensportalen','website_inquiry') or (derived in ('short_stay_new_booking','short_stay_new_message') and NEW.category not in ('short_stay_new_booking','short_stay_new_message')) or NEW.category is null or not(NEW.category=any(public.vihem_notification_keys())) or NEW.category='other_notifications' then NEW.category:=derived;end if;
 select (a.settings->>NEW.category)::boolean into assigned from public.vihem_notification_assignments a where a.user_id=NEW.user_id and a.organisation_id=NEW.organisation_id;
 assigned:=coalesce(assigned,public.vihem_notification_default(target.role,NEW.category));
 if not assigned or not public.notification_enabled_for_user(NEW.organisation_id,NEW.user_id,NEW.category) then return null;end if;
 return NEW;
end $$;
COMMIT;
