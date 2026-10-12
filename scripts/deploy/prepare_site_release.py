#!/usr/bin/python3
"""Packs apps/<site>/dist into a release tar for /usr/local/sbin/site-publish (runs as the normal user, no sudo).

usage: prepare_site_release.py <ekangen|vibofast|vibogruppen> [repo] [inbox_dir]
"""
import hashlib, io, json, os, pathlib, subprocess, sys, tarfile

site = sys.argv[1] if len(sys.argv) > 1 else ''
if site not in ('ekangen', 'vibofast', 'vibogruppen'): raise SystemExit('usage: prepare_site_release.py <ekangen|vibofast|vibogruppen> [repo] [inbox_dir]')
repo = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else '/home/vibo/vi-hem')
inbox = pathlib.Path(sys.argv[3] if len(sys.argv) > 3 else '/home/vibo/.local/share/site-deploy')
source = repo / 'apps' / site / 'dist'
git = lambda *a: subprocess.check_output(['git', '-C', str(repo), *a], text=True).strip()

if git('status', '--porcelain'): raise SystemExit('Repository has local changes; refusing to package.')
revision = git('rev-parse', 'HEAD')
if not (source / 'index.html').is_file(): raise SystemExit('No build found in ' + str(source))
if any(p.is_symlink() for p in source.rglob('*')): raise SystemExit('Symlink in build output.')

files = {}
for p in sorted(source.rglob('*')):
    if not p.is_file(): continue
    name = str(p.relative_to(source))
    if not all(c.isascii() and (c.isalnum() or c in '/._-') for c in name): raise SystemExit('Unsupported file name: ' + name)
    files[name] = p.read_bytes()
if 'deploy-manifest.json' in files: raise SystemExit('Reserved file name in build output.')

meta = json.dumps({'site': site, 'revision': revision, 'files': {n: hashlib.sha256(d).hexdigest() for n, d in files.items()}}).encode()
inbox.mkdir(parents=True, exist_ok=True, mode=0o700)
target = inbox / (site + '.tar')
with tarfile.open(str(target) + '.pending', 'w') as t:
    for name, data in {**files, 'deploy-manifest.json': meta}.items():
        info = tarfile.TarInfo(name); info.size = len(data); info.mode = 0o644; t.addfile(info, io.BytesIO(data))
os.replace(str(target) + '.pending', target)
print(f'{site}: release package prepared ({len(files)} files) at revision {revision[:10]}')
