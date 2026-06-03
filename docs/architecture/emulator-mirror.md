# Embedded Emulator Mirror Strategy

Pickforge should keep the current VM Service inspector flow as the source of
widget identity. A mirror is a viewing and input surface, not a replacement for
inspector-based selection.

Reference docs:

- https://github.com/Genymobile/scrcpy/blob/master/README.md
- https://github.com/Genymobile/scrcpy/blob/master/doc/window.md
- https://github.com/Genymobile/scrcpy/blob/master/doc/video.md
- https://github.com/Genymobile/scrcpy/blob/master/doc/develop.md

## Recommendation

Use two phases:

1. Optional detached `scrcpy` companion window.
2. True embedded mirror through the scrcpy server raw H.264 stream.

Do not try to embed the normal scrcpy SDL window into Flutter. The documented
window options control title, position, size, fullscreen, borderless,
always-on-top, and no-window modes, but they do not provide a stable child-window
embedding contract across Linux, macOS, and Windows.

## Phase 1: Detached Companion Window

This phase is a low-risk bridge for users who want a live mirror near Pickforge:

```bash
scrcpy \
  --window-title="Pickforge Mirror" \
  --window-width=420 \
  --window-height=900 \
  --max-size=1920 \
  --max-fps=60 \
  --no-audio
```

For read-only mode:

```bash
scrcpy --no-control --no-audio --max-size=1920 --max-fps=60
```

This must be optional and launched independently from the existing run/session
flow. If `scrcpy` is missing or exits, the current external emulator and VM
Service inspector flow must continue to work.

## Phase 2: True Embedded Mirror

For an in-app mirror, run the scrcpy server manually and consume the raw stream:

```bash
adb push scrcpy-server /data/local/tmp/scrcpy-server.jar
adb forward tcp:1234 localabstract:scrcpy
adb shell CLASSPATH=/data/local/tmp/scrcpy-server.jar \
  app_process / com.genymobile.scrcpy.Server <version> \
  tunnel_forward=true audio=false control=false cleanup=false \
  raw_stream=true max_size=1920
```

Pickforge would then:

1. Decode H.264 frames with a platform decoder.
2. Publish frames into a Flutter texture.
3. Render that texture in the inspector pane or a collapsible device pane.
4. Keep existing VM Service selection and pick history unchanged.

The first embedded version should be read-only. Input forwarding can be enabled
after coordinate mapping is proven with tests.

## Coordinate Mapping

Maintain a `MirrorTransform` with:

- device capture width and height
- rendered widget logical size
- Flutter device pixel ratio
- fit mode and letterbox offsets
- capture orientation
- client display orientation
- crop rectangle, if any

Pointer mapping:

1. Convert Flutter local logical coordinates to rendered physical pixels.
2. Remove letterbox offsets.
3. Normalize into the decoded video frame.
4. Apply inverse display-orientation transform.
5. Apply crop offset if capture was cropped.
6. Emit device coordinates in the scrcpy control position shape:
   `{x, y, screenWidth, screenHeight}`.

The initial `MirrorTransform` implementation covers contained rendering,
letterbox rejection, and 0/90/180/270 degree inverse rotation. Crop offsets can
be added when the embedded stream supports cropped capture.

Do not use client-side rotation as a shortcut unless the transform records it.
scrcpy documents crop values in device natural orientation, applied before
capture orientation and display angle, so crop and rotation must stay explicit.

## Rotation and Size

Use these scrcpy controls only as inputs to the transform:

- `--max-size` to cap resolution while preserving aspect ratio.
- `--max-fps` to cap frame rate.
- `--video-bit-rate` to trade quality for latency.
- `--crop=width:height:x:y` for focused capture.
- `--orientation` for client-side display orientation in detached-window mode.

For embedded mode, prefer rendering the decoded frame as delivered and applying
rotation in Flutter. That keeps device-coordinate math under Pickforge control.

## Input Forwarding

Read-only mirror mode is the default. If input forwarding is enabled later:

- Gate it behind a per-project setting.
- Disable forwarding while the widget picker overlay is active.
- Prefer scrcpy control messages for taps, swipes, key events, and scroll.
- Fall back to `adb shell input` only for simple tap/swipe smoke tests.
- Keep inspector widget identity from VM Service, not from touch coordinates.

## Non-Regression Rules

- Mirror support is optional.
- Missing `scrcpy` must not block app startup, project loading, Flutter run, hot
  reload, or widget picking.
- The existing external emulator workflow remains the default until embedded
  mode is stable on Linux, macOS, and Windows.
- Tests should cover transform math without requiring a running emulator.
