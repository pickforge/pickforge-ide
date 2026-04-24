# Pickforge — Release Dogfood Checklist

Run through this list before tagging a release. Manual steps only — automated
coverage lives in CI.

## Cold-install smoke

- [ ] Fresh VM / clean machine (Linux, macOS).
- [ ] Install the built artifact. App launches, 480x720 window, dark theme, always-on-top.

## Connection

- [ ] Start a sample Flutter app in an Android emulator and copy the VM Service URL.
- [ ] Paste into Pickforge → Connect → status turns green.
- [ ] Disconnect + reconnect → no crash, URL is remembered next launch.
- [ ] Kill the app mid-session → Pickforge shows Reconnecting, recovers after restart.

## Widget pick → Forge it

- [ ] Tap a user-code widget in emulator → appears in the details panel.
- [ ] Tap a framework widget → Forge it disabled with "pick a user widget" hint.
- [ ] Forge it with each agent (Claude Code, Codex, OpenCode) at least once.
- [ ] Forge it with each detected terminal at least once.
- [ ] Verify `.pickforge/` is created in the project with expected files + `.gitignore`.
- [ ] Verify the user's existing `CLAUDE.md` / `AGENTS.md` is untouched.

## Hot reload

- [ ] After the agent edits and hot-reloads, Pickforge refreshes the tree.
- [ ] Selecting a new widget post-reload still works.

## adb (Android only)

- [ ] With `adb` available: `.pickforge/device-screen.png` is written and referenced in the prompt.
- [ ] With `adb` unavailable: no error, `.pickforge/screenshot.png` still present.

## Misc

- [ ] ⌘K / Ctrl+K opens the command palette.
- [ ] History view shows the last forge.
- [ ] Settings view reads and writes defaults per project.

Sign off: _______________________________
