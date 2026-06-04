#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

case "$(uname -s)" in
  Linux)
    target="linux"
    ;;
  Darwin)
    target="macos"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    target="windows"
    ;;
  *)
    echo "Unsupported desktop build host: $(uname -s)" >&2
    exit 1
    ;;
esac

mode="${PICKFORGE_DESKTOP_BUILD_MODE:-debug}"

case "$mode" in
  debug|profile|release)
    ;;
  *)
    echo "Unsupported PICKFORGE_DESKTOP_BUILD_MODE: $mode" >&2
    exit 1
    ;;
esac

fvm flutter build "$target" "--$mode"

echo "Desktop build smoke passed."
echo "Target: $target"
echo "Mode: $mode"
