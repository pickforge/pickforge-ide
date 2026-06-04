#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Linux visible diagnostics smoke requires Linux." >&2
  exit 1
fi

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo "Linux visible diagnostics smoke requires a visible desktop session." >&2
  exit 1
fi

for required in fvm timeout setsid spectacle; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "Missing required command: $required" >&2
    exit 1
  fi
done

real_fvm="$(command -v fvm)"
out_dir="${PICKFORGE_VISIBLE_DIAGNOSTICS_OUT_DIR:-build/dogfood/visible-diagnostics}"
startup_timeout="${PICKFORGE_VISIBLE_DIAGNOSTICS_STARTUP_TIMEOUT:-180}"
run_timeout="${PICKFORGE_VISIBLE_DIAGNOSTICS_TIMEOUT:-300}"
mkdir -p "$out_dir"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

all_tools=(adb emulator claude codex opencode agent gemini)
make_tool() {
  local dir="$1"
  local tool="$2"
  local status="$3"
  cat >"$dir/$tool" <<'SH'
#!/bin/sh
if [ "${PICKFORGE_FAKE_TOOL_STATUS:-0}" != "0" ]; then
  echo "$(basename "$0") intentionally unavailable" >&2
  exit "$PICKFORGE_FAKE_TOOL_STATUS"
fi
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
  if [[ "$status" != "0" ]]; then
    sed -i "s/PICKFORGE_FAKE_TOOL_STATUS:-0/PICKFORGE_FAKE_TOOL_STATUS:-$status/" "$dir/$tool"
  fi
}

prepare_path_case() {
  local case_name="$1"
  local missing="${2:-}"
  local dir="$tmp_dir/$case_name"
  mkdir -p "$dir"
  for tool in "${all_tools[@]}"; do
    if [[ "$tool" == "$missing" ]]; then
      make_tool "$dir" "$tool" 127
    else
      make_tool "$dir" "$tool" 0
    fi
  done
  printf '%s' "$dir"
}

run_case() {
  local case_name="$1"
  local missing="${2:-}"
  local case_path
  case_path="$(prepare_path_case "$case_name" "$missing")"
  local case_dir="$out_dir/$case_name"
  mkdir -p "$case_dir"

  local log_path="$case_dir/flutter-run.log"
  local probe_path="$case_dir/inspector-root.json"
  local screenshot_path="$case_dir/screenshot.png"
  rm -f "$log_path" "$probe_path" "$screenshot_path"

  local app_pid=""
  cleanup() {
    if [[ -n "$app_pid" ]]; then
      kill -INT -- "-$app_pid" >/dev/null 2>&1 || \
        kill -INT "$app_pid" >/dev/null 2>&1 || true
      sleep 2
      kill -TERM -- "-$app_pid" >/dev/null 2>&1 || \
        kill -TERM "$app_pid" >/dev/null 2>&1 || true
      wait "$app_pid" >/dev/null 2>&1 || true
    fi
  }
  trap cleanup RETURN

  setsid timeout "${run_timeout}s" env \
    PATH="$case_path:$PATH" \
    PICKFORGE_INHERITED_ENV_ONLY=1 \
    "$real_fvm" flutter run -d linux \
      --dart-define=PICKFORGE_INITIAL_ROUTE=/onboarding \
      >"$log_path" 2>&1 &
  app_pid="$!"

  local ready=0
  local deadline=$((SECONDS + startup_timeout))
  while (( SECONDS < deadline )); do
    if grep -Eq "Flutter run key commands|A Dart VM Service" "$log_path"; then
      ready=1
      break
    fi
    if ! kill -0 "$app_pid" >/dev/null 2>&1; then
      cat "$log_path" >&2
      exit 1
    fi
    sleep 1
  done

  if [[ "$ready" != "1" ]]; then
    cat "$log_path" >&2
    echo "Timed out waiting for visible diagnostics smoke startup." >&2
    exit 1
  fi

  local vm_http_url
  vm_http_url="$(
    grep -Eo "http://127\\.0\\.0\\.1:[^ ]+/" "$log_path" | head -n 1 || true
  )"
  if [[ -z "$vm_http_url" ]]; then
    cat "$log_path" >&2
    echo "Could not find VM Service URL in Flutter run log." >&2
    exit 1
  fi
  local vm_ws_url="ws://${vm_http_url#http://}ws"

  local probe_args=(
    "$vm_ws_url"
    "$probe_path"
    --expect OnboardingView
    --expect _SetupChecksCard
    --expect _SetupCheckRow
    --expect "FutureBuilder<DiagnosticsSnapshot>"
  )
  if [[ -n "$missing" ]]; then
    probe_args+=(--expect IconButton)
  else
    probe_args+=(--reject IconButton)
  fi
  "$real_fvm" dart run tool/visible_diagnostics_probe.dart "${probe_args[@]}"

  spectacle --background --nonotify --fullscreen --output "$screenshot_path"
  if [[ ! -s "$screenshot_path" ]]; then
    echo "Visible diagnostics screenshot was not written: $screenshot_path" >&2
    exit 1
  fi

  cleanup
  trap - RETURN
}

run_case all-present
run_case missing-claude claude
run_case missing-codex codex
run_case missing-opencode opencode
run_case missing-agent agent
run_case missing-gemini gemini
run_case missing-adb adb

echo "Linux visible diagnostics smoke passed."
echo "Artifacts: $out_dir"
