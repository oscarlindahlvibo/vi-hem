#!/usr/bin/env bash
# Läsande export av eLearning-data ur Odoo till CSV (inget skrivs i Odoo). Kör på vibo-server med sudo (Odoos databas nås bara som användaren odoo):
#   sudo bash scripts/kp/odoo-export.sh
# Resultat: /home/vibo/odoo-export/*.csv (ägs av vibo). Innehåller personuppgifter – radera mappen när importen är klar.
set -euo pipefail
OUT=/home/vibo/odoo-export; mkdir -p "$OUT"
psql_odoo() { sudo -u odoo psql -X -A -t "$@"; }
DB=$(psql_odoo -d postgres -c "select datname from pg_database where not datistemplate" | while read -r d; do
  if psql_odoo -d "$d" -c "select to_regclass('slide_channel')" 2>/dev/null | grep -q slide_channel; then echo "$d"; fi; done | head -1)
[ -n "$DB" ] || { echo "Hittade ingen Odoo-databas med eLearning (slide_channel)."; exit 1; }
echo "Databas: $DB"
copy() { if sudo -u odoo psql -X -d "$DB" -c "\\copy ($2) to stdout with csv header" > "$OUT/$1.csv"; then echo "  $1: $(($(wc -l < "$OUT/$1.csv") - 1)) rader"; else echo "  $1: MISSLYCKADES (fortsätter)"; rm -f "$OUT/$1.csv"; fi; }
copy channels   "select id, name->>'sv_SE' as name_sv, name->>'en_US' as name_en, description, website_id, enroll, create_date from slide_channel"
copy slides     "select id, channel_id, category_id, sequence, name->>'sv_SE' as name_sv, name->>'en_US' as name_en, slide_category, url as video_url, html_content, completion_time, is_published, quiz_first_attempt_reward, quiz_second_attempt_reward, quiz_third_attempt_reward, quiz_fourth_attempt_reward, survey_id from slide_slide"
copy categories "select id, name->>'sv_SE' as name_sv, sequence, channel_id from slide_slide where is_category"
copy questions  "select q.id, q.survey_id, q.sequence, q.title->>'sv_SE' as title_sv, q.question_type, q.constr_mandatory, q.description->>'sv_SE' as description_sv from survey_question q"
copy answers    "select a.id, a.question_id, a.sequence, a.value->>'sv_SE' as value_sv, a.is_correct from survey_question_answer a"
copy members    "select cp.id, cp.channel_id, p.name, p.email, cp.completion, cp.completed, cp.create_date from slide_channel_partner cp join res_partner p on p.id = cp.partner_id"
copy slide_progress "select sp.id, sp.slide_id, p.email, sp.completed, sp.vote, sp.create_date from slide_slide_partner sp join res_partner p on p.id = sp.partner_id"
copy certificates "select ut.id, ut.survey_id, ut.email, ut.scoring_percentage, ut.scoring_success, ut.state, ut.create_date from survey_user_input ut where ut.survey_id is not null"
copy attachments "select id, name, res_model, res_id, mimetype, file_size, store_fname from ir_attachment where res_model in ('slide.slide','slide.channel') and res_id is not null"
chown -R vibo:vibo "$OUT"; chmod -R go-rwx "$OUT"
echo "Klart: $OUT (videofiler/bilagor ligger i Odoos filstore; sökväg per fil i attachments.csv – store_fname)."
