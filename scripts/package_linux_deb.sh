#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

skip_build=0
for arg in "$@"; do
  case "$arg" in
    --skip-build)
      skip_build=1
      ;;
    --help|-h)
      echo "Usage: scripts/package_linux_deb.sh [--skip-build]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

for cmd in ar tar gzip sha256sum install; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required packaging tool: $cmd" >&2
    exit 1
  fi
done

version="${PICKFORGE_DEB_VERSION:-$(awk '/^version:/ {print $2; exit}' pubspec.yaml)}"
arch="${PICKFORGE_DEB_ARCH:-amd64}"
maintainer="${PICKFORGE_DEB_MAINTAINER:-Pickforge Maintainers <maintainers@pickforge.local>}"
bundle_dir="${PICKFORGE_LINUX_BUNDLE_DIR:-build/linux/x64/release/bundle}"
out_dir="${PICKFORGE_PACKAGE_OUT_DIR:-build/dist/linux}"
package_name="pickforge"
deb_path="$out_dir/${package_name}_${version}_${arch}.deb"

if [[ "$skip_build" -eq 0 ]]; then
  fvm flutter build linux --release
fi

if [[ ! -x "$bundle_dir/pickforge" ]]; then
  echo "Linux bundle executable not found: $bundle_dir/pickforge" >&2
  echo "Run without --skip-build or set PICKFORGE_LINUX_BUNDLE_DIR." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

pkg_root="$tmp_dir/pkg"
install -d "$pkg_root/DEBIAN"
install -d "$pkg_root/opt/pickforge"
cp -a "$bundle_dir/." "$pkg_root/opt/pickforge/"

install -d "$pkg_root/usr/bin"
ln -s /opt/pickforge/pickforge "$pkg_root/usr/bin/pickforge"

install -Dm644 \
  packaging/linux/pickforge.desktop \
  "$pkg_root/usr/share/applications/pickforge.desktop"
install -Dm644 \
  packaging/linux/pickforge.svg \
  "$pkg_root/usr/share/icons/hicolor/scalable/apps/pickforge.svg"

installed_size="$(du -sk "$pkg_root" | awk '{print $1}')"
cat >"$pkg_root/DEBIAN/control" <<CONTROL
Package: $package_name
Version: $version
Section: devel
Priority: optional
Architecture: $arch
Maintainer: $maintainer
Installed-Size: $installed_size
Depends: libc6, libstdc++6, libglib2.0-0, libgtk-3-0, libegl1, libgles2, liblzma5, xdg-user-dirs
Description: Widget-level AI context for Flutter.
 Pickforge is a local Flutter desktop app for selecting widgets in a running
 Flutter app and sending focused context to an embedded agent terminal.
CONTROL

echo "2.0" >"$tmp_dir/debian-binary"
tar --sort=name --mtime="@0" --owner=0 --group=0 --numeric-owner \
  -C "$pkg_root/DEBIAN" -czf "$tmp_dir/control.tar.gz" .
tar --sort=name --mtime="@0" --owner=0 --group=0 --numeric-owner \
  -C "$pkg_root" --exclude=./DEBIAN -czf "$tmp_dir/data.tar.gz" .

mkdir -p "$out_dir"
rm -f "$deb_path" "$deb_path.sha256" "$deb_path.asc" "$deb_path.sha256.asc"
ar rcs "$deb_path" \
  "$tmp_dir/debian-binary" \
  "$tmp_dir/control.tar.gz" \
  "$tmp_dir/data.tar.gz"
sha256sum "$deb_path" >"$deb_path.sha256"

echo "Linux .deb package created: $deb_path"
echo "Checksum: $deb_path.sha256"
