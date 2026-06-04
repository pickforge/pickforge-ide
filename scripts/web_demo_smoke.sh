#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

out_dir="${PICKFORGE_WEB_DEMO_OUT_DIR:-build/web-demo}"
rm -rf "$out_dir"

fvm flutter build web \
  --debug \
  --target lib/web_demo.dart \
  --output "$out_dir"

test -f "$out_dir/index.html"
test -f "$out_dir/main.dart.js"

echo "Web demo build passed."
echo "Output: $out_dir"
