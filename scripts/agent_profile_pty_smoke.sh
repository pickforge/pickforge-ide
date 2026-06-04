#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Agent profile PTY smoke currently requires Linux." >&2
  exit 1
fi

for required in fvm; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "Missing required command: $required" >&2
    exit 1
  fi
done

lib_dir="$ROOT/build/linux/x64/debug/bundle/lib"
if [[ ! -f "$lib_dir/libflutter_pty.so" ]]; then
  fvm flutter build linux --debug
fi

out_dir="build/dogfood/agent-profile-pty"
keep_project=0
flutter_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out-dir)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --out-dir" >&2
        exit 64
      fi
      out_dir="$2"
      shift 2
      ;;
    --keep-project)
      keep_project=1
      shift
      ;;
    *)
      flutter_args+=("$1")
      shift
      ;;
  esac
done

export PICKFORGE_AGENT_PTY_SMOKE_OUT_DIR="$out_dir"
export PICKFORGE_AGENT_PTY_SMOKE_KEEP_PROJECT="$keep_project"
export PICKFORGE_AGENT_PTY_SMOKE=1
export LD_LIBRARY_PATH="$lib_dir${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fvm flutter test test/integration/agent_profile_pty_smoke_test.dart \
  --reporter=compact \
  "${flutter_args[@]}"
