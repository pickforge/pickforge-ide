# Pickforge — Release Dogfood Checklist

Run through this list before tagging a release. Manual steps only — automated
coverage lives in CI.

## Cold-install smoke

- [ ] Fresh VM / clean machine (Linux, macOS).
- [ ] Install the built artifact. App launches, 480x720 window, dark theme, always-on-top.

## Connection

- [ ] Add the sample Flutter app or a real Flutter app as a Pickforge project.
- [ ] Select/bind an Android AVD in project settings.
- [ ] Start the app from Pickforge or attach with the manual VM Service URL.
- [ ] Connection/status pill reaches `Running`.
- [ ] Disconnect + reconnect → no crash, project binding is remembered next launch.
- [ ] Kill the app mid-session → Pickforge shows a recoverable error or reconnecting state, then recovers after restart.

## Widget pick → Forge it

- [ ] Tap a user-code widget in emulator → appears in the details panel.
- [ ] Tap a framework widget → Forge it disabled with "Pick a widget from your app source." hint.
- [ ] Forge it with each agent (Claude Code, Codex, OpenCode) at least once.
- [ ] Prompt is delivered into the visible active embedded terminal chat.
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
- [ ] Pick history data is recorded when available; full History UI is post-MVP and non-blocking.
- [ ] Settings view reads and writes defaults per project.

## MVP dogfood signoff

- [ ] Linux dogfood pass completed.
- [ ] macOS dogfood pass completed before public release.
- [ ] Blockers recorded as issues or follow-up plan items.

Sign off: _______________________________
