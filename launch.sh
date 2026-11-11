#!/usr/bin/env bash
set -euo pipefail
ROOT="$(dirname "$(readlink -f "$0")")"
APP="$ROOT/out/Phantom Workspace-linux-x64/phantom-workspace"
if [[ -x "$APP" ]]; then
  exec "$APP" "$@"
fi
exec "$ROOT/node_modules/.bin/electron" "$ROOT" "$@"
