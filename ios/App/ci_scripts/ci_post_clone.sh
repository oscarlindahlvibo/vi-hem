#!/bin/sh
set -eu

cd "$CI_PRIMARY_REPOSITORY_PATH"

echo "=== VI-HEM Xcode Cloud: preparing web + Capacitor ==="

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

npm ci

# .env is git-ignored (developers keep VITE_SUPABASE_URL etc. locally), so a
# clean Xcode Cloud checkout has none. Without this check, `vite build`
# silently inlines `undefined` for every missing VITE_* var, the Xcode
# archive/upload still succeeds (Xcode never looks inside the JS bundle),
# and the app freezes forever on the static loading screen in index.html
# the first time supabase-js throws during module load -- see
# src/lib/supabase.ts. Set these under the Xcode Cloud workflow's
# Environment Variables in App Store Connect, not here.
echo "=== Checking required VITE_* environment variables ==="
npm run release:check

npm run build
npx cap sync ios

echo "=== VI-HEM Xcode Cloud preparation complete ==="
