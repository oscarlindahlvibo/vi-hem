#!/usr/bin/env python3
"""Publish only the approved restricted VI-HEM frontend. Run as root on vibo-server."""
import os,pathlib,json,hashlib,tarfile,datetime,shutil,urllib.request,fcntl,re,subprocess
if os.geteuid()!=0:raise SystemExit('Requires root: sudo python3 publish_vihem_frontend.py SOURCE WEBROOT')
os.umask(0o022)
import sys
source=pathlib.Path(sys.argv[1]).resolve();web=pathlib.Path(sys.argv[2]).resolve()
assert web==pathlib.Path('/var/www/app.vi-hem.se/html'), 'Only VI-HEM webroot is permitted'
version=json.loads((source/'beta-version.json').read_text())
assert version['restricted'] and not version['workingTreePending']
revision=subprocess.check_output(['git','-C',str(source.parent),'rev-parse','HEAD'],text=True).strip()
assert version['revision']==revision
old=json.loads((web/'beta-version.json').read_text())
assert old['restricted']
subprocess.run(['git','-C',str(source.parent),'merge-base','--is-ancestor',old['revision'],revision],check=True)
files={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}
assert not any(p.is_symlink() for p in source.rglob('*'))
oldbackup=pathlib.Path('/mnt/md0/supabase-backups/shared/vihem-frontend');oldbackup.mkdir(mode=0o700,parents=True,exist_ok=True)
lock=open('/var/lock/vihem-beta-frontend.lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=oldbackup/('frontend-release-'+stamp);backup.mkdir(mode=0o700);shutil.copytree(web,backup/'previous',symlinks=True)
report={'source_commit':revision,'restricted':True,'backup':str(backup),'scope':'VI-HEM frontend only','old_hashed_assets_retained':True}
def install(rel):
 dest=web/rel;dest.parent.mkdir(parents=True,exist_ok=True)
 pending=dest.with_name(dest.name+'.vihem-beta-pending');shutil.copyfile(source/rel,pending);pending.chmod(0o644);shutil.chown(pending,user='www-data',group='www-data');os.replace(pending,dest)
def fetch(rel):
 req=urllib.request.Request('https://app.vi-hem.se/'+rel+'?vihem_release='+stamp,headers={'Cache-Control':'no-cache'})
 with urllib.request.urlopen(req,timeout=30) as response:
  assert response.status==200
  return response.read()
try:
 for rel in files:
  if rel!='index.html':install(rel)
 # Verify referenced build chunks exist before switching the entrypoint.
 index=(source/'index.html').read_text()
 for rel in re.findall(r'(?:src|href)="/([^"?#]+)',index):assert (web/rel).is_file(),rel
 install('index.html')
 for rel in files:
  assert hashlib.sha256((web/rel).read_bytes()).hexdigest()==files[rel]
 for rel in ['index.html','beta-version.json',*sorted(p for p in files if p.startswith('assets/'))]:
  assert hashlib.sha256(fetch(rel)).hexdigest()==files[rel],'HTTP hash '+rel
 assert fetch('chat')==web.joinpath('index.html').read_bytes(),'SPA route'
 report['status']='frontend installed; HTTP/index/assets verified';report['finished_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 (backup/'release-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
except Exception:
 # Restore old entrypoint and overwritten fixed files; retain both generations of hashed assets.
 for src in (backup/'previous').rglob('*'):
  if src.is_file() and src.relative_to(backup/'previous').parts[0]!='assets':
   dest=web/src.relative_to(backup/'previous');tmp=dest.with_name(dest.name+'.rollback');shutil.copy2(src,tmp);shutil.chown(tmp,user='www-data',group='www-data');os.replace(tmp,dest)
 report['status']='publish failed; previous frontend restored; backend/security retained';(backup/'release-report.json').write_text(json.dumps(report,indent=2));raise
