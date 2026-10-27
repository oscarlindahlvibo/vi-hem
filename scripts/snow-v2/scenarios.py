"""Real RPC/trigger/concurrency scenarios with synthetic local data only."""
import json,uuid,concurrent.futures,time,sys
from database_test_helpers import sql,as_user,command,expect_fail,scalar
O='20000000-0000-0000-0000-000000000001';B='20000000-0000-0000-0000-000000000002'
U=[f'10000000-0000-0000-0000-{i:012d}' for i in range(1,10)]
A=U[0];C='30000000-0000-0000-0000-000000000001';CUSTOMER='40000000-0000-0000-0000-000000000001';COMP='50000000-0000-0000-0000-000000000001'
def uid():return str(uuid.uuid4())
sql(f"INSERT INTO vihem_organisations VALUES('{O}','Snö QA','snow-qa'),('{B}','Annan QA','other-qa');INSERT INTO vihem_companies VALUES('{COMP}','{O}','Fakturerande QA');INSERT INTO vihem_finance_customers(id,organisation_id,name,customer_type,address_line1,postal_code,city) VALUES('{CUSTOMER}','{O}','Juridisk kund QA','company','Testvägen 1','12345','Teststad');INSERT INTO vihem_snow_clients(id,organisation_id,name,finance_customer_id,company_id) VALUES('{C}','{O}','Uppdrag ett','{CUSTOMER}','{COMP}');")
for i,u in enumerate(U):
 org=B if i==7 else O;role='admin' if i in [0,1,7] else 'tenant' if i==8 else 'snow' if i==6 else 'staff'
 sql(f"INSERT INTO auth.users VALUES('{u}','qa{i}@example.invalid');INSERT INTO vihem_profiles(id,organisation_id,name,email,role,active,snow_time_access) VALUES('{u}','{org}','Förare {i+1}','qa{i}@example.invalid','{role}',true,true);INSERT INTO vihem_permission_grants VALUES('{org}','{u}','module.snow',null);")
sql(f"INSERT INTO vihem_organisation_modules VALUES('{O}','snow',true,'{{}}','{{\"admin_only\":false,\"staff_availability_enabled\":true}}'),('{B}','snow',true,'{{}}','{{\"admin_only\":false}}');INSERT INTO vihem_time_categories(organisation_id,key,label,active) VALUES('{O}','snow_plowing','Snö',true),('{O}','snow_sanding','Sand',true),('{O}','general','Allmänt',true);")
week=scalar("SELECT (clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date-(extract(isodow FROM clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::int-1)")
start=scalar("SELECT (clock_timestamp()+interval '1 day')::text");end=scalar("SELECT (clock_timestamp()+interval '1 day 4 hours')::text")
patterns=[{'weekday':i,'slots':[[0,1440]]} for i in range(1,8)]
for u in U[:7]:
 command(u,'pattern',{'user_id':u,'days':patterns})
 for w in [week,scalar(f"SELECT '{week}'::date+7")]:command(u,'confirm_week',{'week':w,'available':True})
R=[]
for i in range(3):
 r=command(A,'resource',{'name':f'Maskin {i+1}'})['id'];R.append(r)
 for u in U[:7]:command(A,'competency',{'user_id':u,'resource_id':r,'active':True})
