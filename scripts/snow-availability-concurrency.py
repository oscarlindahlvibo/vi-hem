"""Synthetic availability race in the named QA database only; no live changes."""
import subprocess,uuid,json,concurrent.futures,time
org,user,first,second=[str(uuid.uuid4()) for _ in range(4)]
def sql(s,check=True):
 r=subprocess.run(['docker','exec','-i','vihem-chat-qa-db','sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U supabase_admin -d postgres -X -Atq -v ON_ERROR_STOP=1'],input=s,text=True,capture_output=True)
 if check and r.returncode:raise RuntimeError(r.stderr)
 return r
claims=f"select set_config('request.jwt.claims','{json.dumps({'sub':user,'role':'authenticated'})}',true);select set_config('request.jwt.claim.sub','{user}',true);set local role authenticated;"
def save(op,status):return f"select public.vihem_snow_availability_save('{op}','{user}',ARRAY['2026-11-02']::date[],'{status}','[]','{{\"2026-11-02\":0}}');"
try:
 sql(f"begin;insert into public.vihem_organisations(id,name,slug) values('{org}','QA Snow Availability Race','qa-availability-{org}');insert into auth.users(id,email) values('{user}','{user}@example.invalid');insert into public.vihem_profiles(id,organisation_id,name,email,role,active) values('{user}','{org}','QA Availability Admin','{user}@example.invalid','admin',true) on conflict(id) do update set organisation_id=excluded.organisation_id,role='admin',active=true;insert into public.vihem_organisation_modules(organisation_id,module_key,enabled) values('{org}','snow',true) on conflict(organisation_id,module_key) do update set enabled=true;commit;")
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  a=pool.submit(sql,'BEGIN;'+claims+save(first,'available')+'select pg_sleep(1);COMMIT;',False);time.sleep(.15)
  b=pool.submit(sql,'BEGIN;'+claims+save(second,'unavailable')+'COMMIT;',False)
  ra,rb=a.result(),b.result();assert ra.returncode==0,ra.stderr;assert rb.returncode!=0 and 'ändrats' in rb.stderr,rb.stderr
 sql('BEGIN;'+claims+save(first,'available')+'COMMIT;')
 assert sql(f"select count(*)||':'||max(revision) from public.vihem_snow_availability where organisation_id='{org}';").stdout.strip()=='1:1'
 assert sql(f"select count(*) from public.vihem_snow_availability_operations where organisation_id='{org}';").stdout.strip()=='1'
 print('PASS concurrent availability saves: one winner, stale revision rejected, exact retry one day/receipt')
finally:
 sql(f"begin;delete from public.vihem_snow_availability_operations where organisation_id='{org}';delete from public.vihem_snow_availability where organisation_id='{org}';delete from public.vihem_organisations where id='{org}';delete from auth.users where id='{user}';commit;",False)
 print('Synthetic QA identities and availability rows removed')
