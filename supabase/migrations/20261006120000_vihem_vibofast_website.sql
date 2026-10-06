-- Additive Vi-hem website extension. NEVER run historic migrations on the shared instance.
-- Execute only this file manually, inside its transaction, after staging verification.
begin;
create schema if not exists vihem_vibofast_private;
revoke all on schema vihem_vibofast_private from public, anon, authenticated;

create table vihem_vibofast_private.site_content (
  id boolean primary key default true check(id),
  organisation_id uuid not null references public.vihem_organisations(id),
  content jsonb not null default '{}' check(jsonb_typeof(content) = 'object'),
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
-- No organisation is guessed or seeded. Bind Vibo explicitly during manual deployment.
create table vihem_vibofast_private.adverts (
  source_id uuid primary key references public.vihem_apartments(id) on delete cascade,
  ready_from date,
  published boolean not null default false,
  payload jsonb not null default '{}' check(jsonb_typeof(payload) = 'object'),
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  check(not published or (
    coalesce(length(payload->>'slug'),0)>0 and coalesce(length(payload->>'title'),0)>0
    and jsonb_typeof(payload->'images')='array' and jsonb_array_length(payload->'images')>0
    and payload->>'listingType' in ('apartment','commercial','office','retail','warehouse','storage','garage')
    and payload->>'leaseType' in ('tillsvidare','visstid')
    and payload->>'rentType' in ('warmhyra','kallhyra')
    and jsonb_typeof(payload->'utilities')='object'
    and jsonb_typeof(payload->'features')='array'
    and coalesce(length(payload->>'description'),0)>0
  ) is true)
);
create unique index vihem_vibofast_advert_slug on vihem_vibofast_private.adverts ((payload->>'slug')) where payload ? 'slug';
create table vihem_vibofast_private.enquiries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('contact','interest')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
-- Defence in depth: no table is directly exposed, no anonymous write access.
alter table vihem_vibofast_private.site_content enable row level security;
alter table vihem_vibofast_private.adverts enable row level security;
alter table vihem_vibofast_private.enquiries enable row level security;

create function public.vihem_vibofast_is_editor() returns boolean language sql stable security definer
set search_path = '' as $$
  select exists(select 1 from public.vihem_profiles p
 join vihem_vibofast_private.site_content c on c.organisation_id = p.organisation_id
 where p.id = (select auth.uid()) and p.active and p.role = 'admin');
$$;
revoke all on function public.vihem_vibofast_is_editor() from public, anon;
grant execute on function public.vihem_vibofast_is_editor() to authenticated;

-- Read authoritative Vi-hem data, without changing apartments, tenancies or contracts.
-- A future new tenancy suppresses advertising immediately. Missing termination dates fail closed.
create function vihem_vibofast_private.available_from(p_apartment_id uuid, p_today date)
returns date language sql stable set search_path = '' as $$
 with tenancies as (
 select t.*, coalesce(t.end_date,(select max(r.requested_move_out_date)
 from public.vihem_termination_requests r where r.tenancy_id=t.id
 and r.organisation_id=t.organisation_id and r.status='approved')) as effective_end
 from public.vihem_tenancies t where t.apartment_id=p_apartment_id
 )
 select case
 when a.status in ('blocked','renovation') or not pr.active then null
 -- A signed future lease reserves the apartment even if tenancy creation reported a conflict.
 when exists(select 1 from public.vihem_agreements g
 join public.vihem_agreement_entity_links l on l.agreement_id=g.id
 cross join lateral (select v.blocks from public.vihem_agreement_versions v
   where v.agreement_id=g.id order by v.version_number desc limit 1) latest
 cross join lateral jsonb_array_elements(latest.blocks) block
 where g.organisation_id=a.organisation_id and g.document_type='agreement' and g.status='signed'
   and l.entity_type='apartment' and l.entity_id=a.id
   and block->>'block_type'='date' and (block->'content'->>'label') ~* 'tillträd|inflytt|start'
   and (block->'content'->>'value') ~ '^\d{4}-\d{2}-\d{2}$'
   and block->'content'->>'value' > p_today::text) then null
 when exists(select 1 from tenancies t
   where t.organisation_id is distinct from a.organisation_id or
   (t.status in ('active','terminated') and (t.effective_end is null or t.start_date > p_today))) then null
 when a.status='vacant' or exists(select 1 from tenancies t where t.effective_end is not null)
 then greatest(coalesce((select max(t.effective_end)+1 from tenancies t),p_today),d.ready_from)
 else null end
 from public.vihem_apartments a join public.vihem_properties pr on pr.id=a.property_id
 join vihem_vibofast_private.site_content c on c.organisation_id=a.organisation_id and c.organisation_id=pr.organisation_id
 left join vihem_vibofast_private.adverts d on d.source_id=a.id
 where a.id=p_apartment_id;
$$;

create function public.vihem_vibofast_public_site() returns jsonb language sql stable security definer
set search_path = '' as $$
 select jsonb_build_object(
 'content', coalesce((select content from vihem_vibofast_private.site_content where id),'{}'::jsonb),
 'listings', coalesce((select jsonb_agg(s.payload || jsonb_build_object(
   'id',d.source_id,'available',a.available_from,
   'rent',u.rent,'area',u.size,'rooms',u.rooms,
   'address',pr.address,'city',pr.city,'postalCode',pr.zip,
   'rentLabel','kr/mån','areaLabel','kvm',
   'status',case when a.available_from > (now() at time zone 'Europe/Stockholm')::date then 'coming' else 'available' end
 ) order by a.available_from, d.source_id)
 from vihem_vibofast_private.adverts d
 join public.vihem_apartments u on u.id=d.source_id
 join public.vihem_properties pr on pr.id=u.property_id
 cross join lateral (select vihem_vibofast_private.available_from(u.id,(now() at time zone 'Europe/Stockholm')::date) as available_from) a
 cross join lateral (select jsonb_object_agg(key,value) as payload from jsonb_each(d.payload)
   where key = any(array['slug','title','region','listingType','leaseType','rentType',
   'bedrooms','bathrooms','description','shortDescription','features','utilities','images'])) s
 where d.published and a.available_from is not null and u.size > 0 and u.rent >= 0 and length(pr.address)>0 and length(pr.city)>0), '[]'::jsonb));
$$;
revoke all on function public.vihem_vibofast_public_site() from public;
grant execute on function public.vihem_vibofast_public_site() to anon, authenticated;

create function public.vihem_vibofast_admin_site() returns jsonb language plpgsql stable security definer
set search_path = '' as $$
begin
 if not public.vihem_vibofast_is_editor() then raise exception 'Forbidden' using errcode='42501'; end if;
 return jsonb_build_object('content',(select to_jsonb(c) from vihem_vibofast_private.site_content c where id),
 'adverts',coalesce((select jsonb_agg(jsonb_build_object(
 'source_id',u.id,'payload',coalesce(d.payload,jsonb_build_object('title',pr.address || ' – ' || u.apartment_number,
 'slug',u.id::text,'listingType',case u.unit_type when 'commercial' then 'commercial' when 'storage' then 'storage' when 'garage' then 'garage' else 'apartment' end,
 'leaseType','tillsvidare','rentType','warmhyra','region','','bedrooms',null,'bathrooms',null,
 'description','','shortDescription','','features','[]'::jsonb,'images','[]'::jsonb,
 'utilities',jsonb_build_object('electricity','not-available','water','not-available','heating','not-available',
 'fiber','not-available','washingMachine','not-available','dryer','not-available'))),
 'published',coalesce(d.published,false),'revision',coalesce(d.revision,0),'lifecycle',u.status,
 'ready_from',d.ready_from,'available_from',vihem_vibofast_private.available_from(u.id,(now() at time zone 'Europe/Stockholm')::date),
 'rent',u.rent,'area',u.size,'rooms',u.rooms))
 from public.vihem_apartments u join public.vihem_properties pr on pr.id=u.property_id
 join vihem_vibofast_private.site_content c on c.organisation_id=u.organisation_id and c.organisation_id=pr.organisation_id
 left join vihem_vibofast_private.adverts d on d.source_id=u.id),'[]'::jsonb),
 'enquiries',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc) from vihem_vibofast_private.enquiries e),'[]'::jsonb));
