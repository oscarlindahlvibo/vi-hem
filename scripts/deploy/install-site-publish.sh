#!/usr/bin/env bash
# One-time root install of the passwordless site publisher. Run once:  sudo bash scripts/deploy/install-site-publish.sh
# Re-run only when site-publish itself changes (the installed copy is root-owned and cannot be altered by repo changes).
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }
cd "$(dirname "$0")"
USER_NAME="${DEPLOY_USER:-vibo}"
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"

python3 -c "import ast; ast.parse(open('site-publish').read())"
install -o root -g root -m 0755 site-publish /usr/local/sbin/site-publish
install -o "$USER_NAME" -g "$USER_NAME" -m 0755 deploy_sites.sh "$HOME_DIR/deploy_sites.sh"
install -o "$USER_NAME" -g "$USER_NAME" -m 0755 prepare_site_release.py "$HOME_DIR/prepare_site_release.py"
install -d -m 0700 /var/backups/site-publish

tmp="$(mktemp)"
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/site-publish ekangen, /usr/local/sbin/site-publish grav, /usr/local/sbin/site-publish vibofast\n' "$USER_NAME" > "$tmp"
visudo -cf "$tmp"
install -o root -g root -m 0440 "$tmp" /etc/sudoers.d/site-publish
rm -f "$tmp"
echo "Installed. Deploy the sites with:  ~/deploy_sites.sh   (or ~/deploy_sites.sh ekangen | vibofast | all)"
