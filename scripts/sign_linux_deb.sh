#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for required in awk gpg readlink sha256sum; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "Missing required signing tool: $required" >&2
    exit 1
  fi
done

deb_path=""
key_id="${PICKFORGE_GPG_KEY:-}"

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
    --key)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --key" >&2
        exit 64
      fi
      key_id="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: scripts/sign_linux_deb.sh [--deb <path>] [--key <gpg-key-id>]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

if [[ -z "$deb_path" ]]; then
  version="${PICKFORGE_DEB_VERSION:-$(awk '/^version:/ {print $2; exit}' pubspec.yaml)}"
  arch="${PICKFORGE_DEB_ARCH:-amd64}"
  out_dir="${PICKFORGE_PACKAGE_OUT_DIR:-build/dist/linux}"
  deb_path="$out_dir/pickforge_${version}_${arch}.deb"
fi

if [[ ! -f "$deb_path" ]]; then
  echo "Linux .deb not found: $deb_path" >&2
  exit 1
fi

deb_path="$(readlink -f "$deb_path")"
checksum_path="$deb_path.sha256"

if [[ ! -f "$checksum_path" ]]; then
  sha256sum "$deb_path" >"$checksum_path"
fi
sha256sum -c "$checksum_path"

sign_args=(--batch --yes --armor --detach-sign)
if [[ -n "$key_id" ]]; then
  sign_args+=(--local-user "$key_id")
fi
if [[ -n "${PICKFORGE_GPG_PASSPHRASE:-}" ]]; then
  sign_args+=(--pinentry-mode loopback --passphrase "$PICKFORGE_GPG_PASSPHRASE")
fi

gpg "${sign_args[@]}" --output "$deb_path.asc" "$deb_path"
gpg --batch --verify "$deb_path.asc" "$deb_path"

gpg "${sign_args[@]}" --output "$checksum_path.asc" "$checksum_path"
gpg --batch --verify "$checksum_path.asc" "$checksum_path"

echo "Linux .deb signature created: $deb_path.asc"
echo "Checksum signature created: $checksum_path.asc"
