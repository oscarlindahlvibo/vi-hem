#!/usr/bin/env bash
# Kör ViboRent-migrationen + SQL-testerna mot databasen på vibo-server i en transaktion som ALLTID rullas tillbaka.
# Ingen data ändras. Användning: scripts/test_viborent_sql.sh [migrationsfil...]
set -euo pipefail
cd "$(dirname "$0")/.."
files=("$@")
[ ${#files[@]} -eq 0 ] && files=(supabase/migrations/20261017100000_viborent_2_core.sql)
{
  echo "begin;"
  for f in "${files[@]}"; do sed -E '/^(begin|commit);$/d' "$f"; done
  cat supabase/tests/viborent_core.test.sql
  echo "rollback;"
} | ssh vibo-server 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q'
