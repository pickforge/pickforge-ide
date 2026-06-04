#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Linux installed visible smoke requires Linux." >&2
  exit 1
fi

for required in install readlink setsid timeout; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "Missing required command: $required" >&2
    exit 1
  fi
done

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo "A visible Linux desktop session is required." >&2
  exit 1
fi

app_path="/usr/bin/pickforge"
smoke_out_dir="${PICKFORGE_INSTALLED_VISIBLE_OUT_DIR:-build/dogfood/linux-installed-visible}"
startup_timeout="${PICKFORGE_INSTALLED_VISIBLE_STARTUP_TIMEOUT:-20}"
run_timeout="${PICKFORGE_INSTALLED_VISIBLE_TIMEOUT:-60}"
min_width="${PICKFORGE_INSTALLED_VISIBLE_MIN_WIDTH:-1600}"
min_height="${PICKFORGE_INSTALLED_VISIBLE_MIN_HEIGHT:-900}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --app" >&2
        exit 64
      fi
      app_path="$2"
      shift 2
      ;;
    --out-dir)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --out-dir" >&2
        exit 64
      fi
      smoke_out_dir="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: scripts/linux_installed_visible_smoke.sh [--app <path>] [--out-dir <path>]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

if [[ ! -x "$app_path" ]]; then
  echo "Installed Pickforge executable not found or not executable: $app_path" >&2
  echo "Install the Linux package first, or pass --app <path> for a dry run." >&2
  exit 1
fi

app_path="$(readlink -f "$app_path")"

mkdir -p "$smoke_out_dir"
log_path="$smoke_out_dir/app.log"
screenshot_path="$smoke_out_dir/desktop.png"
window_info_path="$smoke_out_dir/window-info.env"
env_path="$smoke_out_dir/environment.env"
home_dir="$smoke_out_dir/home"
rm -f "$log_path" "$screenshot_path" "$window_info_path" "$env_path"
rm -rf "$home_dir"
install -d "$home_dir/Documents" "$home_dir/.cache" "$home_dir/.config" "$home_dir/.local/share"

{
  echo "APP_PATH=$app_path"
  echo "DISPLAY=${DISPLAY:-}"
  echo "WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-}"
  echo "XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-}"
  echo "OUT_DIR=$smoke_out_dir"
  echo "HOME=$home_dir"
} >"$env_path"

capture_screenshot() {
  local output="$1"

  if command -v spectacle >/dev/null 2>&1; then
    spectacle -b -n -o "$output" >/dev/null 2>&1 && return 0
  fi

  if command -v grim >/dev/null 2>&1; then
    grim "$output" >/dev/null 2>&1 && return 0
  fi

  if command -v gnome-screenshot >/dev/null 2>&1; then
    gnome-screenshot -f "$output" >/dev/null 2>&1 && return 0
  fi

  if [[ -n "${DISPLAY:-}" ]] && command -v import >/dev/null 2>&1; then
    import -window root "$output" >/dev/null 2>&1 && return 0
  fi

  return 1
}

image_stddev() {
  local image="$1"

  if command -v magick >/dev/null 2>&1; then
    magick "$image" -colorspace Gray -format "%[fx:standard_deviation]" info:
    return
  fi

  if command -v convert >/dev/null 2>&1; then
    convert "$image" -colorspace Gray -format "%[fx:standard_deviation]" info:
    return
  fi

  echo ""
}

