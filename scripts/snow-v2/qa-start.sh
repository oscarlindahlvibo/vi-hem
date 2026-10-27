#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
label=$(docker inspect -f '{{index .Config.Labels "vihem.task"}}' vihem-snow-v2-test)
[[ "$label" == snow-v2 ]] || { echo 'Disposable snow test database required.' >&2; exit 1; }
docker network inspect vihem-snow-v2-qa >/dev/null 2>&1 || docker network create --label vihem.task=snow-v2 vihem-snow-v2-qa >/dev/null
docker network connect vihem-snow-v2-qa vihem-snow-v2-test 2>/dev/null || true
if ! docker inspect vihem-snow-v2-rest >/dev/null 2>&1; then
 docker run -d --name vihem-snow-v2-rest --label vihem.task=snow-v2 --network vihem-snow-v2-qa -p 127.0.0.1:55450:3000 -e PGRST_DB_URI=postgres://postgres:snow-local-only@vihem-snow-v2-test:5432/postgres -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=snow-local-test-secret-at-least-32-characters -e PGRST_DB_PRE_REQUEST=public.vihem_snow_api_guard public.ecr.aws/supabase/postgrest:v14.12 >/dev/null
fi
exec npx vite --config scripts/snow-v2/qa/vite.config.ts
