#!/usr/bin/env bash
# Kör Kompetensportalens end-to-end-test på servern (riktig miljö). Skapar testdata (E2E-märkt), kör testet och städar ALLTID efteråt.
set -uo pipefail
cd "$(dirname "$0")/../.."
node scripts/kp/build-webhook-bundle.mjs /private/tmp/kp-webhook-bundle.mjs || exit 1
ssh vibo-server "mkdir -p ~/kp-e2e" && scp -q /private/tmp/kp-webhook-bundle.mjs scripts/kp/e2e.mjs vibo-server:kp-e2e/
trap 'echo "--- städar"; ssh vibo-server "docker exec -i supabase-db psql -U postgres -d postgres -q -At" < scripts/kp/e2e-cleanup.sql' EXIT
IDS=$(ssh vibo-server "docker exec -i supabase-db psql -U postgres -d postgres -q -At" < scripts/kp/e2e-setup.sql | tail -1)
[ -n "$IDS" ] || { echo "setup misslyckades"; exit 1; }
ssh vibo-server "ln -sfn ~/vi-hem/node_modules ~/kp-e2e/node_modules && cd ~/kp-e2e && set -a && source ~/atm-personal-supabase/.env && set +a && E2E_IDS='$IDS' SUPABASE_URL=https://supabase.asedatruckmeet.se ANON_KEY=\$ANON_KEY SERVICE_ROLE_KEY=\$SERVICE_ROLE_KEY node e2e.mjs"
