# Unreleased — v0.1.10 candidate

Working draft for the next PickForge release. Keep this current while PRs land.
At release time, copy and polish it into the GitHub release description, then
reset this file.

## User-facing changes

- Remote host settings now list paired clients with pairing dates and revoked
  status, and let users revoke active client access (#241).
- New section-based Settings navigation: a category sidebar with remembered
  last category, direct section links, keyboard navigation, and layouts that
  adapt to narrow windows. (`settingsNavigation` now default on, #211)
- Chats now get automatic titles from your first prompt, refreshed at
  meaningful milestones. Renaming a chat locks its title until you choose
  “Resume automatic titles”; manual titles survive restarts.
  (`dynamicChatTitles` now default on, #210)
- Double-clicking empty titlebar space now maximizes or restores the window.
- Launching PickForge again now focuses the running window instead of opening
  a duplicate.
- On normal app exit, PickForge gracefully stops its supported owned agent,
  terminal, emulator, mirror, and device-log managers, and interrupts active
  native agent turns so persisted chats return to idle. Crash/SIGKILL
  containment is not included yet (#208).

## Internal/release changes (dark: no default-on behavior change)

- Remote projects: per-project remote host binding over your tailnet, health
  badges, SSH terminals, remote Claude/Codex V1 chats, remote Flutter device
  discovery/launch, VM-service tunnels, and inspector reattach — all behind
  the default-off `remoteProjects` flag (epic #144). A live Acorns macOS run
  passed end to end.
- Remote process leases: leased SSH PTYs and V1 turns with heartbeats, a
  45-second TTL, and verified teardown, behind the default-off
  `remoteProcessLeases` flag (#208).
- Operator: typed intents, audited dispatch, device/run controls, BYO routing
  (Claude Code / Codex / Ollama), local Whisper dictation, semantic Flutter
  widget selection, hosted Pro routing, credits, and checkout — all behind the
  default-off `operator` flag (epic #118).
- Accounts: OAuth wiring, entitlement cache, opt-in settings sync, credit
  packs, data export, and account deletion (LGPD user rights) behind the
  default-off `accounts` and `settingsSync` flags (#132, #151).
- OMP and Pi support behind the default-off `ompPiAgents` flag (#212): terminal
  profiles, bounded offline diagnostics, and native chat gated by exact
  version probes (OMP exactly 16.4.8 for ACP; compatible Pi 0.79.x for RPC).
  OMP ACP runs with a cleared, minimal child environment and no injected
  credentials; Pi native RPC uses the user's installed extensions and tools.
  Includes Settings connector diagnostics, persisted-chat compatibility
  checks, native-chat retry recovery, and Unix/Windows process-tree cleanup
  with platform CI coverage.
- Release CI migrated to the shared `@pickforge/tauri-release` tooling with
  Rust caching, draft-only `latest.json` finalization, and AppImage repair.
- `agent-protocol-drift` schedule fixed: schemas are now compared
  semantically with an enforced file set and seven permanent contract tests
  (#229).
- Stabilized the agent-chat VRT capture race without changing baselines (#228).

## Validation

### Verified on final main `d2ac412`

- Frontend: 66 files / 882 unit tests plus seven schema contract tests,
  coverage run, and production Vite build all passed.
- Rust: 654 tests across 10 suites passed; workspace `cargo check` clean.
- VRT 33/33, Playwright E2E, and installer smoke 9/9 passed.
- Required CI checks green on #228, #229, #235, #236, including macOS OMP ACP
  and visual regression.
- Linux release binary: nonblank window, database quick-check, titlebar
  maximize/restore and staged drag, single-instance focus, clean exit with no
  owned helpers, and a clean worktree after launch.
- Owner acceptance pass (14 Jul, local release binaries at `d2ac412`):
  - Baseline (all flags off): project open, terminal, Claude/Codex chat,
    exit with owned work running — clean teardown, no orphan processes,
    clean worktree.
  - Two-flag candidate: Settings navigation (wide/narrow, keyboard,
    persisted category, gated categories correctly absent) and dynamic chat
    titles (auto title, milestone refresh, manual rename lock, restart
    persistence, resume-auto) passed.
  - Default-off re-check in the baseline binary passed: legacy Settings
    layout and static titles confirmed.

### Not tested yet — release gates

- Signed platform bundles: this machine has no release signing key, and
  AppImage must be proven by release CI (cached linuxdeploy cannot strip
  current Arch RELR host libraries). Inspect every draft asset and
  `latest.json` before publishing.
- Installer/updater flow: updating an installed v0.1.9 to the v0.1.10
  candidate (restart, version display, retained projects/settings).
- First full production proof of the rewritten release workflow (post-#157):
  matrix build, asset collection, AppImage repair, and `latest.json`.
- Install/launch/update smoke from the published GitHub artifacts (repeat
  after publish).

### Known limits (not blockers for this staged patch)

- Crash/SIGKILL containment, Windows Job Objects, stale bootstrap
  reconciliation, and payload-created daemon escapes remain open (#208).
- Remote disconnect/reattach semantics and real Tailnet lease expiry need
  release-artifact acceptance before `remoteProjects`/`remoteProcessLeases`
  enable (#152).
- OMP 16.5.0 certification is tracked in #212; the ACP contract is pinned to
  exactly 16.4.8, so `ompPiAgents` stays default off.
- A stripped launch environment can fall back to a current-directory
  database; standard installed launches are unaffected (#237).
