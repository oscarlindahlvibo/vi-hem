#!/bin/sh
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run installer once with sudo'; exit 1; }
SOURCE=/var/tmp/vihem-passwordless
# Copy the reviewed publisher into a root-controlled location; never sudo user-owned scripts afterward.
install -o root -g root -m 0755 "$SOURCE/vihem-publish" /usr/local/sbin/vihem-publish
RULE=$(mktemp /etc/sudoers.d/.vihem-publish.XXXXXX)
trap 'rm -f "$RULE"' EXIT
printf '%s\n' 'vibo ALL=(root) NOPASSWD: /usr/local/sbin/vihem-publish ""' > "$RULE"
chmod 0440 "$RULE"
chown root:root "$RULE"
/usr/sbin/visudo -cf "$RULE"
mv "$RULE" /etc/sudoers.d/vihem-publish
/usr/sbin/visudo -c
# Unprivileged build/prepare scripts remain owned by vibo.
install -o vibo -g vibo -m 0755 "$SOURCE/prepare-release.py" /home/vibo/prepare_vihem_release.py
install -o vibo -g vibo -m 0755 "$SOURCE/deploy_vihem.sh" /home/vibo/deploy_vihem.sh
/usr/bin/python3 -I - <<'PY2'
from pathlib import Path
import shutil
p=Path('/home/vibo/deploy_multi_app.sh')
s=p.read_text()
old='      run_root python3 "$SCRIPT_DIR/publish_vihem_frontend.py" "$VI_HEM_REPO/dist" "$VI_HEM_WEB_ROOT"'
new='      run python3 /home/vibo/prepare_vihem_release.py\n      run sudo -n /usr/local/sbin/vihem-publish'
if old in s:
 shutil.copy2(p,Path('/home/vibo/deploy_multi_app.sh.before-passwordless'))
 p.write_text(s.replace(old,new))
elif new not in s:raise SystemExit('Unexpected multi-deploy script: manual integration required')
PY2
echo 'Installed: run /home/vibo/deploy_vihem.sh without sudo. Only VI-HEM publication is passwordless.'
