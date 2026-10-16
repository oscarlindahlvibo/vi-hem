"""Isolated PostgREST + synthetic database identities. No live changes or outbound transports."""
import subprocess,uuid,json,secrets,time,tempfile,os,base64,hmac,hashlib,urllib.request,urllib.error
admin_pilot=os.environ.get('SNOW_ADMIN_PILOT')=='1'
org,user,admin,client=[str(uuid.uuid4()) for _ in range(4)]
container='vihem-snow-api-qa';role='snow_api_qa_authenticator';jwt=secrets.token_hex(32);password=secrets.token_hex(24)
def sql(body,check=True):
 r=subprocess.run(['docker','exec','-i','vihem-chat-qa-db','sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U supabase_admin -d postgres -X -Atq -v ON_ERROR_STOP=1'],input=body,text=True,capture_output=True)
 if check and r.returncode:raise RuntimeError(r.stderr)
 return r

def token(who):
 b64=lambda b:base64.urlsafe_b64encode(b).rstrip(b'=')
 text=b64(b'{"alg":"HS256","typ":"JWT"}')+b'.'+b64(json.dumps({'sub':who,'role':'authenticated','exp':int(time.time())+600}).encode())
 return (text+b'.'+b64(hmac.new(jwt.encode(),text,hashlib.sha256).digest())).decode()

def call(path,who=user,method='GET',data=None):
 request=urllib.request.Request(base+path,headers={'Authorization':'Bearer '+token(who),'Content-Type':'application/json'},method=method,data=json.dumps(data).encode() if data is not None else None)
 try:
  with urllib.request.urlopen(request,timeout=15) as response:return response.status,json.loads(response.read() or b'null')
 except urllib.error.HTTPError as error:return error.code,json.loads(error.read())
