#!/usr/bin/env bash
# Only publishes the Vite website. Does not migrate DB, deploy Vi-hem or restart Supabase.
set -euo pipefail
mode="${1:---check}"
build_dir="${2:-}"
if [[ "$mode" != --check && "$mode" != --apply ]] || [[ -z "$build_dir" ]]; then
  echo "Usage: sudo bash publicera-hemsida.sh --check|--apply /absolute/path/to/apps/vibofast/dist" >&2
  exit 2
fi
[[ "$build_dir" = /* && -f "$build_dir/index.html" && -d "$build_dir/assets" ]] || { echo "Missing Vite build" >&2; exit 1; }
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
candidate="$script_dir/vibofast.se.conf"
config="/etc/nginx/sites-enabled/vibofast.se.conf"
[[ -f "$candidate" && -f "$config" ]] || { echo "Missing Nginx configuration" >&2; exit 1; }
[[ -f /etc/letsencrypt/live/vibofast.se/fullchain.pem && -f /etc/letsencrypt/live/vibofast.se/privkey.pem ]] || { echo "Missing existing certificate" >&2; exit 1; }
# A deployment must be preceded by addon installation and an end-to-end check.
if [[ "$mode" == --check ]]; then
  echo "Build, configuration and certificate paths exist. No changes made."
  echo "Before --apply: install website DB addon and profile guard, deploy enquiry function and Vi-hem admin, verify gateway and website build."
  exit 0
fi
[[ "$EUID" -eq 0 ]] || { echo "Run --apply with sudo" >&2; exit 1; }
[[ "${VIBOFAST_BACKEND_VERIFIED:-}" = yes ]] || { echo "Set VIBOFAST_BACKEND_VERIFIED=yes only after the integration has passed its checks." >&2; exit 1; }
base=/var/www/vibofast.se
stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
release="$base/releases/$stamp"
backup="/var/backups/vibofast/$stamp"
mkdir -p "$backup" "$release"
chmod 700 "$backup"
cp -L -- "$config" "$backup/nginx.conf"
previous=""
if [[ -L "$base/current" ]]; then previous="$(readlink "$base/current")";
elif [[ -e "$base/current" ]]; then echo "Refusing to replace current: not a symlink" >&2; exit 1; fi
printf '%s\n' "$previous" > "$backup/previous-release"
cp -a -- "$build_dir"/. "$release"/
chown -R www-data:www-data "$release"
# html/ (old WordPress) is preserved in full. Only the current symlink and this host config change.
rollback() {
  cp -- "$backup/nginx.conf" "$config"
  if [[ -n "$previous" ]]; then
    ln -s -- "$previous" "$base/.current-rollback-$stamp"
    mv -Tf -- "$base/.current-rollback-$stamp" "$base/current"
  else
    rm -f -- "$base/current"
  fi
  nginx -t && systemctl reload nginx
}
trap 'rollback' ERR
ln -s -- "$release" "$base/.current-$stamp"
mv -Tf -- "$base/.current-$stamp" "$base/current"
cp -- "$candidate" "$config"
nginx -t
systemctl reload nginx
trap - ERR
printf 'Published %s\nBackup: %s\nOld WordPress: %s/html (preserved)\n' "$release" "$backup" "$base"