end;
$$;
create function public.vihem_vibofast_save_content(p_content jsonb,p_revision bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare new_revision bigint;
begin
 if not public.vihem_vibofast_is_editor() then raise exception 'Forbidden' using errcode='42501'; end if;
 if jsonb_typeof(p_content->'company') is distinct from 'object'
 or jsonb_typeof(p_content->'faq') is distinct from 'array'
 or jsonb_typeof(p_content->'text') is distinct from 'object' then
 raise exception 'Innehållet måste innehålla company, faq och text.'; end if;
 if exists(select 1 from unnest(array['name','legalName','tagline','description','phone','phoneMobile',
 'email','officeHours','emergencyPhone','viHemUrl']) field
 where jsonb_typeof(p_content->'company'->field) is distinct from 'string')
 or jsonb_typeof(p_content->'company'->'address') is distinct from 'object'
 or jsonb_typeof(p_content->'company'->'contactPerson') is distinct from 'object'
 or jsonb_typeof(p_content->'company'->'policies') is distinct from 'object'
 or jsonb_typeof(p_content->'company'->'areas') is distinct from 'array' then
 raise exception 'Företagsuppgifterna saknar obligatoriska fält.'; end if;
 if exists(select 1 from jsonb_each(p_content->'text') where jsonb_typeof(value) <> 'string') then
 raise exception 'Sidtexter måste vara textvärden.'; end if;
 if exists(select 1 from jsonb_array_elements(p_content->'faq') category
 where jsonb_typeof(category->'articles') is distinct from 'array'
 or coalesce(length(category->>'slug'),0)=0
 or jsonb_typeof(category->'title') is distinct from 'string') then
 raise exception 'Varje FAQ-kategori behöver rubrik, slug och artikellista.'; end if;
 if exists(select 1 from jsonb_array_elements(p_content->'faq') category
 cross join lateral jsonb_array_elements(category->'articles') article
 where jsonb_typeof(article->'content') is distinct from 'array'
 or coalesce(length(article->>'slug'),0)=0
 or jsonb_typeof(article->'title') is distinct from 'string'
 or jsonb_typeof(article->'excerpt') is distinct from 'string') then
 raise exception 'Varje FAQ-artikel behöver rubrik, slug, ingress och textstycken.'; end if;
 if p_content->'company'->>'viHemUrl' is distinct from 'https://app.vi-hem.se' then
 raise exception 'Hyresgästportalen måste vara https://app.vi-hem.se'; end if;
 update vihem_vibofast_private.site_content set content=p_content, revision=revision+1,updated_at=now()
 where id and revision=p_revision returning revision into new_revision;
 if not found then raise exception 'Innehållet har ändrats. Ladda om innan du sparar.'; end if;
 return new_revision;
end;
$$;
create function public.vihem_vibofast_save_advert(p_source_id uuid,p_payload jsonb,p_published boolean,p_revision bigint,p_ready_from date default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare new_revision bigint;
begin
 if not public.vihem_vibofast_is_editor() then raise exception 'Forbidden' using errcode='42501'; end if;
 if not exists(select 1 from public.vihem_apartments a join public.vihem_properties pr on pr.id=a.property_id
   join vihem_vibofast_private.site_content c on c.organisation_id=a.organisation_id and c.organisation_id=pr.organisation_id
   where a.id=p_source_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_revision=0 then
   insert into vihem_vibofast_private.adverts(source_id,payload,published,ready_from)
   values(p_source_id,p_payload,p_published,p_ready_from) on conflict do nothing returning revision into new_revision;
 else
   update vihem_vibofast_private.adverts set payload=p_payload,published=p_published,ready_from=p_ready_from,revision=revision+1,updated_at=now()
   where source_id=p_source_id and revision=p_revision returning revision into new_revision;
 end if;
 if not found then raise exception 'Annonsen har ändrats. Ladda om innan du sparar.'; end if;
 return new_revision;
end;
$$;
revoke all on function public.vihem_vibofast_admin_site() from public,anon;
revoke all on function public.vihem_vibofast_save_content(jsonb,bigint) from public,anon;
revoke all on function public.vihem_vibofast_save_advert(uuid,jsonb,boolean,bigint,date) from public,anon;
grant execute on function public.vihem_vibofast_admin_site() to authenticated;
grant execute on function public.vihem_vibofast_save_content(jsonb,bigint) to authenticated;
grant execute on function public.vihem_vibofast_save_advert(uuid,jsonb,boolean,bigint,date) to authenticated;

create table vihem_vibofast_private.enquiry_limits (
 fingerprint text not null, created_at timestamptz not null default now()
);
create index vihem_vibofast_enquiry_limit_lookup on vihem_vibofast_private.enquiry_limits(fingerprint,created_at);
alter table vihem_vibofast_private.enquiry_limits enable row level security;
create function public.vihem_vibofast_store_enquiry(p_kind text,p_payload jsonb,p_fingerprint text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare enquiry_id uuid;
begin
 if not exists(select 1 from vihem_vibofast_private.site_content) then raise exception 'Site is not configured'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_fingerprint,0));
 if (select count(*) from vihem_vibofast_private.enquiry_limits
 where fingerprint=p_fingerprint and created_at > now()-interval '1 hour') >= 5 then
 raise exception 'Rate limit' using errcode='P0001'; end if;
 delete from vihem_vibofast_private.enquiry_limits where created_at < now()-interval '1 day';
 insert into vihem_vibofast_private.enquiry_limits(fingerprint) values(p_fingerprint);
 insert into vihem_vibofast_private.enquiries(kind,payload) values(p_kind,p_payload) returning id into enquiry_id;
 return enquiry_id;
end;
$$;
revoke all on function public.vihem_vibofast_store_enquiry(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.vihem_vibofast_store_enquiry(text,jsonb,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('vihem-vibofast-images','vihem-vibofast-images',true,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy "Vibo public images" on storage.objects for select to anon,authenticated using(bucket_id='vihem-vibofast-images');
create policy "Vibo editor image insert" on storage.objects for insert to authenticated
with check(bucket_id='vihem-vibofast-images' and public.vihem_vibofast_is_editor());
create policy "Vibo editor image update" on storage.objects for update to authenticated
using(bucket_id='vihem-vibofast-images' and public.vihem_vibofast_is_editor()) with check(bucket_id='vihem-vibofast-images' and public.vihem_vibofast_is_editor());
create policy "Vibo editor image delete" on storage.objects for delete to authenticated
using(bucket_id='vihem-vibofast-images' and public.vihem_vibofast_is_editor());

commit;
