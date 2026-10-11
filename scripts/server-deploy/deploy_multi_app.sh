#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: deploy_multi_app.sh [options]

Deploy barorder, vote, vi-hem, app.asedatruckmeet.se, kompetensportalen,
and asedatruckmeet against the same Supabase stack.

Options:
  --mark-existing     Record the current migration files as already applied
                      without executing them. Use this once when the database
                      is already in sync but no migration history exists yet.
  --dry-run           Print what would happen without changing anything.
  --skip-migrations   Skip database migrations.
  --skip-build        Skip npm install/build for the frontends.
  --skip-vihem        Leave VI-HEM frontend unchanged (backend is always separate).
  --skip-web-copy     Skip copying dist/ into the configured web roots.
  --no-restart        Skip docker compose up -d at the end.
  -h, --help          Show this help.

Environment variables:
  BARORDER_REPO         Path to barorder repo (default: /home/vibo/barorder)
  VOTE_REPO             Path to vote repo (default: /home/vibo/vote)
  VI_HEM_REPO           Path to vi-hem repo (default: /home/vibo/vi-hem)
  APP_ASEDATRUCKMEET_REPO Path to app.asedatruckmeet.se repo
                        (default: /home/vibo/app.asedatruckmeet.se)
  KOMPETENSPORTALEN_REPO Path to kompetensportalen repo
                        (default: /home/vibo/kompetensportalen)
  ASEDATRUCKMEET_REPO   Path to asedatruckmeet repo
                        (default: /home/vibo/asedatruckmeet)
  SUPABASE_COMPOSE_DIR  Path to the shared Supabase compose project
                        (default: /home/vibo/atm-personal-supabase)
  SUPABASE_DB_CONTAINER Docker container name for Postgres
                        (default: supabase-db)
  DEPLOY_ENV_FILE       Shared env file to source before building the apps
                        (default: $BARORDER_REPO/.env)
  BARORDER_WEB_ROOT     Web root for barorder dist/
  VOTE_WEB_ROOT         Web root for vote dist/
  VI_HEM_WEB_ROOT       Web root for vi-hem dist/
  APP_ASEDATRUCKMEET_WEB_ROOT Web root for app.asedatruckmeet.se dist/
  KOMPETENSPORTALEN_WEB_ROOT Web root for kompetensportalen dist/
  ASEDATRUCKMEET_WEB_ROOT Web root for asedatruckmeet dist/
  STATE_DIR             Directory used to persist applied migration tracking
                        (default: $SUPABASE_COMPOSE_DIR/volumes/deploy-state)
EOF
}

log() {
  printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"
}

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

run() {
  log "+ $*"
  if [[ "${DRY_RUN:-false}" == true ]]; then
    return 0
  fi
  "$@"
}

run_in_repo() {
  local repo="$1"
  shift
  log "+ (cd $repo && $*)"
  if [[ "${DRY_RUN:-false}" == true ]]; then
    return 0
  fi
  (cd "$repo" && "$@")
}

