#!/usr/bin/env python3
"""Restore WebSocket forwarding only for the shared Supabase Realtime route.
Run --dry-run first. Requires root to install; never changes data or services.
"""
import argparse
import difflib
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

CONFIG = Path('/etc/nginx/sites-enabled/supabase.asedatruckmeet.se.conf')
EXPECTED_SHA = '34acc9c3855b92e22e38dc5ef6356d418ebb2c1e2fb9c8201d8fa592de901c95'
BLOCK = '  # Supabase Realtime requires the WebSocket upgrade headers.\n  location /realtime/v1/ {\n    proxy_http_version 1.1;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection $connection_upgrade;\n    proxy_set_header X-Forwarded-Host $http_host;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_pass http://localhost:8000;\n  }\n\n'

def patched(source):
    if BLOCK in source:
        return source
    if hashlib.sha256(source.encode()).hexdigest() != EXPECTED_SHA:
        raise RuntimeError('Config changed since review; inspect before applying.')
    anchor = '  # Redirect requests to odoo backend server\n'
    if source.count(anchor) != 1:
        raise RuntimeError('Expected proxy location not found uniquely.')
    return source.replace(anchor, BLOCK + anchor)


def atomic_write(path, content, stat):
    fd, name = tempfile.mkstemp(prefix='.vihem-websocket-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(name, stat.st_mode & 0o777)
        os.chown(name, stat.st_uid, stat.st_gid)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    target = CONFIG.resolve(strict=True)
    original = target.read_text()
    updated = patched(original)
    if original == updated:
        print('WebSocket proxy fix already installed.')
        return
    if args.dry_run:
        print(''.join(difflib.unified_diff(original.splitlines(True), updated.splitlines(True), fromfile=str(target), tofile=str(target))))
        return
    if os.geteuid() != 0:
        raise RuntimeError('Run with sudo; root is required for nginx configuration.')
    subprocess.run(['nginx', '-t'], check=True)
    backup = target.with_name(target.name + '.before-vihem-websocket-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    shutil.copy2(target, backup)
    stat = target.stat()
    try:
        atomic_write(target, updated, stat)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    except BaseException:
        atomic_write(target, original, stat)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
        raise
    print('Realtime route updated; backup: ' + str(backup))
    print('Other routes, Supabase containers and databases were not changed.')

if __name__ == '__main__':
    main()
