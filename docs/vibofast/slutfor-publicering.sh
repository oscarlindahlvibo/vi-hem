#!/usr/bin/env bash
# One sudo authentication for the two remaining frontend publication phases.
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Run this final publication step with sudo' >&2; exit 1; }
package="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
bash "$package/driftsatt-vibofast.sh" --publish-admin
bash "$package/driftsatt-vibofast.sh" --publish-site
printf '\nVi-hem administration and vibofast.se published.\n'
