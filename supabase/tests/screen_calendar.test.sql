BEGIN;
create function pg_temp.expect(label text,ok boolean) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end$$;
create function pg_temp.reject(label text,statement text) returns void language plpgsql as $$declare failed boolean:=false;begin begin execute statement;exception when others then failed:=true;end;if not failed then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end$$;
create temp table f(org uuid,other_org uuid,screen uuid,staff uuid);
do $$declare o uuid:=gen_random_uuid();o2 uuid:=gen_random_uuid();s uuid:=gen_random_uuid();u uuid:=gen_random_uuid();begin
 insert into public.vihem_organisations(id,name,slug) values(o,'QA TV','qa-tv-'||o),(o2,'QA Other TV','qa-tv-'||o2);
 insert into auth.users(id,email) values(s,s||'@example.invalid'),(u,u||'@example.invalid');
 insert into public.vihem_profiles(id,organisation_id,name,email,role,active) values(s,o,'QA Screen',s||'@example.invalid','screen',true),(u,o,'QA Staff',u||'@example.invalid','staff',true) on conflict(id) do update set organisation_id=excluded.organisation_id,role=excluded.role,active=true;
 insert into f values(o,o2,s,u);
 insert into public.vihem_calendar_events(organisation_id,title,starts_at,ends_at,visibility,participant_ids,created_by) values
 (o,'QA shared',now(),now()+interval '1 day','organisation','{}',u),
 (o,'QA private',now(),now()+interval '1 day','private','{}',s),
 (o,'QA selected',now(),now()+interval '1 day','selected_users',array[s],u),
 (o2,'QA other org',now(),now()+interval '1 day','organisation','{}',null);
 perform set_config('request.jwt.claim.sub',s::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',s,'role','authenticated')::text,true);
end$$;
grant select on f to authenticated;
set local role authenticated;
select pg_temp.expect('screen only shared same organisation',(select count(*)=1 from public.vihem_calendar_events where organisation_id in(select org from f union all select other_org from f)));
with changed as(update public.vihem_calendar_events set title='QA changed' where title='QA shared' returning id) select pg_temp.expect('screen cannot change event',count(*)=0) from changed;
with changed as(delete from public.vihem_calendar_events where title='QA shared' returning id) select pg_temp.expect('screen cannot delete event',count(*)=0) from changed;
select pg_temp.reject('screen cannot create events',format('insert into public.vihem_calendar_events(organisation_id,title,starts_at,ends_at,visibility) values(%L,%L,now(),now()+interval ''1 day'',%L)',(select org from f),'QA denied','organisation'));
reset role;
update public.vihem_profiles set active=false where id=(select screen from f);
set local role authenticated;
select pg_temp.expect('inactive screen blocked',(select count(*)=0 from public.vihem_calendar_events where organisation_id in(select org from f union all select other_org from f)));
reset role;
select set_config('request.jwt.claim.sub',staff::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true) from f;
set local role authenticated;
select pg_temp.expect('staff shared access retained',(select count(*)=2 from public.vihem_calendar_events where organisation_id=(select org from f)));
reset role;
ROLLBACK;
