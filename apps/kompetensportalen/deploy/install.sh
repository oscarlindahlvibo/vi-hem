#!/usr/bin/env bash
# Engångsinstallation för kompetensportalen.se (apex + www). Kräver root. Kör:  sudo bash apps/kompetensportalen/deploy/install.sh
# 1) webbrot  2) http-vhost  3) certifikat för kompetensportalen.se (+ www om den pekar hit)  4) https-vhost med www->apex-omdirigering och säkerhetsrubriker
# 5) uppdaterar den lösenordsfria publiceringshjälparen. Därefter publiceras sajten med  ~/deploy_sites.sh kompetensportalen  (inget lösenord).
# Den gamla vhosten sparas som backup och kan återställas med  cp <backup> /etc/nginx/sites-available/kompetensportalen.se.conf && nginx -s reload
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN=kompetensportalen.se
ROOT=/var/www/kompetensportalen/html
CONF=/etc/nginx/sites-available/$DOMAIN.conf
[[ $EUID -eq 0 ]] || { echo "Kör med sudo."; exit 1; }

mkdir -p "$ROOT"
[[ -f "$ROOT/index.html" ]] || echo '<!doctype html><title>Kompetensportalen</title><p>Kommer snart.</p>' > "$ROOT/index.html"
chown -R www-data:www-data /var/www/kompetensportalen

if [[ -f "$CONF" || -f /etc/nginx/sites-enabled/$DOMAIN.conf ]]; then
  BACKUP="/root/kompetensportalen.se.conf.backup-$(date +%Y%m%dT%H%M%S)"
  cp -L "/etc/nginx/sites-enabled/$DOMAIN.conf" "$BACKUP" 2>/dev/null || cp "$CONF" "$BACKUP"
  echo "Gammal vhost sparad: $BACKUP"
fi
# Under steg 1 behåller vi https-svarare för apex tills det nya certifikatet finns, så sajten aldrig går ner.
cp nginx-http.conf "$CONF"
if [[ -e /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]]; then
  # certifikat finns redan: lägg till 443-blocken direkt så att apex fortsätter fungera medan www läggs till
  cp nginx-https.conf "$CONF"
fi
ln -sf "$CONF" /etc/nginx/sites-enabled/$DOMAIN.conf
nginx -t
systemctl reload nginx

# www tas med i certifikatet bara om den pekar på serverns publika IP (kontrollerar mot publik DNS, inte lokala Pi-hole).
SERVER_IP="$(curl -s -m 10 https://ifconfig.me || true)"
WWW_IP="$(dig +short www.$DOMAIN @1.1.1.1 | tail -1 || true)"
DOMAINS=(-d "$DOMAIN")
if [[ -n "$SERVER_IP" && "$WWW_IP" == "$SERVER_IP" ]]; then DOMAINS+=(-d "www.$DOMAIN"); else echo "OBS: www.$DOMAIN pekar inte på $SERVER_IP (pekar på: ${WWW_IP:-ingenting}) -- certifikatet utfärdas bara för $DOMAIN."; fi
MAIL_ARGS=(--register-unsafely-without-email)
[[ -n "${CERTBOT_EMAIL:-}" ]] && MAIL_ARGS=(-m "$CERTBOT_EMAIL")
certbot certonly --webroot -w "$ROOT" "${DOMAINS[@]}" --non-interactive --agree-tos --expand --keep-until-expiring "${MAIL_ARGS[@]}"

cp nginx-https.conf "$CONF"
nginx -t
systemctl reload nginx

echo "Uppdaterar publiceringshjälparen (site-publish) med kompetensportalen.se…"
bash ../../../scripts/deploy/install-site-publish.sh
echo "Klart: https://$DOMAIN och https://www.$DOMAIN svarar. Publicera nya versioner utan lösenord med:  ~/deploy_sites.sh kompetensportalen"
