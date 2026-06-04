#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

all_tools=(fvm git adb emulator claude codex opencode agent gemini)
required_available=(fvm git adb emulator claude codex opencode)
cases=(claude codex opencode adb)

make_tool() {
  local dir="$1"
  local tool="$2"
  cat >"$dir/$tool" <<'SH'
#!/bin/sh
case "$(basename "$0")" in
  fvm)
    if [ "${1:-}" = "flutter" ] && [ "${2:-}" = "--version" ]; then
      echo "Flutter 3.41.7 channel stable"
      exit 0
    fi
    ;;
  adb)
    if [ "${1:-}" = "version" ]; then
      echo "Android Debug Bridge version 1.0.41"
      exit 0
    fi
    ;;
  emulator)
    if [ "${1:-}" = "-version" ]; then
      echo "Android emulator version 37.0.0"
      exit 0
    fi
    ;;
esac
echo "$(basename "$0") 0.0.0"
SH
  chmod +x "$dir/$tool"
}

run_case() {
  local missing="$1"
  local dir="$tmp_dir/$missing"
  mkdir -p "$dir"
  for tool in "${all_tools[@]}"; do
    if [[ "$tool" != "$missing" ]]; then
      make_tool "$dir" "$tool"
    fi
  done

  local args=(--path "$dir" --expect-missing "$missing")
  for tool in "${required_available[@]}"; do
    if [[ "$tool" != "$missing" ]]; then
      args+=(--expect-available "$tool")
    fi
  done
  fvm dart run tool/diagnostics_probe.dart "${args[@]}"
}

for missing in "${cases[@]}"; do
  echo "## Missing $missing"
  run_case "$missing"
done

echo "Missing-tool diagnostics smoke passed."