run_root() {
  if [[ "${DRY_RUN:-false}" == true ]]; then
    log "+ $*"
    return 0
  fi

  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

migration_applied() {
  local key="$1"
  [[ -f "$STATE_FILE" ]] || return 1
  awk -F'\t' -v key="$key" '$1 == key { found = 1 } END { exit(found ? 0 : 1) }' "$STATE_FILE"
}

record_migration() {
  local key="$1"
  local checksum="$2"
  [[ "${DRY_RUN:-false}" == true ]] && return 0
  mkdir -p "$STATE_DIR"
  printf '%s\t%s\n' "$key" "$checksum" >> "$STATE_FILE"
}

seed_state_from_supabase_history() {
  [[ "${DRY_RUN:-false}" == true ]] && return 0
  [[ -f "$STATE_FILE" ]] && return 0

  local has_history=0
  if ! docker exec -i "$SUPABASE_DB_CONTAINER" psql -U postgres -d postgres -tAc \
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations' LIMIT 1;" \
    | grep -q '^1$'; then
    return 0
  fi

  mapfile -t db_versions < <(
    docker exec -i "$SUPABASE_DB_CONTAINER" psql -U postgres -d postgres -tAc \
      "SELECT version::text FROM supabase_migrations.schema_migrations ORDER BY version;" \
      | sed '/^\s*$/d'
  )

  [[ ${#db_versions[@]} -gt 0 ]] || return 0

  mkdir -p "$STATE_DIR"
  : > "$STATE_FILE"

  for version in "${db_versions[@]}"; do
    while IFS= read -r file; do
      local base checksum key
      base="$(basename "$file")"
      if [[ "$base" == "$version"_* ]]; then
        checksum="$(sha256sum "$file" | awk '{print $1}')"
        key="$(repo_name_from_path "$(dirname "$file")")/$base"
        record_migration "$key" "$checksum"
      fi
    done < <(find "$BARORDER_REPO/supabase/migrations" "$VOTE_REPO/supabase/migrations" "$APP_ASEDATRUCKMEET_REPO/supabase/migrations" "$KOMPETENSPORTALEN_REPO/supabase/migrations" "$ASEDATRUCKMEET_REPO/supabase/migrations" -maxdepth 1 -type f -name '*.sql' 2>/dev/null | sort)
  done

  log "Seeded migration state from supabase_migrations.schema_migrations"
}

repo_name_from_path() {
  case "$1" in
    "$BARORDER_REPO"*) printf 'barorder' ;;
    "$VOTE_REPO"*) printf 'vote' ;;
    "$VI_HEM_REPO"*) printf 'vi-hem' ;;
    "$APP_ASEDATRUCKMEET_REPO"*) printf 'app.asedatruckmeet.se' ;;
    "$KOMPETENSPORTALEN_REPO"*) printf 'kompetensportalen' ;;
    "$ASEDATRUCKMEET_REPO"*) printf 'asedatruckmeet' ;;
    *) printf '%s' "$(basename "$1")" ;;
  esac
}

