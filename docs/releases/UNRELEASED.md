# Unreleased — v0.1.11 candidate

Working draft for the next PickForge release. Keep this current while PRs land.
At release time, copy and polish it into the GitHub release description, then
reset this file.

## User-facing changes

- PickForge no longer silently creates its database in the launch directory
  when the home directory cannot be resolved: startup now fails fast with an
  actionable error, and the `PICKFORGE_HOME` override keeps working (#237).
  Surfacing that error graphically in packaged builds is tracked in #255.
- Remote host settings now list paired clients with pairing dates and revoked
  status, and let users revoke active client access (#241).
- New section-based Settings navigation: a category sidebar with remembered
  last category, direct section links, keyboard navigation, and layouts that
  adapt to narrow windows. (`settingsNavigation` now default on, #211)
- Chats now get automatic titles from your first prompt, refreshed at
  meaningful milestones. Renaming a chat locks its title until you choose
  “Resume automatic titles”; manual titles survive restarts.
  (`dynamicChatTitles` now default on, #210)
- Linux builds get a persistent graphics compatibility mode in Settings
  (General): Auto (previous behavior), Compatibility (prefer X11/XWayland and
  disable WebKitGTK's DMA-BUF renderer — the verified fast path on affected
  AMD/KDE Wayland systems), or Native Wayland. Changing it shows a
  restart-required notice — accurate across Settings remounts and an
  A→B→A round trip, not just "you touched this" — with a restart action.
  Applied before GTK/WebKitGTK initialize; explicit `GDK_BACKEND` /
  `WEBKIT_DISABLE_DMABUF_RENDERER` environment overrides still win, and the
  existing `PICKFORGE_WAYLAND` troubleshooting override is unchanged.
  Restarting via the notice's own action correctly re-evaluates the mode
  instead of a stale synthesized value silently surviving the relaunch. Not
  shown or applied on non-Linux builds (#238).
- Double-clicking empty titlebar space now maximizes or restores the window.
- Launching PickForge again now focuses the running window instead of opening
  a duplicate.
- On normal app exit, PickForge gracefully stops its supported owned agent,
  terminal, emulator, mirror, and device-log managers, and interrupts active
  native agent turns so persisted chats return to idle. Crash/SIGKILL
  containment is not included yet (#208).

## Internal/release changes (dark: no default-on behavior change)

- Local crash containment (#208 PR 2), default off behind the startup-safe
  `PICKFORGE_LOCAL_CRASH_CONTAINMENT` environment variable: on Unix a
  guardian child (the app binary re-executed) holds a private pipe and, on
  pipe EOF — delivered by the kernel for normal close, SIGTERM, panic, abort,
  and SIGKILL alike — terminates every registered owned local process tree by
  exact pid + birth identity (never by name), including descendants discovered
  through `/proc` ancestry/session expansion on Linux, then sweeps the dead
  instance's private dtach sockets and tmux server. On Windows one
  kill-on-close Job Object owned by the app process makes the kernel kill
  every assigned tree on any main-process death. Every owned launcher (PTY
  shells, Codex/Claude/OMP/Pi agents, claude bridge, emulator, mirror,
  logcat/oslog streams, voice recorder, SSH tunnels) registers its tree root.

## Validation

- Forced-exit regression harness (`crash_containment` integration test):
  child + grandchild trees proven dead after normal close, SIGTERM, panic,
  abort, and forced SIGKILL of the parent.
- Rust workspace tests, frontend unit tests (66 files / 886 tests), and the
  production build pass. One pre-existing `pty_roundtrip` shared-grace timing
  failure reproduces identically on clean main on this machine
  (environment-specific, unrelated to this change).
- #238: mode→env resolution precedence (including a PickForge-owned DMA-BUF
  value that survived a Settings-triggered relaunch never being mistaken for
  a user override), persisted-config round-trip, malformed/missing-config
  fallback to Auto, `WEBKIT_DISABLE_DMABUF_RENDERER` and its synthesized
  marker never leaking into spawned shells/agents (including the
  claude-turn spawn path, which previously bypassed that hygiene entirely),
  and KDE Wayland + AMD detection fixtures are covered by focused Rust unit
  tests; a VRT spec covers the mode segments and restart-required notice
  (incl. clearing on an A→B→A round trip) with a real (behavioral-only,
  no local baseline) Playwright run. `cargo test --workspace --locked
  --all-targets`, `bun run test:unit`, and `bun run build` pass. The
  Linux-only backend code (early-boot application, IPC commands) only
  compiles/runs on the `ubuntu-22.04` CI job — this change was authored on
  macOS, where it is cfg'd out entirely.

### Not tested yet — release gates

- Windows Job Object containment compiles behind `cfg(windows)` but needs
  Windows CI validation; the macOS guardian birth-identity path needs macOS
  CI validation.
- Real Linux/macOS/Windows forced-exit smoke with the env flag enabled before
  enabling containment by default (#208).
- VRT baselines for `settings-navigation-general-chromium-linux.png`,
  `settings-chromium-linux.png`, and the two new
  `settings-linux-graphics.spec.ts` screenshots need CI regeneration
  (`update-vrt-baselines` workflow) — not generated locally, per repo policy
  (#238).

- Real AMD/KDE Wayland A/B smoke (Auto vs. Compatibility vs. Native Wayland,
  persistence across restart, KDE Wayland + AMD one-time recommendation) on
  the affected release-smoke machine (#238).

### Known limits

- Registration happens just after spawn, so a crash inside that instant can
  still orphan one fresh child; guardian-owned spawning closes this later.
- Payload-created `setsid`/daemon escapes outside tracked ancestry remain
  future #208 scope on non-Linux Unix.
- Remaining #208 scope: stale remote bootstrap reconciliation and the flag
  enablement/removal lifecycle.
