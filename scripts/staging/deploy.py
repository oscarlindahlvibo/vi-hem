"""Deploy only the named, loopback-only isolated QA frontend and safe Edge router."""
import pathlib, subprocess
root = '/var/tmp/vihem-chat-qa-20261008'
def run(args, **kw):
    r = subprocess.run(args, capture_output=True, text=True, **kw)
    if r.returncode: raise SystemExit(r.stderr[:1000])
    return r
if not pathlib.Path('dist-staging/staging-version.json').exists(): raise SystemExit('Build isolated staging first')
run(['ssh','vibo-server','mkdir -p '+root+'/frontend'])
run(['scp','-rq','dist-staging/.','vibo-server:'+root+'/frontend/'])
run(['scp','scripts/staging/nginx.conf','vibo-server:'+root+'/frontend-nginx.conf'])
run(['scp','scripts/staging/edge-router.ts','vibo-server:'+root+'/functions/main/index.ts'])
for name in ['vihem-public-laundry','vihem-access-entries','vihem-inspection-archive','vihem-chat-upload','vihem-chat-to-workorder','vihem-profile-photo','vihem-rent-overview','vihem-agreements-admin','vihem-routines','_shared']:
    run(['scp','-rq','supabase/functions/'+name,'vibo-server:'+root+'/functions/'])
script = '''import json,os,pathlib,subprocess
os.environ['DOCKER_HOST']='unix:///run/user/1000/docker.sock'
root=pathlib.Path('/var/tmp/vihem-chat-qa-20261008');p=root/'compose.json';c=json.loads(p.read_text())
assert c['services']['gateway']['container_name']=='vihem-chat-qa-gateway'
assert c['services']['gateway']['ports']==['127.0.0.1:18880:8080']
c['services']['edge']['environment']['VIHEM_BETA_RESTRICT_EXTERNAL']='true'
c['services']['web']={'image':'nginx:1.29-alpine','container_name':'vihem-chat-qa-web','ports':['127.0.0.1:18881:8080'],'volumes':[str(root/'frontend')+':/usr/share/nginx/html:ro',str(root/'frontend-nginx.conf')+':/etc/nginx/nginx.conf:ro'],'networks':['qa']}
p.write_text(json.dumps(c));p.chmod(0o600)
for args in [['docker','compose','-f',str(p),'up','-d','web'],['docker','compose','-f',str(p),'up','-d','edge']]:
 r=subprocess.run(args,capture_output=True,text=True)
 if r.returncode:raise SystemExit('Isolated staging service failed')
print('QA web started at server loopback:18881; production containers/configuration unchanged.')
'''
print(run(['ssh','vibo-server','python3 -'],input=script).stdout)