try:
 sql(f"create role {role} login noinherit password '{password}';grant anon,authenticated,authenticator to {role};alter role {role} set pgrst.db_pre_request='public.vihem_snow_api_guard';")
 sql(f"begin;insert into public.vihem_organisations(id,name,slug) values('{org}','QA Snow API','qa-api-{org}');insert into auth.users(id,email) values('{user}','{user}@example.invalid'),('{admin}','{admin}@example.invalid');insert into public.vihem_profiles(id,organisation_id,name,email,role,active,snow_time_access) values('{user}','{org}','Snow API User','{user}@example.invalid','snow',true,true),('{admin}','{org}','Snow API Admin','{admin}@example.invalid','admin',true,false) on conflict(id) do update set organisation_id=excluded.organisation_id,role=excluded.role,active=true,snow_time_access=excluded.snow_time_access;insert into public.vihem_organisation_modules(organisation_id,module_key,enabled,settings) values('{org}','snow',true,'{{\"admin_only\":false}}') on conflict(organisation_id,module_key) do update set enabled=true;insert into public.vihem_time_categories(organisation_id,key,label,active) values('{org}','snow_plowing','Snow',true) on conflict do nothing;insert into public.vihem_snow_clients(id,organisation_id,name) values('{client}','{org}','QA Snow API Client');commit;")
 with tempfile.NamedTemporaryFile(mode='w',delete=False) as env:
  os.chmod(env.name,0o600);env.write(f'PGRST_DB_URI=postgres://{role}:{password}@vihem-chat-qa-db:5432/postgres\nPGRST_DB_SCHEMAS=public\nPGRST_DB_ANON_ROLE=anon\nPGRST_DB_PRE_REQUEST=public.vihem_snow_api_guard\nPGRST_JWT_SECRET={jwt}\nPGRST_LOG_LEVEL=error\n')
 if admin_pilot:sql(f"update public.vihem_organisation_modules set settings='{{\"admin_only\":true}}' where organisation_id='{org}' and module_key='snow';")
 try:subprocess.run(['docker','run','-d','--name',container,'--network','vihem-chat-qa','--env-file',env.name,'-p','127.0.0.1::3000','postgrest/postgrest:v14.8'],check=True,stdout=subprocess.DEVNULL)
 finally:os.unlink(env.name)
 port=json.loads(subprocess.check_output(['docker','inspect',container,'--format','{{json .NetworkSettings.Ports}}']))['3000/tcp'][0]['HostPort'];base='http://127.0.0.1:'+port
 for _ in range(30):
  try:
   if call('/vihem_snow_clients',who=admin)[0]==200:break
  except (OSError,urllib.error.URLError):pass
  time.sleep(1)
 else:raise RuntimeError('QA PostgREST did not become healthy')
 if admin_pilot:
  assert call('/vihem_snow_clients')==(200,[])
  operation={'p_id':str(uuid.uuid4()),'p_action':'clockin','p_expected':None,'p_event':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'p_job':{'category':'snow_plowing','snow_client_id':client,'snow_method':'machine'}}
  assert call('/rpc/vihem_clock_transition',method='POST',data=operation)[0]==403
  sql(f"update public.vihem_profiles set role='staff' where id='{user}';insert into public.vihem_permission_grants(organisation_id,user_id,permission_key) values('{org}','{user}','module.snow');")
  assert call('/vihem_snow_clients')==(200,[])
  assert call('/rpc/vihem_clock_transition',method='POST',data=operation)[0]==403
  assert call('/rpc/vihem_snow_external_ready',who=admin,method='POST',data={})==(200,False)
  assert len(call('/vihem_snow_clients',who=admin)[1])==1
  status,result=call('/rpc/vihem_clock_transition',who=admin,method='POST',data=operation);assert status==200,result
  status,snapshot=call('/rpc/vihem_snow_availability_snapshot',who=admin,method='POST',data={'p_from':'2026-11-02','p_days':7});assert status==200,snapshot
  assert len(snapshot['people'])==2 and all(set(person)=={'id','name'} for person in snapshot['people'])
  assert call('/rpc/vihem_snow_availability_snapshot',method='POST',data={'p_from':'2026-11-02','p_days':7})[0]==403
  availability={'p_operation':str(uuid.uuid4()),'p_user':user,'p_days':['2026-11-02','2026-11-03'],'p_status':'partial','p_slots':[[0,360],[1020,1440]],'p_expected':{'2026-11-02':0,'2026-11-03':0}}
  status,saved=call('/rpc/vihem_snow_availability_save',who=admin,method='POST',data=availability);assert status==200 and len(saved)==2,saved
  assert call('/rpc/vihem_snow_availability_save',who=admin,method='POST',data=availability)==(200,saved)
  assert call('/rpc/vihem_snow_availability_save',method='POST',data={**availability,'p_operation':str(uuid.uuid4())})[0]==403
  print('PASS availability HTTP: admin snapshot/save/retry, minimal roster, staff denied, exactly two saved dates')
  print('PASS admin pilot HTTP: staff and external denied snow clock/data; admin allowed; external provisioning disabled')
 else:
  status,rows=call('/vihem_snow_clients');assert status==200 and len(rows)==1,(status,rows)
  assert call('/vihem_profiles')[1][0]['id']==user and len(call('/vihem_profiles')[1])==1
  for path in ['/vihem_work_orders','/vihem_rental_customers','/vihem_organisations']:
   assert call(path)[0]==403,path
  status,result=call('/rpc/create_notification',method='POST',data={'recipient_id':user,'org_uuid':org,'notification_title':'QA denied','notification_message':'synthetic','notification_type':'info','notification_link':'','setting_key':'other_notifications'});assert status==403,(status,result)
  status,result=call('/rpc/vihem_snow_save',method='POST',data={'p_kind':'client','p_id':str(uuid.uuid4()),'p_revision':None,'p_data':{'name':'Denied edit'}});assert status==403,(status,result)
  assert call('/vihem_profiles?id=eq.'+user,method='PATCH',data={'role':'admin'})[0]==403
  assert call('/rpc/vihem_snow_external_ready',who=admin,method='POST',data={})==(200,True)
  assert call('/vihem_snow_clients',who=admin)[0]==200
  operation={'p_id':str(uuid.uuid4()),'p_action':'clockin','p_expected':None,'p_event':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'p_job':{'category':'snow_plowing','snow_client_id':client,'snow_method':'machine'}}
  status,result=call('/rpc/vihem_clock_transition',method='POST',data=operation);assert status==200,result
  assert call('/rpc/vihem_clock_transition',method='POST',data=operation)==(200,result)
  assert len(call('/vihem_time_entries')[1])==1
  print('PASS real HTTP: restricted tables/RPC/write denial, own data, clock + retry, admin unaffected, readiness hook verified')
finally:
 subprocess.run(['docker','rm','-fv',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 sql(f"begin;delete from public.vihem_snow_availability_operations where organisation_id='{org}';delete from public.vihem_snow_availability where organisation_id='{org}';delete from public.vihem_clock_operations where organisation_id='{org}';delete from public.vihem_time_entries where organisation_id='{org}';delete from public.vihem_snow_clients where organisation_id='{org}';delete from public.vihem_organisations where id='{org}';delete from auth.users where id in ('{user}','{admin}');commit;drop role if exists {role};",False)
 print('Temporary REST container and synthetic QA fixtures removed')
