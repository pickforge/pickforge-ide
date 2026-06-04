#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Linux .deb smoke requires Linux." >&2
  exit 1
fi

for required in ar awk fvm gzip install readlink setsid sha256sum tar timeout xvfb-run; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "Missing required command: $required" >&2
    exit 1
  fi
done

image_tool=""
if command -v magick >/dev/null 2>&1; then
  image_tool="magick"
elif command -v convert >/dev/null 2>&1; then
  image_tool="convert"
fi

deb_path=""
skip_build=0
smoke_out_dir="${PICKFORGE_DEB_SMOKE_OUT_DIR:-build/smoke/linux-deb}"
startup_timeout="${PICKFORGE_DEB_SMOKE_STARTUP_TIMEOUT:-20}"
run_timeout="${PICKFORGE_DEB_SMOKE_TIMEOUT:-90}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deb)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --deb" >&2
        exit 64
      fi
      deb_path="$2"
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
    --skip-build)
      skip_build=1
      shift
      ;;
    --help|-h)
      echo "Usage: scripts/linux_deb_smoke.sh [--skip-build] [--deb <path>] [--out-dir <path>]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

mkdir -p "$smoke_out_dir"

if [[ -z "$deb_path" ]]; then
  package_args=()
  if [[ "$skip_build" -eq 1 ]]; then
    package_args+=(--skip-build)
  fi
  scripts/package_linux_deb.sh "${package_args[@]}"

  version="${PICKFORGE_DEB_VERSION:-$(awk '/^version:/ {print $2; exit}' pubspec.yaml)}"
  arch="${PICKFORGE_DEB_ARCH:-amd64}"
  package_out_dir="${PICKFORGE_PACKAGE_OUT_DIR:-build/dist/linux}"
  deb_path="$package_out_dir/pickforge_${version}_${arch}.deb"
fi

if [[ ! -f "$deb_path" ]]; then
  echo "Linux .deb not found: $deb_path" >&2
  exit 1
fi

deb_path="$(readlink -f "$deb_path")"
deb_name="$(basename "$deb_path")"
deb_dir="$(dirname "$deb_path")"
checksum_path="$deb_path.sha256"

if [[ -f "$checksum_path" ]]; then
  sha256sum -c "$checksum_path"
else
  sha256sum "$deb_path" >"$smoke_out_dir/$deb_name.sha256"
fi

members="$(ar t "$deb_path")"
for member in debian-binary control.tar.gz data.tar.gz; do
  if ! grep -qx "$member" <<<"$members"; then
    echo "Missing .deb member: $member" >&2
    exit 1
  fi
done

if [[ "$(ar p "$deb_path" debian-binary | tr -d '\n')" != "2.0" ]]; then
  echo "Unexpected debian-binary marker." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

control_dir="$tmp_dir/control"
extract_dir="$tmp_dir/extract"
clean_home="$tmp_dir/home"
install -d "$control_dir" "$extract_dir" "$clean_home"

ar p "$deb_path" control.tar.gz | tar -xzf - -C "$control_dir"
ar p "$deb_path" data.tar.gz | tar -xzf - -C "$extract_dir"

cp "$control_dir/control" "$smoke_out_dir/control"

app_path="$extract_dir/opt/pickforge/pickforge"
if [[ ! -x "$app_path" ]]; then
  echo "Extracted app executable is missing or not executable: $app_path" >&2
  exit 1
fi

if [[ ! -L "$extract_dir/usr/bin/pickforge" ]]; then
  echo "Extracted /usr/bin/pickforge symlink is missing." >&2
  exit 1
fi

if [[ "$(readlink "$extract_dir/usr/bin/pickforge")" != "/opt/pickforge/pickforge" ]]; then
  echo "Extracted /usr/bin/pickforge symlink points to the wrong target." >&2
  exit 1
fi

for required_path in \
  "$extract_dir/opt/pickforge/data/flutter_assets" \
  "$extract_dir/opt/pickforge/lib/libflutter_linux_gtk.so" \
  "$extract_dir/usr/share/applications/pickforge.desktop" \
  "$extract_dir/usr/share/icons/hicolor/scalable/apps/pickforge.svg"; do
  if [[ ! -e "$required_path" ]]; then
    echo "Extracted package is missing: $required_path" >&2
    exit 1
  fi
