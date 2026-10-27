import subprocess,json,uuid
NAME='vihem-snow-v2-test'
def sql(body):
 r=subprocess.run(['docker','exec','-i',NAME,'psql','-h','127.0.0.1','-X','-v','ON_ERROR_STOP=1','-U','postgres','-Atq'],input=body,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def scalar(body):return sql(body).splitlines()[-1]
def as_user(user,body):return sql("BEGIN;SELECT set_config('request.jwt.claim.sub','"+user+"',true);SET LOCAL ROLE authenticated;"+body+';COMMIT;')
def command(user,action,data,id=None):return json.loads(as_user(user,"SELECT vihem_snow_command('%s','%s','%s')"%(id or uuid.uuid4(),action,json.dumps(data).replace("'","''"))).splitlines()[-1])
def expect_fail(user,action,data):
 try:command(user,action,data)
 except RuntimeError:return
 raise AssertionError('Unexpected command success: '+action)
