#!/usr/bin/env bash
set -euo pipefail
mode="${1:---check}"
[[ "$mode" == --check || "$mode" == --apply ]] || exit 2
package="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
python3 - "$package" <<'PY'
from pathlib import Path
import hashlib,json,subprocess,sys
root=Path(sys.argv[1]);m=json.loads((root/'release.json').read_text())
for name,digest in m['files'].items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,'Package changed: '+name
head=subprocess.check_output(['git','ls-remote','https://github.com/oscarlindahlvibo/vi-hem.git','refs/heads/main'],text=True).split()[0]
assert head==m['main_commit'],'main changed; review first'
current=Path('/var/www/vibofast.se/current');assert current.is_symlink(),'Expected existing release symlink'
assert hashlib.sha256((current/'index.html').read_bytes()).hexdigest() in [m['previous_index'],m['files']['site/index.html']],'Live website changed; review first'
print('PASS: package, main and current website verified.')
PY
[[ "$mode" == --apply ]] || exit 0
[[ "$EUID" == 0 ]] || { echo 'Publication requires sudo authentication.' >&2; exit 1; }
base=/var/www/vibofast.se
stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
previous="$(readlink "$base/current")"
release="$base/releases/mobile-$stamp"
backup="/var/backups/vibofast/mobile-$stamp"
install -d -m 700 "$backup"
printf '%s\n' "$previous" > "$backup/previous-release"
install -d -m 755 "$release"
cp -a "$package/site/." "$release/"
chown -R www-data:www-data "$release"
rollback() { ln -s "$previous" "$base/.mobile-rollback-$stamp"; mv -Tf "$base/.mobile-rollback-$stamp" "$base/current"; echo 'Previous website restored.' >&2; }
trap rollback ERR
ln -s "$release" "$base/.mobile-current-$stamp"
mv -Tf "$base/.mobile-current-$stamp" "$base/current"
python3 - "$package" <<'PY'
from pathlib import Path
import hashlib,json,sys,urllib.request
root=Path(sys.argv[1]);m=json.loads((root/'release.json').read_text())
for name,digest in m['files'].items():
 if not name.startswith('site/') or not (name.endswith('.html') or '/assets/' in name):continue
 relative=name.removeprefix('site/')
 data=urllib.request.urlopen('https://vibofast.se/'+relative+'?mobile='+m['main_commit'],timeout=25).read()
 assert hashlib.sha256(data).hexdigest()==digest,'Published HTTP mismatch: '+relative
print('PASS: published HTML and website assets match the tested build.')
PY
trap - ERR
printf 'Mobile website published. Previous release recorded in %s\n' "$backup"
