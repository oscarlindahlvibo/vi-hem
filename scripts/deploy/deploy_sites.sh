#!/usr/bin/env bash
# Deploys the public sites without a password (uses the root-owned /usr/local/sbin/site-publish via scoped sudo).
#   ./deploy_sites.sh                 -> ekangen + grav + vibofast
#   ./deploy_sites.sh ekangen         -> only ekangensvandrarhem.se
#   ./deploy_sites.sh grav            -> only gavirserum.se
#   ./deploy_sites.sh vibofast        -> only vibofast.se
#   ./deploy_sites.sh vihem           -> only VI-HEM (runs ./deploy_vihem.sh)
#   ./deploy_sites.sh all             -> ekangen + grav + vibofast + VI-HEM
# Run as the normal user (vibo), not with sudo.
set -uo pipefail
REPO="${VI_HEM_REPO:-/home/vibo/vi-hem}"
ENV_FILE="${DEPLOY_ENV_FILE:-/home/vibo/barorder/.env}"
[[ $EUID -ne 0 ]] || { echo "Run as vibo, without sudo."; exit 1; }

targets=("$@")
[[ ${#targets[@]} -eq 0 ]] && targets=(ekangen grav vibofast)
[[ "${targets[0]}" == all ]] && targets=(ekangen grav vibofast vihem)
for t in "${targets[@]}"; do [[ "$t" =~ ^(ekangen|grav|vibofast|vihem)$ ]] || { echo "Unknown target: $t"; exit 2; }; done

log() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
needs_repo=false; for t in "${targets[@]}"; do [[ "$t" != vihem ]] && needs_repo=true; done

if $needs_repo; then
  cd "$REPO"
  [[ "$(git branch --show-current)" == main && -z "$(git status --porcelain)" ]] || { echo "VI-HEM repo must be clean on main."; exit 1; }
  log "git pull"; git pull --ff-only || exit 1
  if [[ -f "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a; fi
  : "${VITE_SUPABASE_URL:?VITE_SUPABASE_URL must be set (see $ENV_FILE)}"
  : "${VITE_SUPABASE_ANON_KEY:?VITE_SUPABASE_ANON_KEY must be set (see $ENV_FILE)}"
fi

failed=()
for site in "${targets[@]}"; do
  if [[ "$site" == vihem ]]; then
    log "VI-HEM"; /home/vibo/deploy_vihem.sh || failed+=("vihem"); continue
  fi
  log "$site: build"
  ( cd "$REPO" && npm --prefix "apps/$site" ci --no-audit --no-fund && npm --prefix "apps/$site" run build \
      && python3 /home/vibo/prepare_site_release.py "$site" "$REPO" ) \
    && { log "$site: publish"; sudo -n /usr/local/sbin/site-publish "$site"; } || failed+=("$site")
done

echo
if [[ ${#failed[@]} -gt 0 ]]; then echo "FAILED: ${failed[*]}"; exit 1; fi
echo "Done: ${targets[*]}"
