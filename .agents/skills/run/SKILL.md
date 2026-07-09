---
name: run
description: Launch PickForge in dev mode or isolated headless lab mode to verify changes. Use when asked to run the app, screenshot it, or confirm a change works in the real app.
---

# Run PickForge

## Normal dev launch

Install dependencies once, then launch the normal app:

```sh
bun install --frozen-lockfile
bun run tauri dev
```

This uses the live desktop and the normal single-instance app. In a worktree,
use a separate port and visible flavor/version suffix. The existing performance
flavor is `bun run tauri:dev:performance` (PickForge Performance on port 1422).

## Isolated lab launch (Linux)

Use a free Vite port and unused X display number below. Build the sidecar first:

```sh
for candidate in {1421..1439}; do ! ss -ltnH "sport = :$candidate" | grep -q . && { PORT=$candidate; break; }; done
: "${PORT:?No free port in 1421-1439}"
for n in $(seq 90 120); do [ ! -e "/tmp/.X11-unix/X$n" ] && DISPLAY_NUM=$n && break; done
: "${DISPLAY_NUM:?No free X display in 90-120}"
LAB_HOME="$(mktemp -d /tmp/pickforge-lab-home.XXXX)"
bun run sidecar
setsid Xvfb :$DISPLAY_NUM -screen 0 1280x820x24 > /tmp/pickforge-xvfb-$DISPLAY_NUM.log 2>&1 &
setsid xfwm4 --display :$DISPLAY_NUM --compositor=off > /tmp/pickforge-xfwm-$DISPLAY_NUM.log 2>&1 &
setsid bun run dev -- --host 127.0.0.1 --port $PORT > /tmp/pickforge-vite-$PORT.log 2>&1 &
setsid env -u WAYLAND_DISPLAY \
  PICKFORGE_HOME="$LAB_HOME" \
  XDG_DATA_HOME="$LAB_HOME/xdg-data" \
  XDG_CONFIG_HOME="$LAB_HOME/xdg-config" \
  XDG_CACHE_HOME="$LAB_HOME/xdg-cache" \
  GDK_BACKEND=x11 DISPLAY=:$DISPLAY_NUM \
  bun run tauri dev --config "{\"identifier\":\"dev.pickforge.app.labtest\",\"build\":{\"devUrl\":\"http://127.0.0.1:$PORT\",\"beforeDevCommand\":\"\"}}" \
  > /tmp/pickforge-lab-$DISPLAY_NUM.log 2>&1 &
```

`DISPLAY` alone is not enough: GDK otherwise prefers the user's Wayland session.
The Xvfb display needs `xfwm4` for maximize and restore. The `.labtest`
identifier keeps `tauri-plugin-single-instance` from focusing the live app.

The lab starts with fresh PickForge and XDG data under `$LAB_HOME`; do not copy
real data into it unless that is an explicit test. Keep `HOME` real for
Cargo/rustup. Anything outside `PICKFORGE_HOME` and the XDG overrides may still
touch real state.

## Verify and screenshot

```sh
curl -fsS http://127.0.0.1:$PORT/ >/dev/null
ls -l "$LAB_HOME/pickforge.db"
find "$LAB_HOME/xdg-data" "$LAB_HOME/xdg-config" -maxdepth 2 \( -name '*handler.desktop' -o -name mimeapps.list \) -print
import -display :$DISPLAY_NUM -window root /tmp/pickforge-lab-$DISPLAY_NUM.png
```

Open the PNG to inspect the real Tauri window. Read the lab log if the screenshot
is blank or the app has not finished compiling.

## Cleanup

Kill each matching process in a separate Bash call after substituting the chosen
numbers. The `[x]` pattern avoids matching the wrapper shell itself.

```sh
bash -c 'kill $(pgrep -f "[d]ev.pickforge.app.labtest.*1431")'
bash -c 'kill $(pgrep -f "[v]ite.*--port 1431")'
bash -c 'kill $(pgrep -f "[x]fwm4.*:99")'
bash -c 'kill $(pgrep -f "[X]vfb :99")'
rm -rf "$LAB_HOME"
```

Substitute `1431`/`99` with the values actually chosen by the scans.

Never put `pkill -f` in a compound command; it can match and kill its own shell.
