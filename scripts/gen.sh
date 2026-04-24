#!/usr/bin/env bash
set -euo pipefail
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter gen-l10n
