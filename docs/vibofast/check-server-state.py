#!/usr/bin/env python3
"""Read-only guard against replacing unrecorded direct server changes."""
from pathlib import Path
import hashlib,json,subprocess,sys
package=Path(__file__).resolve().parent
manifest=json.loads((package/'release.json').read_text())
after_install='--after-install' in sys.argv
for name,digest in manifest['server_baseline'].items():
    if after_install and name in {
        '/home/vibo/atm-personal-supabase/docker-compose.yml',
        '/home/vibo/atm-personal-supabase/.env',
    }: continue
    path=Path(name)
    acceptable={digest}
    if after_install and name=='/etc/nginx/sites-enabled/vibofast.se.conf': acceptable.add(manifest['files']['vibofast.se.conf'])
    if after_install and name=='/var/www/app.vi-hem.se/html/index.html': acceptable.add(manifest['files']['admin/index.html'])
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() not in acceptable:
        raise SystemExit('Server file changed since package preparation: '+name)
base='/home/vibo/atm-personal-supabase'
live=json.loads(subprocess.check_output(['docker','inspect','supabase-edge-functions'],text=True))[0]
labels=live['Config'].get('Labels',{})
if labels.get('com.docker.compose.project.config_files')!=base+'/docker-compose.yml':
    raise SystemExit('Functions Compose file set changed; update the package first')
if labels.get('com.docker.compose.project')!='supabase':
    raise SystemExit('Functions Compose project changed')
env=dict(item.split('=',1) for item in live['Config']['Env'])
image=json.loads(subprocess.check_output(['docker','image','inspect',live['Image']],text=True))[0]
defaults=dict(item.split('=',1) for item in image['Config'].get('Env',[]))
config=json.loads(subprocess.check_output(['docker','compose','--project-directory',base,'-p','supabase','-f',base+'/docker-compose.yml','--env-file',base+'/.env','config','--format','json'],text=True))
expected=config['services']['functions'].get('environment',{})
changed=sorted(key for key in expected if key not in env or str(expected[key])!=env[key])
extra=sorted(key for key in env if key not in expected and env[key]!=defaults.get(key))
if changed or extra:
    raise SystemExit('Running functions env differs from saved Compose (values hidden). Keys: '+', '.join(changed+extra))
mounts=[mount.get('Source') for mount in live['Mounts'] if mount.get('Destination')=='/home/deno/functions']
if mounts!=[base+'/volumes/functions']:
    raise SystemExit('Functions bind mount changed')
print('Recorded server files and live functions configuration verified. No changes made.')
