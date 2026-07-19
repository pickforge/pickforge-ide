# Unreleased — v0.1.11 candidate

Working draft for the next PickForge release. Keep this current while PRs land.
At release time, copy and polish it into the GitHub release description, then
reset this file.

## User-facing changes

- None yet.

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

### Not tested yet — release gates

- Windows Job Object containment compiles behind `cfg(windows)` but needs
  Windows CI validation; the macOS guardian birth-identity path needs macOS
  CI validation.
- Real Linux/macOS/Windows forced-exit smoke with the env flag enabled before
  enabling containment by default (#208).

### Known limits

- Registration happens just after spawn, so a crash inside that instant can
  still orphan one fresh child; guardian-owned spawning closes this later.
- Payload-created `setsid`/daemon escapes outside tracked ancestry remain
  future #208 scope on non-Linux Unix.
- Remaining #208 scope: stale remote bootstrap reconciliation and the flag
  enablement/removal lifecycle.
