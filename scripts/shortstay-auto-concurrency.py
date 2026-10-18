"""Run on vibo-server against the named isolated QA database. No external transports."""
import subprocess,json,concurrent.futures,pathlib

def sql(body):
 r=subprocess.run(['docker','exec','-i','vihem-chat-qa-db','sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U supabase_admin -d postgres -X -Atq -v ON_ERROR_STOP=1'],input=body,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr[:1200])
 return r.stdout.strip()
source=pathlib.Path('/var/tmp/shortstay-auto-release/shortstay_auto_messages.test.sql').read_text()
setup=source.split("SELECT set_config('request.jwt.claims'")[0]
fixture=json.loads(sql(setup+"SELECT row_to_json(f) FROM f;COMMIT;").splitlines()[-1])
f=fixture
try:
 sql(f"insert into public.vihem_guest_message_rules(id,organisation_id,unit_id,template_id,channels,language,event,send_time,enabled,activated_at,updated_by) values('{f['r']}','{f['o']}','{f['u']}','{f['t']}',ARRAY['booking'],'en','arrival',('{f['stamp']}'::timestamptz at time zone 'Europe/Stockholm')::time,true,now()-interval '1 day','{f['a']}');")
 command=f"BEGIN;SET LOCAL ROLE service_role;select public.vihem_claim_guest_message('{f['r']}',1,'{f['b']}','Hi QA',(select updated_at from public.vihem_short_stay_message_templates where id='{f['t']}'));select pg_sleep(0.25);COMMIT;"
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(sql,[command,command]))
 assert sum(bool(r.strip()) for r in results)==1,results
 assert sql(f"select count(*) from public.vihem_guest_message_jobs where organisation_id='{f['o']}'")=='1'
 assert sql(f"select count(*) from public.vihem_short_stay_message_sends where organisation_id='{f['o']}'")=='1'
 print('PASS two concurrent scheduler claims: exactly one winner, one job and one send receipt')
finally:
 sql(f"BEGIN;delete from public.vihem_guest_message_jobs where organisation_id in ('{f['o']}','{f['o2']}');delete from public.vihem_short_stay_message_sends where organisation_id in ('{f['o']}','{f['o2']}');delete from public.vihem_guest_message_rules where organisation_id in ('{f['o']}','{f['o2']}');delete from public.vihem_short_stay_bookings where organisation_id in ('{f['o']}','{f['o2']}');delete from public.vihem_short_stay_message_templates where organisation_id in ('{f['o']}','{f['o2']}');delete from public.vihem_short_stay_units where organisation_id in ('{f['o']}','{f['o2']}');delete from public.vihem_organisations where id in ('{f['o']}','{f['o2']}');delete from auth.users where id in ('{f['a']}','{f['s']}');COMMIT;")
 print('Synthetic QA fixtures removed')
