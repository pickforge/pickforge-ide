# Unreleased

Working draft for the next PickForge release. Keep this current while PRs land.
At release time, copy and polish it into the GitHub release description, then
reset this file.

## User-facing changes

- Double-clicking empty titlebar space now maximizes or restores the window.
- Added Remote Host settings for starting the local daemon listener, issuing
  pairing codes, and toggling Tailscale SSH.
- Projects can now attach a remote host (over your tailnet) from the project
  menu, with a live health badge in the sidebar and a test-connection check.
- Remote health checks now resolve `pickforged` through the remote login shell,
  including macOS hosts where non-login SSH omits `/usr/local/bin` from PATH.
- Launching PickForge again now focuses the running window.

## Internal/release changes

- Release CI now caches Rust builds (`Swatinem/rust-cache`), and ci.yml no longer compiles the test suite twice.
- Migrated release CI to the shared `@pickforge/tauri-release` tooling and draft-only `latest.json` finalization.
- Added the `pickforged` daemon foundation with hashed-token pairing auth.
- Landed the per-project remote host backend for bindings, SSH probing, and remote detection; UI follows.
- Operator M1 core parser, dispatch, and audit landed dark behind the `operator` flag.
- Operator composer dock landed dark behind the `operator` flag.
- Operator device/run intents (M1.5) wired dark behind the `operator` flag.
- BYO operator routing (Claude Code / Codex / Ollama) landed dark behind the `operator` flag.
- Semantic Flutter widget selection now routes only indexed class names and labels, with local disambiguation and selection.
- Landed accounts/auth wiring dark behind the `accounts` flag.
- Hardened account session invalidation, offline cache clearing, and desktop OAuth deep-link registration.
- Local dictation pipeline (Rust + IPC) landed dark; composer UI follows.
- Core PTY can spawn over Tailscale SSH for remote projects; terminal and agent wiring follows.
- Project terminals now run over SSH on their bound remote host; chat recovery stays local-only.
- Agent chats now run V1 engines over SSH on the bound remote host.
- Added managed SSH VM-service tunnels for remote Flutter runs and inspector reattach.
- Dictation mic landed in the operator dock (live preview, push-to-command, model override) behind the `operator` flag.
- Settings sync landed dark behind the `settingsSync` flag (opt-in, per-group).
- Hosted Pro Operator routing and credit purchase landed dark behind the `operator` flag (requires sign-in): a hosted router backend closes the routing ladder, the dock surfaces cost/balance and a quiet buy-credits prompt, and Settings gains a credit-pack purchase flow. Local and BYO routing stay free.
- In-app account deletion + data export (LGPD user rights), behind the `accounts` flag.

## Validation

### Tested

- Workflow YAML parse check:
  `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"`
- `pickforge.release.json` shape checked against `../pickgauge/pickforge.release.json`.
- `bun run test:coverage` — 739 tests green, including account-session cache,
  refresh-race, and titlebar double-click regressions.
- `bun run build` — `tsc --noEmit` + vite production build clean.
- `bunx playwright test` — VRT snapshots unchanged (remote UI is flag-gated
  and badge renders only for bound projects).
- `cargo check` — workspace check clean.
- `cargo test -p pickforge-core --lib --locked` — 391 tests green, including
  login-shell quoting, noisy-profile output, and daemon health regressions.
- Live Acorns macOS probe — Tailnet, SSH, and daemon states all green.

### Not tested yet

- Windows development OAuth deep-link smoke (no Windows Rust target is installed).
- Tauri app bundle build.
- Installer or updater flow.
- Platform smoke checks.
- Live second-machine remote attach smoke (real tailnet host: attach, probe
  states, badge, detach).

### Release blockers

- None known.
