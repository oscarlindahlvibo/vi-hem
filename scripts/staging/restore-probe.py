"""Rehearse an existing shared backup inside a disposable, network-less container.
Runs on vibo-server; no live database or shared container is touched. No row values/logs emitted.
"""
import argparse, gzip, json, os, pathlib, re, secrets, subprocess, time
p=argparse.ArgumentParser();p.add_argument('backup');p.add_argument('--package');a=p.parse_args()
backup=pathlib.Path(a.backup).resolve()
if backup.parent != pathlib.Path('/mnt/md0/supabase-backups/shared') or not re.fullmatch(r'\d{8}T\d{6}Z',backup.name):raise SystemExit('Named shared backup required')
os.environ['DOCKER_HOST']='unix:///run/user/1000/docker.sock'
name='vihem-beta-restore-probe'
password=secrets.token_hex(24)
def run(args,**kw):
 r=subprocess.run(args,capture_output=True,text=True,**kw)
 if r.returncode:
  logs=subprocess.run(['docker','logs',name],capture_output=True,text=True)
  private=pathlib.Path('/var/tmp/vihem-chat-qa-20261008/restore-probe-container-private.log');private.write_text(logs.stdout+logs.stderr);private.chmod(0o600)
  log=pathlib.Path('/var/tmp/vihem-chat-qa-20261008/restore-probe-private.log');log.write_text(r.stderr);log.chmod(0o600)
  raise RuntimeError('Restore probe command failed; private diagnostics retained')
 return r
