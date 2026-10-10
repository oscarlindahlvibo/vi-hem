"""Apply SQL only to a named schema-only staging clone inside the QA container.
Requires the pre-created clones; deliberately cannot create/drop databases or
connect to production. Credentials stay on the server and are never printed.
Usage: python3 scripts/premium/hotfix-stage-sql.py comments < candidate.sql
"""
import subprocess, sys, shlex
if len(sys.argv)!=2 or sys.argv[1] not in ('comments','fleet','inventory'):
    raise SystemExit('Choose comments, fleet or inventory staging only')
name='vihem_hotfix_stage_'+sys.argv[1]+'_20261010'
remote="""import json,os,subprocess,sys
os.environ['DOCKER_HOST']='unix:///run/user/1000/docker.sock'
c=json.load(open('/var/tmp/vihem-chat-qa-20261008/credentials.json'))
r=subprocess.run(['docker','exec','-i','-e','PGPASSWORD='+c['password'],'vihem-chat-qa-db','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',%r],input=sys.stdin.read(),text=True,capture_output=True)
print((r.stderr if r.returncode else r.stdout or 'Staging SQL applied').replace(c['password'],'[redacted]'))
sys.exit(r.returncode)
""" % name
r=subprocess.run(['ssh','vibo-server','python3 -c '+shlex.quote(remote)],input=sys.stdin.read(),text=True,capture_output=True)
print(r.stdout,r.stderr);raise SystemExit(r.returncode)
