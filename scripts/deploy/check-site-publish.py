import pathlib,importlib.machinery,importlib.util,tempfile,tarfile,hashlib,json,io
from unittest.mock import patch
p=pathlib.Path(__file__).parent/'site-publish';loader=importlib.machinery.SourceFileLoader('site_publisher',str(p));spec=importlib.util.spec_from_loader(loader.name,loader);m=importlib.util.module_from_spec(spec);loader.exec_module(m)
assert set(m.SITES)=={'ekangen','grav','vibofast','vibogruppen','viborent','kompetensportalen','vihem-site'}
assert m.SITES['vihem-site']['web']=='/var/www/vi-hem.se/html'
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d)/'site.tar';files={'index.html':b'<html>QA</html>','assets/site.js':b'// QA'}
 meta=json.dumps({'site':'vihem-site','revision':'a'*40,'files':{n:m.sha(v) for n,v in files.items()}}).encode()
 with tarfile.open(p,'w') as t:
  for name,data in {**files,'deploy-manifest.json':meta}.items():
   v=tarfile.TarInfo(name);v.size=len(data);t.addfile(v,io.BytesIO(data))
 assert m.read_package(p,'vihem-site')[0]==files
 try:m.read_package(p,'vibogruppen')
 except ValueError:pass
 else:raise AssertionError('Wrong site accepted')
 with patch.object(m,'fetch_local',side_effect=[(200,b'old'),(200,b'new')]),patch.object(m.time,'sleep'):
  m.verify_live('vi-hem.se',{'index.html':b'new'},'qa')
 with patch.object(m,'fetch_local',return_value=(200,b'old')),patch.object(m.time,'monotonic',side_effect=[0,46]):
  try:m.verify_live('vi-hem.se',{'index.html':b'new'},'qa')
  except ValueError:pass
  else:raise AssertionError('Mismatch accepted')
print('PASS new exact sales-site target, existing targets retained, wrong-package rejection, stale cache retry and persistent mismatch denial')
