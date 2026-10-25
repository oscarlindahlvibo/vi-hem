#!/usr/bin/env bash
# Kör VI-HEM Mails migration + SQL-tester mot databasen på vibo-server i en transaktion som ALLTID rullas tillbaka (inget sparas).
# Migrationen som ännu inte finns i serverns ledger körs i transaktionen före testerna – ingen produktionsmigration tillämpas.
set -euo pipefail
cd "$(dirname "$0")/.."
LEDGER=$(ssh vibo-server 'cat /home/vibo/atm-personal-supabase/volumes/deploy-state/applied-migrations.tsv')
{
  echo "begin;"
  for f in supabase/migrations/20261101*_vihem_mail_*.sql; do
    if grep -q "vi-hem/$(basename "$f")" <<<"$LEDGER"; then continue; fi
    sed -E '/^(begin|commit);$/d' "$f"
  done
  cat supabase/tests/vihem_mail.test.sql
  echo "rollback;"
} | ssh vibo-server 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q'
