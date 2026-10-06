#!/usr/bin/env bash
set -euo pipefail
mode="${1:---check}"
[[ "$mode" == --check || "$mode" == --apply ]] || { echo 'Use --check or --apply'; exit 1; }
package="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export DOCKER_HOST=unix:///run/user/1000/docker.sock
python3 "$package/check-interest-release.py"
if [[ "$mode" == --check ]]; then echo 'Interest inbox release verified; no files published.'; exit 0; fi
[[ "$EUID" == 0 ]] || { echo 'Publication requires sudo authentication.' >&2; exit 1; }
web_root=/var/www/app.vi-hem.se/html
[[ -d "$web_root" && ! -L "$web_root" ]] || exit 1
backup="/var/backups/vibofast/interests-$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 700 "$backup"
cp -a -- "$web_root" "$backup/html"
rollback() { rsync -a --delete "$backup/html/" "$web_root/"; echo 'Previous frontend restored.' >&2; }
trap rollback ERR
rsync -a --chown=www-data:www-data --exclude=index.html "$package/admin/" "$web_root/"
install -m 644 -o www-data -g www-data "$package/admin/index.html" "$web_root/.index-interests.html"
mv -f -- "$web_root/.index-interests.html" "$web_root/index.html"
python3 "$package/check-interest-release.py" --live
trap - ERR
printf 'Interest inbox published. Backup: %s\n' "$backup"
