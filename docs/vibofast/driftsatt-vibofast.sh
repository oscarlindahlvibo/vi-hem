#!/usr/bin/env bash
# Manual scoped deployment. Never pulls repos, runs historical migrations or deploys other apps.
set -euo pipefail
mode="${1:---check}"
package="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
stack=/home/vibo/atm-personal-supabase
web_root=/var/www/app.vi-hem.se/html
# This host uses vibo's rootless Docker daemon. sudo otherwise selects root's
# default /var/run/docker.sock, which has no daemon. All Python helpers inherit this.
export DOCKER_HOST=unix:///run/user/1000/docker.sock
[[ -S /run/user/1000/docker.sock ]] || { echo 'Expected rootless Docker socket not found' >&2; exit 1; }
[[ "$mode" == --check || "$mode" == --install-backend || "$mode" == --publish-admin || "$mode" == --publish-site ]] || { echo 'Unknown mode' >&2; exit 2; }
for executable in docker python3 git rsync gzip; do command -v "$executable" >/dev/null; done
[[ -f "$package/install-vibofast.sql" && -f "$package/installation-digest.txt" && -f "$package/release.json" ]] || { echo 'Incomplete deployment package' >&2; exit 1; }
[[ -f "$package/admin/index.html" && -f "$package/website/index.html" ]] || { echo 'Missing compiled frontends' >&2; exit 1; }
[[ -f "$stack/.env" && -f "$stack/docker-compose.yml" ]] || { echo 'Expected Supabase stack not found' >&2; exit 1; }
# Validate every package file before any operation (excluding manifest itself).
python3 "$package/verify-package.py"
# Refuse to overwrite newer work from Claude or other collaborators.
expected_main="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["base_main_commit"])' "$package/release.json")"
git_command=(git)
if [[ "$EUID" -eq 0 ]]; then git_command=(runuser -u vibo -- git); fi
current_main="$("${git_command[@]}" -C /home/vibo/vi-hem ls-remote origin refs/heads/main | awk '{print $1}')"
[[ "$current_main" == "$expected_main" ]] || { echo 'GitHub main changed since this package was built. Rebuild the package before deployment.' >&2; exit 1; }
readonly_sql() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' supabase-db psql -X -At -v ON_ERROR_STOP=1 -U postgres -d postgres; }
organisation="$(printf '%s\n' "SELECT name FROM public.vihem_organisations WHERE id='38fe702d-e72c-49a2-9750-5e0b6934959b';" | readonly_sql)"
[[ "$organisation" == 'Vibogruppen AB' ]] || { echo 'Wrong database/organisation' >&2; exit 1; }
installation_present="$(printf '%s\n' "SELECT to_regclass('vihem_vibofast_private.installation') IS NOT NULL;" | readonly_sql)"
if [[ "$installation_present" == t ]]; then
  installed_digest="$(printf '%s\n' 'SELECT source_digest FROM vihem_vibofast_private.installation WHERE id;' | readonly_sql)"
  [[ "$installed_digest" == "$(cat "$package/installation-digest.txt")" ]] || { echo 'Different backend installation found' >&2; exit 1; }
  python3 "$package/check-server-state.py" --after-install
else
  python3 "$package/check-server-state.py"
fi
if [[ "$mode" == --check ]]; then
  echo 'Package integrity, current GitHub main, server paths and Vibo organisation verified. No changes made.'
  echo 'Run the three manual phases in order: --install-backend, --publish-admin, --publish-site.'
  exit 0
