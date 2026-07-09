# Unreleased

Working draft for the next PickForge release. Keep this current while PRs land.
At release time, copy and polish it into the GitHub release description, then
reset this file.

## User-facing changes

- Added Remote Host settings for starting the local daemon listener, issuing
  pairing codes, and toggling Tailscale SSH.
- Projects can now attach a remote host (over your tailnet) from the project
  menu, with a live health badge in the sidebar and a test-connection check.
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
- Local dictation pipeline (Rust + IPC) landed dark; composer UI follows.
- Core PTY can spawn over Tailscale SSH for remote projects; terminal and agent wiring follows.
- Project terminals now run over SSH on their bound remote host; chat recovery stays local-only.
- Agent chats now run V1 engines over SSH on the bound remote host.
- Dictation mic landed in the operator dock (live preview, push-to-command, model override) behind the `operator` flag.

## Validation

### Tested

- Workflow YAML parse check:
  `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"`
- `pickforge.release.json` shape checked against `../pickgauge/pickforge.release.json`.
- `bun run test:unit` — 535 tests green, including the remote attach panel
  state machine, remote health poller (dedupe/backoff/startup prime), and the
  operator parser/dispatch/dock suites.
- `bun run build` — `tsc --noEmit` + vite production build clean.
- `bunx playwright test` — VRT snapshots unchanged (remote UI is flag-gated
  and badge renders only for bound projects).

### Not tested yet

- Tauri app bundle build.
- Installer or updater flow.
- Platform smoke checks.
- Live second-machine remote attach smoke (real tailnet host: attach, probe
  states, badge, detach).

### Release blockers

- None known.
