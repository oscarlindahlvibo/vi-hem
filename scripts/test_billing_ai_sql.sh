#!/usr/bin/env bash
# Kör AI-tolkningsloggen/månadsunderlaget (20261022100000_vibogruppen_billing_ai.sql) mot en tillfällig lokal Supabase-
# Postgres med minimala förutsättningar. Rör ingen server eller produktionsdatabas.
set -Eeuo pipefail
IMAGE="${SUPABASE_PG_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.132}"
NAME="vihem-billing-sqltest-$$"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=pw "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done
sleep 5
run() { docker exec -i "$NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
run -o /dev/null < "$ROOT/supabase/tests/stubs/vibogruppen_billing_prereq.sql"
run -o /dev/null < "$ROOT/supabase/migrations/20261022100000_vibogruppen_billing_ai.sql"
run -o /dev/null < "$ROOT/supabase/migrations/20261022110000_vibogruppen_system_notices.sql"
run -o /dev/null < "$ROOT/supabase/migrations/20261022120000_vibogruppen_notice_surfaces.sql"
echo "== migration ok"
output="$(for t in vibogruppen_billing_ai vibogruppen_system_notices vibogruppen_notice_surfaces; do docker exec -i "$NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$ROOT/supabase/tests/$t.test.sql" 2>&1 || true; done)"
echo "$output" | grep -E "NOTICE:  PASS" | sed 's/.*NOTICE:  //' 
passed="$(grep -c 'NOTICE:  PASS' <<<"$output" || true)"
if grep -qE "ERROR|FAIL" <<<"$output"; then
  echo "== FEL:"; grep -E "ERROR|FAIL" <<<"$output"; exit 1
fi
echo "== $passed kontroller ok"
