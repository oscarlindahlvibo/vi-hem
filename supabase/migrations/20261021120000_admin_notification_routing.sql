begin;
-- Adminfördelning är skild från användarens egna tysta inställningar.
create table public.vihem_notification_assignments(
 user_id uuid primary key references public.vihem_profiles(id) on delete cascade,
 organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
 settings jsonb not null default '{}',updated_at timestamptz not null default clock_timestamp(),updated_by uuid references public.vihem_profiles(id)
);
alter table public.vihem_notification_assignments enable row level security;
revoke all on public.vihem_notification_assignments from public,anon,authenticated;
grant all on public.vihem_notification_assignments to service_role;
alter table public.vihem_notifications add column category text not null default 'other_notifications';
create function public.vihem_notification_keys() returns text[] language sql immutable as $$
 select array['work_order_assigned','work_order_unassigned','work_order_overdue','work_order_comment','maintenance_created_staff','maintenance_comment_staff','staff_absence_submitted','chat_message','fleet_damage_reported','short_stay_new_booking','short_stay_new_message','jour_swap_available','shift_start_reminder','lunch_start_reminder','lunch_return_reminder','lunch_late_reminder','shift_end_reminder','admin_broadcast','kompetensportalen','website_inquiry','calendar_reminder','other_notifications']::text[];
$$;
create function public.vihem_notification_default(p_role text,p_key text) returns boolean language sql immutable as $$
 select case when p_key in ('short_stay_new_booking','short_stay_new_message','kompetensportalen','website_inquiry') then p_role in ('admin','superadmin') else true end;
$$;
create function public.vihem_notification_assignment_read(p_target uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor public.vihem_profiles; target public.vihem_profiles; row public.vihem_notification_assignments; settings jsonb; begin
 select * into actor from public.vihem_profiles where id=auth.uid();
 select * into target from public.vihem_profiles where id=p_target;
 if actor.id is null or actor.active is not true or actor.role is null or actor.role not in ('admin','superadmin') or target.id is null or target.role is null or target.role not in ('staff','admin','superadmin') or (actor.role<>'superadmin' and actor.organisation_id is distinct from target.organisation_id) then raise exception 'Du saknar behörighet till medarbetaren.' using errcode='42501';end if;
 select * into row from public.vihem_notification_assignments where user_id=p_target and organisation_id=target.organisation_id;
 select jsonb_object_agg(k,coalesce((row.settings->>k)::boolean,public.vihem_notification_default(target.role,k))) into settings from unnest(public.vihem_notification_keys()) k;
 return jsonb_build_object('settings',settings,'revision',coalesce(row.updated_at::text,'initial:'||target.role));
end $$;
create function public.vihem_notification_assignment_save(p_target uuid,p_settings jsonb,p_revision text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare current_state jsonb; target public.vihem_profiles; begin
 perform pg_advisory_xact_lock(hashtextextended('vihem-notification-assignment:'||p_target::text,0));
 select * into target from public.vihem_profiles where id=p_target for update;
 current_state:=public.vihem_notification_assignment_read(p_target);
 if jsonb_typeof(p_settings) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_settings))<>cardinality(public.vihem_notification_keys()) or exists(select 1 from jsonb_each(p_settings) v where not(v.key=any(public.vihem_notification_keys())) or jsonb_typeof(v.value)<>'boolean') then raise exception 'Kontrollera aviseringsvalen.' using errcode='22023';end if;
 if p_revision is distinct from current_state->>'revision' then
  if p_settings=current_state->'settings' then return current_state;end if;
  raise exception 'En annan administratör har ändrat inställningarna. Läs in dem igen.' using errcode='40001';
 end if;
 insert into public.vihem_notification_assignments(user_id,organisation_id,settings,updated_by) values(p_target,target.organisation_id,p_settings,auth.uid())
 on conflict(user_id) do update set organisation_id=excluded.organisation_id,settings=excluded.settings,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 return public.vihem_notification_assignment_read(p_target);
end $$;
create function public.vihem_notification_category(p_type text,p_link text,p_title text) returns text
language sql immutable as $$
 select case
 when p_link like 'kompetensportalen%' then 'kompetensportalen'
 when p_link like 'short-stay%' then case when lower(p_title) like '%meddelande%' then 'short_stay_new_message' else 'short_stay_new_booking' end
 when p_link like '%interests%' or p_link like '%contacts%' then 'website_inquiry'
 when p_link like 'calendar%' then 'calendar_reminder'
 when p_type in ('chat','message','chat_message') or p_link like 'chat/%' then 'chat_message'
 when p_type=any(public.vihem_notification_keys()) then p_type
 else 'other_notifications' end;
$$;
create function public.vihem_notification_routing_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare target public.vihem_profiles; assigned boolean; derived text; begin
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
create trigger trg_vihem_notification_routing_guard before insert on public.vihem_notifications for each row execute function public.vihem_notification_routing_guard();
-- Samma RPC-signatur och ursprungliga kandidater; typinformationen följer med till den centrala grinden.
create or replace function public.create_notification(recipient_id uuid,org_uuid uuid,notification_title text,notification_message text,notification_type text,notification_link text default '',setting_key text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if recipient_id is null then return;end if;
 if setting_key is not null and not public.notification_enabled_for_user(org_uuid,recipient_id,setting_key) then return;end if;
 insert into public.vihem_notifications(user_id,organisation_id,title,message,type,link,category)
 values(recipient_id,org_uuid,notification_title,notification_message,notification_type,coalesce(notification_link,''),case when setting_key=any(public.vihem_notification_keys()) then setting_key else 'other_notifications' end);
end $$;
revoke all on function public.vihem_notification_assignment_read(uuid),public.vihem_notification_assignment_save(uuid,jsonb,text) from public,anon;
grant execute on function public.vihem_notification_assignment_read(uuid),public.vihem_notification_assignment_save(uuid,jsonb,text) to authenticated;
revoke all on function public.vihem_notification_routing_guard() from public,anon,authenticated;
commit;
