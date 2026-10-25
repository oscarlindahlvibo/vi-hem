"""Isolated PostgreSQL tests. Never reads a production URL or changes other containers."""
import subprocess, pathlib, json, uuid, sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
NAME='vihem-personal-qa'+('-verify' if '--verification' in sys.argv else '-test' if '--fresh-test' in sys.argv else '')
def run(args,**kw):return subprocess.run(args,check=True,text=True,capture_output=True,**kw).stdout
def sql(s):return run(['docker','exec','-i',NAME,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-At'],input=s)
if '--existing' not in sys.argv:
 run(['docker','run','-d','--name',NAME,'--label','vihem.task=personal-workspace','-e','POSTGRES_PASSWORD=workspace-local-test-only','postgres:15'])
 import time
 for i in range(40):
  try:run(['docker','exec',NAME,'pg_isready','-h','127.0.0.1']);sql('SELECT 1');break
  except subprocess.CalledProcessError:time.sleep(.25)
 sql((ROOT/'scripts/personal-workspace/bootstrap.sql').read_text())
 sql((ROOT/'supabase/migrations/20261021120000_admin_notification_routing.sql').read_text())
 for path in sorted((ROOT/'supabase/migrations').glob('20261025*personal_workspace*.sql')):sql(path.read_text())
sql("INSERT INTO vihem_notification_assignments(user_id,organisation_id,settings) VALUES('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','{\"other_notifications\":false}') ON CONFLICT(user_id) DO UPDATE SET settings=excluded.settings")
A='10000000-0000-0000-0000-000000000001';B='10000000-0000-0000-0000-000000000002';T='10000000-0000-0000-0000-000000000003'
note=str(uuid.uuid4());coll=str(uuid.uuid4());folder=str(uuid.uuid4())
def as_user(u,q):return sql("BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','"+u+"',true); "+q+'; COMMIT;')
def expect_fail(u,q):
 try:as_user(u,q)
 except subprocess.CalledProcessError:return
 raise AssertionError('Unexpected permitted action: '+q[:100])
def save(u,id,rev,data,mutation=None):
 return as_user(u,"SELECT vihem_personal_save_note('%s',%d,'%s','%s'::jsonb)->>'revision'"%(id,rev,mutation or uuid.uuid4(),json.dumps(data).replace("'","''")))
mutation=str(uuid.uuid4());d={'title':'Bankmöte','plain_text':'Ring banken om lånevillkoren','content':{'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'Ring banken'}]}]}}
assert '1' in save(A,note,0,d,mutation)
save(A,note,0,d,mutation) # Lost ACK retry is idempotent.
assert sql("SELECT count(*) FROM vihem_personal_notes WHERE id='%s'"%note).strip()=='1'
assert sql("SELECT result ? 'content' FROM vihem_personal_mutations WHERE id='%s'"%mutation).strip()=='f' # Small ACK only, never another full document copy.
expect_fail(B,"SELECT vihem_personal_save_note('%s',1,gen_random_uuid(),'{}')"%note)
assert '\n0\n' in as_user(B,"SELECT count(*) FROM vihem_personal_notes WHERE id='%s'"%note)
expect_fail(T,"SELECT vihem_personal_save_note(gen_random_uuid(),0,gen_random_uuid(),'{}')")
as_user(A,"INSERT INTO vihem_personal_collections(id,title,kind) VALUES('%s','Min bok','notebook'); INSERT INTO vihem_personal_collections(id,title,kind,parent_id) VALUES('%s','Mapp','folder','%s')"%(coll,folder,coll))
expect_fail(A,"UPDATE vihem_personal_collections SET parent_id='%s' WHERE id='%s'"%(folder,folder))
expect_fail(B,"INSERT INTO vihem_personal_collections(title,kind,parent_id) VALUES('Intrång','folder','%s')"%coll)
save(A,note,1,{**d,'collection_id':folder,'favorite':True})
expect_fail(A,"SELECT vihem_personal_save_note('%s',1,gen_random_uuid(),'{}')"%note)
assert '\n1\n' in as_user(A,"SELECT count(*) FROM vihem_personal_notes WHERE search_document @@ websearch_to_tsquery('swedish','banken')")
assert '\n0\n' in as_user(B,"SELECT count(*) FROM vihem_personal_notes WHERE search_document @@ websearch_to_tsquery('swedish','banken')")
assert sql("SELECT count(*) FROM vihem_personal_revisions WHERE note_id='%s'"%note).strip()=='1'
stroke=str(uuid.uuid4());page=str(uuid.uuid4())
sql_ink="SELECT vihem_personal_save_stroke('%s','%s','%s',0,'{\"points\":[{\"x\":2,\"y\":3,\"p\":0.5}],\"tool\":\"pen\",\"color\":\"#172b49\",\"width\":3}',false)"%(stroke,note,page)
as_user(A,sql_ink);as_user(A,sql_ink);expect_fail(B,sql_ink)
assert sql("SELECT count(*) FROM vihem_personal_ink_strokes WHERE note_id='%s'"%note).strip()=='1'
r=str(uuid.uuid4());rd={'title':'Hemlig påminnelse','due_at':'2025-01-01T09:00:00Z','timezone':'Europe/Stockholm','note_id':note,'recurrence':'daily'}
as_user(A,"SELECT (vihem_personal_save_reminder('%s',0,'%s')).revision"%(r,json.dumps(rd)))
expect_fail(B,"SELECT vihem_personal_complete_reminder('%s',1)"%r)
assert '\n0\n' in as_user(B,"SELECT count(*) FROM vihem_personal_reminders")
assert sql('SELECT vihem_personal_dispatch_reminders()').strip()=='1'
assert sql('SELECT vihem_personal_dispatch_reminders()').strip()=='0'
assert sql("SELECT message FROM vihem_notifications").strip()=='Du har en personlig påminnelse.'
# Deleting a notification must never erase the deduplication receipt.
sql('DELETE FROM vihem_notifications');assert sql('SELECT vihem_personal_dispatch_reminders()').strip()=='0'
as_user(A,"SELECT vihem_personal_complete_reminder('%s',1)"%r)
assert sql("SELECT due_at>now() FROM vihem_personal_reminders WHERE id='%s'"%r).strip()=='t'
# Storage isolation, including organisation admin and tenant.
path=A+'/'+note+'/'+str(uuid.uuid4())
as_user(A,"INSERT INTO storage.objects(bucket_id,name) VALUES('vihem-personal','%s')"%path)
assert '\n0\n' in as_user(B,"SELECT count(*) FROM storage.objects")
expect_fail(B,"INSERT INTO storage.objects(bucket_id,name) VALUES('vihem-personal','%s')"%path)
# Failure after notification insert rolls back notification AND delivery; next run retries.
r2=str(uuid.uuid4());as_user(A,"SELECT vihem_personal_save_reminder('%s',0,'%s')"%(r2,json.dumps({**rd,'recurrence':'none'})))
sql("CREATE FUNCTION fail_delivery() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'simulated delivery DB failure'; END$$; CREATE TRIGGER test_fail BEFORE INSERT ON vihem_personal_reminder_deliveries FOR EACH ROW EXECUTE FUNCTION fail_delivery()")
try:sql('SELECT vihem_personal_dispatch_reminders()');raise AssertionError('Expected injected failure')
except subprocess.CalledProcessError:pass
assert sql('SELECT count(*) FROM vihem_notifications').strip()=='0'
sql('DROP TRIGGER test_fail ON vihem_personal_reminder_deliveries');assert sql('SELECT vihem_personal_dispatch_reminders()').strip()=='1'
# Trash suppresses linked future reminders; restore makes them eligible again.
r3=str(uuid.uuid4());as_user(A,"SELECT vihem_personal_save_reminder('%s',0,'%s')"%(r3,json.dumps({**rd,'recurrence':'none'})))
save(A,note,2,{**d,'deleted_at':'2026-10-25T10:00:00Z'});assert sql('SELECT vihem_personal_dispatch_reminders()').strip()=='0'
save(A,note,3,d);assert sql('SELECT vihem_personal_dispatch_reminders()').strip()=='1'
# Admin in the SAME organisation still cannot inspect personal data.
sql("UPDATE vihem_profiles SET organisation_id='20000000-0000-0000-0000-000000000001' WHERE id='%s'"%B)
assert '\n0\n' in as_user(B,"SELECT count(*) FROM vihem_personal_notes")
assert '\n0\n' in as_user(B,"SELECT count(*) FROM vihem_personal_reminders")
# Personal labels and owner-bound joins.
tag=str(uuid.uuid4());as_user(A,"INSERT INTO vihem_personal_tags(id,title) VALUES('%s','Ekonomi'); INSERT INTO vihem_personal_note_tags(note_id,tag_id) VALUES('%s','%s')"%(tag,note,tag))
assert '\n1\n' in as_user(A,"SELECT count(*) FROM vihem_personal_notes n JOIN vihem_personal_note_tags t ON t.note_id=n.id WHERE t.tag_id='%s'"%tag)
expect_fail(B,"INSERT INTO vihem_personal_note_tags(note_id,tag_id) VALUES('%s','%s')"%(note,tag))
# Deactivation removes even the owner's read/write access, without deleting data.
sql("UPDATE vihem_profiles SET active=false WHERE id='%s'"%A)
assert '\n0\n' in as_user(A,"SELECT count(*) FROM vihem_personal_notes")
expect_fail(A,"SELECT vihem_personal_save_note(gen_random_uuid(),0,gen_random_uuid(),'{}')")
sql("UPDATE vihem_profiles SET active=true WHERE id='%s'"%A)
# Restricted Storage guard still applies if another module adds an overly broad policy.
sql("CREATE POLICY test_broad_storage ON storage.objects FOR SELECT TO authenticated USING(true)")
assert '\n0\n' in as_user(B,"SELECT count(*) FROM storage.objects")
sql('DROP POLICY test_broad_storage ON storage.objects')
# No privileged execution of the scheduling or retention functions.
expect_fail(A,'SELECT vihem_personal_dispatch_reminders()')
expect_fail(B,'SELECT vihem_personal_retry_push()')
# Daily recurrence crosses DST with local 09:00 preserved.
rdst=str(uuid.uuid4());future_year=2030
as_user(A,"SELECT vihem_personal_save_reminder('%s',0,'%s')"%(rdst,json.dumps({**rd,'due_at':'2030-03-30T08:00:00Z'})))
as_user(A,"SELECT vihem_personal_complete_reminder('%s',1)"%rdst)
assert sql("SELECT to_char(due_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') FROM vihem_personal_reminders WHERE id='%s'"%rdst).strip()=='2030-03-31 09:00'
# Monthly 31st clamps in February and returns to the 31st in March.
rmonth=str(uuid.uuid4());as_user(A,"SELECT vihem_personal_save_reminder('%s',0,'%s')"%(rmonth,json.dumps({**rd,'due_at':'2030-01-31T08:00:00Z','recurrence':'monthly'})))
as_user(A,"SELECT vihem_personal_complete_reminder('%s',1)"%rmonth)
assert sql("SELECT to_char(due_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') FROM vihem_personal_reminders WHERE id='%s'"%rmonth).strip()=='2030-02-28 09:00'
as_user(A,"SELECT vihem_personal_complete_reminder('%s',2)"%rmonth)
assert sql("SELECT to_char(due_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') FROM vihem_personal_reminders WHERE id='%s'"%rmonth).strip()=='2030-03-31 09:00'
rweek=str(uuid.uuid4());as_user(A,"SELECT vihem_personal_save_reminder('%s',0,'%s')"%(rweek,json.dumps({**rd,'due_at':'2030-04-05T07:00:00Z','recurrence':'weekdays','weekdays':[1,3,5]})))
as_user(A,"SELECT vihem_personal_complete_reminder('%s',1)"%rweek)
assert sql("SELECT extract(isodow FROM due_at AT TIME ZONE timezone) FROM vihem_personal_reminders WHERE id='%s'"%rweek).strip() in ['1','3','5']
rinterval=str(uuid.uuid4());as_user(A,"SELECT vihem_personal_save_reminder('%s',0,'%s')"%(rinterval,json.dumps({**rd,'due_at':'2030-04-05T07:00:00Z','recurrence':'interval','repeat_every':3})))
as_user(A,"SELECT vihem_personal_complete_reminder('%s',1)"%rinterval)
assert sql("SELECT to_char(due_at AT TIME ZONE timezone,'YYYY-MM-DD HH24:MI') FROM vihem_personal_reminders WHERE id='%s'"%rinterval).strip()=='2030-04-08 09:00'
# Retry scheduling uses bounded backoff. Unknown provider acceptance is never retried.
sql("INSERT INTO vihem_system_settings VALUES('push_notification_dispatch','{\"enabled\":true,\"function_url\":\"http://local-test.invalid\",\"secret\":\"test-only\"}'); UPDATE vihem_personal_reminder_deliveries SET last_push_at=now()-interval '1 hour'")
assert int(sql('SELECT vihem_personal_retry_push()').strip())>0
assert sql('SELECT vihem_personal_retry_push()').strip()=='0'
sql("UPDATE vihem_personal_reminder_deliveries SET last_push_at=now()-interval '1 hour';INSERT INTO vihem_push_deliveries(notification_id,token_id,status) SELECT notification_id,gen_random_uuid(),'unknown' FROM vihem_personal_reminder_deliveries WHERE notification_id IS NOT NULL")
assert sql('SELECT vihem_personal_retry_push()').strip()=='0'
# Scale smoke test: 1,200 real documents and 1,500 independent vector records.
import time
scale_start=time.monotonic()
scale=sql("BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','%s',true); DO $$BEGIN FOR i IN 1..1200 LOOP PERFORM vihem_personal_save_note(gen_random_uuid(),0,gen_random_uuid(),jsonb_build_object('title','Skalprov '||i,'plain_text','ekonomi och vinterplanering'));END LOOP; FOR i IN 1..1500 LOOP PERFORM vihem_personal_save_stroke(gen_random_uuid(),'%s','%s',0,'{\"points\":[{\"x\":2,\"y\":3,\"p\":0.5}],\"tool\":\"pen\",\"color\":\"#172b49\",\"width\":3}',false);END LOOP;END$$;SELECT count(*) FROM vihem_personal_notes WHERE search_document @@ websearch_to_tsquery('swedish','vinterplanering');ROLLBACK;"%(A,note,page))
assert '\n1200\n' in scale
print('Scale SQL smoke seconds:',round(time.monotonic()-scale_start,2))
print('PASS: real PostgreSQL migration, RLS A/B/admin/tenant, owner FKs, hierarchy, search, revisions, CAS, note/ink retries, reminder atomicity/dedup/retry/recurrence/trash, private Storage')