done

if ! grep -qx "Package: pickforge" "$control_dir/control"; then
  echo "Package control file does not identify pickforge." >&2
  exit 1
fi

log_path="$smoke_out_dir/app.log"
screenshot_path="$smoke_out_dir/first-frame.png"
window_info_path="$smoke_out_dir/window-info.env"
rm -f "$log_path" "$screenshot_path" "$window_info_path"

timeout "${run_timeout}s" xvfb-run -a -s "-screen 0 1920x1200x24" \
  bash -c '
    set -euo pipefail
    app_path="$1"
    clean_home="$2"
    log_path="$3"
    screenshot_path="$4"
    window_info_path="$5"
    startup_timeout="$6"
    image_tool="$7"

    app_pid=""
    cleanup() {
      if [[ -n "$app_pid" ]]; then
        kill -INT -- "-$app_pid" >/dev/null 2>&1 || \
          kill -INT "$app_pid" >/dev/null 2>&1 || true
        sleep 1
        kill -TERM -- "-$app_pid" >/dev/null 2>&1 || \
          kill -TERM "$app_pid" >/dev/null 2>&1 || true
        wait "$app_pid" >/dev/null 2>&1 || true
      fi
    }
    trap cleanup EXIT

    export HOME="$clean_home"
    export XDG_CACHE_HOME="$clean_home/.cache"
    export XDG_CONFIG_HOME="$clean_home/.config"
    export XDG_DATA_HOME="$clean_home/.local/share"
    export NO_AT_BRIDGE=1
    mkdir -p "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME"

    setsid "$app_path" >"$log_path" 2>&1 &
    app_pid="$!"

    deadline=$((SECONDS + startup_timeout))
    while (( SECONDS < deadline )); do
      if ! kill -0 "$app_pid" >/dev/null 2>&1; then
        cat "$log_path" >&2
        echo "Extracted Pickforge app exited during first-run startup." >&2
        exit 1
      fi
      sleep 1
    done

    window_id=""
    if command -v xdotool >/dev/null 2>&1; then
      window_id="$(xdotool search --name Pickforge 2>/dev/null | head -n 1 || true)"
      if [[ -z "$window_id" ]]; then
        window_id="$(xdotool search --name pickforge 2>/dev/null | head -n 1 || true)"
      fi
    fi

    if [[ -n "$window_id" ]]; then
      xdotool getwindowgeometry --shell "$window_id" >"$window_info_path"
      # shellcheck disable=SC1090
      source "$window_info_path"
      if (( WIDTH < 1600 || HEIGHT < 900 )); then
        cat "$window_info_path" >&2
        echo "Package window opened smaller than the expected default size." >&2
        exit 1
      fi
    else
      {
        echo "WINDOW_FOUND=0"
        echo "NOTE=headless Xvfb did not expose a discoverable Pickforge window"
      } >"$window_info_path"
      echo "No discoverable Pickforge window under headless Xvfb; liveness and package checks passed." >&2
    fi

    if command -v import >/dev/null 2>&1; then
      if import -window root "$screenshot_path"; then
        if [[ -n "$image_tool" ]]; then
          stddev=$("$image_tool" "$screenshot_path" -colorspace Gray \
            -format "%[fx:standard_deviation]" info:)
          if ! awk -v stddev="$stddev" "BEGIN { exit !(stddev > 0.001) }"; then
            echo "Screenshot was captured but appears blank under Xvfb." >&2
          fi
        fi
      else
        echo "Screenshot capture failed under Xvfb." >&2
      fi
    fi
  ' bash "$app_path" "$clean_home" "$log_path" "$screenshot_path" \
  "$window_info_path" "$startup_timeout" "$image_tool"

echo "Linux .deb smoke passed."
echo "Package: $deb_path"
echo "Log: $log_path"
echo "Window: $window_info_path"
echo "Screenshot: $screenshot_path"
