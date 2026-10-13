-- Material & utrustning: begränsad personalåtkomst, intern tjänstereservation, gemensam atomisk registrering.
begin;
create or replace function public.vihem_rental_admin_access(p_org uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.vihem_profiles where id=auth.uid() and active and organisation_id=p_org and role in ('admin','superadmin'));
$$;
-- Ersätter tidigare SECURITY DEFINER-kontroll som använde current_user (funktionsägaren).
create or replace function public.vihem_rental_assert_access(p_org uuid) returns void
language plpgsql stable security definer set search_path=public as $$
begin
 if auth.role()='service_role' or (auth.uid() is null and auth.role() is null and session_user in ('postgres','supabase_admin')) then return; end if;
 if public.vihem_rental_admin_access(p_org) then return; end if;
 raise exception '[E_FORBIDDEN] Administratörsbehörighet krävs.';
end $$;
-- Hela administrationsregistret skyddas i databasen; personal får endast de nedanstående begränsade RPC-svaren.
do $$ declare t text; p record; begin
 foreach t in array array['vihem_rental_settings','vihem_rental_products','vihem_rental_assets','vihem_rental_pricing_rules','vihem_rental_customers','vihem_rental_bookings','vihem_rental_booking_items','vihem_rental_blocks','vihem_rental_contract_versions','vihem_rental_locks','vihem_rental_access_codes','vihem_rental_access_events'] loop
  for p in select policyname from pg_policies where schemaname='public' and tablename=t loop execute format('drop policy %I on public.%I',p.policyname,t); end loop;
  execute format('create policy "Rental administration only" on public.%I for all to authenticated using (public.vihem_rental_admin_access(organisation_id) and public.vihem_rental_enabled(organisation_id)) with check (public.vihem_rental_admin_access(organisation_id) and public.vihem_rental_enabled(organisation_id))',t);
 end loop;
end $$;
revoke execute on function public.vihem_rental_free_assets(uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated;
create or replace function public.vihem_rental_available_assets(target_product_id uuid,target_start_at timestamptz,target_end_at timestamptz)
returns table(asset_id uuid,asset_name text) language plpgsql stable security definer set search_path=public as $$
declare o uuid; begin
 select organisation_id into o from public.vihem_rental_products where id=target_product_id;
 perform public.vihem_rental_assert_access(o);
 return query select * from public.vihem_rental_free_assets(target_product_id,target_start_at,target_end_at);
end $$;

create table if not exists public.vihem_resource_reservations (
 id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.vihem_organisations(id),
 actor_id uuid not null references public.vihem_profiles(id),work_order_id uuid references public.vihem_work_orders(id),
 product_id uuid not null references public.vihem_rental_products(id),asset_id uuid not null references public.vihem_rental_assets(id),
 block_id uuid unique references public.vihem_rental_blocks(id) on delete set null,
 start_at timestamptz not null,end_at timestamptz not null,status text not null default 'reserved' check(status in ('reserved','picked_up','returned','cancelled')),
 notes text not null default '',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(end_at>start_at)
);
create table if not exists public.vihem_resource_operations (
 actor_id uuid not null references public.vihem_profiles(id),operation_id uuid not null,organisation_id uuid not null,
 request_hash text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,operation_id)
);
alter table public.vihem_resource_reservations enable row level security;
alter table public.vihem_resource_operations enable row level security;
revoke all on public.vihem_resource_reservations,public.vihem_resource_operations from public,anon,authenticated;
grant all on public.vihem_resource_reservations,public.vihem_resource_operations to service_role;
create index if not exists vihem_resource_actor_time on public.vihem_resource_reservations(actor_id,start_at);
create index if not exists vihem_resource_work_order on public.vihem_resource_reservations(work_order_id);

create or replace function public.vihem_resource_actor() returns public.vihem_profiles
language plpgsql stable security definer set search_path=public as $$
declare a public.vihem_profiles; begin
 select * into a from public.vihem_profiles where id=auth.uid();
 if a.id is null or a.active is not true or a.role is null or a.role not in ('staff','admin','superadmin') or a.organisation_id is null then raise exception 'Du saknar behörighet.' using errcode='42501'; end if;
 return a;
end $$;
revoke all on function public.vihem_resource_actor() from public,anon,authenticated;