fi
[[ "$EUID" -eq 0 ]] || { echo 'Run installation/publication with sudo' >&2; exit 1; }
if [[ "$mode" == --install-backend ]]; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  backup="/var/backups/vibofast/backend-$stamp"
  install -d -m 700 "$backup"
  (umask 077; docker exec supabase-db pg_dump -U postgres -d postgres --no-owner | gzip > "$backup/postgres.sql.gz")
  [[ -s "$backup/postgres.sql.gz" ]] || { echo 'Database backup failed' >&2; exit 1; }
  cp -p -- "$stack/.env" "$backup/supabase.env"
  cp -p -- "$stack/docker-compose.yml" "$backup/docker-compose.yml"
  destination="$stack/volumes/functions/vihem-vibofast-enquiry"
  if [[ -d "$destination" ]]; then cp -a -- "$destination" "$backup/previous-function"; fi
  present="$(printf '%s\n' "SELECT to_regclass('vihem_vibofast_private.installation') IS NOT NULL;" | readonly_sql)"
  digest="$(cat "$package/installation-digest.txt")"
  if [[ "$present" == t ]]; then
    installed="$(printf '%s\n' 'SELECT source_digest FROM vihem_vibofast_private.installation WHERE id;' | readonly_sql)"
    [[ "$installed" == "$digest" ]] || { echo 'A different Vibo installation exists; refusing to overwrite it' >&2; exit 1; }
    echo 'Matching backend SQL already installed; checking function configuration.'
  else
    docker exec -i supabase-db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$package/install-vibofast.sql"
  fi
  # Recreate ONLY functions. Keep other services and all other function directories intact.
  rollback_edge() {
    cp -p -- "$backup/supabase.env" "$stack/.env"
    cp -p -- "$backup/docker-compose.yml" "$stack/docker-compose.yml"
    rm -rf -- "$destination"
    if [[ -d "$backup/previous-function" ]]; then cp -a -- "$backup/previous-function" "$destination"; fi
    docker compose --project-directory "$stack" -p supabase -f "$stack/docker-compose.yml" --env-file "$stack/.env" up -d --no-deps functions
    echo 'Previous function configuration restored. Additive database extension remains installed.' >&2
  }
  trap 'rollback_edge' ERR
  python3 "$package/configure-edge.py"
  docker compose --project-directory "$stack" -p supabase -f "$stack/docker-compose.yml" --env-file "$stack/.env" config --quiet
  mkdir -p "$destination"
  cp -a -- "$package/function"/. "$destination"/
  docker compose --project-directory "$stack" -p supabase -f "$stack/docker-compose.yml" --env-file "$stack/.env" up -d --no-deps --force-recreate functions
  passed=false
  for attempt in 1 2 3 4 5 6; do
    if python3 "$package/check-backend.py"; then passed=true; break; fi
    sleep 5
  done
  [[ "$passed" == true ]]
  trap - ERR
  printf 'Backend installed. Backup: %s\n' "$backup"
  exit 0
fi
installed="$(printf '%s\n' 'SELECT source_digest FROM vihem_vibofast_private.installation WHERE id;' | readonly_sql)"
[[ "$installed" == "$(cat "$package/installation-digest.txt")" ]] || { echo 'Expected backend installation not found' >&2; exit 1; }
guarded="$(printf '%s\n' "SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_vihem_vibofast_guard_profile_authority' AND tgrelid='public.vihem_profiles'::regclass AND tgenabled IN ('O','A'));" | readonly_sql)"
[[ "$guarded" == t ]] || { echo 'Required profile authority guard is not enabled' >&2; exit 1; }
cmp -- "$package/function/index.ts" "$stack/volumes/functions/vihem-vibofast-enquiry/index.ts"
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' supabase-edge-functions | python3 -c 'import sys; e=dict(line.rstrip().split("=",1) for line in sys.stdin if "=" in line); assert len(e.get("VIBOFAST_RATE_LIMIT_SECRET",""))>=32, "Function rate-limit secret not configured"'
python3 "$package/check-backend.py"
if [[ "$mode" == --publish-admin ]]; then
  [[ -d "$web_root" && ! -L "$web_root" ]] || { echo 'Unexpected Vi-hem webroot; refusing to replace it' >&2; exit 1; }
  backup="/var/backups/vibofast/admin-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  install -d -m 700 "$backup"
  cp -a -- "$web_root" "$backup/html"
  rollback_admin() { rsync -a --delete "$backup/html/" "$web_root/"; }
  trap 'rollback_admin' ERR
  # Retain older hashed assets for open browser sessions; publish index last.
  rsync -a --exclude=index.html "$package/admin/" "$web_root/"
  cp -- "$package/admin/index.html" "$web_root/.index-vibofast.html"
  chown -R www-data:www-data "$web_root"
  mv -f -- "$web_root/.index-vibofast.html" "$web_root/index.html"
  trap - ERR
  printf 'Vi-hem admin published. Backup: %s\n' "$backup"
  exit 0
fi
VIBOFAST_BACKEND_VERIFIED=yes bash "$package/publicera-hemsida.sh" --apply "$package/website"
