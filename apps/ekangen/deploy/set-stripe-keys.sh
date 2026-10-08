#!/usr/bin/env bash
# Lägger in Stripe-nycklarna för Ekängens direktbokning på servern. Kör som vanlig användare (inte sudo):
#   bash ~/vi-hem/apps/ekangen/deploy/set-stripe-keys.sh
# Nycklarna skrivs med dold inmatning, hamnar bara i serverns .env (aldrig i koden eller hemsidan) och funktionerna startas om.
# Lämna ett fält tomt för att behålla det värde som redan finns.
set -euo pipefail
COMPOSE_DIR="${SUPABASE_COMPOSE_DIR:-/home/vibo/atm-personal-supabase}"
ENV_FILE="$COMPOSE_DIR/.env"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
[[ -f "$ENV_FILE" && -f "$COMPOSE_FILE" ]] || { echo "Hittar inte $ENV_FILE / $COMPOSE_FILE"; exit 1; }
[[ $EUID -ne 0 ]] || { echo "Kör utan sudo (Docker körs för användaren vibo)."; exit 1; }

# 1) Se till att funktionscontainern får variablerna (idempotent).
python3 - "$COMPOSE_FILE" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
if "STRIPE_EKANGEN_SECRET_KEY" in s:
    sys.exit(0)
anchor = re.search(r"^(\s+)BANKSIGN_PRODUCTION_COLLECT_URL:.*$", s, re.M)
if not anchor:
    sys.exit("Hittar inte platsen i docker-compose.yml att lägga till variablerna på.")
indent = anchor.group(1)
add = "\n".join([
    f"{indent}# Ekängens direktbokning (Stripe). Tomma tills nycklarna är satta med apps/ekangen/deploy/set-stripe-keys.sh",
    f"{indent}STRIPE_EKANGEN_SECRET_KEY: ${{STRIPE_EKANGEN_SECRET_KEY:-}}",
    f"{indent}STRIPE_EKANGEN_WEBHOOK_SECRET: ${{STRIPE_EKANGEN_WEBHOOK_SECRET:-}}",
    f"{indent}EKANGEN_SITE_URL: ${{EKANGEN_SITE_URL:-https://ekangensvandrarhem.se}}",
])
s = s[:anchor.end()] + "\n" + add + s[anchor.end():]
open(p, "w").write(s)
print("docker-compose.yml uppdaterad.")
PY

# --prepare: bara koppla in variablerna i containern (utan nycklar) och starta om funktionerna.
if [[ "${1:-}" == "--prepare" ]]; then
  grep -q "^EKANGEN_SITE_URL=" "$ENV_FILE" || printf 'EKANGEN_SITE_URL=https://ekangensvandrarhem.se\n' >> "$ENV_FILE"
  (cd "$COMPOSE_DIR" && docker compose up -d functions >/dev/null)
  echo "Förberett: funktionerna kan nu läsa Stripe-nycklar när de läggs in."
  exit 0
fi

get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
setenv() { # key value
  python3 - "$ENV_FILE" "$1" "$2" <<'PY'
import sys
p, k, v = sys.argv[1:4]
lines = open(p).read().split("\n")
out, done = [], False
for line in lines:
    if line.startswith(k + "="):
        if not done: out.append(f"{k}={v}"); done = True
    else:
        out.append(line)
if not done:
    while out and out[-1] == "": out.pop()
    out += [f"{k}={v}", ""]
open(p, "w").write("\n".join(out))
PY
}

cp "$ENV_FILE" "$ENV_FILE.bak-stripe-$(date +%Y%m%d%H%M%S)"; chmod 600 "$ENV_FILE".bak-stripe-* 2>/dev/null || true

read -rsp "Stripe hemlig nyckel (sk_live_… / sk_test_… / rk_…) [tomt = behåll]: " SK; echo
read -rsp "Stripe webhook-hemlighet (whsec_…) [tomt = behåll]: " WH; echo
if [[ -n "$SK" ]]; then
  [[ "$SK" =~ ^(sk|rk)_(live|test)_[A-Za-z0-9]+$ ]] || { echo "Nyckeln ser inte ut som en Stripe-nyckel (ska börja med sk_live_, sk_test_ eller rk_)."; exit 1; }
  setenv STRIPE_EKANGEN_SECRET_KEY "$SK"
fi
if [[ -n "$WH" ]]; then
  [[ "$WH" =~ ^whsec_[A-Za-z0-9]+$ ]] || { echo "Webhook-hemligheten ska börja med whsec_."; exit 1; }
  setenv STRIPE_EKANGEN_WEBHOOK_SECRET "$WH"
fi
grep -q "^EKANGEN_SITE_URL=" "$ENV_FILE" || setenv EKANGEN_SITE_URL "https://ekangensvandrarhem.se"
chmod 600 "$ENV_FILE" || true

echo "Startar om funktionerna…"
(cd "$COMPOSE_DIR" && docker compose up -d functions >/dev/null)
sleep 6

KEY="$(get STRIPE_EKANGEN_SECRET_KEY)"
if [[ -n "$KEY" ]]; then
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $KEY" https://api.stripe.com/v1/balance || true)
  mode=$([[ "$KEY" == *_live_* ]] && echo "skarpt läge" || echo "testläge")
  [[ "$code" == "200" ]] && echo "Stripe-nyckeln fungerar ($mode)." || echo "OBS: Stripe svarade $code på nyckeln – kontrollera den."
else
  echo "Ingen Stripe-nyckel är satt ännu."
fi
[[ -n "$(get STRIPE_EKANGEN_WEBHOOK_SECRET)" ]] && echo "Webhook-hemligheten är satt." || echo "Webhook-hemligheten saknas fortfarande."
echo "Klart. Kontrollera i VI-HEM → Ekängens hemsida → Inställningar → Betalning."