D=[]
for i in range(3):D.append(command(A,'plan',{'resource_id':R[i],'client_id':C,'starts_at':start,'ends_at':end,'user_id':U[i+2],'activity':'snow_plowing'})['id'])
expect_fail(U[2],'resource',{'name':'Otillåten resurs'})
expect_fail(U[7],'plan',{'resource_id':R[0],'client_id':C,'starts_at':start,'ends_at':end,'activity':'snow_plowing'})
expect_fail(U[8],'confirm_week',{'week':week,'available':True})
expect_fail(A,'plan',{'resource_id':R[1],'client_id':C,'starts_at':start,'ends_at':end,'user_id':U[2],'activity':'snow_plowing'})
assert scalar(f"SELECT count(*) FROM vihem_snow_duties WHERE accepted_user IS NOT NULL AND organisation_id='{O}'")=='0'
call_id=uid();payload={'duties':D}
command(A,'callout',payload,call_id);command(A,'callout',payload,call_id)
assert scalar(f"SELECT count(*) FROM vihem_snow_invitations WHERE organisation_id='{O}'")=='3'
inv=lambda duty,user:scalar(f"SELECT id FROM vihem_snow_invitations WHERE duty_id='{duty}' AND user_id='{user}'")
command(U[2],'respond',{'invitation_id':inv(D[0],U[2]),'accept':False})
sql(f"UPDATE vihem_snow_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE duty_id='{D[1]}'")
# Third driver accepts before scheduler. First/second need different reserves.
command(U[4],'respond',{'invitation_id':inv(D[2],U[4]),'accept':True})
sql('SELECT vihem_snow_dispatch()');notices=scalar('SELECT count(*) FROM vihem_notifications');sql('SELECT vihem_snow_dispatch()');assert scalar('SELECT count(*) FROM vihem_notifications')==notices
assert scalar(f"SELECT count(*) FROM vihem_snow_invitations WHERE duty_id IN ('{D[0]}','{D[1]}') AND state='pending'")=='2'
# Simulate two concurrent open offers, checking the same guarantee as a late reserve race.
pending_user=scalar(f"SELECT user_id FROM vihem_snow_invitations WHERE duty_id='{D[0]}' AND state='pending'")
other=next(u for u in U[:7] if u not in [pending_user,U[2],U[3],U[4]])
sql(f"SELECT vihem_snow_offer('{D[0]}','{other}')")
def accept(u):
 try:command(u,'respond',{'invitation_id':inv(D[0],u),'accept':True});return True
 except RuntimeError:return False
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(accept,[pending_user,other]))
assert sum(results)==1,results
assert scalar(f"SELECT count(*) FROM vihem_snow_invitations WHERE duty_id='{D[0]}' AND state='accepted'")=='1'
print('PASS: seven drivers, three machines, nonbinding availability, 3 plans, decline, timeout, reserve, scheduler dedup, concurrent acceptance, role/org isolation')
# A planned driver, even unavailable later, must never silently become accepted.
board=json.loads(as_user(A,f"SELECT vihem_snow_board('{week}',31)").splitlines()[-1]);assert len(board['resources'])==3
otherboard=json.loads(as_user(U[7],f"SELECT vihem_snow_board('{week}',31)").splitlines()[-1]);assert not otherboard['resources']
# End-to-end clock and immutable historical price snapshots.
for kind,amount in [('labor',300),('machine',200),('start',50)]:
 command(A,'price',{'activity':'snow_plowing','kind':kind,'label':kind,'mode':'fixed' if kind=='start' else 'hour','amount':amount,'vat_rate':25,'valid_from':'2020-01-01'})
T=[]
for i in range(2):
 op=uid();out=uid();t=scalar(f"SELECT (clock_timestamp()-interval '{180-i*50} minutes')::text");t2=scalar(f"SELECT '{t}'::timestamptz+interval '30 minutes'")
 job={'category':'snow_plowing','snow_client_id':C,'snow_method':'machine','snow_resource_id':R[2],'snow_v2':True,'completion_status':'submitted'}
 params=f"'{op}','clockin',null,'{t}','{json.dumps(job)}'::jsonb,'','Europe/Stockholm'"
 as_user(U[5],f'SELECT vihem_snow_clock({params})');as_user(U[5],f'SELECT vihem_snow_clock({params})')
 as_user(U[5],f"SELECT vihem_snow_clock('{out}','clockout','{op}','{t2}','{{\"completion_status\":\"submitted\"}}'::jsonb,'','Europe/Stockholm')")
 assert scalar(f"SELECT status FROM vihem_time_entries WHERE id='{op}'")=='approved'
 assert scalar(f"SELECT jsonb_array_length(lines) FROM vihem_snow_valuations WHERE entry_id='{op}'")=='3'
 T.append(op)
