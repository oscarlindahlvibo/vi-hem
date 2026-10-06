#!/usr/bin/env python3
"""Record only the two verified, already-installed Vibo migrations in the existing deploy ledger."""
from pathlib import Path
import subprocess,json,os,shutil,datetime
package=Path(__file__).resolve().parent
state=Path('/home/vibo/atm-personal-supabase/volumes/deploy-state/applied-migrations.tsv')
query='SELECT source_digest FROM vihem_vibofast_private.installation WHERE id;'
installed=subprocess.check_output(['docker','exec','-e','PGOPTIONS=-c default_transaction_read_only=on','supabase-db','psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',query],text=True).strip()
if installed!=(package/'installation-digest.txt').read_text().strip():raise SystemExit('Expected installed SQL digest not found')
if not state.is_file():raise SystemExit('Existing multi-app deploy ledger not found; refusing to initialise it')
records=json.loads((package/'migration-checksums.json').read_text())
expected={'vi-hem/20261006113000_vihem_profile_authority_guard.sql','vi-hem/20261006120000_vihem_vibofast_website.sql'}
if set(records)!=expected:raise SystemExit('Unexpected migration ledger keys')
previous=state.read_text();existing=dict(line.split('\t',1) for line in previous.splitlines() if '\t' in line)
append=[]
for key,digest in records.items():
 if key in existing:
  if existing[key]!=digest:raise SystemExit('Conflicting recorded migration checksum: '+key)
 else:append.append(key+'\t'+digest+'\n')
if append:
 backup_root=Path('/home/vibo/atm-personal-supabase/volumes/vibofast-backups')
 backup_root.mkdir(mode=0o700,parents=True,exist_ok=True)
 backup=backup_root/('migration-ledger-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.tsv')
 shutil.copyfile(state,backup);backup.chmod(0o600)
 fd=os.open(state,os.O_WRONLY|os.O_APPEND)
 try:os.write(fd,((('\n' if previous and not previous.endswith('\n') else '')+''.join(append))).encode())
 finally:os.close(fd)
print('PASS: both installed Vibo migration checksums are registered. All existing deploy ledger entries preserved.')
