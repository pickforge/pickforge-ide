#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mode="${PICKFORGE_DESKTOP_BUILD_MODE:-debug}"
case "$mode" in
  debug) config="Debug" ;;
  profile) config="Profile" ;;
  release) config="Release" ;;
  *)
    echo "Unsupported PICKFORGE_DESKTOP_BUILD_MODE: $mode" >&2
    exit 1
    ;;
esac

host="$(uname -s)"
case "$host" in
  Darwin)
    target="macos"
    app_path="$ROOT/build/macos/Build/Products/$config/pickforge.app/Contents/MacOS/pickforge"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    target="windows"
    app_path="$ROOT/build/windows/x64/runner/$config/pickforge.exe"
    ;;
  Linux)
    echo "Use scripts/linux_smoke.sh for Linux desktop launch coverage."
    exit 0
    ;;
  *)
    echo "Unsupported desktop launch host: $host" >&2
    exit 1
    ;;
esac

if [[ ! -x "$app_path" ]]; then
  echo "Built desktop executable not found: $app_path" >&2
  echo "Run scripts/desktop_build_smoke.sh first." >&2
  exit 1
fi

out_dir="${PICKFORGE_DESKTOP_LAUNCH_SMOKE_OUT_DIR:-build/smoke/desktop-launch/$target}"
startup_seconds="${PICKFORGE_DESKTOP_LAUNCH_SMOKE_SECONDS:-10}"
mkdir -p "$out_dir"

log_path="$out_dir/app.log"
home_dir="$out_dir/home"
rm -f "$log_path"
rm -rf "$home_dir"
mkdir -p "$home_dir"

app_pid=""
cleanup() {
  if [[ -z "$app_pid" ]]; then
    return
  fi
  if ! kill -0 "$app_pid" >/dev/null 2>&1; then
    return
  fi
  kill "$app_pid" >/dev/null 2>&1 || true
  sleep 2
  if kill -0 "$app_pid" >/dev/null 2>&1; then
    kill -9 "$app_pid" >/dev/null 2>&1 || true
  fi
  if [[ "$target" == "windows" ]] && command -v taskkill >/dev/null 2>&1; then
    taskkill //PID "$app_pid" //T //F >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

case "$target" in
  macos)
    HOME="$home_dir" \
      PICKFORGE_INHERITED_ENV_ONLY=1 \
      "$app_path" >"$log_path" 2>&1 &
    ;;
  windows)
    HOME="$home_dir" \
      USERPROFILE="$home_dir" \
      APPDATA="$home_dir/AppData/Roaming" \
      LOCALAPPDATA="$home_dir/AppData/Local" \
      PICKFORGE_INHERITED_ENV_ONLY=1 \
      "$app_path" >"$log_path" 2>&1 &
    ;;
esac
app_pid="$!"

deadline=$((SECONDS + startup_seconds))
while (( SECONDS < deadline )); do
  if ! kill -0 "$app_pid" >/dev/null 2>&1; then
    cat "$log_path" >&2 || true
    echo "Desktop app exited before the ${startup_seconds}s liveness window." >&2
    exit 1
  fi
  sleep 1
done

echo "Desktop launch smoke passed."
echo "Target: $target"
echo "Mode: $mode"
echo "Executable: $app_path"
echo "Log: $log_path"
