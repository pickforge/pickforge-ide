#!/usr/bin/env bash
set -euo pipefail
fvm dart format --set-exit-if-changed .
fvm flutter analyze
fvm flutter test
