#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

skip_build=0
appimagetool="${PICKFORGE_APPIMAGETOOL:-}"
tool_url="${PICKFORGE_APPIMAGETOOL_URL:-https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage}"
tool_dir="${PICKFORGE_APPIMAGE_TOOL_DIR:-build/tools}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      skip_build=1
      shift
      ;;
    --appimagetool)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --appimagetool" >&2
        exit 64
      fi
      appimagetool="$2"
      shift 2
      ;;
    --tool-url)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --tool-url" >&2
        exit 64
      fi
      tool_url="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: scripts/package_linux_appimage.sh [--skip-build] [--appimagetool <path>] [--tool-url <url>]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Linux AppImage packaging requires Linux." >&2
  exit 1
fi

for required in awk chmod cp curl install ln mkdir readlink rm sha256sum; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "Missing required packaging tool: $required" >&2
    exit 1
  fi
done

if [[ -z "$appimagetool" ]]; then
  if command -v appimagetool >/dev/null 2>&1; then
    appimagetool="$(command -v appimagetool)"
  else
    mkdir -p "$tool_dir"
    appimagetool="$tool_dir/appimagetool-x86_64.AppImage"
    if [[ ! -x "$appimagetool" ]]; then
      curl -fsSL "$tool_url" -o "$appimagetool"
      chmod +x "$appimagetool"
    fi
  fi
fi

if [[ ! -x "$appimagetool" ]]; then
  echo "appimagetool is not executable: $appimagetool" >&2
  exit 1
fi

version="${PICKFORGE_APPIMAGE_VERSION:-$(awk '/^version:/ {print $2; exit}' pubspec.yaml)}"
arch="${PICKFORGE_APPIMAGE_ARCH:-x86_64}"
bundle_dir="${PICKFORGE_LINUX_BUNDLE_DIR:-build/linux/x64/release/bundle}"
out_dir="${PICKFORGE_PACKAGE_OUT_DIR:-build/dist/linux}"
appdir="${PICKFORGE_APPIMAGE_APPDIR:-build/dist/linux/Pickforge.AppDir}"
appimage_path="$out_dir/Pickforge-${version}-${arch}.AppImage"

if [[ "$skip_build" -eq 0 ]]; then
  fvm flutter build linux --release
fi

if [[ ! -x "$bundle_dir/pickforge" ]]; then
  echo "Linux bundle executable not found: $bundle_dir/pickforge" >&2
  echo "Run without --skip-build or set PICKFORGE_LINUX_BUNDLE_DIR." >&2
  exit 1
fi

rm -rf "$appdir"
install -d "$appdir/usr/lib/pickforge"
install -d "$appdir/usr/bin"
install -d "$appdir/usr/share/applications"
install -d "$appdir/usr/share/icons/hicolor/scalable/apps"

cp -a "$bundle_dir/." "$appdir/usr/lib/pickforge/"
ln -s ../lib/pickforge/pickforge "$appdir/usr/bin/pickforge"
cp packaging/linux/pickforge.desktop "$appdir/pickforge.desktop"
cp packaging/linux/pickforge.desktop "$appdir/usr/share/applications/pickforge.desktop"
cp packaging/linux/pickforge.svg "$appdir/pickforge.svg"
cp packaging/linux/pickforge.svg "$appdir/usr/share/icons/hicolor/scalable/apps/pickforge.svg"

cat >"$appdir/AppRun" <<'APPRUN'
#!/usr/bin/env bash
set -euo pipefail

here="$(dirname "$(readlink -f "${0}")")"
export LD_LIBRARY_PATH="$here/usr/lib/pickforge/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PATH="$here/usr/bin${PATH:+:$PATH}"
exec "$here/usr/lib/pickforge/pickforge" "$@"
APPRUN
chmod +x "$appdir/AppRun"

mkdir -p "$out_dir"
rm -f "$appimage_path" "$appimage_path.sha256"
ARCH="$arch" VERSION="$version" APPIMAGE_EXTRACT_AND_RUN=1 \
  "$appimagetool" -n "$appdir" "$appimage_path"
sha256sum "$appimage_path" >"$appimage_path.sha256"

echo "Linux AppImage created: $appimage_path"
echo "Checksum: $appimage_path.sha256"
