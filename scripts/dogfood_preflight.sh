#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

out_dir="${PICKFORGE_DOGFOOD_OUT_DIR:-build/dogfood}"
mkdir -p "$out_dir"
report="$out_dir/preflight.txt"

{
  echo "# Pickforge Dogfood Preflight"
  echo
  echo "Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "Host: $(uname -a)"
  echo "Repo: $ROOT"
  echo
  echo "## Tool availability"
  for cmd in fvm git adb emulator claude codex opencode agent gemini; do
    if command -v "$cmd" >/dev/null 2>&1; then
      printf -- "- %s: available (%s)\\n" "$cmd" "$(command -v "$cmd")"
    else
      printf -- "- %s: missing\\n" "$cmd"
    fi
  done
  echo
  echo "## Versions"
  for cmd in claude codex opencode agent gemini; do
    if command -v "$cmd" >/dev/null 2>&1; then
      printf -- "### %s\\n" "$cmd"
      "$cmd" --version 2>&1 || true
      echo
    fi
  done
  if command -v adb >/dev/null 2>&1; then
    echo "### adb devices"
    adb devices -l || true
    echo
  fi
  echo "## Required manual evidence"
  echo "- Visible desktop project binding."
  echo "- Widget pick into inspector."
  echo "- Forge prompt visible in embedded terminal."
  echo "- .pickforge context files verified in the target project."
  echo "- Missing-binary and missing-adb behavior verified with controlled PATH."
} | tee "$report"

echo "Dogfood preflight report: $report"
