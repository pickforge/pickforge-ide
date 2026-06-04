#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Linux .deb container install smoke requires Linux." >&2
  exit 1
fi

deb_path=""
skip_build=0
runtime="${PICKFORGE_CONTAINER_RUNTIME:-}"
image="${PICKFORGE_DEB_CONTAINER_IMAGE:-ubuntu:24.04}"
smoke_out_dir="${PICKFORGE_DEB_CONTAINER_SMOKE_OUT_DIR:-build/smoke/linux-deb-container}"

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
    --image)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --image" >&2
        exit 64
      fi
      image="$2"
      shift 2
      ;;
    --runtime)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --runtime" >&2
        exit 64
      fi
      runtime="$2"
      shift 2
      ;;
    --skip-build)
      skip_build=1
      shift
      ;;
    --help|-h)
      echo "Usage: scripts/linux_deb_container_install_smoke.sh [--skip-build] [--deb <path>] [--out-dir <path>] [--image <image>] [--runtime <docker|podman>]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

if [[ -z "$runtime" ]]; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    runtime="docker"
  elif command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
    runtime="podman"
  else
    echo "Missing usable container runtime: docker or podman" >&2
    exit 1
  fi
fi

if ! command -v "$runtime" >/dev/null 2>&1; then
  echo "Container runtime not found: $runtime" >&2
  exit 1
fi

mkdir -p "$smoke_out_dir"
smoke_out_dir_abs="$(cd "$smoke_out_dir" && pwd)"

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

rm -f \
  "$smoke_out_dir_abs/app.log" \
  "$smoke_out_dir_abs/dpkg-status.txt" \
  "$smoke_out_dir_abs/ldd.txt" \
  "$smoke_out_dir_abs/install.log" \
  "$smoke_out_dir_abs/runtime.txt"

printf 'runtime=%s\nimage=%s\ndeb=%s\n' \
  "$runtime" "$image" "$deb_path" >"$smoke_out_dir_abs/runtime.txt"

"$runtime" run --rm -i \
  -v "$deb_path:/tmp/pickforge.deb:ro" \
  -v "$smoke_out_dir_abs:/artifacts" \
  "$image" \
  bash -s <<'CONTAINER'
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update >/artifacts/install.log
apt-get install -y --no-install-recommends \
  /tmp/pickforge.deb \
  ca-certificates \
  dbus-x11 \
  file \
  libgtk-3-bin \
  xauth \
  xvfb >>/artifacts/install.log 2>&1

dpkg-query -W -f='${Package} ${Version} ${Architecture} ${Status}\n' \
  pickforge > /artifacts/dpkg-status.txt
expected_version="$(dpkg-deb -f /tmp/pickforge.deb Version)"
expected_arch="$(dpkg-deb -f /tmp/pickforge.deb Architecture)"
grep -qx "pickforge ${expected_version} ${expected_arch} install ok installed" \
  /artifacts/dpkg-status.txt

test -x /opt/pickforge/pickforge
test -d /opt/pickforge/data/flutter_assets
test -f /opt/pickforge/lib/libflutter_linux_gtk.so
test -L /usr/bin/pickforge
test "$(readlink /usr/bin/pickforge)" = "/opt/pickforge/pickforge"
test -f /usr/share/applications/pickforge.desktop
test -f /usr/share/icons/hicolor/scalable/apps/pickforge.svg

set +e
{
  echo "== /opt/pickforge/pickforge =="
  ldd /opt/pickforge/pickforge
  find /opt/pickforge/lib \
    -type f \
    -name '*.so' \
    ! -name 'libdartjni.so' \
    -print | sort | while IFS= read -r so; do
    echo "== $so =="
    LD_LIBRARY_PATH=/opt/pickforge/lib ldd "$so"
  done
} > /artifacts/ldd.txt 2>&1
ldd_status=$?
set -e

if [[ "$ldd_status" -ne 0 ]] || grep -q 'not found' /artifacts/ldd.txt; then
  cat /artifacts/ldd.txt >&2
  exit 1
fi

clean_home="$(mktemp -d)"
export HOME="$clean_home"
export XDG_CACHE_HOME="$clean_home/.cache"
export XDG_CONFIG_HOME="$clean_home/.config"
export XDG_DATA_HOME="$clean_home/.local/share"
export NO_AT_BRIDGE=1
export PICKFORGE_INHERITED_ENV_ONLY=1
mkdir -p "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME"
xdg-user-dirs-update >/dev/null 2>&1 || true
mkdir -p "$HOME/Documents"

set +e
xvfb-run -a -s "-screen 0 1600x1000x24" \
  timeout 12s /usr/bin/pickforge >/artifacts/app.log 2>&1
status=$?
set -e

if [[ "$status" -ne 124 ]]; then
  cat /artifacts/app.log >&2
  echo "Expected installed Pickforge to remain alive until timeout; exit status: $status" >&2
  exit 1
fi

if grep -E \
  'MissingPlatformDirectoryException|Another exception was thrown|Unhandled [Ee]xception|Aborted|core dumped' \
  /artifacts/app.log >&2; then
  echo "Installed Pickforge emitted startup exceptions." >&2
  exit 1
fi
CONTAINER

echo "Linux .deb container install smoke passed."
echo "Runtime: $runtime"
echo "Image: $image"
echo "Package: $deb_path"
echo "Artifacts: $smoke_out_dir"
