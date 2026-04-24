#!/usr/bin/env bash
set -euo pipefail
fvm dart run build_runner watch --delete-conflicting-outputs
