from pathlib import Path
import hashlib,json,subprocess,sys,urllib.request,re
root=Path(__file__).resolve().parent
manifest=json.loads((root/'release.json').read_text())
for name,digest in manifest['files'].items():
 p=root/name
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise SystemExit('Package checksum mismatch: '+name)
main=subprocess.check_output(['git','ls-remote','https://github.com/oscarlindahlvibo/vi-hem.git','refs/heads/main'],text=True).split()[0]
if main!=manifest['base_main_commit']:raise SystemExit('GitHub main changed; review before publication')
key='vi-hem/20261006160000_vihem_vibofast_drive_images.sql'
ledger=Path('/home/vibo/atm-personal-supabase/volumes/deploy-state/applied-migrations.tsv').read_text().splitlines()
if key+'\t'+manifest['files']['drive-images.sql'] not in ledger:raise SystemExit('Expected installed Drive migration not registered')
query="SELECT to_regprocedure('public.vihem_vibofast_drive_state()') IS NOT NULL AND to_regprocedure('public.vihem_vibofast_interests(integer,uuid)') IS NOT NULL AND EXISTS(SELECT 1 FROM cron.job WHERE jobname='vihem-vibofast-drive-images' AND active);"
result=subprocess.check_output(['docker','exec','-e','PGOPTIONS=-c default_transaction_read_only=on','supabase-db','psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',query],text=True).strip()
if result!='t':raise SystemExit('Drive backend not ready')
live=Path('/var/www/app.vi-hem.se/html/index.html')
new=manifest['files']['admin/index.html']
if hashlib.sha256(live.read_bytes()).hexdigest() not in (*manifest['expected_previous_indexes'],new):raise SystemExit('Live Vi-hem frontend changed; review before publication')
for name in ['index.ts','core.ts','google.ts']:
 installed=Path('/home/vibo/atm-personal-supabase/volumes/functions/vihem-vibofast-drive')/name
 if hashlib.sha256(installed.read_bytes()).hexdigest()!=manifest['files']['function/'+name]:raise SystemExit('Installed Drive function changed: '+name)
if 'document-function/index.ts' in manifest['files']:
 installed=Path('/home/vibo/atm-personal-supabase/volumes/functions/vihem-google-drive-storage/index.ts')
 if hashlib.sha256(installed.read_bytes()).hexdigest()!=manifest['files']['document-function/index.ts']:raise SystemExit('Installed document Drive function changed; review first')
if '--live' in sys.argv:
 body=urllib.request.urlopen('https://app.vi-hem.se/?vibo_interest_release='+manifest['source_commit'],timeout=20).read()
 if hashlib.sha256(body).hexdigest()!=new:raise SystemExit('HTTP does not serve the new frontend')
 for asset in re.findall(r'(?:src|href)="(/assets/[^\"]+)"',body.decode()):
  data=urllib.request.urlopen('https://app.vi-hem.se'+asset,timeout=20).read()
  if hashlib.sha256(data).hexdigest()!=manifest['files']['admin'+asset]:raise SystemExit('Published asset mismatch: '+asset)
print('PASS: package, current GitHub main, installed migration, Drive function and schedule and frontend checks.')
