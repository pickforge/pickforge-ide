#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for required in awk fvm gpg gpgconf mktemp; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "Missing required signing smoke tool: $required" >&2
    exit 1
  fi
done

package_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      package_args+=(--skip-build)
      shift
      ;;
    --help|-h)
      echo "Usage: scripts/linux_deb_signing_smoke.sh [--skip-build]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

scripts/package_linux_deb.sh "${package_args[@]}"

tmp_dir="$(mktemp -d)"
export GNUPGHOME="$tmp_dir/gnupg"
mkdir -m 700 "$GNUPGHOME"
cleanup() {
  gpgconf --kill all >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

identity="Pickforge Test Signing <test-signing@pickforge.local>"
gpg --batch --passphrase '' --quick-generate-key "$identity" ed25519 sign 1d
key_id="$(
  gpg --batch --with-colons --list-secret-keys "$identity" |
    awk -F: '/^fpr:/ {print $10; exit}'
)"
if [[ -z "$key_id" ]]; then
  echo "Failed to discover generated signing key fingerprint." >&2
  exit 1
fi

PICKFORGE_GPG_KEY="$key_id" scripts/sign_linux_deb.sh

echo "Linux .deb signing smoke passed with ephemeral key: $key_id"
