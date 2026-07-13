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
- Remote Flutter runs now discover devices on the bound host and require an
  explicit device choice before launch when more than one is available.
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
- Section-based Settings navigation landed dark behind the default-off `settingsNavigation` flag, with remembered/direct categories and wide/narrow preference layouts.
- Dynamic semantic chat titles landed dark behind the `dynamicChatTitles` flag,
  with durable manual ownership, milestone refreshes, provider/OSC precedence,
  and a “Resume automatic titles” control.
- OMP and Pi terminal profiles, bounded offline/read-only CLI diagnostics, Pi's
  offline model catalog, optional quick-launch chips, and OMP activity/title
  recognition landed dark behind the default-off `ompPiAgents` flag. OMP keeps
  its terminal profile; native chat appears only after an exact compatible
  16.4.8 probe. Pi RPC remains terminal-only.
- Added an exhaustive, immutable agent-backend capability registry for native
  chat and terminal surfaces. Claude Code and Codex behavior is unchanged; the
  OMP 16.4.8 ACP connector provides renderer-flagged, exact-probed local v2
  sessions, streaming, exact approvals, identity-keyed scoped MCP grants and
  canonical cwd reuse, model validation, safe reattach/resume, bounded transport
  failure recovery, cumulative-context and durable-title events, and process-tree cleanup.
- OMP ACP launches as `omp acp --no-extensions --approval-mode=always-ask`,
  with no config/yolo overlay. Its cleared child environment restores exactly
  `PATH`, `HOME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `XDG_CONFIG_HOME`,
  `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `APPDATA`, `LOCALAPPDATA`, `SystemRoot`,
  `WINDIR`, `COMSPEC`, `PATHEXT`, `TEMP`, `TMP`, `TMPDIR`, `LANG`, `LC_ALL`,
  `LC_CTYPE`, `TERM`, `COLORTERM`, and `NO_COLOR`. Home/config roots let OMP
  discover its own auth without PickForge reading or copying provider tokens;
  inherited provider secrets and extension/config injection variables are absent.

## Validation

### Tested

- Workflow YAML parse check:
  `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"`
- `pickforge.release.json` shape checked against `../pickgauge/pickforge.release.json`.
- `bun run test:coverage` — 750 tests green, including remote-device discovery,
  persistence, launch-race, and keyboard regressions.
- `bun run build` — `tsc --noEmit` + vite production build clean.
- `bunx playwright test` — 12 tests green, including remote-device loading,
  empty, error, stale, and keyboard-focus baselines at 1024px.
- Settings navigation focused checks: 11 registry/flag unit tests and 10 legacy/flagged wide/narrow Playwright cases passed.
- `cargo check` — workspace check clean.
- `cargo test -p pickforge-core --lib --locked` — 391 tests green, including
  login-shell quoting, noisy-profile output, and daemon health regressions.
- `bun run test:unit -- chatAutoName flags agentChat` — 111 focused title,
  precedence, cadence, restart-lock, manual-race, and flag-registry tests green.
- `cargo test -p pickforge-core db::tests::` — 35 database migration and narrow
  write tests green.
- `cargo check -p pickforge-tauri` — title metadata IPC commands compile clean
  (one pre-existing unused-function warning).
- `bun run vrt -- tests/vrt/dropdown.spec.ts` — 2 focused menu tests green,
  including automatic-title resume visibility.
- `bunx vitest run` — 121 focused title ownership, ordering, lifecycle,
  failed-turn, browser-mock, privacy, and default-off flag tests green.
- `cargo test -p pickforge-core narrow_chat_updates_touch_only_their_column` —
  monotonic title CAS, legacy sentinel adoption, and narrow provider writes green.
- `bun run vrt -- tests/vrt/screens.spec.ts` — 5 existing browser baselines green
  without updating snapshots.
- Live Acorns macOS run — Tailnet attach, deterministic device launch, VM-service
  tunnel, widget tree, node selection, hot reload, and stop all passed.
- `bunx vitest run tests/unit/flags.test.ts tests/unit/agentModels.test.ts tests/unit/chatAutoName.test.ts tests/unit/settingsSync.test.ts`
  — 65 focused flag, command, discovery, failure, terminal, and sync tests green.
- `bunx tsc --noEmit` — frontend type-check clean.
- `cargo test -p pickforge-tauri agent_probe_is_strictly_allowlisted --lib` —
  fixed diagnostic command allowlist test green.
- `bunx vitest run tests/unit/agentBackends.test.ts tests/unit/agentChat.test.ts tests/unit/agentModels.test.ts tests/unit/agentModes.test.ts tests/unit/chatDefaults.test.ts tests/unit/swarm.test.ts tests/unit/operatorDispatch.test.ts tests/unit/orchestraView.test.ts tests/unit/settingsRegistry.test.ts`
  — 216 focused capability-matrix, exact-probe native-chat parity, control,
  provider, composer-store, swarm, operator, and Settings tests green.
- `cargo test -p pickforge-core --lib agents::manager::tests:: --locked` — 27
  focused session lifecycle, capability-gate, approval replay, and dispatch tests green.
- `bun run build` — frontend type-check and Vite production build clean;
  dynamic-import and chunk-size warnings remain.

- `cargo test -p pickforge-core agents:: --locked` — 97 core-agent tests green,
  including 18 OMP ACP environment, handshake, immutable-identity, trusted
  direct-manager, bounded-failure, usage, title, model, approval, callback,
  descendant-reaping, and lifecycle regressions.
- `cargo test -p pickforge-tauri agent_chat_commands --locked` — 12 Tauri
  agent-chat authorization, scoped-MCP, and remote-binding tests green.
- `bunx vitest run tests/unit/agentBackends.test.ts tests/unit/agentChat.test.ts tests/unit/agentModels.test.ts tests/unit/agentModes.test.ts tests/unit/agentPricing.test.ts`
  — 116 frontend capability, exact-probe, native-selection, title-ownership,
  default-off rollout, IPC payload, and mode tests green.
- `cargo check -p pickforge-core -p pickforge-tauri --locked` and `bun run build`
  — native Rust compile, frontend type-check, and Vite production build clean
  apart from pre-existing unused-function/dynamic-import/chunk-size warnings.
- Real installed `omp acp` 16.4.8 smoke in isolated temporary HOME/XDG/project
  roots: protocol-v1 initialize, session/new, session/close, clean exit 0; no
  prompt, credentials, or model turn.

### Not tested yet

- OMP ACP connector smoke on Windows and macOS.
- Windows development OAuth deep-link smoke (no Windows Rust target is installed).
- Tauri app bundle build.
- Installer or updater flow.
- Platform smoke checks.

### Release blockers

- None known.
