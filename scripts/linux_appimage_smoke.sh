#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Linux AppImage smoke requires Linux." >&2
  exit 1
fi

for required in file readlink sha256sum timeout xvfb-run; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "Missing required command: $required" >&2
    exit 1
  fi
done

appimage_path=""
skip_build=0
smoke_out_dir="${PICKFORGE_APPIMAGE_SMOKE_OUT_DIR:-build/smoke/linux-appimage}"
run_timeout="${PICKFORGE_APPIMAGE_SMOKE_TIMEOUT:-90}"
liveness_seconds="${PICKFORGE_APPIMAGE_SMOKE_LIVENESS_SECONDS:-12}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --appimage)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --appimage" >&2
        exit 64
      fi
      appimage_path="$2"
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
      echo "Usage: scripts/linux_appimage_smoke.sh [--skip-build] [--appimage <path>] [--out-dir <path>]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

mkdir -p "$smoke_out_dir"

if [[ -z "$appimage_path" ]]; then
  package_args=()
  if [[ "$skip_build" -eq 1 ]]; then
    package_args+=(--skip-build)
  fi
  scripts/package_linux_appimage.sh "${package_args[@]}"

  version="${PICKFORGE_APPIMAGE_VERSION:-$(awk '/^version:/ {print $2; exit}' pubspec.yaml)}"
  arch="${PICKFORGE_APPIMAGE_ARCH:-x86_64}"
  package_out_dir="${PICKFORGE_PACKAGE_OUT_DIR:-build/dist/linux}"
  appimage_path="$package_out_dir/Pickforge-${version}-${arch}.AppImage"
fi

if [[ ! -f "$appimage_path" ]]; then
  echo "Linux AppImage not found: $appimage_path" >&2
  exit 1
fi

appimage_path="$(readlink -f "$appimage_path")"
appimage_name="$(basename "$appimage_path")"
checksum_path="$appimage_path.sha256"

if [[ -f "$checksum_path" ]]; then
  sha256sum -c "$checksum_path"
else
  sha256sum "$appimage_path" >"$smoke_out_dir/$appimage_name.sha256"
fi

if ! file "$appimage_path" | grep -q 'AppImage'; then
  file "$appimage_path" >&2
  echo "Package does not look like an AppImage." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

extract_dir="$tmp_dir/extract"
clean_home="$tmp_dir/home"
install -d "$extract_dir" "$clean_home"

(
  cd "$extract_dir"
  APPIMAGE_EXTRACT_AND_RUN=1 "$appimage_path" --appimage-extract >/dev/null
)

appdir="$extract_dir/squashfs-root"
for required_path in \
  "$appdir/AppRun" \
  "$appdir/pickforge.desktop" \
  "$appdir/pickforge.svg" \
  "$appdir/usr/lib/pickforge/pickforge" \
  "$appdir/usr/lib/pickforge/data/flutter_assets" \
  "$appdir/usr/lib/pickforge/lib/libflutter_linux_gtk.so" \
  "$appdir/usr/bin/pickforge"; do
  if [[ ! -e "$required_path" ]]; then
    echo "Extracted AppImage is missing: $required_path" >&2
    exit 1
  fi
done

if [[ ! -x "$appdir/AppRun" || ! -x "$appdir/usr/lib/pickforge/pickforge" ]]; then
  echo "Extracted AppImage launchers are not executable." >&2
  exit 1
fi

log_path="$smoke_out_dir/app.log"
rm -f "$log_path"

timeout "${run_timeout}s" xvfb-run -a -s "-screen 0 1600x1000x24" \
  bash -c '
    set -euo pipefail
    appimage_path="$1"
    clean_home="$2"
    log_path="$3"
    liveness_seconds="$4"

    export HOME="$clean_home"
    export XDG_CACHE_HOME="$clean_home/.cache"
    export XDG_CONFIG_HOME="$clean_home/.config"
    export XDG_DATA_HOME="$clean_home/.local/share"
    export NO_AT_BRIDGE=1
    export PICKFORGE_INHERITED_ENV_ONLY=1
    mkdir -p "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$HOME/Documents"

    set +e
    APPIMAGE_EXTRACT_AND_RUN=1 timeout "${liveness_seconds}s" \
      "$appimage_path" >"$log_path" 2>&1
    status=$?
    set -e

    if [[ "$status" -ne 124 ]]; then
      cat "$log_path" >&2
      echo "Expected AppImage Pickforge to remain alive until timeout; exit status: $status" >&2
      exit 1
    fi
  ' bash "$appimage_path" "$clean_home" "$log_path" "$liveness_seconds"

if grep -E \
  'MissingPlatformDirectoryException|Another exception was thrown|Unhandled [Ee]xception|Aborted|core dumped' \
  "$log_path" >&2; then
  echo "AppImage Pickforge emitted startup exceptions." >&2
  exit 1
fi

echo "Linux AppImage smoke passed."
echo "Package: $appimage_path"
echo "Log: $log_path"
