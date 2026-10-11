#!/usr/bin/env python3
import hashlib,json,pathlib,subprocess,sys
repo,state,web,functions=map(pathlib.Path,sys.argv[1:])
def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()
old=json.loads((web/'beta-version.json').read_text())
assert old['restricted'], 'Existing VI-HEM beta restrictions must remain enabled'
subprocess.run(['git','-C',str(repo),'merge-base','--is-ancestor',old['revision'],'HEAD'],check=True)
ledger=dict(line.split('\t')[:2] for line in state.read_text().splitlines() if '\t' in line)
for rel in git('diff','--name-only','2b935b7','HEAD','--','supabase/migrations').splitlines():
    f=repo/rel
    assert f.is_file(), 'Removed migration: '+rel
    assert ledger.get('vi-hem/'+f.name)==hashlib.sha256(f.read_bytes()).hexdigest(), 'Backend migration missing/mismatch: '+f.name
for rel in git('diff','--name-only','2b935b7','HEAD','--','supabase/functions').splitlines():
    source=repo/rel
    installed=functions/pathlib.Path(rel).relative_to('supabase/functions')
    assert source.is_file() and installed.is_file(), 'Backend function missing/removed: '+rel
    assert hashlib.sha256(source.read_bytes()).digest()==hashlib.sha256(installed.read_bytes()).digest(), 'Backend function mismatch: '+rel
assert (repo/'scripts/build-mobile-release.mjs').is_file(), 'Restricted beta build missing'
print('VI-HEM: no downgrade; backend migrations match installed ledger.')