create or replace function public.vihem_resource_catalog() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare a public.vihem_profiles:=public.vihem_resource_actor(); m boolean; r boolean; begin
 select exists(select 1 from public.vihem_organisation_modules where organisation_id=a.organisation_id and module_key='inventory_management' and enabled) into m;
 r:=public.vihem_rental_enabled(a.organisation_id);
 return jsonb_build_object(
 'materials',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'code',i.article_number,'barcode',i.barcode,'qr',i.qr_identifier,'unit',i.unit)) from public.vihem_inventory_stock_items i where m and i.organisation_id=a.organisation_id and i.active),'[]'::jsonb),
 'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name)) from public.vihem_inventory_locations l where m and l.organisation_id=a.organisation_id and l.active),'[]'::jsonb),
 'balances',coalesce((select jsonb_agg(jsonb_build_object('item_id',b.item_id,'location_id',b.location_id,'quantity',b.quantity)) from public.vihem_inventory_balances b where m and b.organisation_id=a.organisation_id),'[]'::jsonb),
 'equipment',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'product_id',p.id,'name',p.name||' · '||x.name,'code',x.internal_identifier,'location',coalesce(nullif(x.location,''),p.location))) from public.vihem_rental_assets x join public.vihem_rental_products p on p.id=x.product_id and p.organisation_id=x.organisation_id where r and x.organisation_id=a.organisation_id and x.active and p.active and x.status='available'),'[]'::jsonb),
 'work_orders',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'title',w.title)) from public.vihem_work_orders w where w.organisation_id=a.organisation_id and w.status not in ('completed','cancelled','closed')),'[]'::jsonb));
end $$;

create or replace function public.vihem_resource_availability(p_asset uuid,p_start timestamptz,p_end timestamptz) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare a public.vihem_profiles:=public.vihem_resource_actor(); x public.vihem_rental_assets; candidates timestamptz[]; slot timestamptz; duration interval;
begin
 if not public.vihem_rental_enabled(a.organisation_id) then raise exception 'Uthyrning är inte aktiverad.'; end if;
 select * into x from public.vihem_rental_assets where id=p_asset and organisation_id=a.organisation_id and active and exists(select 1 from public.vihem_rental_products p where p.id=product_id and p.organisation_id=a.organisation_id and p.active);
 if x.id is null then raise exception 'Utrustningen är inte tillgänglig.' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_end<=p_start or p_end-p_start>interval '366 days' then raise exception 'Välj en giltig period.'; end if;
 if exists(select 1 from public.vihem_rental_free_assets(x.product_id,p_start,p_end) f where f.asset_id=x.id) then return jsonb_build_object('available',true); end if;
 duration:=p_end-p_start;
 -- Visa endast nästa möjliga period, aldrig kund, pris, orderreferens eller spärrorsak.
 for slot in
 select t from (
  select i.end_at+make_interval(mins=>coalesce(p.buffer_minutes,s.default_return_buffer_minutes,0)) as t from public.vihem_rental_booking_items i join public.vihem_rental_bookings b on b.id=i.booking_id join public.vihem_rental_products p on p.id=i.product_id left join public.vihem_rental_settings s on s.organisation_id=p.organisation_id where i.asset_id=x.id and b.status in ('pending','confirmed','active') and (b.status<>'pending' or b.hold_expires_at is null or b.hold_expires_at>now())
  union select z.end_at from public.vihem_rental_blocks z where z.organisation_id=a.organisation_id and (z.asset_id=x.id or (z.asset_id is null and (z.product_id is null or z.product_id=x.product_id)))
 ) ends where t>=p_start and t<p_start+interval '366 days' order by t limit 100
 loop
  if exists(select 1 from public.vihem_rental_free_assets(x.product_id,slot,slot+duration) f where f.asset_id=x.id) then return jsonb_build_object('available',false,'next_start',slot,'next_end',slot+duration); end if;
 end loop;
 return jsonb_build_object('available',false);
end $$;

