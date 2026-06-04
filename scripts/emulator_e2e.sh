#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

avd="${1:-${PICKFORGE_E2E_AVD:-Pixel_10}}"
out_dir="${PICKFORGE_E2E_OUT_DIR:-build/e2e/android}"
mkdir -p "$out_dir"

run_e2e() {
  local name="$1"
  local test_file="$2"
  local artifact_dir="$out_dir/$name"
  mkdir -p "$artifact_dir"

  fvm flutter test \
    --dart-define=PICKFORGE_E2E_AVD="$avd" \
    --dart-define=PICKFORGE_E2E_ARTIFACT_DIR="$artifact_dir" \
    "$test_file" \
    --reporter=compact 2>&1 | tee "$artifact_dir/flutter-test.log"
}

run_e2e emulator test/integration/emulator_e2e_test.dart
run_e2e widget-pick test/integration/widget_pick_e2e_test.dart

echo "Emulator E2E passed for AVD: $avd"
echo "Artifacts: $out_dir"
