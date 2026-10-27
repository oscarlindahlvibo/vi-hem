"""Disposable PostgreSQL contract + concurrency tests; never reads production URLs."""
import pathlib,subprocess,time,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
NAME='vihem-snow-v2-test'
def run(args,**kw):
 r=subprocess.run(args,text=True,capture_output=True,**kw)
 if r.returncode:raise RuntimeError(r.stdout+"\n"+r.stderr)
 return r.stdout
def sql(s):return run(['docker','exec','-i',NAME,'psql','-h','127.0.0.1','-X','-v','ON_ERROR_STOP=1','-U','postgres','-Atq'],input=s)
if '--existing' not in sys.argv:
 if '--fresh-test' in sys.argv:
  existing=subprocess.run(['docker','inspect','-f','{{index .Config.Labels "vihem.task"}}',NAME],text=True,capture_output=True)
  if existing.returncode==0:
   if existing.stdout.strip()!='snow-v2':raise RuntimeError('Refusing to remove a container without the snow-v2 task label')
   run(['docker','rm','-f',NAME])
 run(['docker','run','-d','--name',NAME,'--label','vihem.task=snow-v2','-e','POSTGRES_PASSWORD=snow-local-only','postgres:15'])
 for i in range(40):
  try:sql('SELECT 1');break
  except (subprocess.CalledProcessError,RuntimeError):time.sleep(.25)
 sql((ROOT/'scripts/snow-v2/bootstrap.sql').read_text())
 for name in ['20261022100000_snow_operations.sql','20261022110000_snow_external_accounts.sql','20261022120000_snow_api_guard.sql','20261022130000_snow_admin_pilot.sql','20261022140000_snow_route_segments.sql','20261022150000_snow_mixed_route_shapes.sql','20261022160000_snow_availability.sql','20261022170000_snow_driver_calendar.sql']:
  source=(ROOT/'supabase/migrations'/name).read_text()
  sql(source)
 for p in sorted((ROOT/'supabase/migrations').glob('20261027*sn*.sql')):sql(p.read_text())
 print('PASS: real snow v1/v2 migration compilation on disposable PostgreSQL15 contract schema')
if (ROOT/'scripts/snow-v2/scenarios.sql').exists():
 print(sql((ROOT/'scripts/snow-v2/scenarios.sql').read_text()))

if '--existing' not in sys.argv:
 print(run([sys.executable,str(ROOT/'scripts/snow-v2/scenarios.py')]))