assert float(scalar(f"SELECT (lines->0->>'unit_price') FROM vihem_snow_valuations WHERE entry_id='{T[0]}'"))==300
command(A,'price',{'activity':'snow_plowing','kind':'labor','label':'Nytt timpris','mode':'hour','amount':600,'vat_rate':25,'valid_from':'2020-01-01'})
assert float(scalar(f"SELECT (lines->0->>'unit_price') FROM vihem_snow_valuations WHERE entry_id='{T[0]}'"))==300
# Manual edit invalidates approval; direct re-approval cannot bypass the review function.
as_user(U[5],f"UPDATE vihem_time_entries SET total_minutes=31,status='approved' WHERE id='{T[1]}'")
assert scalar(f"SELECT status FROM vihem_time_entries WHERE id='{T[1]}'")=='submitted'
command(A,'review',{'entry_id':T[1],'reason':'Kontrollerat manuellt'})
# Two admins trying to reserve the same work: only one succeeds.
first_day=scalar(f"SELECT (start_time AT TIME ZONE 'Europe/Stockholm')::date FROM vihem_time_entries WHERE id='{T[0]}'")
billing={'entries':[T[0]],'company_id':COMP,'reference':'','from':first_day,'to':scalar(f"SELECT '{first_day}'::date+1")}
def reserve(u):
 try:return command(u,'invoice_prepare',billing)['id']
 except RuntimeError:return None
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:batch_ids=list(pool.map(reserve,[A,U[1]]))
assert sum(x is not None for x in batch_ids)==1,batch_ids
batch=next(x for x in batch_ids if x)
try:as_user(U[5],f"UPDATE vihem_time_entries SET snow_client_id=null WHERE id='{T[0]}'");raise AssertionError('Moved reserved work')
except RuntimeError:pass
assert scalar(f"SELECT state FROM vihem_snow_invoice_batches WHERE id='{batch}'")=='prepared'
# Network uncertainty preserves both reserved work and the exact immutable payload.
attempt=uid();sql(f"SELECT vihem_snow_invoice_claim('{batch}','{attempt}')")
payload={'customer_id':uid(),'items':[],'invoice_date':first_day,'due_date':first_day,'notes':f'VI-HEM snow batch {batch}'}
sql(f"SELECT vihem_snow_invoice_payload('{batch}','{attempt}','{json.dumps(payload)}')")
sql(f"SELECT vihem_snow_invoice_uncertain('{batch}','{attempt}','simulerad timeout')")
assert scalar(f"SELECT state FROM vihem_snow_invoice_batches WHERE id='{batch}'")=='uncertain'
try:sql(f"SELECT vihem_snow_invoice_claim('{batch}','{uid()}')");raise AssertionError('Unknown POST was retried')
except RuntimeError:pass
attempt=uid();sql(f"SELECT vihem_snow_invoice_claim('{batch}','{attempt}',true)")
try:sql(f"SELECT vihem_snow_invoice_payload('{batch}','{attempt}','{{\"changed\":true}}')");raise AssertionError('Payload changed')
except RuntimeError:pass
print('PASS: original clock retry, automatic review, manual-edit review, historic prices, concurrent invoice reservation, reserved-time immutability, uncertain external result and immutable retry payload')
# Optimistic concurrency: old baseline must not erase newer changes.
expect_fail(U[2],'pattern',{'days':patterns,'revision':'stale'})
b=json.loads(as_user(U[2],f"SELECT vihem_snow_board('{week}',31)").splitlines()[-1])
command(U[2],'pattern',{'days':patterns,'revision':b['pattern_revisions'][U[2]]})
assert not bool(json.loads(as_user(U[2],f"SELECT vihem_snow_board('{week}',31)").splitlines()[-1])['confirmations'][0]['current'])
command(U[2],'confirm_week',{'week':week,'available':True})
# Fingerprint must be independent of session timezone, including daylight saving offsets.
f1=scalar(f"SET timezone='UTC';SELECT vihem_snow_time_fingerprint(e) FROM vihem_time_entries e WHERE id='{T[1]}'")
f2=scalar(f"SET timezone='Europe/Stockholm';SELECT vihem_snow_time_fingerprint(e) FROM vihem_time_entries e WHERE id='{T[1]}'")
assert f1==f2
# Private storage: ownership holds even if a legacy permissive policy allows all storage.
sql('CREATE POLICY legacy_broad ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true)')
photo=uid();path=as_user(U[5],f"SELECT vihem_snow_photo('{photo}','{T[1]}','jpg',false)").splitlines()[-1]
as_user(U[5],f"INSERT INTO storage.objects(id,bucket_id,name) VALUES('{uid()}','vihem-snow-photos','{path}')")
as_user(U[5],f"SELECT vihem_snow_photo('{photo}','{T[1]}','jpg',true)")
assert as_user(U[2],"SELECT count(*) FROM storage.objects WHERE bucket_id='vihem-snow-photos'").splitlines()[-1]=='0'
assert as_user(U[7],"SELECT count(*) FROM storage.objects WHERE bucket_id='vihem-snow-photos'").splitlines()[-1]=='0'
assert as_user(A,"SELECT count(*) FROM storage.objects WHERE bucket_id='vihem-snow-photos'").splitlines()[-1]=='1'
try:as_user(U[2],f"INSERT INTO storage.objects(id,bucket_id,name) VALUES('{uid()}','vihem-snow-photos','{path}fake')");raise AssertionError('Foreign photo path written')
except RuntimeError:pass
# A declined/accepted/cancelled invitation cannot send a queued callout push.
stale=scalar(f"SELECT n.notification_id FROM vihem_snow_notices n JOIN vihem_snow_invitations i ON i.id=n.object_id WHERE i.state<>'pending' AND n.notification_id IS NOT NULL LIMIT 1")
if stale:assert scalar(f"SELECT vihem_snow_push_allowed('{stale}')")=='f'
# Spontaneous private customer with missing address must not reach billing.
extra_customer=command(U[5],'customer_create',{'name':'Privat QA','customer_type':'private'})['id']
extra=command(U[5],'extra_assignment',{'customer_id':extra_customer,'name':'Uppfart QA','rut_requested':True})['id']
command(A,'assignment',{'id':extra,'revision':1,'finance_customer_id':extra_customer,'company_id':COMP})
op=uid();out=uid();t=scalar("SELECT (clock_timestamp()-interval '60 minutes')::text");t2=scalar(f"SELECT '{t}'::timestamptz+interval '15 minutes'")
job={'category':'snow_plowing','snow_client_id':extra,'snow_method':'machine','snow_resource_id':R[2],'snow_v2':True}
as_user(U[5],f"SELECT vihem_snow_clock('{op}','clockin',null,'{t}','{json.dumps(job)}')")
# Material exact replay is accepted after clock-out; never duplicates.
material=command(A,'price',{'activity':'snow_plowing','kind':'material','label':'Sand QA','mode':'quantity','amount':20,'vat_rate':25,'valid_from':'2020-01-01'})['id'];item=uid()
item_args=f"'{item}','{op}','{material}',2,'Sand'"
as_user(U[5],f'SELECT vihem_snow_add_item({item_args})')
as_user(U[5],f"SELECT vihem_snow_clock('{out}','clockout','{op}','{t2}','{{}}')")
as_user(U[5],f'SELECT vihem_snow_add_item({item_args})')
assert scalar(f"SELECT count(*) FROM vihem_snow_work_items WHERE id='{item}'")=='1'
extra_bill={'entries':[op],'company_id':COMP,'reference':'','from':first_day,'to':scalar(f"SELECT '{first_day}'::date+1")}
expect_fail(A,'invoice_prepare',extra_bill)
cust=json.loads(as_user(A,"SELECT vihem_snow_customers('Privat QA')").splitlines()[-1])[0]
command(A,'customer_update',{'id':extra_customer,'revision':cust['revision'],'name':cust['name'],'address':'Testvägen 2','postal_code':'12345','city':'Teststad','personnummer':'199001010017','housing':'QA 1:1','tax_checked':True})
# Explicit RUT-eligible labor price version, then review unreserved work to value it.
# Existing valuation stays immutable, so create eligible labor before the next job.
command(A,'price',{'activity':'snow_plowing','kind':'labor','label':'Arbete med RUT','mode':'hour','amount':400,'vat_rate':25,'valid_from':'2020-01-01','rut_eligible':True})
# The earlier unqualified labor must not receive a tax deduction retroactively.
batch_extra=command(A,'invoice_prepare',extra_bill)['id']
assert float(scalar(f"SELECT snapshot->>'rut' FROM vihem_snow_invoice_batches WHERE id='{batch_extra}'"))==0
# Accepted driver requests a real replacement; no second guaranteed driver is invented.
accepted=scalar(f"SELECT accepted_user FROM vihem_snow_duties WHERE id='{D[2]}'")
relief=command(accepted,'relief',{'duty_id':D[2],'at':scalar(f"SELECT '{start}'::timestamptz+interval '2 hours'")})['id']
assert scalar(f"SELECT count(*) FROM vihem_snow_duties WHERE id='{relief}' AND accepted_user IS NULL")=='1'
assert scalar(f"SELECT a.ends_at=b.starts_at FROM vihem_snow_duties a JOIN vihem_snow_duties b ON b.relief_of=a.id WHERE b.id='{relief}'")=='t'
# Actual remote response is mandatory: claim/lease, validate, then confirm exactly one draft link.
link=uid();remote=uid();sql(f"INSERT INTO vihem_accounted_company_links VALUES('{link}','{O}','{COMP}')")
try:sql(f"SELECT vihem_snow_invoice_claim('{batch}','{uid()}')");raise AssertionError('Claimed live lease')
except RuntimeError:pass
response={'id':remote,'status':'draft','currency':'SEK','total':999999,'customer_id':payload['customer_id'],'notes':payload['notes']}
try:sql(f"SELECT vihem_snow_invoice_finish('{batch}','{attempt}','{link}','{json.dumps(response)}')");raise AssertionError('Wrong remote total accepted')
except RuntimeError:pass
response.update({'total':float(scalar(f"SELECT snapshot->>'gross' FROM vihem_snow_invoice_batches WHERE id='{batch}'")),'remaining_amount':float(scalar(f"SELECT snapshot->>'customer_payable' FROM vihem_snow_invoice_batches WHERE id='{batch}'")),'invoice_date':first_day,'due_date':first_day})
sql(f"SELECT vihem_snow_invoice_finish('{batch}','{attempt}','{link}','{json.dumps(response)}')")
assert scalar(f"SELECT state FROM vihem_snow_invoice_batches WHERE id='{batch}'")=='draft_created'
assert scalar(f"SELECT count(*) FROM vihem_accounted_invoice_links WHERE source_id='{batch}'")=='1'
print('PASS: stale-baseline conflict, timezone-stable fingerprints, private storage against broad policies, suppressed stale push, spontaneous private client, incomplete billing rejection, material exact replay after clock-out, no retroactive RUT, relief handover, remote lease and actual draft-response validation')
# Calendar projection reuses the dated editor and never synthesizes revision rows.
calendar=json.loads(as_user(A,f"SELECT vihem_snow_availability_snapshot('{week}',7)").splitlines()[-1])
assert len(calendar['base_patterns'])==49 and len(calendar['days'])==0
assert calendar['confirmed_weeks']
# Current eligible labor only: equipment, minimum start and material are excluded.
op2=uid();out2=uid();t=scalar("SELECT (clock_timestamp()-interval '20 minutes')::text");t2=scalar(f"SELECT '{t}'::timestamptz+interval '15 minutes'")
as_user(U[5],f"SELECT vihem_snow_clock('{op2}','clockin',null,'{t}','{json.dumps(job)}')")
as_user(U[5],f"SELECT vihem_snow_clock('{out2}','clockout','{op2}','{t2}','{{}}')")
bill2=command(A,'invoice_prepare',{**extra_bill,'entries':[op2]})['id']
assert float(scalar(f"SELECT snapshot->>'rut' FROM vihem_snow_invoice_batches WHERE id='{bill2}'"))==62.5
assert float(scalar(f"SELECT sum((x->>'labor_hours')::numeric) FROM vihem_snow_invoice_batches b,jsonb_array_elements(b.snapshot->'lines') x WHERE b.id='{bill2}'"))==.25
# Configured weekly reminder runs once, including external restricted snow drivers.
settings={'revision':0,'max_hours':12,'rest_hours':11,'response_minutes':5,'remind_minutes':2,'weekly_day':int(scalar("SELECT extract(isodow FROM clock_timestamp() AT TIME ZONE 'Europe/Stockholm')")),'weekly_hour':0,'auto_approve':True}
command(A,'settings',settings)
sql(f"DELETE FROM vihem_snow_week_confirmations WHERE user_id='{U[6]}'")
sql('SELECT vihem_snow_dispatch()');n=scalar("SELECT count(*) FROM vihem_snow_notices WHERE kind='week'");sql('SELECT vihem_snow_dispatch()');assert scalar("SELECT count(*) FROM vihem_snow_notices WHERE kind='week'")==n and int(n)>=1
# Ended callouts are closed rather than continuing to alarm reserves forever.
sql(f"UPDATE vihem_snow_duties SET starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 hour' WHERE id='{D[1]}'")
sql('SELECT vihem_snow_dispatch()');assert scalar(f"SELECT state FROM vihem_snow_duties WHERE id='{D[1]}'")=='cancelled'
print('PASS: calendar baseline projection, real RUT on labor only, measured labor hours, weekly reminder dedup and expired-duty escalation stop')
# Traceable correction only before any external attempt; reservations released atomically.
release_id=uid();release_data={'batch_id':bill2,'reason':'Felaktig preliminär specifikation'}
command(A,'invoice_release',release_data,release_id);command(A,'invoice_release',release_data,release_id)
assert scalar(f"SELECT state FROM vihem_snow_invoice_batches WHERE id='{bill2}'")=='cancelled'
assert scalar(f"SELECT count(*) FROM vihem_snow_invoice_entries WHERE entry_id='{op2}'")=='0'
expect_fail(A,'invoice_release',{'batch_id':batch,'reason':'Kan inte återöppna externt utkast'})
print('PASS: idempotent traceable release before transfer, preserved snapshot, external drafts remain locked')
# Existing notification preferences can suppress an INSERT; it must not starve dispatch forever.
sql("CREATE FUNCTION suppress_snow_test() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.link='snow' THEN RETURN NULL;END IF;RETURN NEW;END$$;CREATE TRIGGER suppress_snow_test BEFORE INSERT ON vihem_notifications FOR EACH ROW EXECUTE FUNCTION suppress_snow_test()")
sql(f"SELECT vihem_snow_notice('{O}','{A}','suppression-test','week',NULL,'Prov','Prov')")
sql('SELECT vihem_snow_dispatch()')
assert scalar("SELECT closed_at IS NOT NULL AND notification_id IS NULL FROM vihem_snow_notices WHERE dedupe='suppression-test'")=='t'
n=scalar("SELECT count(*) FROM vihem_snow_events WHERE kind='notification_suppressed'");sql('SELECT vihem_snow_dispatch()');assert scalar("SELECT count(*) FROM vihem_snow_events WHERE kind='notification_suppressed'")==n
sql('DROP TRIGGER suppress_snow_test ON vihem_notifications;DROP FUNCTION suppress_snow_test()')
print('PASS: existing notification suppression closes/logs once and cannot starve the dispatch queue')