create or replace function public.vihem_resource_checkout(p_operation uuid,p_materials jsonb,p_equipment jsonb,p_work_order uuid default null,p_notes text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare a public.vihem_profiles:=public.vihem_resource_actor(); previous public.vihem_resource_operations; line jsonb; x public.vihem_rental_assets;
 request_hash text:=encode(sha256(convert_to(jsonb_build_array(p_materials,p_equipment,p_work_order,p_notes)::text,'UTF8')),'hex'); ids uuid[]:='{}'; txs uuid[]:='{}'; created_id uuid; block uuid; start_time timestamptz; end_time timestamptz; buffer interval; quantity numeric;
begin
 if p_operation is null or jsonb_typeof(p_materials) is distinct from 'array' or jsonb_typeof(p_equipment) is distinct from 'array' or jsonb_array_length(p_materials)+jsonb_array_length(p_equipment) not between 1 and 100 then raise exception 'Kontrollera valda rader.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a.id::text||p_operation::text,0));
 select * into previous from public.vihem_resource_operations where actor_id=a.id and operation_id=p_operation;
 if found then
  if previous.organisation_id<>a.organisation_id or previous.request_hash<>request_hash then raise exception 'Registreringen har ändrats.'; end if;
  return previous.result;
 end if;
 if p_work_order is not null and not exists(select 1 from public.vihem_work_orders where id=p_work_order and organisation_id=a.organisation_id) then raise exception 'Arbetsordern är inte tillgänglig.' using errcode='42501'; end if;
 if jsonb_array_length(p_materials)>0 and not exists(select 1 from public.vihem_organisation_modules where organisation_id=a.organisation_id and module_key='inventory_management' and enabled) then raise exception 'Lager är inte aktiverat.'; end if;
 if jsonb_array_length(p_equipment)>0 and not public.vihem_rental_enabled(a.organisation_id) then raise exception 'Uthyrning är inte aktiverad.'; end if;
 -- Samma produktlås som kundbokningar. Maskiner kontrolleras och spärras före lageruttag, i samma transaktion.
 perform pg_advisory_xact_lock(hashtextextended('vihem_rental:'||p::text,0)) from (select distinct e->>'product_id' as p from jsonb_array_elements(p_equipment) e order by 1) products;
 for line in select value from jsonb_array_elements(p_equipment) loop
  select * into x from public.vihem_rental_assets where id=(line->>'asset_id')::uuid and organisation_id=a.organisation_id and active and exists(select 1 from public.vihem_rental_products p where p.id=product_id and p.organisation_id=a.organisation_id and p.active);
  if x.id is null or x.product_id is distinct from (line->>'product_id')::uuid then raise exception 'Utrustningen är inte tillgänglig.' using errcode='42501'; end if;
  start_time:=(line->>'start_at')::timestamptz;end_time:=(line->>'end_at')::timestamptz;
  if start_time is null or end_time is null or start_time<now()-interval '5 minutes' or end_time<=start_time or end_time-start_time>interval '366 days' then raise exception 'Kontrollera bokningstiden.'; end if;
  if not exists(select 1 from public.vihem_rental_free_assets(x.product_id,start_time,end_time) f where f.asset_id=x.id) then raise exception 'Utrustningen är upptagen under perioden.'; end if;
  select make_interval(mins=>coalesce(p.buffer_minutes,s.default_return_buffer_minutes,0)) into buffer from public.vihem_rental_products p left join public.vihem_rental_settings s on s.organisation_id=p.organisation_id where p.id=x.product_id;
  insert into public.vihem_rental_blocks(organisation_id,product_id,asset_id,start_at,end_at,block_type,reason,created_by)
  values(a.organisation_id,x.product_id,x.id,start_time-buffer,end_time+buffer,'internal_use','Tjänstebruk · '||coalesce(a.name,'Medarbetare'),a.id) returning public.vihem_rental_blocks.id into block;
  insert into public.vihem_resource_reservations(organisation_id,actor_id,work_order_id,product_id,asset_id,block_id,start_at,end_at,notes)
  values(a.organisation_id,a.id,p_work_order,x.product_id,x.id,block,start_time,end_time,left(coalesce(p_notes,''),2000)) returning public.vihem_resource_reservations.id into created_id;
  ids:=array_append(ids,created_id);
 end loop;
 for line in select value from jsonb_array_elements(p_materials) order by value->>'item_id',value->>'location_id' loop
  quantity:=(line->>'quantity')::numeric;
  if quantity is null or quantity<=0 or quantity::text in ('NaN','Infinity','-Infinity') or not exists(select 1 from public.vihem_inventory_stock_items where id=(line->>'item_id')::uuid and organisation_id=a.organisation_id and active) or not exists(select 1 from public.vihem_inventory_locations where id=(line->>'location_id')::uuid and organisation_id=a.organisation_id and active) then raise exception 'Kontrollera material och lagerplats.' using errcode='42501'; end if;
  created_id:=public.vihem_inventory_apply_transaction((line->>'item_id')::uuid,quantity,'stock_out',(line->>'location_id')::uuid,null,null,p_work_order,'Intern tjänsteanvändning',left(coalesce(p_notes,''),2000),null);
  txs:=array_append(txs,created_id);
 end loop;
 insert into public.vihem_resource_operations values(a.id,p_operation,a.organisation_id,request_hash,jsonb_build_object('reservations',ids,'transactions',txs),now());
 return jsonb_build_object('reservations',ids,'transactions',txs);
end $$;

create or replace function public.vihem_resource_history(p_work_order uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare a public.vihem_profiles:=public.vihem_resource_actor(); begin
 if p_work_order is not null and not exists(select 1 from public.vihem_work_orders where id=p_work_order and organisation_id=a.organisation_id) then raise exception 'Arbetsordern är inte tillgänglig.' using errcode='42501'; end if;
 return jsonb_build_object('reservations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',p.name||' · '||x.name,'actor_id',r.actor_id,'work_order_id',r.work_order_id,'start_at',r.start_at,'end_at',r.end_at,'status',r.status) order by r.start_at desc) from public.vihem_resource_reservations r join public.vihem_rental_products p on p.id=r.product_id join public.vihem_rental_assets x on x.id=r.asset_id where r.organisation_id=a.organisation_id and (case when p_work_order is null then r.actor_id=a.id else r.work_order_id=p_work_order end)),'[]'::jsonb),
 'materials',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',i.name,'quantity',t.quantity,'unit',i.unit,'created_at',t.created_at) order by t.created_at desc) from public.vihem_inventory_transactions t join public.vihem_inventory_stock_items i on i.id=t.item_id where t.organisation_id=a.organisation_id and t.transaction_type='stock_out' and (case when p_work_order is null then t.created_by=a.id else t.work_order_id=p_work_order end)),'[]'::jsonb));
