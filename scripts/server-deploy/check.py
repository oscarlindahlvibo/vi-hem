import importlib.machinery,importlib.util,tempfile,pathlib,tarfile,io,json,hashlib
loader=importlib.machinery.SourceFileLoader('publisher',str(pathlib.Path(__file__).parent/'vihem-publish'));spec=importlib.util.spec_from_loader(loader.name,loader);m=importlib.util.module_from_spec(spec);loader.exec_module(m)
base={'index.html':b'<html>QA</html>','beta-version.json':json.dumps({'restricted':True,'workingTreePending':False,'revision':'a'*40}).encode()}
def package(path,extra=None):
 files={**base,**(extra or {})};meta=json.dumps({'revision':'a'*40,'files':{n:hashlib.sha256(d).hexdigest() for n,d in files.items()}}).encode()
 with tarfile.open(path,'w') as t:
  for name,data in {**files,'deploy-manifest.json':meta}.items():
   v=tarfile.TarInfo(name);v.size=len(data);t.addfile(v,io.BytesIO(data))
with tempfile.TemporaryDirectory() as tmp:
 p=pathlib.Path(tmp)/'release.tar';package(p);assert len(m.read_package(p)[0])==2
 for name in ['../escape.js','/outside.js','assets/.hidden.js','execute.php','bad name.js']:
  package(p,{name:b'bad'})
  try:m.read_package(p)
  except ValueError:pass
  else:raise AssertionError(name)
 p.unlink();p.symlink_to('/etc/passwd')
 try:m.read_package(p)
 except OSError:pass
 else:raise AssertionError('Symlink accepted')
print('PASS valid snapshot; traversal, absolute paths, hidden files, executable suffixes, invalid names and symlink package rejected')
