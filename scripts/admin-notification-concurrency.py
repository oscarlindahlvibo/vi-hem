"""Isolated QA only. No notifications or transports are invoked."""
import subprocess,uuid,concurrent.futures,time,json
org,staff,admin=[str(uuid.uuid4()) for _ in range(3)]
def sql(body,check=True):
 r=subprocess.run(['docker','exec','-i','vihem-chat-qa-db','sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U supabase_admin -d postgres -X -Atq -v ON_ERROR_STOP=1'],input=body,text=True,capture_output=True)
 if check and r.returncode:raise RuntimeError(r.stderr)
 return r
claims=f"select set_config('request.jwt.claims','{json.dumps({'sub':admin,'role':'authenticated'})}',true);select set_config('request.jwt.claim.sub','{admin}',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;"
def change(value):return f"select public.vihem_notification_assignment_save('{staff}',(select jsonb_object_agg(k,{str(value).lower()}) from unnest(public.vihem_notification_keys()) k),'initial:staff');"
try:
 sql(f"begin;insert into public.vihem_organisations(id,name,slug) values('{org}','QA Notice Race','qa-notice-{org}');insert into auth.users(id,email) values('{staff}','{staff}@example.invalid'),('{admin}','{admin}@example.invalid');insert into public.vihem_profiles(id,organisation_id,name,email,role,active) values('{staff}','{org}','QA Staff','{staff}@example.invalid','staff',true),('{admin}','{org}','QA Admin','{admin}@example.invalid','admin',true) on conflict(id) do update set organisation_id=excluded.organisation_id,role=excluded.role,active=true;commit;")
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  first=pool.submit(sql,'begin;'+claims+change(True)+'select pg_sleep(1);commit;')
  time.sleep(.25)
  second=pool.submit(sql,'begin;'+claims+change(False)+'commit;',False)
  first.result();result=second.result()
 assert result.returncode!=0 and 'administratör' in result.stderr,result.stderr
 r=sql(f"select bool_and(value::boolean) from public.vihem_notification_assignments,jsonb_each_text(settings) where user_id='{staff}';")
 assert r.stdout.strip()=='t'
 print('PASS concurrent different edit rejected; first settings preserved')
 r=sql('begin;'+claims+change(True)+'commit;')
 print('PASS retry after lost response returns saved settings')
finally:
 sql(f"begin;delete from public.vihem_notification_assignments where organisation_id='{org}';delete from public.vihem_organisations where id='{org}';delete from auth.users where id in ('{staff}','{admin}');commit;")
 print('Synthetic QA fixtures removed')
