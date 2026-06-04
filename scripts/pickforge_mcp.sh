#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
binary="${PICKFORGE_MCP_BINARY:-$ROOT/build/mcp/pickforge_mcp}"
needs_rebuild=0

if [[ ! -x "$binary" || "${PICKFORGE_MCP_REBUILD:-0}" == "1" ]]; then
  needs_rebuild=1
elif [[ -n "$(find "$ROOT/tool/pickforge_mcp.dart" "$ROOT/lib/core/mcp" "$ROOT/lib/core/emulator/emulator_ipc_server.dart" "$ROOT/pubspec.lock" -newer "$binary" -print -quit)" ]]; then
  needs_rebuild=1
fi

if [[ "$needs_rebuild" == "1" ]]; then
  mkdir -p "$(dirname "$binary")"
  (cd "$ROOT" && fvm dart compile exe "$ROOT/tool/pickforge_mcp.dart" -o "$binary") >&2
fi

exec "$binary" "$@"
