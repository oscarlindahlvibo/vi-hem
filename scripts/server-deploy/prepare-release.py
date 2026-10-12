#!/usr/bin/python3
import pathlib,subprocess,json,hashlib,tarfile,io,os
repo=pathlib.Path('/home/vibo/vi-hem');source=repo/'dist';target=pathlib.Path('/home/vibo/.local/share/vihem-deploy/release.tar')
subprocess.run(['python3','/home/vibo/check_vihem_frontend.py',str(repo),'/home/vibo/atm-personal-supabase/volumes/deploy-state/applied-migrations.tsv','/var/www/app.vi-hem.se/html','/home/vibo/atm-personal-supabase/volumes/functions'],check=True)
revision=subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()
assert not subprocess.check_output(['git','-C',str(repo),'status','--porcelain'],text=True).strip()
v=json.loads((source/'beta-version.json').read_text());assert v['revision']==revision and v['restricted'] and not v['workingTreePending']
assert not any(p.is_symlink() for p in source.rglob('*'))
files={str(p.relative_to(source)):p.read_bytes() for p in source.rglob('*') if p.is_file()}
assert 'deploy-manifest.json' not in files
meta=json.dumps({'revision':revision,'files':{n:hashlib.sha256(d).hexdigest() for n,d in files.items()}}).encode()
target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
with tarfile.open(str(target)+'.pending','w') as t:
 for name,data in {**files,'deploy-manifest.json':meta}.items():
  m=tarfile.TarInfo(name);m.size=len(data);m.mode=0o644;t.addfile(m,io.BytesIO(data))
os.replace(str(target)+'.pending',target)
print('VI-HEM release package prepared: '+revision)
