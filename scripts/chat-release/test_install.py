"""Release preflight guards, against fake Docker/Git and temporary host paths."""
import hashlib, json, os, subprocess, tempfile, unittest
from pathlib import Path
SOURCE=Path(__file__).with_name('install.py')
class ReleaseGuards(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.package=self.root/'package';self.package.mkdir();self.volume=self.root/'volumes';self.web=self.root/'web';self.web.mkdir();(self.web/'index.html').write_text('old web');(self.volume/'deploy-state').mkdir(parents=True);(self.volume/'deploy-state/applied-migrations.tsv').write_text('')
  s=SOURCE.read_text().replace('/home/vibo/atm-personal-supabase/volumes',str(self.volume)).replace('/var/www/app.vi-hem.se/html',str(self.web));(self.package/'install.py').write_text(s)
  self.bin=self.root/'bin';self.bin.mkdir();(self.package/'admin').mkdir();(self.package/'admin/index.html').write_text('new web');(self.package/'migrations').mkdir();(self.package/'migrations/20261009090000_chat_foundation.sql').write_text('BEGIN;\nSELECT 42;\nCOMMIT;')
  digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();self.limits={'external_id':'realtime-dev','max_events_per_second':100,'max_concurrent_users':200,'max_channels_per_client':100}
  self.manifest={'source_commit':'chatsha','base_main':'mainsha','previous_index':digest(self.web/'index.html'),'previous_realtime':self.limits,'server_files':{'_shared/apns.ts':None},'backend_files':[],'migrations':['20261009090000_chat_foundation.sql'],'files':{'migrations/20261009090000_chat_foundation.sql':digest(self.package/'migrations/20261009090000_chat_foundation.sql'),'admin/index.html':digest(self.package/'admin/index.html')}}
  (self.package/'release.json').write_text(json.dumps(self.manifest));self.state={'journal_exists':False,'journal':{},'schema_exists':False,'limits':self.limits};self.save()
  (self.bin/'git').write_text('#!/usr/bin/env python3\nprint("mainsha refs/heads/main\\nchatsha refs/heads/codex/chat-modernisation")\n')
  (self.bin/'docker').write_text('''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
r=Path(os.environ['FAKE_HOST']);state=json.loads((r/'state.json').read_text());args=sys.argv[1:]
if args[0]=='inspect':print(json.dumps([{'Config':{'Env':['APNS_AUTH_KEY=not-a-real-key','APNS_KEY_ID=k','APNS_TEAM_ID=t','APNS_TOPIC=se.vihem.app','APNS_ENVIRONMENT=production']}}]));sys.exit()
sql=sys.stdin.read();(r/'queries.log').open('a').write(sql+'\\n')
if "to_regclass('public.vihem_chat_release_journal')" in sql:print('t' if state['journal_exists'] else 'f')
elif 'json_object_agg(name,sha256)' in sql:print(json.dumps(state['journal']))
elif 'vihem_chat_same_org(uuid)' in sql:print('t' if state['schema_exists'] else 'f')
elif '_realtime.tenants' in sql:print(json.dumps(state['limits']))
elif "key='push_notification_dispatch'" in sql:print('t')
elif sql.startswith('BEGIN;'):
 assert sql.rstrip().endswith('ROLLBACK;'), 'preflight attempted commit'
 print('rolled back')
else:raise SystemExit(3)
''')
  for p in self.bin.iterdir():p.chmod(0o755)
 def save(self):(self.root/'state.json').write_text(json.dumps(self.state))
 def run_installer(self,*args):return subprocess.run(['python3',str(self.package/'install.py'),*args],env={**os.environ,'PATH':str(self.bin)+os.pathsep+os.environ['PATH'],'FAKE_HOST':str(self.root)},capture_output=True,text=True)
 def tearDown(self):self.temp.cleanup()
 def test_default_is_read_only(self):
  r=self.run_installer();self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertNotIn('BEGIN;', (self.root/'queries.log').read_text());self.assertEqual((self.web/'index.html').read_text(),'old web')
 def test_rehearsal_rolls_back(self):
  r=self.run_installer('--rehearse');self.assertEqual(r.returncode,0,r.stderr);q=(self.root/'queries.log').read_text();self.assertIn('original_chat_history',q);self.assertIn('ROLLBACK;',q);self.assertNotIn('COMMIT;',q)
 def test_changed_file_stops_before_migration(self):
  target=self.volume/'functions/_shared/apns.ts';target.parent.mkdir(parents=True);target.write_text('Claude changed this');r=self.run_installer('--rehearse');self.assertNotEqual(r.returncode,0);self.assertIn('Server file changed',r.stdout+r.stderr)
 def test_bad_package_stops(self):
  (self.package/'migrations/20261009090000_chat_foundation.sql').write_text('tampered');r=self.run_installer('--rehearse');self.assertNotEqual(r.returncode,0);self.assertIn('checksum',r.stdout+r.stderr)
 def test_unjournaled_schema_stops(self):
  self.state['schema_exists']=True;self.save();r=self.run_installer('--rehearse');self.assertNotEqual(r.returncode,0);self.assertIn('Unjournaled',r.stdout+r.stderr)
 def test_unknown_realtime_settings_stop(self):
  self.state['limits']={**self.limits,'max_concurrent_users':999};self.save();r=self.run_installer();self.assertNotEqual(r.returncode,0);self.assertIn('Realtime settings changed',r.stdout+r.stderr)
 def test_post_commit_crash_can_resume_without_reapplying(self):
  name=self.manifest['migrations'][0];self.state.update(journal_exists=True,schema_exists=True,journal={name:self.manifest['files']['migrations/'+name]});self.save();r=self.run_installer('--rehearse');self.assertEqual(r.returncode,0,r.stderr);self.assertNotIn('SELECT 42;', (self.root/'queries.log').read_text())
 def test_journal_hash_conflict_stops(self):
  self.state.update(journal_exists=True,journal={self.manifest['migrations'][0]:'wrong'});self.save();r=self.run_installer();self.assertNotEqual(r.returncode,0);self.assertIn('checksum conflict',r.stdout+r.stderr)
if __name__=='__main__':unittest.main()
