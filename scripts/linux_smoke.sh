#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Linux desktop smoke requires Linux." >&2
  exit 1
fi

for required in fvm xvfb-run timeout import awk setsid; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "Missing required command: $required" >&2
    exit 1
  fi
done

image_tool=""
if command -v magick >/dev/null 2>&1; then
  image_tool="magick"
elif command -v convert >/dev/null 2>&1; then
  image_tool="convert"
else
  echo "Missing required command: magick or convert" >&2
  exit 1
fi

out_dir="${PICKFORGE_SMOKE_OUT_DIR:-build/smoke/linux}"
startup_timeout="${PICKFORGE_SMOKE_STARTUP_TIMEOUT:-90}"
run_timeout="${PICKFORGE_SMOKE_TIMEOUT:-180}"
mkdir -p "$out_dir"

log_path="$out_dir/flutter-run.log"
screenshot_path="$out_dir/first-frame.png"
probe_path="$out_dir/inspector-root.json"
rm -f "$log_path" "$screenshot_path" "$probe_path"

timeout "${run_timeout}s" xvfb-run -a -s "-screen 0 1280x800x24" \
  bash -c '
    set -euo pipefail
    log_path="$1"
    screenshot_path="$2"
    startup_timeout="$3"
    image_tool="$4"
    probe_path="$5"

    app_pid=""
    cleanup() {
      if [[ -n "$app_pid" ]]; then
        kill -INT -- "-$app_pid" >/dev/null 2>&1 || \
          kill -INT "$app_pid" >/dev/null 2>&1 || true
        sleep 2
        kill -TERM -- "-$app_pid" >/dev/null 2>&1 || \
          kill -TERM "$app_pid" >/dev/null 2>&1 || true
        wait "$app_pid" >/dev/null 2>&1 || true
      fi
    }
    trap cleanup EXIT

    setsid fvm flutter run -d linux \
      --dart-define=PICKFORGE_INITIAL_ROUTE=/demo \
      >"$log_path" 2>&1 &
    app_pid="$!"

    ready=0
    deadline=$((SECONDS + startup_timeout))
    while (( SECONDS < deadline )); do
      if grep -Eq "Flutter run key commands|A Dart VM Service" "$log_path"; then
        ready=1
        break
      fi
      if ! kill -0 "$app_pid" >/dev/null 2>&1; then
        cat "$log_path" >&2
        exit 1
      fi
      sleep 1
    done

    if [[ "$ready" != "1" ]]; then
      cat "$log_path" >&2
      echo "Timed out waiting for Linux desktop smoke startup." >&2
      exit 1
    fi

    vm_http_url=$(
      grep -Eo "http://127\\.0\\.0\\.1:[^ ]+/" "$log_path" | head -n 1 || true
    )
    if [[ -z "$vm_http_url" ]]; then
      cat "$log_path" >&2
      echo "Could not find VM Service URL in Flutter run log." >&2
      exit 1
    fi
    vm_ws_url="ws://${vm_http_url#http://}ws"
    fvm dart run tool/linux_smoke_probe.dart "$vm_ws_url" "$probe_path"

    sleep 3
    if import -window root "$screenshot_path"; then
      stddev=$("$image_tool" "$screenshot_path" -colorspace Gray \
        -format "%[fx:standard_deviation]" info:)
      if ! awk -v stddev="$stddev" "BEGIN { exit !(stddev > 0.001) }"; then
        echo "Screenshot was captured but appears blank under Xvfb." >&2
      fi
    else
      echo "Screenshot capture failed under Xvfb." >&2
    fi
  ' bash "$log_path" "$screenshot_path" "$startup_timeout" "$image_tool" \
  "$probe_path"

echo "Linux desktop smoke passed."
echo "Log: $log_path"
echo "Inspector root: $probe_path"
echo "Screenshot: $screenshot_path"
