"""Two real database sessions; synthetic fixtures in named QA container only."""
import subprocess,uuid,concurrent.futures,time,json
org,user,client,first,second=[str(uuid.uuid4()) for _ in range(5)]
def sql(body,check=True):
 r=subprocess.run(['docker','exec','-i','vihem-chat-qa-db','sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U supabase_admin -d postgres -X -Atq -v ON_ERROR_STOP=1'],input=body,text=True,capture_output=True)
 if check and r.returncode:raise RuntimeError(r.stderr)
 return r
claims=f"select set_config('request.jwt.claims','{json.dumps({'sub':user,'role':'authenticated'})}',true);select set_config('request.jwt.claim.sub','{user}',true);set local role authenticated;"
try:
 sql(f"begin;insert into public.vihem_organisations(id,name,slug) values('{org}','QA Snow Race','qa-snow-{org}');insert into auth.users(id,email) values('{user}','{user}@example.invalid');insert into public.vihem_profiles(id,organisation_id,name,email,role,active,snow_time_access) values('{user}','{org}','Snow Race','{user}@example.invalid','snow',true,true) on conflict(id) do update set organisation_id=excluded.organisation_id,role=excluded.role,active=true,snow_time_access=true;insert into public.vihem_organisation_modules(organisation_id,module_key,enabled,settings) values('{org}','snow',true,'{{\"admin_only\":false}}') on conflict(organisation_id,module_key) do update set enabled=true;insert into public.vihem_time_categories(organisation_id,key,label,active) values('{org}','snow_plowing','Snow',true) on conflict do nothing;insert into public.vihem_snow_clients(id,organisation_id,name) values('{client}','{org}','QA Snow Client');commit;")
 event=sql('select now()::text;').stdout.strip()
 job=json.dumps({'category':'snow_plowing','snow_client_id':client,'snow_method':'machine'})
 def clock(op):return f"select public.vihem_clock_transition('{op}','clockin',null,'{event}','{job}'::jsonb,'','Europe/Stockholm');"
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  a=pool.submit(sql,'begin;'+claims+clock(first)+'select pg_sleep(1);commit;')
  time.sleep(.25)
  b=pool.submit(sql,'begin;'+claims+clock(second)+'commit;',False)
  a.result();r=b.result()
 assert r.returncode and 'CLOCK_STATE_CONFLICT' in r.stderr,r.stderr
 assert sql(f"select count(*) from public.vihem_time_entries where user_id='{user}' and end_time is null;").stdout.strip()=='1'
 sql('begin;'+claims+clock(first)+'commit;')
 assert sql(f"select count(*) from public.vihem_clock_operations where user_id='{user}';").stdout.strip()=='1'
 print('PASS: concurrent clocks serialized, stale state rejected, exact retry remains one entry/receipt')
finally:
 sql(f"begin;delete from public.vihem_clock_operations where organisation_id='{org}';delete from public.vihem_time_entries where organisation_id='{org}';delete from public.vihem_snow_clients where organisation_id='{org}';delete from public.vihem_organisations where id='{org}';delete from auth.users where id='{user}';commit;")
 print('Synthetic QA fixtures removed')