end $$;
create or replace function public.vihem_resource_update(p_id uuid,p_action text) returns void
language plpgsql security definer set search_path=public as $$
declare a public.vihem_profiles:=public.vihem_resource_actor(); r public.vihem_resource_reservations; begin
 select * into r from public.vihem_resource_reservations where id=p_id and organisation_id=a.organisation_id;
 if r.id is null or (r.actor_id<>a.id and a.role not in ('admin','superadmin')) then raise exception 'Reservationen är inte tillgänglig.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('vihem_rental:'||r.product_id::text,0));
 select * into r from public.vihem_resource_reservations where id=p_id for update;
 if r.status=p_action and p_action in ('cancelled','returned','picked_up') then return; end if;
 if (p_action='cancelled' and r.status='reserved') or (p_action='returned' and r.status in ('reserved','picked_up')) then
  delete from public.vihem_rental_blocks where id=r.block_id and organisation_id=a.organisation_id;
 elsif not (p_action='picked_up' and r.status='reserved' and r.start_at<=now()) then raise exception 'Åtgärden går inte att utföra på reservationen.'; end if;
 update public.vihem_resource_reservations set status=p_action,updated_at=now() where id=r.id;
end $$;
-- Administrativ översikt hålls separat från personalens egen historik.
create or replace function public.vihem_resource_admin_reservations() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare a public.vihem_profiles:=public.vihem_resource_actor(); begin
 perform public.vihem_rental_assert_access(a.organisation_id);
 return coalesce((select jsonb_agg(to_jsonb(rows) order by rows.start_at desc) from (
 select r.id,p.name||' · '||x.name as name,u.name as employee,w.title as work_order,r.start_at,r.end_at,r.status,r.notes
 from public.vihem_resource_reservations r join public.vihem_rental_products p on p.id=r.product_id
 join public.vihem_rental_assets x on x.id=r.asset_id join public.vihem_profiles u on u.id=r.actor_id
 left join public.vihem_work_orders w on w.id=r.work_order_id
 where r.organisation_id=a.organisation_id order by r.start_at desc limit 200
 ) rows),'[]'::jsonb);
end $$;
revoke all on function public.vihem_resource_admin_reservations() from public,anon;
grant execute on function public.vihem_resource_admin_reservations() to authenticated;
-- Exponera endast de begränsade arbetsflödena för inloggade medarbetare.
revoke all on function public.vihem_resource_catalog(),public.vihem_resource_availability(uuid,timestamptz,timestamptz),public.vihem_resource_checkout(uuid,jsonb,jsonb,uuid,text),public.vihem_resource_history(uuid),public.vihem_resource_update(uuid,text) from public,anon;
grant execute on function public.vihem_resource_catalog(),public.vihem_resource_availability(uuid,timestamptz,timestamptz),public.vihem_resource_checkout(uuid,jsonb,jsonb,uuid,text),public.vihem_resource_history(uuid),public.vihem_resource_update(uuid,text) to authenticated;
commit;