apply_migrations_for_repo() {
  local repo="$1"
  local repo_name="$2"
  local migrations_dir="$repo/supabase/migrations"

  [[ -d "$migrations_dir" ]] || return 0

  mapfile -t migration_files < <(find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' | sort)
  for file in "${migration_files[@]}"; do
    local base key checksum existing_checksum
    base="$(basename "$file")"
    key="$repo_name/$base"
    checksum="$(sha256sum "$file" | awk '{print $1}')"

    existing_checksum="$(awk -F'\t' -v key="$key" '$1 == key { print $2; exit }' "$STATE_FILE" 2>/dev/null || true)"
    if [[ -n "$existing_checksum" ]]; then
      if [[ "$existing_checksum" != "$checksum" ]]; then
        die "Recorded checksum for $key differs from the current file contents. Refusing to continue."
      fi
      log "Skipping already applied migration: $key"
      continue
    fi

    if [[ "$MARK_EXISTING" == true ]]; then
      record_migration "$key" "$checksum"
      log "Marked existing migration: $key"
      continue
    fi

    log "Applying migration: $key"
    if [[ "$DRY_RUN" == true ]]; then
      continue
    fi

    docker exec -i "$SUPABASE_DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$file"
    record_migration "$key" "$checksum"
  done
}

sync_edge_functions() {
  local src_dir dest_dir
  dest_dir="$SUPABASE_COMPOSE_DIR/volumes/functions"
  if [[ "$DRY_RUN" == false ]]; then
    mkdir -p "$dest_dir"
  fi

  for src_dir in "$BARORDER_REPO/supabase/functions" "$VOTE_REPO/supabase/functions" "$APP_ASEDATRUCKMEET_REPO/supabase/functions" "$KOMPETENSPORTALEN_REPO/supabase/functions" "$ASEDATRUCKMEET_REPO/supabase/functions"; do
    [[ -d "$src_dir" ]] || continue
    log "Syncing edge functions from $src_dir"
    if [[ "$DRY_RUN" == true ]]; then
      continue
    fi
    # Preserve the separately installed VI-HEM backend, including shared helpers.
    while IFS= read -r -d '' file; do
      local rel
      rel="${file#"$src_dir/"}"
      case "$rel" in
        vihem-*/*|_shared/agreement-tenancy.ts|_shared/chat-files.ts|_shared/fcm.ts|_shared/apns.ts|_shared/google-drive-auth.ts|_shared/inspection-drive.ts) continue ;;
      esac
      mkdir -p "$dest_dir/$(dirname "$rel")"
      cp -a "$file" "$dest_dir/$rel"
    done < <(find "$src_dir" -type f -print0)
  done
}

build_and_publish_app() {
  local app_name="$1"
  local repo="$2"
  local web_root="${3:-}"
  local build_command="${4:-build}"
  local output_dir="${5:-dist}"

  [[ -d "$repo" ]] || die "Missing repo: $repo"

  run_in_repo "$repo" git pull --ff-only
  prepare_build_output "$repo" "$output_dir"
  run_in_repo "$repo" npm install
  run_in_repo "$repo" npm run "$build_command"

  if [[ -n "$web_root" ]]; then
    log "Publishing $app_name $output_dir/ to $web_root"
    if [[ "$DRY_RUN" == true ]]; then
      return 0
    fi
    run_root rm -rf "$web_root"
    run_root mkdir -p "$web_root"
    run_root cp -a "$repo/$output_dir"/. "$web_root"/
    run_root chown -R www-data:www-data "$web_root"
  else
    log "No web root configured for $app_name; build completed only."
  fi
}

restart_supabase_stack() {
  log "Restarting shared Supabase stack in $SUPABASE_COMPOSE_DIR"
  if [[ "$DRY_RUN" == true ]]; then
    return 0
  fi
  (cd "$SUPABASE_COMPOSE_DIR" && docker compose up -d)
}

# Do not run npm/git as root and recreate root-owned build files.
if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
  die "Run this script as vibo, without sudo. It requests sudo only for file ownership/publication."
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

prepare_build_output() {
  local repo="$1" output="$2" target owner
  target="$repo/$output"
  [[ -d "$target" ]] || return 0
  [[ "$(realpath "$target")" == "$(realpath "$repo")/"* ]] || die "Build output escapes repository: $target"
  [[ -z "$(find "$target" -type l -print -quit)" ]] || die "Symlink in build output; review required: $target"
  owner="$(id -un):$(id -gn)"
  if [[ -n "$(find "$target" ! -user "$(id -un)" -print -quit)" ]]; then
    log "Repairing ownership only in build output: $target"
    run_root chown -R -P --no-dereference "$owner" "$target"
  fi
}

MARK_EXISTING=false
DRY_RUN=false
SKIP_MIGRATIONS=false
SKIP_BUILD=false
SKIP_VIHEM=false
SKIP_WEB_COPY=false
SKIP_RESTART=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mark-existing) MARK_EXISTING=true ;;
    --dry-run) DRY_RUN=true ;;
    --skip-migrations) SKIP_MIGRATIONS=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --skip-vihem) SKIP_VIHEM=true ;;
    --skip-web-copy) SKIP_WEB_COPY=true ;;
    --no-restart) SKIP_RESTART=true ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
 done

BARORDER_REPO="${BARORDER_REPO:-/home/vibo/barorder}"
VOTE_REPO="${VOTE_REPO:-/home/vibo/vote}"
VI_HEM_REPO="${VI_HEM_REPO:-/home/vibo/vi-hem}"
APP_ASEDATRUCKMEET_REPO="${APP_ASEDATRUCKMEET_REPO:-/home/vibo/app.asedatruckmeet.se}"
KOMPETENSPORTALEN_REPO="${KOMPETENSPORTALEN_REPO:-/home/vibo/kompetensportalen}"
ASEDATRUCKMEET_REPO="${ASEDATRUCKMEET_REPO:-/home/vibo/asedatruckmeet}"
VIBORENT_REPO="${VIBORENT_REPO:-/home/vibo/vi-hem}"
SUPABASE_COMPOSE_DIR="${SUPABASE_COMPOSE_DIR:-/home/vibo/atm-personal-supabase}"
SUPABASE_DB_CONTAINER="${SUPABASE_DB_CONTAINER:-supabase-db}"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$BARORDER_REPO/.env}"
BARORDER_WEB_ROOT="${BARORDER_WEB_ROOT:-/var/www/personal.asedatruckmeet.se/html}"
VOTE_WEB_ROOT="${VOTE_WEB_ROOT:-/var/www/vote.asedatruckmeet.se/html}"
VI_HEM_WEB_ROOT="${VI_HEM_WEB_ROOT:-/var/www/app.vi-hem.se/html}"
APP_ASEDATRUCKMEET_WEB_ROOT="${APP_ASEDATRUCKMEET_WEB_ROOT:-/var/www/app.asedatruckmeet.se/html}"
KOMPETENSPORTALEN_WEB_ROOT="${KOMPETENSPORTALEN_WEB_ROOT:-/var/www/kompetensportalen/html}"
ASEDATRUCKMEET_WEB_ROOT="${ASEDATRUCKMEET_WEB_ROOT:-/var/www/asedatruckmeet/html}"
VIBORENT_WEB_ROOT="${VIBORENT_WEB_ROOT:-/var/www/viborent.se/html}"
EKANGEN_REPO="${EKANGEN_REPO:-/home/vibo/vi-hem}"
EKANGEN_WEB_ROOT="${EKANGEN_WEB_ROOT:-/var/www/ekangensvandrarhem.se/html}"
STATE_DIR="${STATE_DIR:-$SUPABASE_COMPOSE_DIR/volumes/deploy-state}"
STATE_FILE="$STATE_DIR/applied-migrations.tsv"

[[ -d "$BARORDER_REPO" ]] || die "BARORDER_REPO not found: $BARORDER_REPO"
[[ -d "$VOTE_REPO" ]] || die "VOTE_REPO not found: $VOTE_REPO"
[[ -d "$VI_HEM_REPO" ]] || die "VI_HEM_REPO not found: $VI_HEM_REPO"
[[ -d "$APP_ASEDATRUCKMEET_REPO" ]] || die "APP_ASEDATRUCKMEET_REPO not found: $APP_ASEDATRUCKMEET_REPO"
[[ -d "$KOMPETENSPORTALEN_REPO" ]] || die "KOMPETENSPORTALEN_REPO not found: $KOMPETENSPORTALEN_REPO"
[[ -d "$ASEDATRUCKMEET_REPO" ]] || die "ASEDATRUCKMEET_REPO not found: $ASEDATRUCKMEET_REPO"
if [[ "$DRY_RUN" == false ]]; then
  [[ -d "$SUPABASE_COMPOSE_DIR" ]] || die "SUPABASE_COMPOSE_DIR not found: $SUPABASE_COMPOSE_DIR"
fi

if [[ -f "$DEPLOY_ENV_FILE" ]]; then
  log "Sourcing shared deploy env: $DEPLOY_ENV_FILE"
  # shellcheck disable=SC1090
  set -a
  source "$DEPLOY_ENV_FILE"
  set +a
else
  log "No DEPLOY_ENV_FILE found at $DEPLOY_ENV_FILE; using the current shell environment."
fi

: "${VITE_SUPABASE_URL:?VITE_SUPABASE_URL must be set before building the apps}"
: "${VITE_SUPABASE_ANON_KEY:?VITE_SUPABASE_ANON_KEY must be set before building the apps}"

# Validate VI-HEM before touching other deployments. Backend is not installed here.
if [[ "$SKIP_BUILD" == false && "$SKIP_VIHEM" == false ]]; then
  [[ -f "$SCRIPT_DIR/check_vihem_frontend.py" && -f "$SCRIPT_DIR/publish_vihem_frontend.py" ]] || die "Missing VI-HEM release helpers"
  if [[ "$DRY_RUN" == false ]]; then
    [[ -z "$(git -C "$VI_HEM_REPO" status --porcelain)" ]] || die "VI-HEM has local changes; refusing git pull"
    [[ "$(git -C "$VI_HEM_REPO" branch --show-current)" == main ]] || die "VI-HEM must be on main"
  fi
  run_in_repo "$VI_HEM_REPO" git pull --ff-only
  run python3 "$SCRIPT_DIR/check_vihem_frontend.py" "$VI_HEM_REPO" "$STATE_FILE" "$VI_HEM_WEB_ROOT" "$SUPABASE_COMPOSE_DIR/volumes/functions"
fi

if [[ "$SKIP_MIGRATIONS" == false ]]; then
  mkdir -p "$STATE_DIR"
  seed_state_from_supabase_history
  apply_migrations_for_repo "$BARORDER_REPO" "barorder"
  apply_migrations_for_repo "$VOTE_REPO" "vote"
  log "VI-HEM migrations use the separately verified backend release."
#  apply_migrations_for_repo "$APP_ASEDATRUCKMEET_REPO" "app.asedatruckmeet.se"
  apply_migrations_for_repo "$KOMPETENSPORTALEN_REPO" "kompetensportalen"
  apply_migrations_for_repo "$ASEDATRUCKMEET_REPO" "asedatruckmeet"
fi

sync_edge_functions

if [[ "$SKIP_BUILD" == false ]]; then
  if [[ "$SKIP_WEB_COPY" == true ]]; then
    BARORDER_WEB_ROOT=""
    VOTE_WEB_ROOT=""
    VI_HEM_WEB_ROOT=""
    APP_ASEDATRUCKMEET_WEB_ROOT=""
    KOMPETENSPORTALEN_WEB_ROOT=""
    ASEDATRUCKMEET_WEB_ROOT=""
    VIBORENT_WEB_ROOT=""
    EKANGEN_WEB_ROOT=""
  fi
  build_and_publish_app "barorder" "$BARORDER_REPO" "$BARORDER_WEB_ROOT"
  build_and_publish_app "vote" "$VOTE_REPO" "$VOTE_WEB_ROOT"
  if [[ "$SKIP_VIHEM" == false ]]; then
    prepare_build_output "$VI_HEM_REPO" dist
    run_in_repo "$VI_HEM_REPO" npm ci
    run_in_repo "$VI_HEM_REPO" env VITE_PUBLIC_APP_URL=https://app.vi-hem.se npm run mobile:build
    if [[ -n "$VI_HEM_WEB_ROOT" ]]; then
      run_root python3 "$SCRIPT_DIR/publish_vihem_frontend.py" "$VI_HEM_REPO/dist" "$VI_HEM_WEB_ROOT"
    fi
  fi
#  build_and_publish_app "app.asedatruckmeet.se" "$APP_ASEDATRUCKMEET_REPO" "$APP_ASEDATRUCKMEET_WEB_ROOT"
  build_and_publish_app "kompetensportalen" "$KOMPETENSPORTALEN_REPO" "$KOMPETENSPORTALEN_WEB_ROOT"
  build_and_publish_app "asedatruckmeet" "$ASEDATRUCKMEET_REPO" "$ASEDATRUCKMEET_WEB_ROOT"
  build_and_publish_app "viborent" "$VIBORENT_REPO" "$VIBORENT_WEB_ROOT" "viborent:build" "apps/viborent/dist"
  build_and_publish_app "ekangen" "$EKANGEN_REPO" "$EKANGEN_WEB_ROOT" "ekangen:build" "apps/ekangen/dist"
fi

if [[ "$SKIP_RESTART" == false ]]; then
  restart_supabase_stack
fi

log "Done."

