#!/usr/bin/env bash
# Kör Kompetensportalens migrationer + SQL-tester mot databasen på vibo-server i en transaktion som ALLTID rullas tillbaka.
set -euo pipefail
cd "$(dirname "$0")/.."
# Migrationer som redan finns i serverns ledger hoppas över (de är redan applicerade); nya körs i testtransaktionen före testerna.
LEDGER=$(ssh vibo-server 'cat /home/vibo/atm-personal-supabase/volumes/deploy-state/applied-migrations.tsv')
{
  echo "begin;"
  for f in supabase/migrations/20261020*_kp_*.sql; do
    if grep -q "vi-hem/$(basename "$f")" <<<"$LEDGER"; then continue; fi
    sed -E '/^(begin|commit);$/d' "$f"
  done
  cat supabase/tests/kompetensportalen.test.sql
  echo "rollback;"
} | ssh vibo-server 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q'
