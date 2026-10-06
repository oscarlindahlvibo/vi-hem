-- Generated scoped installer: do not also run the individual migration copies.
-- All extension/profile-guard/seed changes succeed or roll back together.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('vihem_vibofast_install',0));
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.vihem_organisations
 WHERE id='38fe702d-e72c-49a2-9750-5e0b6934959b' AND name='Vibogruppen AB')
 THEN RAISE EXCEPTION 'Verified Vibo organisation not found'; END IF;
 IF to_regnamespace('vihem_vibofast_private') IS NOT NULL
 THEN RAISE EXCEPTION 'Vibo extension already exists: do not reinstall blindly'; END IF;
END $$;
-- Required before enabling role-based Vibo website administration.
-- Additive INSERT/UPDATE guard on Vi-hem profiles; no data, grants or RLS policies are replaced.
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

-- Additive Vi-hem website extension. NEVER run historic migrations on the shared instance.
-- Execute only this file manually, inside its transaction, after staging verification.
create schema if not exists vihem_vibofast_private;
revoke all on schema vihem_vibofast_private from public, anon, authenticated;

create table vihem_vibofast_private.site_content (
  id boolean primary key default true check(id),
  organisation_id uuid not null references public.vihem_organisations(id),
  content jsonb not null default '{}' check(jsonb_typeof(content) = 'object'),
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
-- Bind Vibo explicitly during deployment; all active organisation admins are editors.
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


SET LOCAL vihem_vibofast.organisation_id = '38fe702d-e72c-49a2-9750-5e0b6934959b';
-- Set Vibo's verified organisation UUID in this SQL session first:
-- SET vihem_vibofast.organisation_id = 'REPLACE_WITH_VERIFIED_UUID';
-- Add only this feature's initial content; never overwrite existing content.
INSERT INTO vihem_vibofast_private.site_content(id,organisation_id,content)
VALUES(true,current_setting('vihem_vibofast.organisation_id')::uuid,'{"company":{"name":"Vibo Fastigheter","legalName":"Vibogruppen AB","tagline":"Här börjar din hemlängtan","description":"Vibo Fastigheter hyr ut lägenheter, lokaler, kontor, lager och förråd i Virserum och omnejd. Vi vill att du ska trivas hos oss – i ditt hem, i huset, med grannarna, gården och samhället. Varje dag jobbar vi med att skapa trivsel och hålla det rent och snyggt i våra områden.","phone":"010-214 61 10","phoneMobile":"010-214 61 12","email":"kontakt@vibofast.se","contactPerson":{"name":"Christofer Sakshaug","email":"christofer@vibofast.se","phone":"010-214 61 10","mobile":"010-214 61 12"},"officeHours":"Vardagar kl. 7.00–16.00","emergencyPhone":"010-214 61 10","address":{"street":"Ekängsvägen 1","postalCode":"577 72","city":"Virserum","region":"Hultsfreds kommun","county":"Kalmar län","country":"Sverige"},"viHemUrl":"https://app.vi-hem.se","areas":[{"name":"Virserum","description":"Virserum är en tätort i Hultsfreds kommun, Kalmar län, med omkring 2 000 invånare. Orten ligger vackert vid Virserumsviken vid Emåns dalgång och erbjuder en lugn och naturnära miljö med god tillgång till service, skola och natur."}],"policies":{"rental":"Vi söker skötsamma hyresgäster som visar hänsyn till både bostaden och sina grannar. En individuell prövning görs i varje enskilt fall och du behöver uppfylla vissa grundläggande krav för att kunna hyra bostad hos oss.","youthDiscount":"Vi erbjuder 10 procent rabatt på hyran till ungdomar under 25 år.","smoking":"I samtliga Vibo Fastigheters lägenheter och lokaler råder förbud mot rökning."}},"faq":[{"id":"1","slug":"inomhusmiljo","title":"Inomhusmiljö","icon":"Thermometer","description":"Temperatur, ventilation och hur du skapar ett bra inomhusklimat.","articles":[{"id":"1-1","slug":"temperatur-i-lagenheten","title":"Så mäter du temperaturen i din lägenhet","excerpt":"Om du upplever att det är kallt i din lägenhet kan du börja med att mäta temperaturen på rätt sätt.","content":["Om du upplever att det är kallt i din lägenhet kan du börja med att mäta temperaturen:","1. Placera termometern i mitten av rummet och 1 meter ovanför golvet.","2. Låt termometern ligga stilla i minst 10 minuter innan du avläser.","3. Mät på flera ställen i lägenheten för att få en helhetsbild.","Den normala rumstemperaturen ska vara cirka 20–21 grader Celsius. Om temperaturen avviker mycket, kontakta oss via felanmälan."]},{"id":"1-2","slug":"ventilation","title":"Ventilation och luftkvalitet","excerpt":"Bra ventilation är viktigt för ett hälsosamt inomhusklimat. Så här fungerar det i din lägenhet.","content":["Bra ventilation är viktigt för ett hälsosamt inomhusklimat och för att undvika fukt och mögel.","Våra fastigheter har mekanisk eller självdragsventilation. Se till att ventiler inte blockeras av möbler eller prylar.","Vädra gärna regelbundet genom att öppna fönstret helt i 5–10 minuter, särskilt i sovrum och badrum.","Om du misstänker att ventilationen inte fungerar som den ska, gör en felanmälan så att vi kan undersöka saken."]}]},{"id":"2","slug":"varme","title":"Värme","icon":"Flame","description":"Hur värmesystemet fungerar och vad du gör om det är för kallt eller varmt.","articles":[{"id":"2-1","slug":"hur-värmen-fungerar","title":"Så fungerar värmesystemet","excerpt":"El, vatten och värme ingår i hyran. Så här är värmesystemet uppbyggt i våra fastigheter.","content":["El, vatten och värme ingår i hyran för samtliga Vibo Fastigheters lägenheter och lokaler.","Värmesystemet är inställt för att hålla en behaglig och jämn temperatur i lägenheten. Termostater på elementen reglerar temperaturen per rum.","För att spara energi och hålla en jämn temperatur: håll dörrar öppna mellan rum så att värmen kan sprida sig, och undvik att täcka över elementen med möbler eller gardiner."]},{"id":"2-2","slug":"for-kallt-eller-varmt","title":"Det är för kallt eller för varmt – vad gör jag?","excerpt":"Steg för steg: vad du själv kan göra och när du ska felanmäla.","content":["Om det är för kallt:","1. Kontrollera att termostaten på elementet är öppen och inte stängd.","2. Se till att inga möbler eller gardiner blockerar elementen.","3. Mät temperaturen enligt anvisningarna under \"Inomhusmiljö\".","4. Om temperaturen fortfarande är för låg – gör en felanmälan.","Om det är för varmt:","1. Sänk termostaten på elementet.","2. Vädra genom att öppna fönstret helt i 5–10 minuter.","3. Om problemet kvarstår – kontakta oss."]}]},{"id":"3","slug":"vatten-och-el","title":"Vatten & El","icon":"Zap","description":"Vattenavstängning, elavbrott och andra tekniska frågor.","articles":[{"id":"3-1","slug":"vattenavbrott","title":"Vattenavbrott eller läcka","excerpt":"Vad du gör om vattnet plötsligt försvinner eller om du upptäcker en läcka.","content":["Om vattnet försvinner:","Kontrollera om det är ett allmänt avbrott i området. Hör med grannar eller kontakta kommunen.","Om du upptäcker en läcka:","1. Stäng av huvudkranen i din lägenhet omedelbart.","2. Kontakta oss via felanmälan eller journumret vid akuta läckor.","3. Flytta värdeföremål och möbler bort från vattnet om möjligt."]},{"id":"3-2","slug":"elavbrott","title":"Elavbrott i lägenheten","excerpt":"Vad du gör om strömmen försvinner och hur du säkerställer säkerheten.","content":["Vid elavbrott:","1. Kontrollera proppsäkringen i din lägenhet. Om en säkring har löst ut, försök återställa den.","2. Kontrollera om det är ett allmänt strömavbrott i området.","3. Om problemet kvarstår – kontakta oss via felanmälan.","Vid akuta elproblem utanför kontorstid, ring journumret: 010-214 61 10."]}]},{"id":"4","slug":"nycklar-och-utlasning","title":"Nycklar & Utlåsning","icon":"Key","description":"Tappat nycklar, låst dig ute eller behöver extra nyckel?","articles":[{"id":"4-1","slug":"ar-du-utelast","title":"Har du låst dig ute?","excerpt":"Så här gör du om du har låst dig ute från din lägenhet – kontorstid och jour.","content":["Om du har låst dig ute från din lägenhet kan du få hjälp på följande sätt:","Kontorstid (vardagar kl. 7.00–16.00):","Ring 010-214 61 10 eller mejla kontakt@vibofast.se.","Journummer (övrig tid):","Ring 010-214 61 10.","Observera att om din låscylinder behöver bytas står du som hyresgäst själv för kostnaden."]},{"id":"4-2","slug":"tappade-nycklar","title":"Tappade eller extra nycklar","excerpt":"Vad du gör om du har tappat en nyckel eller behöver en extra nyckel.","content":["Har du tappat en nyckel?","Kontakta oss omedelbart så att vi kan byta låscylinder om det behövs. Detta för din och dina grannars säkerhet.","Behöver du en extra nyckel?","Kontakta oss under kontorstid så hjälper vi dig. En extra nyckel kan medföra en mindre avgift."]}]},{"id":"5","slug":"inflyttning","title":"Inflyttning","icon":"LogIn","description":"Allt du behöver veta innan du flyttar in hos Vibo.","articles":[{"id":"5-1","slug":"innan-du-flyttar-in","title":"Innan du flyttar in – checklista","excerpt":"Stort grattis till din nya bostad! Här är vad du behöver ordna innan inflyttningen.","content":["Stort grattis till din nya bostad! Inför en flytt finns det en del att tänka på. Här är en checklista för att hjälpa dig på väg:","1. Teckna hemförsäkring – det är ett krav för att hyra hos oss.","2. Gör en adressändran hos Skatteverket i god tid innan flytt.","3. Skicka in flyttanmälan till din nuvarande hyresvärd om du har en.","4. Beställ flyttkartonger och börja packa i tid.","5. Boka flytthjälp om du behöver.","6. Avtal och nyckelutlämning sker i samband med inflyttningen. Du får mer information från oss när tiden närmar sig.","7. Skapa ett konto i hyresgästportalen på app.vi-hem.se så kan du hantera din lägenhet, göra felanmälan, boka tvättider och chatta med oss."]},{"id":"5-2","slug":"nyckel-och-avtal","title":"Nyckelutlämning och avtal","excerpt":"Hur det går till när du hämtar nycklar och skriver under ditt hyresavtal.","content":["I samband med inflyttningen får du nycklar till din nya bostad och skriver under ditt hyresavtal.","Du får information om tid och plats för nyckelutlämning från oss i god tid innan inflyttning.","Kom ihåg att ta med legitimation vid nyckelutlämningen."]}]},{"id":"6","slug":"utflyttning","title":"Utflyttning","icon":"LogOut","description":"När det är dags att flytta – vad du behöver veta och göra.","articles":[{"id":"6-1","slug":"checklista-utflyttning","title":"Checklista för utflyttning","excerpt":"Se till att all utrustning finns på plats och att lägenheten är välstädad.","content":["När det är dags att flytta från din lägenhet finns det några saker du behöver tänka på:","1. Säg upp din lägenhet i hyresgästportalen på app.vi-hem.se i god tid innan flytt.","2. Se till att all utrustning som hör till lägenheten finns på plats, t.ex. hatthylla, gardinbeslag och innerdörrar.","3. Lägg inte heltäckande mattor över parkett – ta bort dem innan utflyttning.","4. Lägenheten ska vara välstädad och tömd vid utflyttning.","5. Lämna tillbaka alla nycklar till oss.","6. Gör en flyttanmälan till Skatteverket.","7. Avsluta ditt elavtal om du har ett separat sådant.","Om du är osäker på vad som gäller, kontakta oss i god tid innan flytt så hjälper vi dig."]}]},{"id":"7","slug":"felanmalan-och-jour","title":"Felanmälan & Jour","icon":"Wrench","description":"Hur du felanmäler och når oss vid akuta problem.","articles":[{"id":"7-1","slug":"gor-en-felanmalan","title":"Så gör du en felanmälan","excerpt":"Vid fel i din lägenhet eller fastighet – så här anmäler du det till oss.","content":["Om du upptäcker ett fel i din lägenhet eller i fastigheten ska du göra en felanmälan så snabbt som möjligt.","Felanmälan gör du enklast i vår hyresgästportal på app.vi-hem.se. Där kan du beskriva felet, bifoga bilder och följa status på din anmälan.","Du kan också ringa 010-214 61 10 eller mejla kontakt@vibofast.se under kontorstid (vardagar kl. 7.00–16.00).","Akut felanmälan utanför kontorstid:","Ring journumret 010-214 61 10. Exempel på akuta fel: vattenläcka, strömavbrott, uppvärmning som inte fungerar vintertid, eller skador som utgör en säkerhetsrisk.","Mindre fel som inte kräver omedelbar åtgärd anmäls lämpligast via app.vi-hem.se eller under kontorstid."]},{"id":"7-2","slug":"jourinformation","title":"Jourinformation","excerpt":"Vid akuta problem utanför kontorstid – så når du oss.","content":["Kontorstid (vardagar kl. 7.00–16.00):","Ring 010-214 61 10 eller mejla kontakt@vibofast.se.","Journummer (övrig tid):","Ring 010-214 61 10.","Jour gäller endast för akuta ärenden som inte kan vänta till nästa vardag. Exempel: vattenläcka, elementfel på vintern, hissfel, eller fara för person eller egendom.","För icke-akuta ärenden vänligen använd hyresgästportalen på app.vi-hem.se eller vänta till kontorstid."]}]},{"id":"8","slug":"hyra-och-betalning","title":"Hyra & Betalning","icon":"CreditCard","description":"Frågor om hyra, fakturor, autogiro och betalningsterminer.","articles":[{"id":"8-1","slug":"hur-betalar-jag-hyran","title":"Hur betalar jag hyran?","excerpt":"Information om betalningssätt, autogiro och fakturor.","content":["Hyran betalas månadsvis i förskott. Du får en hyresavin som betalas senast sista vardagen månaden före förfallodagen.","Betalningssätt:","• Autogiro – rekommenderas för smidig betalning varje månad.","• Bankgiro eller plusgiro – se din hyresavin för aktuellt nummer.","Du kan också hantera din hyra och betalningar via hyresgästportalen på app.vi-hem.se.","Om du har frågor om din faktura eller betalning, kontakta oss under kontorstid."]},{"id":"8-2","slug":"ungdomsrabatt","title":"Ungdomsrabatt","excerpt":"Vi erbjuder 10 procent rabatt på hyran till ungdomar under 25 år.","content":["Vi erbjuder 10 procent rabatt på hyran till ungdomar under 25 år.","Rabatten dras av automatiskt om du uppfyller ålderskravet vid avtalstillfället.","För frågor om ungdomsrabatt, kontakta oss under kontorstid."]}]},{"id":"8b","slug":"hyresgastportalen","title":"Hyresgästportalen (VI-HEM)","icon":"Smartphone","description":"Hantera din lägenhet, felanmälan, tvättider och chatt – allt på app.vi-hem.se.","articles":[{"id":"8b-1","slug":"kom-igang-med-vi-hem","title":"Kom igång med VI-HEM","excerpt":"I hyresgästportalen på app.vi-hem.se hanterar du din lägenhet, felanmälan, tvättider och chattar med oss.","content":["Som hyresgäst hos Vibo Fastigheter har du tillgång till hyresgästportalen på app.vi-hem.se. Där kan du:","• Administrera din lägenhet och dina uppgifter","• Göra felanmälan och följa status","• Säger upp din lägenhet vid flytt","• Boka tvättider","• Chatta direkt med oss vid frågor","Har du inte fått inbjudan eller har problem att logga in? Kontakta oss under kontorstid så hjälper vi dig."]},{"id":"8b-2","slug":"boka-tvattider","title":"Boka tvättider","excerpt":"I hyresgästportalen på app.vi-hem.se bokar du tvättider i tvättstugan.","content":["Tvättider bokas via hyresgästportalen på app.vi-hem.se. Där ser du tillgängliga tider och kan boka det som passar dig.","Tänk på att hålla tiden du bokat och städa upp efter dig i tvättstugan så att nästa hyresgäst får det trivsligt.","Har du problem att boka eller inte ser några lediga tider? Kontakta oss under kontorstid."]}]},{"id":"9","slug":"vanliga-fragor","title":"Vanliga frågor","icon":"HelpCircle","description":"Bra att veta om att bo hos Vibo Fastigheter.","articles":[{"id":"9-1","slug":"rökforbud","title":"Rökförbud i lägenheter och lokaler","excerpt":"I samtliga Vibo Fastigheters lägenheter och lokaler råder förbud mot rökning.","content":["I samtliga Vibo Fastigheters lägenheter och lokaler råder förbud mot rökning.","Detta gäller både cigaretter, vattenpipa, e-cigaretter och liknande. Förbudet gäller i både lägenhet och på allmänna ytor i fastigheten.","Om du har frågor om rökförbudet, kontakta oss gärna."]},{"id":"9-2","slug":"husdjur","title":"Husdjur i lägenheten","excerpt":"Regler kring husdjur i våra lägenheter.","content":["Husdjur är välkomna i våra lägenheter. Som djurägare ansvarar du för att ditt djur inte stör grannar eller skadar lägenheten.","Tänk på att hundar ska rastas utomhus och att kattsand inte får spolas i toaletten.","Om du har frågor om husdjur, kontakta oss."]},{"id":"9-3","slug":"uthyrningspolicy","title":"Vår uthyrningspolicy","excerpt":"Vi söker skötsamma hyresgäster som visar hänsyn till bostaden och sina grannar.","content":["Vi söker skötsamma hyresgäster som visar hänsyn till både bostaden och sina grannar.","En individuell prövning görs i varje enskilt fall och du behöver uppfylla vissa grundläggande krav för att kunna hyra bostad hos oss.","För frågor om vår uthyrningspolicy, kontakta oss under kontorstid."]}]}],"text":{"AboutPage.45b9f35e0a":"Om oss","AboutPage.7fbab71c7e":"Här börjar din hemlängtan","AboutPage.b4aec6ef15":"Vårt område","AboutPage.da6015e908":"Smidiga pendlingsavstånd till Hultsfred, Vetlanda, Vimmerby, Oskarshamn, Växjö och Kalmar","AboutPage.e30784aef3":"Bra att veta","AboutPage.dcec646912":"Våra riktlinjer","AboutPage.40314f8828":"Telefon","AboutPage.b3418c9716":"E-post","AboutPage.5c09a76d96":"Adress","AboutPage.a09a0b25a0":"Öppettider","AboutPage.176aeaea00":"Jour:","AboutPage.62b77380fe":"Kontakta oss","ContactPage.a92b9bcb16":"Kontakt","ContactPage.62b77380fe":"Kontakta oss","ContactPage.27b8752c01":"Har du frågor om våra objekt eller vill du boka en visning? Vi finns här för att hjälpa dig.","ContactPage.0f8a0b6bb7":"Kontaktuppgifter","ContactPage.40314f8828":"Telefon","ContactPage.b3418c9716":"E-post","ContactPage.5c09a76d96":"Adress","ContactPage.a09a0b25a0":"Öppettider","ContactPage.176aeaea00":"Jour:","ContactPage.dff2ebf8bf":"Kontaktperson","ContactPage.9479657649":"Tack för ditt meddelande!","ContactPage.42254ef3ab":"Vi återkommer till dig så snart vi kan.","ContactPage.a460647035":"Skicka ett till meddelande","ContactPage.1f458cb267":"Skicka ett meddelande","ContactPage.68a2d213f5":"Fyll i formuläret så återkommer vi till dig.","ContactPage.dc35d12a94":"Namn *","ContactPage.67c9566ba2":"E-post *","ContactPage.21678bcf45":"Ämne","ContactPage.a4e2bd6217":"Meddelande *","ContactPage.1f51ec1b5b":"Skicka meddelande","FaqArticlePage.3432369bee":"Artikeln hittades inte","FaqArticlePage.b119e787e8":"Tillbaka till kunskapsbanken","FaqArticlePage.27360ba855":"Kunskapsbank","FaqArticlePage.29e5bdc4f4":"Behöver du mer hjälp?","FaqArticlePage.56788d455a":"Som hyresgäst kan du hantera din lägenhet, felanmälan, tvättider och chatta med oss i hyresgästportalen.","FaqArticlePage.59ba9896a8":"app.vi-hem.se","FaqArticlePage.615ffdd0a2":"Tillbaka till","FaqCategoryPage.1454881772":"Kategorin hittades inte","FaqCategoryPage.b119e787e8":"Tillbaka till kunskapsbanken","FaqCategoryPage.bf623c04f6":"Andra kategorier","FaqPage.63dc4907b4":"För hyresgäster","FaqPage.27360ba855":"Kunskapsbank","FaqPage.a67404a045":"Här hittar du svar på vanliga frågor om boende, inomhusmiljö, felanmälan, inflyttning, utflyttning och mer.","FaqPage.98314fa41b":"för \"","FaqPage.c1edb38835":"Inga resultat hittades","FaqPage.2afc3de9d2":"Prova ett annat sökord.","FaqPage.4a115ad69c":"Kategorier","HomePage.afb8b334a4":"Hitta ditt drömhem hos oss","HomePage.7f2c3a5f63":"Vi hyr ut lägenheter, lokaler och förråd i Virserum och omnejd. Låt oss hjälpa dig i jakten på ditt drömboende.","HomePage.15e66f68f7":"Se lediga objekt","HomePage.1bfd74a74b":"Intresseanmälan","HomePage.8e1ff837de":"Lediga objekt","HomePage.5bbc716fb9":"Aktuella bostäder och lokaler","HomePage.6cd45430eb":"Visa alla objekt","HomePage.d5635ea698":"Hemma hos oss","HomePage.b71f449df3":"Vi vill att du ska trivas","HomePage.5caa0ac610":"Vi vill att du ska trivas hos oss – i ditt hem, i huset, med grannarna, gården och samhället. Varje dag jobbar vi med att skapa trivsel och hålla det rent och snyggt i våra områden.","HomePage.5e592d0629":"Läs mer om oss","HomePage.a9bf300e2f":"Ett hus byggs av väggar och bjälkar, ett hem byggs av kärlek och drömmar.","HomePage.b4aec6ef15":"Vårt område","HomePage.c581d44d60":"Virserum – naturnära boende","HomePage.63dc4907b4":"För hyresgäster","HomePage.2e425eb9a3":"Kunskapsbank för dig som bor hos oss","HomePage.94081665a8":"Här hittar du svar på vanliga frågor om inomhusmiljö, inflyttning, felanmälan, jour och mycket mer.","HomePage.0121a5c5fd":"Till kunskapsbanken","HomePage.c7930da748":"Det har aldrig varit enklare att hitta din nästa lägenhet","HomePage.3e7e367ad4":"Vi har ett stort utbud av lägenheter och lokaler och hjälper dig gärna hitta just ditt drömboende.","InterestPage.1bfd74a74b":"Intresseanmälan","InterestPage.06903a7d9c":"Lämna din intresseanmälan","InterestPage.716b22b251":"Låt oss veta vad du letar efter så hjälper vi dig att hitta rätt boende. Vi kontaktar dig när vi har något som passar.","InterestPage.c318bc4e03":"Tack för din intresseanmälan!","InterestPage.59aea7f643":"Vi har tagit emot dina uppgifter och återkommer till dig när vi har något som passar dina önskemål.","InterestPage.a957e0c4df":"Berätta vad du söker","InterestPage.0c1b9d1d0f":"Fyll i formuläret så gott du kan – alla fält är inte obligatoriska.","InterestPage.dc35d12a94":"Namn *","InterestPage.67c9566ba2":"E-post *","InterestPage.40314f8828":"Telefon","InterestPage.33b75acdef":"Hur snart vill du flytta in?","InterestPage.228d765ecf":"Typ av objekt","InterestPage.ae2697adfc":"Välj typ","InterestPage.96c66047ea":"Antal rum","InterestPage.614238cfaf":"Övriga önskemål","InterestPage.f227ffa1ab":"Skicka intresseanmälan","PropertiesPage.8e1ff837de":"Lediga objekt","PropertiesPage.afb8b334a4":"Hitta ditt drömhem hos oss","PropertiesPage.7bf0f0ade4":"Vi har ett stort utbud av lägenheter, lokaler och förråd. Filtrera och sortera för att hitta det som passar dig bäst.","PropertiesPage.6eab89a6ab":"Filter:","PropertiesPage.6eb6f6024e":"Alla orter","PropertiesPage.2819160c3a":"Lägst hyra","PropertiesPage.f7575e96dd":"Högst hyra","PropertiesPage.060dfa10ec":"Störst yta","PropertiesPage.61a68e41c6":"Inga objekt matchar dina filter","PropertiesPage.e958f97282":"Prova att ändra eller ta bort några av dina filter.","PropertiesPage.9ffe65fcce":"hittades","PropertyDetailPage.fbabf2e2a3":"Objektet hittades inte","PropertyDetailPage.eb06ee99ed":"Tillbaka till lediga objekt","PropertyDetailPage.26d52d204a":"Ledig","PropertyDetailPage.a7b2a71ff0":"Hyra","PropertyDetailPage.04e81b9faa":"Rum","PropertyDetailPage.5338136fc1":"ROK","PropertyDetailPage.3f9d17ed39":"Yta","PropertyDetailPage.84935ca0ca":"Tillgänglig","PropertyDetailPage.7061f719f1":"Beskrivning","PropertyDetailPage.53008966a6":"Egenskaper","PropertyDetailPage.f6c6dbd443":"Vad ingår i hyran","PropertyDetailPage.0f59266b8e":"Allmän information","PropertyDetailPage.047e5dc7c4":"Uthyrningspolicy","PropertyDetailPage.13dbb1a495":"Ungdomsrabatt","PropertyDetailPage.5151c4d3ac":"Rökförbud","PropertyDetailPage.27190da607":"Intresserad?","PropertyDetailPage.dcb2d512f7":"Kontakta oss för visning eller mer information om detta objekt.","PropertyDetailPage.96ddaccf58":"Ring","PropertyDetailPage.5487b2f699":"Skicka mejl","PropertyDetailPage.1bfd74a74b":"Intresseanmälan","PropertyDetailPage.dff2ebf8bf":"Kontaktperson","PropertyDetailPage.d0a758d706":"Liknande objekt","Footer.cf03cf2e9c":"Navigation","Footer.bf0ebeea31":"Hem","Footer.8e1ff837de":"Lediga objekt","Footer.63dc4907b4":"För hyresgäster","Footer.45b9f35e0a":"Om oss","Footer.a92b9bcb16":"Kontakt","Footer.1bfd74a74b":"Intresseanmälan","Footer.1ef003745f":"Mina sidor","Footer.a09a0b25a0":"Öppettider","Footer.176aeaea00":"Jour:","Footer.0a56eef0fc":". Alla rättigheter förbehållna.","Header.1bfd74a74b":"Intresseanmälan","PropertyCard.c9ee5681d3":"V","PropertyCard.4c96118800":"Kommer","PropertyCard.c26af33caf":"Uthyrd","PropertyCard.000f1fb16a":"sovrum","PropertyCard.ad06817718":"badrum","PropertyCard.787023d3d3":"Läs mer","PropertyImage.c9ee5681d3":"V","image.https://vibofast.se/wp-content/uploads/2025/08/IMG_6075-2-1240x720.jpeg":"https://vibofast.se/wp-content/uploads/2025/08/IMG_6075-2-1240x720.jpeg","copy.Lägenheter & lokaler":"Lägenheter & lokaler","copy.I Virserum":"I Virserum","copy.Ungdomsrabatt":"Ungdomsrabatt","copy.10% under 25 år":"10% under 25 år","copy.Hyresgästportal":"Hyresgästportal","copy.app.vi-hem.se":"app.vi-hem.se","copy.Rökfritt":"Rökfritt","copy.Alla lägenheter":"Alla lägenheter","copy.Trivsel":"Trivsel","copy.Vi skapar boenden där människor trivs":"Vi skapar boenden där människor trivs","copy.Naturnära":"Naturnära","copy.Lugna områden med närhet till natur":"Lugna områden med närhet till natur","copy.Säkerhet":"Säkerhet","copy.Skötsamma områden och tryggt boende":"Skötsamma områden och tryggt boende","copy.Fräscht & renoverat":"Fräscht & renoverat","copy.Välunderhållna fastigheter och lägenheter":"Välunderhållna fastigheter och lägenheter","image.https://vibofast.se/wp-content/uploads/2025/08/IMG_6057-2-1240x720.jpeg":"https://vibofast.se/wp-content/uploads/2025/08/IMG_6057-2-1240x720.jpeg","copy.Upplyst naturstig: 2 min promenad":"Upplyst naturstig: 2 min promenad","copy.ICA och Coop: 10 min gång":"ICA och Coop: 10 min gång","copy.Apotek och vårdcentral: 15 min gång":"Apotek och vårdcentral: 15 min gång","copy.Förskola Evahagen: 5 min gång":"Förskola Evahagen: 5 min gång","image.https://vibofast.se/wp-content/uploads/2025/08/IMG_1812-3-1240x720.jpeg":"https://vibofast.se/wp-content/uploads/2025/08/IMG_1812-3-1240x720.jpeg","copy.Felanmälan & Jour":"Felanmälan & Jour","copy.Via app.vi-hem.se eller telefon":"Via app.vi-hem.se eller telefon","copy.Inflyttning":"Inflyttning","copy.Allt du behöver veta innan flytt":"Allt du behöver veta innan flytt","copy.Inomhusmiljö":"Inomhusmiljö","copy.Temperatur, ventilation och klimat":"Temperatur, ventilation och klimat","copy.Trivsel i fokus":"Trivsel i fokus","copy.Vi vill att du ska trivas – i ditt hem, i huset, med grannarna, gården och samhället.":"Vi vill att du ska trivas – i ditt hem, i huset, med grannarna, gården och samhället.","copy.Naturnära boende":"Naturnära boende","copy.Våra fastigheter ligger i lugna områden med nära till natur, service och kommunikationer.":"Våra fastigheter ligger i lugna områden med nära till natur, service och kommunikationer.","copy.Tryggt boende":"Tryggt boende","copy.Vi söker skötsamma hyresgäster och skapar trygga, välunderhållna boendemiljöer.":"Vi söker skötsamma hyresgäster och skapar trygga, välunderhållna boendemiljöer.","copy.Vi håller våra fastigheter och lägenheter välunderhållna och fräscha.":"Vi håller våra fastigheter och lägenheter välunderhållna och fräscha.","image.https://vibofast.se/wp-content/uploads/2025/08/IMG_6076-2-1240x720.jpeg":"https://vibofast.se/wp-content/uploads/2025/08/IMG_6076-2-1240x720.jpeg","copy.Uthyrningspolicy":"Uthyrningspolicy","copy.Rökförbud":"Rökförbud","copy.Som hyresgäst hanterar du din lägenhet, felanmälan, tvättider och chatt med oss via app.vi-hem.se. Hyresvillkor – vad som ingår i hyran – varierar från objekt till objekt. Se respektive objekt för vad som ingår.":"Som hyresgäst hanterar du din lägenhet, felanmälan, tvättider och chatt med oss via app.vi-hem.se. Hyresvillkor – vad som ingår i hyran – varierar från objekt till objekt. Se respektive objekt för vad som ingår.","copy.Hem":"Hem","copy.Lediga objekt":"Lediga objekt","copy.För hyresgäster":"För hyresgäster","copy.Om oss":"Om oss","copy.Kontakt":"Kontakt","copy.Mina sidor":"Mina sidor","image./Vit_logo_vibofast.png":"/Vit_logo_vibofast.png","image./logo-svart-vibo.png":"/logo-svart-vibo.png","copy.Intresseanmälan":"Intresseanmälan","meta.title":"Vibo Fastigheter – Här börjar din hemlängtan","meta.description":"Vibo Fastigheter – hyr lägenheter, lokaler och förråd i Virserum och omnejd. Här börjar din hemlängtan."}}'::jsonb)
ON CONFLICT(id) DO NOTHING;

CREATE TABLE vihem_vibofast_private.installation (
 id boolean primary key default true check(id),
 source_digest text not null,
 installed_at timestamptz not null default now()
);
ALTER TABLE vihem_vibofast_private.installation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vihem_vibofast_private.installation FROM public,anon,authenticated;
INSERT INTO vihem_vibofast_private.installation(id,source_digest) VALUES(true,'714fc5c0a25fd62c057e1978019707d00f7dd02592ae4c0e3b9584272ce803c8');
NOTIFY pgrst, 'reload schema';
COMMIT;