if run(['docker','ps','-a','--filter','name=^/'+name+'$','--format','{{.Names}}']).stdout.strip():raise SystemExit('Existing probe: inspect rather than overwrite')
run(['sha256sum','--check','SHA256SUMS'],cwd=backup)
report={ 'backup':str(backup),'network':'none','ports':[], 'source':'existing backup, live DB unchanged' }
try:
 run(['docker','run','-d','--name',name,'--network','none','--memory','2g','--cpus','1','--pids-limit','256','-e','POSTGRES_PASSWORD='+password,'-e','POSTGRES_DB=restore_probe','supabase/postgres:15.8.1.085'])
 run(['docker','exec',name,'mkdir','-p','/tmp/storage-restore'])
 with open(backup/'storage-config.tar.gz','rb') as archive:
  extracted=subprocess.run(['docker','exec','-i',name,'tar','-xzf','-','-C','/tmp/storage-restore','--wildcards','volumes/storage/*'],stdin=archive,capture_output=True)
  if extracted.returncode:raise SystemExit('Storage archive extraction failed')
 file_count=int(run(['docker','exec',name,'sh','-c','find /tmp/storage-restore/volumes/storage -type f | wc -l']).stdout)
 report['storage_files_restored']=file_count
 if file_count<1:raise SystemExit('Storage backup contains no restored files')
 for _ in range(60):
  ready=subprocess.run(['docker','exec','-e','PGPASSWORD='+password,name,'psql','-h','127.0.0.1','-X','-At','-U','supabase_admin','-d','restore_probe','-c',"SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_admin' AND rolsuper);"],capture_output=True,text=True)
  if ready.returncode==0 and ready.stdout.strip()=='t':break
  time.sleep(1)
 else:raise RuntimeError('Probe did not start')
 run(['docker','exec','-e','PGPASSWORD='+password,name,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','restore_probe','-c',"CREATE ROLE vihem_restore_operator LOGIN SUPERUSER PASSWORD '"+password+"';"])
 with gzip.open(backup/'database.sql.gz','rt') as f:
  dump=f.read()
 # Fresh Supabase images have system roles already. Preserve them, restore all
 # original ALTER ROLE settings/grants, and create missing roles conditionally.
 dump=re.sub(r'^DROP ROLE [^;]+;\n', '', dump, flags=re.M)
 dump=re.sub(r'^CREATE ROLE ([a-z_][a-z_0-9]*);$', lambda m: "DO $restore$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='"+m[1]+"') THEN CREATE ROLE "+m[1]+"; END IF; END $restore$;", dump, flags=re.M)
 # pg_dump omits the wrapper owned by Supabase's event-trigger machinery.
 # Recreate the same forwarding function before its original ACL statements.
 wrapper='''CREATE OR REPLACE FUNCTION graphql_public.graphql("operationName" text DEFAULT NULL, query text DEFAULT NULL, variables jsonb DEFAULT NULL, extensions jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $wrapper$ SELECT graphql.resolve(query := query, variables := coalesce(variables, '{}'), "operationName" := "operationName", extensions := extensions); $wrapper$;\n'''
 marker='GRANT ALL ON FUNCTION graphql_public.graphql('
 if marker in dump:
  offset=dump.index(marker);dump=dump[:offset]+wrapper+dump[offset:]
 report['restore_adapter']='fresh Supabase roles + original GraphQL forwarding wrapper; original ACLs retained'
 result=subprocess.run(['docker','exec','-i','-e','PGPASSWORD='+password,name,'psql','-h','127.0.0.1','-X','-q','-v','VERBOSITY=verbose','-U','vihem_restore_operator','-d','restore_probe'],input=dump.replace('DROP DATABASE postgres;', 'DROP DATABASE IF EXISTS postgres WITH (FORCE);'),text=True,capture_output=True)
 log=pathlib.Path('/var/tmp/vihem-chat-qa-20261008/restore-probe-private.log');log.write_text(result.stderr);log.chmod(0o600)
 # Every remaining SQL error fails verification, including COPY/data errors.
 states=re.findall(r'(?:ERROR|FATAL):\s+(\w{5})',result.stderr)
 report['sqlstates']={s:states.count(s) for s in set(states)}
 report['restore_exit']=result.returncode
 report['expected_bootstrap_only']=not states
 query="SELECT json_build_object('vihem_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'vihem%'),'documents',(SELECT count(*) FROM public.vihem_documents),'inspections',(SELECT count(*) FROM public.vihem_apartment_inspections),'storage_objects',(SELECT count(*) FROM storage.objects),'auth_users',(SELECT count(*) FROM auth.users));"
 report['counts']=json.loads(run(['docker','exec','-e','PGPASSWORD='+password,name,'psql','-h','127.0.0.1','-X','-At','-U','vihem_restore_operator','-d','postgres','-c',query]).stdout)
 if result.returncode or not report['expected_bootstrap_only']:print(json.dumps(report));raise SystemExit('Backup restore requires investigation; not verified')
 if a.package:
  import hashlib
  def unrelated_fingerprint():
   content=run(['docker','exec','-e','PGPASSWORD='+password,name,'pg_dump','-h','127.0.0.1','-U','vihem_restore_operator','-d','postgres','--data-only','--schema=public','--exclude-table=public.vihem*','--no-owner','--no-privileges']).stdout
   return hashlib.sha256(content.encode()).hexdigest()
  unrelated_before=unrelated_fingerprint()
  package=pathlib.Path(a.package).resolve()
  if not str(package).startswith('/var/tmp/vihem-chat-qa-20261008/'):raise SystemExit('QA package path required')
  manifest=json.loads((package/'manifest.json').read_text())
  import hashlib
  passed=[]
  for relative in manifest['migrations']:
   if pathlib.Path(relative).is_absolute() or '..' in pathlib.Path(relative).parts:raise SystemExit('Invalid migration path')
   path=package/relative
   if hashlib.sha256(path.read_bytes()).hexdigest()!=manifest['files'][relative]:raise SystemExit('Package hash mismatch')
   migration=run(['docker','exec','-i','-e','PGPASSWORD='+password,name,'psql','-h','127.0.0.1','-X','-q','-v','ON_ERROR_STOP=1','-U','vihem_restore_operator','-d','postgres'],input=path.read_text())
   passed.append(path.name)
  report['migrations_passed']=len(passed)
  privacy=manifest.get('post_migration_privacy_sql')
  if privacy:
   path=package/privacy
   if pathlib.Path(privacy).is_absolute() or '..' in pathlib.Path(privacy).parts or hashlib.sha256(path.read_bytes()).hexdigest()!=manifest['files'][privacy]:raise SystemExit('Privacy SQL hash/path mismatch')
   run(['docker','exec','-i','-e','PGPASSWORD='+password,name,'psql','-h','127.0.0.1','-X','-q','-v','ON_ERROR_STOP=1','-U','vihem_restore_operator','-d','postgres'],input=path.read_text())
   targets="('vihem-chat-attachments','vihem-inspection-photos','vihem-work-order-attachments','vihem-fleet-images','vihem-fleet-documents')"
   for role in ['anon','authenticated']:
    test=run(['docker','exec','-i','-e','PGPASSWORD='+password,name,'psql','-h','127.0.0.1','-X','-qAt','-v','ON_ERROR_STOP=1','-U','vihem_restore_operator','-d','postgres'],input='BEGIN; SET LOCAL ROLE '+role+'; SELECT count(*) FROM storage.objects WHERE bucket_id IN '+targets+'; ROLLBACK;')
    if test.stdout.strip()!='0':raise SystemExit('Legacy storage quarantine failed for '+role)
   report['legacy_privacy_roles_denied']=['anon','authenticated']
   report['legacy_files_retained']=json.loads(run(['docker','exec','-e','PGPASSWORD='+password,name,'psql','-h','127.0.0.1','-X','-At','-U','vihem_restore_operator','-d','postgres','-c',query]).stdout)['storage_objects']==report['counts']['storage_objects']
   if not report['legacy_files_retained']:raise SystemExit('Legacy objects lost')
  report['other_public_app_data_unchanged']=unrelated_fingerprint()==unrelated_before
  if not report['other_public_app_data_unchanged']:raise SystemExit('Unrelated application data changed')
  after=json.loads(run(['docker','exec','-e','PGPASSWORD='+password,name,'psql','-h','127.0.0.1','-X','-At','-U','vihem_restore_operator','-d','postgres','-c',query]).stdout)
  report['existing_records_preserved']=all(after[k]==report['counts'][k] for k in ['documents','inspections','storage_objects','auth_users'])
  if not report['existing_records_preserved']:raise SystemExit('Record preservation failed')
 print(json.dumps(report))
 if result.returncode or not report['expected_bootstrap_only'] or not report['counts']['vihem_tables']:raise SystemExit('Backup restore requires investigation; not verified')
finally:
 # Disposable restore copy only; source archive retained, no live files touched.
 subprocess.run(['docker','rm','-f','-v',name],capture_output=True)
