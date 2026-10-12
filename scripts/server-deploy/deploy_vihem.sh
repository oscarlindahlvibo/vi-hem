#!/usr/bin/env bash
set -euo pipefail
cd /home/vibo/vi-hem
[[ $(git branch --show-current) == main && -z $(git status --porcelain) ]] || { echo 'VI-HEM must be clean on main'; exit 1; }
git pull --ff-only
set -a
source /home/vibo/barorder/.env
set +a
npm ci
env VITE_PUBLIC_APP_URL=https://app.vi-hem.se npm run mobile:build
python3 /home/vibo/prepare_vihem_release.py
sudo -n /usr/local/sbin/vihem-publish
