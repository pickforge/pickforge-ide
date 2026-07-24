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
  adapt to narrow windows (#211).
- Chats now get automatic titles from your first prompt, refreshed at
  meaningful milestones. Renaming a chat locks its title until you choose
  “Resume automatic titles”; manual titles survive restarts (#210).
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
- Linux: agent shells spawned in the embedded terminal (Raw, dtach, and tmux
  chat sessions alike) now get `SUDO_ASKPASS` propagated automatically when a
  graphical session and a system askpass helper (the user's own `SUDO_ASKPASS`
  if executable, else the first of `ksshaskpass`/`ssh-askpass`/
  `lxqt-openssh-askpass`/a few standard distro paths) are both detected —
  `sudo -A <command>` shows a graphical password prompt instead of failing or
  blocking on a terminal password. It's the only environment variable this
  feature injects, and only for local (non-remote) shells. On a headless
  session or with no helper installed, a chat pane's title bar shows a small
  "no sudo helper" / "no graphical session" notice so the human running the
  agent knows to use a real terminal for privileged commands instead.
  macOS/Windows are out of scope this release — never `sudo -S`, never
  password capture, never a bundled helper (#215).
- Settings (General) gets a new "Legacy sessions" section: after #209
  namespaced every dtach/tmux recovery session per PickForge process, a
  session created by an older build no longer reattaches automatically —
  it just sits under the old shared paths. This section lists any such
  session it finds (a live/stale hint for dtach, an attached/detached hint
  for tmux) and lets you stop one at a time, or all of the currently listed
  ones at once — either way through the same confirmation dialog, which
  calls out the risk by name when the session you're stopping is live or
  attached. Nothing is ever stopped without that confirmation, and nothing
  is ever swept automatically: a live legacy session may still belong to
  another PickForge window that happens to be running right now, and
  there's no way to prove otherwise without asking you. Until you use this
  (or stop a session manually —
  `tmux -L pickforge kill-session -t <name>`, or send a dtach master's
  process a signal), the old session just keeps running alongside the new
  per-instance ones; it costs nothing but its own memory (#214).

## Internal/release changes (dark: no default-on behavior change)

- Split the shared `ompPiAgents` rollout flag into independent `piAgents` and
  `ompAgents` flags (both default off), so Pi native chat/terminal profiles
  can ship ahead of OMP's own ACP pin (#212, #270). Every previously shared
  gate site (profiles, quick-launch chips, connector diagnostics, native
  compatibility probes, error copy) now checks the flag for its own provider;
  a stored override under the removed `ompPiAgents` key is simply ignored, no
  migration. Pi's RPC wire protocol was empirically certified today as a
  compatible superset from 0.79.10 (the original adapter contract) through
  0.81, so `isCompatiblePiRpcVersion`/`compatible_version_output` now accept
  `>=0.79.10` and `<0.82.0` (previously `<0.80.0`). OMP stays pinned to its
  own 16.4.8 ACP version gate, untouched.
- CI now blocks complexity regressions, severe dependency advisories, and
  committed secrets; frontend coverage floors were ratcheted to current results.
- Integrated the published `@pickforge/tauri-updater` shared dialog/controller
  behind the `studioUpdateDialog` flag, default off (pickforge/pickforge-platform#36).
  With the flag on, a startup update check runs once per process, only in a
  packaged build, deferred until the main window is visible and focused;
  startup feed/network failures stay silent and non-blocking. The titlebar
  availability badge and the Settings "Check for updates" action now drive
  the same shared controller (a manual check always calls
  `controller.check({ manual: true })`), replacing the app-local updater
  store for that path. With the flag off, the existing app-local updater
  store, titlebar badge, and Settings check are unchanged.
- Removed the release gates for dynamic chat titles and Settings navigation
  after both shipped enabled in v0.1.10; their enabled behavior is now
  unconditional (#210, #211).
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

- #212/#270 (`piAgents`/`ompAgents` flag split + Pi 0.81 certification):
  `bun run test:unit` (973 tests) has the same 3 pre-existing
  `chatTerminalLifecycle` failures present on a clean `main` checkout
  (unrelated file, not touched here — reproduced by stashing this change and
  rerunning); `bun run build` (`tsc --noEmit && vite build`) passes.
  `cargo test -p pickforge-core` (545 tests) passes; two `agents::claude_stream`
  tests flaked once under full-suite parallel load and passed individually —
  pre-existing env-contention flakiness, unrelated to this change. `cargo
  clippy --workspace --all-targets -- -D warnings` passes clean.
- pickforge/pickforge-platform#36 (PR 3, PickForge integration): focused unit
  tests drive the controller/eligibility/store/view/fixture seams entirely
  through the package's injected adapters — no mocks in production code
  paths — covering packaged+PROD gating, main-window visible/focused
  eligibility (immediate and focus-event paths), non-main-window rejection,
  the shared store's reactive mirroring/unsubscribe-on-replace/idle-reset,
  badge flag-gating (legacy vs. shared state, dismissed-with-update still
  surfacing), Settings label/busy/error mapping for every controller status,
  and the dialog component binding metadata/controller onto the mounted
  custom element. `bun run test:unit` (971 tests) has the same 3
  pre-existing `chatTerminalLifecycle` failures present on a clean `main`
  checkout (unrelated file, not touched here — reproduced by stashing this
  change and rerunning); `bun run test:coverage` thresholds pass (new files:
  `studioUpdate.ts` 82%, `studioUpdater.ts` 68%, `studioUpdateView.ts` 100%,
  `studioUpdateFixture.ts` 71%, `StudioUpdateDialog.tsx` 100% statements).
  `bun run build` (`tsc --noEmit && vite build`) passes. A VRT spec
  (`tests/vrt/update-dialog.spec.ts`) drives the real flag + mount path
  through a VRT-only fixture seam (`src/lib/studioUpdateFixture.ts`,
  reachable only from the `VITE_PICKFORGE_VRT` branch) at PickForge's
  minimum 880×600 and the default 1280×820, asserting heading/version/notes
  text, initial focus on "Update & restart", and download-progress text for
  the available-with-notes and downloading states; baselines are CI-canonical
  via `update-vrt-baselines`, not generated locally, per repo policy (#238).
  No Rust changes.
- #214: `pty::sessions` unit tests cover legacy-vs-current-instance path
  separation (the legacy shared dir/tmux server name never equal this
  process's private ones), the legacy dtach socket path's escape/grammar
  guard, an unsupported-kind and non-owned-name refusal at both the core and
  Tauri-command layers, detection scoping to only the legacy dir (a
  current-instance-dir artifact is never reported as legacy), a live-master
  detection fixture (a concurrently bound legacy socket is reported live, not
  silently treated as safe — the exact scenario this issue protects against),
  a stale-socket no-op cleanup, and a regression guard proving normal
  exit-time cleanup (`kill_recoverable_sessions_on_exit` /
  `contain_recoverable_sessions`) never reaches into the legacy namespace.
  `cargo test --workspace --locked --all-targets` (545 pickforge-core tests
  after this change) passes; one `agents::claude_stream` test flaked once
  under full-suite parallel load and passed both individually and on a clean
  full-suite re-run — pre-existing env-contention flakiness, unrelated to
  this change. `bun run test:unit` (929 tests) has the same 3 pre-existing
  `chatTerminalLifecycle` failures present on a clean `main` checkout
  (unrelated file, not touched here); `bun run build` passes.
  **No feature flag:** detection is read-only and every mutating action
  requires an explicit, per-session (or explicitly-confirmed bulk) click —
  there is no state this ships disabled, matching #208's "corrective
  lifecycle behavior, no flag" precedent.
- #215: capability-detection unit tests (`process::askpass`) cover a
  user-executable helper winning over the probe list, a non-executable
  user-set value falling back to the probe list, no helper resolving, and
  headless (no `WAYLAND_DISPLAY`/`DISPLAY`) — plus a redaction-boundary test
  proving an unvalidated `SUDO_ASKPASS` value never reaches the capability's
  public surface. `pty::session` tests prove `SUDO_ASKPASS` is unconditionally
  OWNED by the injection seam — never present unless PickForge itself
  resolved a helper, in EVERY capability state and a remote spawn, whether
  the stray value came from the caller's `extra_env` or was already sitting
  in the resolved login-shell environment — and, via a `program_override`
  spawn (the same seam dtach/tmux use), that propagation is identical across
  backends.
  **Architectural guarantee (redaction):** the askpass helper's stdin/stdout
  is never in PickForge's process tree — `sudo` invokes it directly via its
  own pipe, out-of-band from the pty this module spawns — so prompt/credential
  material structurally never enters `PtyEvent::Output` in the first place.
  What a Rust test *can* prove is that PickForge's own code doesn't add a
  second path: a spawn test with a script emitting a fake "Password:"-style
  prompt proves the bytes reach the caller's sink byte-for-byte unmodified
  (no interception/masking) and that spawning writes nothing to any
  file/DB side-channel (this seam has no such handle to begin with).
  **Deliberate deviation (cancellation):** unlike PickLab's structured
  provisioning executor, PickForge's terminal is a generic interactive shell
  — runtime cancellation/auth-failure at `sudo -A` time is never parsed or
  specially surfaced; it reaches the user as ordinary pty output (proven by a
  spawn test asserting a stand-in cancelled-`sudo`'s stderr and non-zero exit
  status both reach the caller unmodified). The pre-flight chat-pane chip only
  covers the two states knowable BEFORE a privileged command is ever typed
  (`noHelper`, `headless`).
  `cargo test --workspace --locked --all-targets` (post-review: 538
  pickforge-core tests, incl. all of the above) passes; two timing-sensitive
  `agents::claude_stream`/`agents::manager` tests flaked once under
  full-suite parallel load and passed individually — pre-existing
  env-contention flakiness, unrelated to this change (reproduced clean on a
  second full run). `bun run test:unit` adds a pure-function test for the
  chat pane's `askpassNotice()` copy (all four `AskpassStatus` values, exact
  strings) and otherwise has the 3 known pre-existing `chatTerminalLifecycle`
  failures (unrelated file, not touched here); `bun run build` passes.
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

- pickforge/pickforge-platform#36 (PR 3): an owner-gated packaged
  signed-update smoke (old build → staged newer build → prompt → download →
  install → relaunch) with `studioUpdateDialog` on, plus flipping the flag
  on for real on `main` per the issue's rollout checklist. Deferred to
  PR 6+ per the issue's PR plan.

- Windows Job Object containment compiles behind `cfg(windows)` but needs
  Windows CI validation; the macOS guardian birth-identity path needs macOS
  CI validation.
- Real Linux/macOS/Windows forced-exit smoke with the env flag enabled before
  enabling containment by default (#208).
- VRT baselines for `settings-navigation-general-chromium-linux.png`,
  `settings-chromium-linux.png`, and the two new
  `settings-linux-graphics.spec.ts` screenshots need CI regeneration
  (`update-vrt-baselines` workflow) — not generated locally, per repo policy
  (#238). The same two `general`-category baselines also need regenerating
  for the new "Legacy sessions" section (#214).
- #214: the fixture-level concurrent-old-instance scenario (a live legacy
  dtach master while this build starts) is covered by a Rust unit test; a
  real end-to-end smoke — an actual older PickForge build left running,
  upgrading past it, and confirming the newer build's own sessions/exit
  cleanup never disturb it while the Settings panel lists and can stop the
  older build's session by hand — has not been run.

- Real AMD/KDE Wayland A/B smoke (Auto vs. Compatibility vs. Native Wayland,
  persistence across restart, KDE Wayland + AMD one-time recommendation) on
  the affected release-smoke machine (#238).
- Real Linux `sudo -A -v` smoke from a PickForge-launched agent shell —
  helper-present success, cancellation, and the headless/no-helper fallback
  notice — deferred to Elberte-PC (#215).
- A real-tmux (not `program_override`-shimmed) integration test proving the
  askpass env reaches an ACTUAL `tmux new-session -A` client, gated behind
  `#[ignore]` so CI without tmux installed isn't required to run it — deferred,
  no tracking issue needed; the existing `program_override`-based test already
  proves the shared code seam is exercised identically (#215).

### Known limits

- Registration happens just after spawn, so a crash inside that instant can
  still orphan one fresh child; guardian-owned spawning closes this later.
- Payload-created `setsid`/daemon escapes outside tracked ancestry remain
  future #208 scope on non-Linux Unix.
- Remaining #208 scope: stale remote bootstrap reconciliation and the flag
  enablement/removal lifecycle.
- #215: PickForge cannot inject guidance into a third-party agent CLI's own
  reasoning — whether an agent actually types `sudo -A` (vs. something else)
  is the agent's choice; PickForge provides the environment (`SUDO_ASKPASS`)
  and the chat-pane UI copy, not a guarantee of agent behavior. Programmatic
  sudo invocation on the agent's behalf is picklab#27's scope, not this one.
