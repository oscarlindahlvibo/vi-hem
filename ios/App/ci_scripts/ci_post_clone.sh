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
npm run build
npx cap sync ios

echo "=== VI-HEM Xcode Cloud preparation complete ==="
