#!/usr/bin/env bash
# Engångsinstallation av ekangensvandrarhem.se på servern (kräver root). Kör: sudo bash apps/ekangen/deploy/install.sh
# 1) webbrot  2) http-vhost  3) Let's Encrypt-certifikat  4) https-vhost  5) första publiceringen av sajten.
# Därefter publiceras sajten av deploy_multi_app.sh som övriga appar.
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN=ekangensvandrarhem.se
ROOT=/var/www/$DOMAIN/html
CONF=/etc/nginx/sites-available/$DOMAIN.conf

[[ $EUID -eq 0 ]] || { echo "Kör med sudo."; exit 1; }
mkdir -p "$ROOT"
[[ -f "$ROOT/index.html" ]] || echo '<!doctype html><title>Ekängens vandrarhem</title><p>Kommer snart.</p>' > "$ROOT/index.html"
chown -R www-data:www-data "/var/www/$DOMAIN"

cp nginx-http.conf "$CONF"
ln -sf "$CONF" /etc/nginx/sites-enabled/$DOMAIN.conf
nginx -t
systemctl reload nginx

DOMAINS=(-d "$DOMAIN")
if getent hosts "www.$DOMAIN" >/dev/null; then DOMAINS+=(-d "www.$DOMAIN"); else echo "OBS: www.$DOMAIN saknar DNS-post -- certifikatet utfärdas bara för $DOMAIN."; fi
MAIL_ARGS=(--register-unsafely-without-email)
[[ -n "${CERTBOT_EMAIL:-}" ]] && MAIL_ARGS=(-m "$CERTBOT_EMAIL")
certbot certonly --webroot -w "$ROOT" "${DOMAINS[@]}" --non-interactive --agree-tos --expand --keep-until-expiring "${MAIL_ARGS[@]}"

cp nginx-https.conf "$CONF"
nginx -t
systemctl reload nginx
echo "Klart: https://$DOMAIN ska nu svara. Publicera sajten med deploy_multi_app.sh (eller kör appens build och kopiera dist/ till $ROOT)."
