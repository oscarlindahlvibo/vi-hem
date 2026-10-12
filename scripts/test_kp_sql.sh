#!/usr/bin/env bash
# Kör Kompetensportalens migrationer + SQL-tester mot databasen på vibo-server i en transaktion som ALLTID rullas tillbaka.
set -euo pipefail
cd "$(dirname "$0")/.."
{
  echo "begin;"
  for f in supabase/migrations/20261020*_kp_*.sql; do sed -E '/^(begin|commit);$/d' "$f"; done
  cat supabase/tests/kompetensportalen.test.sql
  echo "rollback;"
} | ssh vibo-server 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q'
