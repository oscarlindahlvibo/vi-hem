#!/usr/bin/env python3
"""Build a checksummed manual release from a clean, committed chat branch."""
from pathlib import Path
import argparse, hashlib, json, shutil, subprocess
p=argparse.ArgumentParser();p.add_argument('output');args=p.parse_args()
repo=Path(__file__).resolve().parents[2];out=Path(args.output).resolve()
def git(*args):return subprocess.check_output(['git',*args],cwd=repo,text=True).strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
if git('status','--porcelain'):raise SystemExit('Commit/review all changes before packaging.')
if out.exists():raise SystemExit('Output path must be new.')
main=git('rev-parse','origin/main');commit=git('rev-parse','HEAD')
subprocess.run(['git','merge-base','--is-ancestor',main,commit],cwd=repo,check=True)
subprocess.run(['node','--input-type=module','-e', "import {loadEnv} from 'vite';import {execFileSync} from 'node:child_process';const env={...process.env,...loadEnv('production',process.cwd(),'VITE_')};env.VITE_PUBLIC_APP_URL ||= 'https://app.vi-hem.se';execFileSync('npm',['run','release:check'],{env,stdio:'inherit'});"],cwd=repo,check=True)
subprocess.run(['npm','run','typecheck'],cwd=repo,check=True)
subprocess.run(['npm','run','build'],cwd=repo,check=True)
out.mkdir(parents=True);shutil.copytree(repo/'dist',out/'admin')
backend=['vihem-chat-upload/index.ts','vihem-chat-to-workorder/index.ts','vihem-send-push/index.ts','_shared/chat-files.ts','_shared/fcm.ts','_shared/apns.ts']
server_files=backend+['_shared/vihem-auth.ts','main/index.ts']
# Read hashes/configuration presence only. Credentials never leave the server.
audit='''import os,subprocess,json,hashlib
from pathlib import Path
os.environ['DOCKER_HOST']='unix:///run/user/1000/docker.sock'
volume=Path('/home/vibo/atm-personal-supabase/volumes/functions')
names=NAMES
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
sql="select row_to_json(t) from (select external_id,max_events_per_second,max_concurrent_users,max_channels_per_client from _realtime.tenants where external_id='realtime-dev') t"
r=subprocess.check_output(['docker','exec','supabase-db','psql','-X','-At','-U','postgres','-d','postgres','-c',sql],text=True)
print(json.dumps({'server_files':{n:sha(volume/n) if (volume/n).exists() else None for n in names},'previous_index':sha(Path('/var/www/app.vi-hem.se/html/index.html')),'previous_realtime':json.loads(r)}))
'''.replace('NAMES',repr(server_files))
metadata=json.loads(subprocess.check_output(['ssh','-o','BatchMode=yes','vibo-server','python3 -'],input=audit,text=True))
for name in backend:
 target=out/'backend'/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(repo/'supabase/functions'/name,target)
for name in ['_shared/vihem-auth.ts']:
 if metadata['server_files'][name]!=sha(repo/'supabase/functions'/name):raise SystemExit('Shared auth/cors differs on server: review first.')
migrations=sorted((repo/'supabase/migrations').glob('20261009*chat*.sql'))
(out/'migrations').mkdir()
for f in migrations:shutil.copyfile(f,out/'migrations'/f.name)
shutil.copyfile(repo/'scripts/chat-release/install.py',out/'install.py')
shutil.copyfile(repo/'docs/chat-release.md',out/'LAS-MIG.md')
manifest={'source_commit':commit,'base_main':main,**metadata,'backend_files':backend,'migrations':[f.name for f in migrations],'files':{str(f.relative_to(out)):sha(f) for f in out.rglob('*') if f.is_file()}}
(out/'release.json').write_text(json.dumps(manifest,indent=2)+'\n')
shutil.make_archive(str(out),'zip',out)
print('Manual release packaged at',out,'commit',commit)
