#!/bin/sh
set -eu

stage="repository setup"
trap 'status=$?; if [ "$status" -ne 0 ]; then printf "\nVI-HEM preparation failed at: %s (exit %s). Read this script log before the later Swift package errors.\n" "$stage" "$status" >&2; fi' 0

cd "$CI_PRIMARY_REPOSITORY_PATH"

echo "=== VI-HEM Xcode Cloud: preparing web + Capacitor ==="

stage="Node.js installation"
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$NODE_MAJOR" -ge 22 ]; then
    NODE_OK=1
  fi
fi

if [ "$NODE_OK" -ne 1 ]; then
  brew install node@22
  export PATH="$(brew --prefix node@22)/bin:$PATH"
fi

echo "Node: $(node --version)"
echo "npm: $(npm --version)"

stage="npm dependency installation"
# The web build requires Vite and TypeScript even if the workflow sets NODE_ENV=production.
npm ci --include=dev --no-audit --no-fund

stage="native package verification"
node --input-type=module <<'JS'
import fs from 'node:fs';
for (const name of ['@capacitor/browser', '@capacitor/filesystem', '@capacitor/push-notifications', '@capacitor/share', '@capawesome/capacitor-badge']) {
  if (!fs.existsSync(`node_modules/${name}/Package.swift`)) {
    throw new Error(`Missing native package: ${name}. npm installation must finish before Xcode resolves Swift packages.`);
  }
}
JS

# This is the same production fallback used by src/lib/authUrls.ts.
VITE_PUBLIC_APP_URL="${VITE_PUBLIC_APP_URL:-https://app.vi-hem.se}"
export VITE_PUBLIC_APP_URL

# .env is git-ignored (developers keep VITE_SUPABASE_URL etc. locally), so a
# clean Xcode Cloud checkout has none. Without this check, `vite build`
# silently inlines `undefined` for every missing VITE_* var, the Xcode
# archive/upload still succeeds (Xcode never looks inside the JS bundle),
# and the app freezes forever on the static loading screen in index.html
# the first time supabase-js throws during module load -- see
# src/lib/supabase.ts. Set these under the Xcode Cloud workflow's
# Environment Variables in App Store Connect, not here.
echo "=== Checking required VITE_* environment variables ==="
stage="production environment validation"
npm run release:check

stage="Vite web build"
npm run build
stage="Capacitor iOS sync"
npx cap sync ios

echo "=== VI-HEM Xcode Cloud preparation complete ==="
