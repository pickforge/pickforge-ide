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
PORT=1431
DISPLAY_NUM=99
bun run sidecar
setsid Xvfb :$DISPLAY_NUM -screen 0 1280x820x24 > /tmp/pickforge-xvfb-$DISPLAY_NUM.log 2>&1 &
setsid xfwm4 --display :$DISPLAY_NUM --compositor=off > /tmp/pickforge-xfwm-$DISPLAY_NUM.log 2>&1 &
setsid bun run dev -- --host 127.0.0.1 --port $PORT > /tmp/pickforge-vite-$PORT.log 2>&1 &
setsid env -u WAYLAND_DISPLAY GDK_BACKEND=x11 DISPLAY=:$DISPLAY_NUM \
  bun run tauri dev --config "{\"identifier\":\"dev.pickforge.app.labtest\",\"build\":{\"devUrl\":\"http://127.0.0.1:$PORT\",\"beforeDevCommand\":\"\"}}" \
  > /tmp/pickforge-lab-$DISPLAY_NUM.log 2>&1 &
```

`DISPLAY` alone is not enough: GDK otherwise prefers the user's Wayland session.
The Xvfb display needs `xfwm4` for maximize and restore. The `.labtest`
identifier keeps `tauri-plugin-single-instance` from focusing the live app.

The lab still reads the real PickForge data directories. Never use destructive UI
there: clear-all, delete, or sign-out.

## Verify and screenshot

```sh
curl -fsS http://127.0.0.1:$PORT/ >/dev/null
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
```

Never put `pkill -f` in a compound command; it can match and kill its own shell.
