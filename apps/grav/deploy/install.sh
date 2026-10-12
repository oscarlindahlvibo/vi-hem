#!/usr/bin/env bash
# Engångsinstallation av gavirserum.se på servern (kräver root). Kör:  sudo bash apps/grav/deploy/install.sh
# 1) webbrot  2) http-vhost  3) Let's Encrypt-certifikat  4) https-vhost  5) uppdaterar den lösenordsfria publiceringshjälparen så att
# den också känner till gavirserum.se. Därefter publiceras sajten med  ~/deploy_sites.sh grav  (inget lösenord).
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN=gavirserum.se
ROOT=/var/www/$DOMAIN/html
CONF=/etc/nginx/sites-available/$DOMAIN.conf

[[ $EUID -eq 0 ]] || { echo "Kör med sudo."; exit 1; }
mkdir -p "$ROOT"
[[ -f "$ROOT/index.html" ]] || echo '<!doctype html><title>Gräv &amp; Allservice i Virserum AB</title><p>Kommer snart.</p>' > "$ROOT/index.html"
chown -R www-data:www-data "/var/www/$DOMAIN"

cp nginx-http.conf "$CONF"
ln -sf "$CONF" /etc/nginx/sites-enabled/$DOMAIN.conf
nginx -t
systemctl reload nginx

# www tas med i certifikatet bara om den pekar på den här servern (annars misslyckas Let's Encrypt-verifieringen).
SERVER_IP="$(curl -s -m 10 https://ifconfig.me || true)"
DOMAINS=(-d "$DOMAIN")
if [[ -n "$SERVER_IP" ]] && getent ahostsv4 "www.$DOMAIN" | awk '{print $1}' | grep -qx "$SERVER_IP"; then
  DOMAINS+=(-d "www.$DOMAIN")
else
  echo "OBS: www.$DOMAIN pekar inte på den här servern ($SERVER_IP) -- certifikatet utfärdas bara för $DOMAIN."
fi
MAIL_ARGS=(--register-unsafely-without-email)
[[ -n "${CERTBOT_EMAIL:-}" ]] && MAIL_ARGS=(-m "$CERTBOT_EMAIL")
certbot certonly --webroot -w "$ROOT" "${DOMAINS[@]}" --non-interactive --agree-tos --expand --keep-until-expiring "${MAIL_ARGS[@]}"

cp nginx-https.conf "$CONF"
nginx -t
systemctl reload nginx

echo "Uppdaterar publiceringshjälparen (site-publish) med gavirserum.se…"
bash ../../../scripts/deploy/install-site-publish.sh
echo "Klart: https://$DOMAIN svarar nu. Publicera sajten utan lösenord med:  ~/deploy_sites.sh grav"