app_pid=""
cleanup() {
  if [[ -z "$app_pid" ]]; then
    return
  fi
  if ! kill -0 "$app_pid" >/dev/null 2>&1; then
    return
  fi
  kill -INT -- "-$app_pid" >/dev/null 2>&1 || kill -INT "$app_pid" >/dev/null 2>&1 || true
  sleep 1
  kill -TERM -- "-$app_pid" >/dev/null 2>&1 || kill -TERM "$app_pid" >/dev/null 2>&1 || true
  sleep 1
  kill -KILL -- "-$app_pid" >/dev/null 2>&1 || kill -KILL "$app_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

timeout "${run_timeout}s" bash -c '
  set -euo pipefail
  app_path="$1"
  home_dir="$2"
  log_path="$3"
  startup_timeout="$4"

  export HOME="$home_dir"
  export XDG_CACHE_HOME="$home_dir/.cache"
  export XDG_CONFIG_HOME="$home_dir/.config"
  export XDG_DATA_HOME="$home_dir/.local/share"
  export NO_AT_BRIDGE=1
  export PICKFORGE_INHERITED_ENV_ONLY=1

  setsid "$app_path" >"$log_path" 2>&1 &
  echo "$!" >"$home_dir/.pickforge-visible-smoke-pid"

  deadline=$((SECONDS + startup_timeout))
  while (( SECONDS < deadline )); do
    pid="$(cat "$home_dir/.pickforge-visible-smoke-pid")"
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      cat "$log_path" >&2
      echo "Installed Pickforge exited during startup." >&2
      exit 1
    fi
    sleep 1
  done
' bash "$app_path" "$home_dir" "$log_path" "$startup_timeout" &
runner_pid="$!"

deadline=$((SECONDS + startup_timeout + 5))
while (( SECONDS < deadline )); do
  if [[ -f "$home_dir/.pickforge-visible-smoke-pid" ]]; then
    app_pid="$(cat "$home_dir/.pickforge-visible-smoke-pid")"
    break
  fi
  if ! kill -0 "$runner_pid" >/dev/null 2>&1; then
    wait "$runner_pid"
  fi
  sleep 1
done

if [[ -z "$app_pid" ]]; then
  echo "Installed Pickforge did not start before the smoke timeout." >&2
  exit 1
fi

wait "$runner_pid"

if ! kill -0 "$app_pid" >/dev/null 2>&1; then
  cat "$log_path" >&2 || true
  echo "Installed Pickforge was not alive after the startup window." >&2
  exit 1
fi

if command -v xdotool >/dev/null 2>&1; then
  window_id="$(xdotool search --name Pickforge 2>/dev/null | head -n 1 || true)"
  if [[ -z "$window_id" ]]; then
    window_id="$(xdotool search --name pickforge 2>/dev/null | head -n 1 || true)"
  fi

  if [[ -n "$window_id" ]]; then
    xdotool getwindowgeometry --shell "$window_id" >"$window_info_path"
    # shellcheck disable=SC1090
    source "$window_info_path"
    if (( WIDTH < min_width || HEIGHT < min_height )); then
      cat "$window_info_path" >&2
      echo "Installed Pickforge window opened smaller than expected." >&2
      exit 1
    fi
  else
    {
      echo "WINDOW_FOUND=0"
      echo "NOTE=xdotool could not discover the Pickforge window"
    } >"$window_info_path"
  fi
else
  {
    echo "WINDOW_FOUND=0"
    echo "NOTE=xdotool is unavailable"
  } >"$window_info_path"
fi

if ! capture_screenshot "$screenshot_path"; then
  echo "Could not capture a visible desktop screenshot." >&2
  exit 1
fi

stddev="$(image_stddev "$screenshot_path")"
if [[ -n "$stddev" ]]; then
  if ! awk -v stddev="$stddev" "BEGIN { exit !(stddev > 0.001) }"; then
    echo "Visible desktop screenshot appears blank." >&2
    exit 1
  fi
fi

if grep -E \
  'MissingPlatformDirectoryException|Another exception was thrown|Unhandled [Ee]xception|Aborted|core dumped' \
  "$log_path" >&2; then
  echo "Installed Pickforge emitted startup exceptions." >&2
  exit 1
fi

echo "Linux installed visible smoke passed."
echo "App: $app_path"
echo "Log: $log_path"
echo "Window info: $window_info_path"
echo "Screenshot: $screenshot_path"
