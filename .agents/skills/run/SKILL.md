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

## Isolated lab (Linux)

Prepare a fresh, stateful lab shell:

```sh
set -e
bun install --frozen-lockfile
command -v ss >/dev/null || { echo "ss (iproute2) required" >&2; false; }
for candidate in {1421..1439}; do ! ss -ltnH "sport = :$candidate" | grep -q . && { PORT=$candidate; break; }; done
: "${PORT:?No free port in 1421-1439}"
for n in $(seq 90 120); do [ ! -e "/tmp/.X11-unix/X$n" ] && DISPLAY_NUM=$n && break; done
: "${DISPLAY_NUM:?No free X display in 90-120}"
LAB_HOME="$(mktemp -d /tmp/pickforge-lab-home.XXXX)"
printf 'PORT=%s\nDISPLAY_NUM=%s\nLAB_HOME=%s\n' "$PORT" "$DISPLAY_NUM" "$LAB_HOME" > /tmp/pickforge-lab.env
```

Launch in a later shell:

```sh
source /tmp/pickforge-lab.env
set -e
bun run sidecar
setsid Xvfb :$DISPLAY_NUM -screen 0 1280x820x24 > /tmp/pickforge-xvfb-$DISPLAY_NUM.log 2>&1 &
for _ in {1..50}; do [ -e "/tmp/.X11-unix/X$DISPLAY_NUM" ] && break; sleep 0.1; done
[ -e "/tmp/.X11-unix/X$DISPLAY_NUM" ] || { echo "Xvfb did not start" >&2; false; }
setsid xfwm4 --display :$DISPLAY_NUM --compositor=off > /tmp/pickforge-xfwm-$DISPLAY_NUM.log 2>&1 &
setsid bun run dev -- --host 127.0.0.1 --port $PORT > /tmp/pickforge-vite-$PORT.log 2>&1 &
setsid env -u WAYLAND_DISPLAY PICKFORGE_HOME="$LAB_HOME" XDG_DATA_HOME="$LAB_HOME/xdg-data" \
  XDG_CONFIG_HOME="$LAB_HOME/xdg-config" XDG_CACHE_HOME="$LAB_HOME/xdg-cache" \
  GDK_BACKEND=x11 DISPLAY=:$DISPLAY_NUM bun run tauri dev --config "{\"identifier\":\"dev.pickforge.app.labtest$DISPLAY_NUM\",\"build\":{\"devUrl\":\"http://127.0.0.1:$PORT\",\"beforeDevCommand\":\"\"}}" \
  > /tmp/pickforge-lab-$DISPLAY_NUM.log 2>&1 &
```

`DISPLAY` alone is not enough: GDK otherwise prefers Wayland. `xfwm4` enables
maximize and restore. The identifier suffix (`.labtest$DISPLAY_NUM`) avoids
focusing the live single-instance app AND other agents' concurrent labs — two
labs sharing one labtest identifier ping each other and the second exits.
The lab has fresh PickForge/XDG data; copying real data is opt-in. Keep `HOME`
real for Cargo/rustup: anything outside these overrides may still touch real state.

## Verify and screenshot

```sh
source /tmp/pickforge-lab.env
curl -fsS http://127.0.0.1:$PORT/ >/dev/null
ls -l "$LAB_HOME/pickforge.db"
find "$LAB_HOME/xdg-data" "$LAB_HOME/xdg-config" -maxdepth 2 \( -name '*handler.desktop' -o -name mimeapps.list \) -print
import -display :$DISPLAY_NUM -window root /tmp/pickforge-lab-$DISPLAY_NUM.png
```

Open the PNG to inspect the real Tauri window. Read the lab log if the screenshot
is blank or the app has not finished compiling.

## Cleanup

Only kill PIDs whose environment contains the lab home; this protects a normal
dev app from the same checkout. The `[x]` pattern avoids matching the shell.

```sh
source /tmp/pickforge-lab.env
export PORT DISPLAY_NUM LAB_HOME
bash -c 'for pid in $(pgrep -f "[d]ev.pickforge.app.labtest$DISPLAY_NUM" || true); do grep -zqF "$LAB_HOME" "/proc/$pid/environ" 2>/dev/null && kill "$pid"; done'
bash -c 'for pid in $(pgrep -f "[p]ickforge-tauri" || true); do grep -zqF "$LAB_HOME" "/proc/$pid/environ" 2>/dev/null && kill "$pid"; done'
bash -c 'kill $(pgrep -f "[v]ite.*--port $PORT")'
bash -c 'kill $(pgrep -f "[x]fwm4.*:$DISPLAY_NUM")'
bash -c 'kill $(pgrep -f "[X]vfb :$DISPLAY_NUM")'
rm -rf "$LAB_HOME" /tmp/pickforge-lab.env
```

Never put `pkill -f` in a compound command; it can match and kill its own shell.
