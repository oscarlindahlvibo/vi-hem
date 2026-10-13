#!/usr/bin/env bash
# Kopplar in Kompetensportalens hemligheter i edge-funktionernas miljö på servern. Kör som vanlig användare (inte sudo):
#   bash ~/vi-hem/apps/kompetensportalen/deploy/set-keys.sh --prepare     (skapar krypteringsnyckel för personnummer + kopplar in variablerna; inga Stripe-nycklar)
#   bash ~/vi-hem/apps/kompetensportalen/deploy/set-keys.sh               (frågar efter Stripe-nycklar med dold inmatning)
# Nycklarna hamnar bara i serverns .env (aldrig i koden eller hemsidan). Lämna ett fält tomt för att behålla befintligt värde.
# VIKTIGT: VIHEM_KP_SECRET_KEY krypterar personnummer. Byt den aldrig efter att koder/nycklar har sparats
# (gamla personnummer går inte att dekryptera med en ny nyckel). Ta backup av .env.
set -euo pipefail
COMPOSE_DIR="${SUPABASE_COMPOSE_DIR:-/home/vibo/atm-personal-supabase}"
ENV_FILE="$COMPOSE_DIR/.env"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
[[ -f "$ENV_FILE" && -f "$COMPOSE_FILE" ]] || { echo "Hittar inte $ENV_FILE / $COMPOSE_FILE"; exit 1; }
[[ $EUID -ne 0 ]] || { echo "Kör utan sudo (Docker körs för användaren vibo)."; exit 1; }

python3 - "$COMPOSE_FILE" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
if "STRIPE_KP_SECRET_KEY" in s:
    sys.exit(0)
anchor = re.search(r"^(\s+)BANKSIGN_PRODUCTION_COLLECT_URL:.*$", s, re.M)
if not anchor:
    sys.exit("Hittar inte platsen i docker-compose.yml att lägga till variablerna på.")
i = anchor.group(1)
add = "\n".join([
    f"{i}# Kompetensportalen (utbildning). Tomma tills de sätts med apps/kompetensportalen/deploy/set-keys.sh",
    f"{i}STRIPE_KP_SECRET_KEY: ${{STRIPE_KP_SECRET_KEY:-}}",
    f"{i}STRIPE_KP_WEBHOOK_SECRET: ${{STRIPE_KP_WEBHOOK_SECRET:-}}",
    f"{i}VIHEM_KP_SECRET_KEY: ${{VIHEM_KP_SECRET_KEY:-}}",
    f"{i}KP_SITE_URL: ${{KP_SITE_URL:-https://kompetensportalen.se}}",
])
open(p, "w").write(s[:anchor.end()] + "\n" + add + s[anchor.end():])
print("docker-compose.yml uppdaterad.")
PY

get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
setenv() {
  python3 - "$ENV_FILE" "$1" "$2" <<'PY'
import sys
p, k, v = sys.argv[1:4]
lines = open(p).read().split("\n"); out, done = [], False
for line in lines:
    if line.startswith(k + "="):
        if not done: out.append(f"{k}={v}"); done = True
    else: out.append(line)
if not done:
    while out and out[-1] == "": out.pop()
    out += [f"{k}={v}", ""]
open(p, "w").write("\n".join(out))
PY
}
cp "$ENV_FILE" "$ENV_FILE.bak-kp-$(date +%Y%m%d%H%M%S)"; chmod 600 "$ENV_FILE".bak-kp-* 2>/dev/null || true
[[ -n "$(get VIHEM_KP_SECRET_KEY)" ]] || { setenv VIHEM_KP_SECRET_KEY "$(openssl rand -hex 32)"; echo "Krypteringsnyckel för personnummer skapad."; }
[[ -n "$(get KP_SITE_URL)" ]] || setenv KP_SITE_URL "https://kompetensportalen.se"

if [[ "${1:-}" != "--prepare" ]]; then
  read -rsp "Stripe hemlig nyckel för Kompetensportalen (WPE Sweden AB) (sk_live_… / sk_test_… / rk_…) [tomt = behåll]: " SK; echo
  read -rsp "Stripe webhook-hemlighet (whsec_…) [tomt = behåll]: " WH; echo
  if [[ -n "$SK" ]]; then [[ "$SK" =~ ^(sk|rk)_(live|test)_[A-Za-z0-9]+$ ]] || { echo "Ser inte ut som en Stripe-nyckel."; exit 1; }; setenv STRIPE_KP_SECRET_KEY "$SK"; fi
  if [[ -n "$WH" ]]; then [[ "$WH" =~ ^whsec_[A-Za-z0-9]+$ ]] || { echo "Webhook-hemligheten ska börja med whsec_."; exit 1; }; setenv STRIPE_KP_WEBHOOK_SECRET "$WH"; fi
fi
chmod 600 "$ENV_FILE" || true
echo "Startar om funktionerna…"
(cd "$COMPOSE_DIR" && docker compose up -d functions >/dev/null)
sleep 6
KEY="$(get STRIPE_KP_SECRET_KEY)"
if [[ -n "$KEY" ]]; then
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $KEY" https://api.stripe.com/v1/balance || true)
  mode=$([[ "$KEY" == *_live_* ]] && echo "skarpt läge" || echo "testläge")
  [[ "$code" == "200" ]] && echo "Stripe-nyckeln fungerar ($mode)." || echo "OBS: Stripe svarade $code på nyckeln – kontrollera den."
else echo "Ingen Stripe-nyckel är satt ännu (kortbetalning är av tills den läggs in)."; fi
[[ -n "$(get STRIPE_KP_WEBHOOK_SECRET)" ]] && echo "Webhook-hemligheten är satt." || echo "Webhook-hemligheten saknas fortfarande."
echo "Klart."
