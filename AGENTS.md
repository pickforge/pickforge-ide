# Pickforge Repository Instructions

These instructions apply to the entire repository. They are inferred from the
current codebase and should override personal/global defaults when they conflict.

## Project overview

Pickforge is a local desktop app for selecting on-screen elements in a running
app — Flutter (deep), React Native and native Android (useful), web
(experimental) — writing the selected element's context into `.pickforge/`, and
pasting that context into an embedded terminal. The terminal is shell-first: it
runs the user's `$SHELL` in the project root, with quick-launch chips that type
agent CLI commands (claude/codex/…) for the user to run.

It is built on **Tauri v2**: a UI-agnostic Rust core, a Tauri shell that adapts
the core to IPC, and a SolidJS frontend. (The app targets mobile and web
projects, not only Flutter; it is no longer itself written in Flutter — that was
migrated away. See `plans/rust-migration/`.)

## Tooling

- Frontend/build is bun + Vite; the native side is a Cargo workspace.
- Standard checks:
  - `bun run build` — `tsc --noEmit && vite build`
  - `bun run test:unit` — deterministic frontend unit tests
  - `bun run test:coverage` — frontend coverage ratchet
  - `bun run e2e` — device-free run-command smoke unless a serial is explicitly set
  - `cargo check` — whole workspace
  - `cargo test --workspace --locked --all-targets` — Rust workspace tests
  - `cargo llvm-cov --workspace --locked --all-targets` — Rust coverage ratchet
  - `bun run vrt` — Playwright visual regression tests
- Develop: `bun install`, then `bun run tauri dev` (builds the Rust shell + serves
  the Vite frontend). Requires a Rust toolchain (`rustup`) and Bun 1.2+.
- When handing a worktree build to someone for manual testing, make the running
  app visibly identifiable. Prefer a small Tauri flavor config and script that
  keep the normal dev path unchanged while using a different dev-server port and
  a semver prerelease suffix tied to the work, for example
  `v0.1.7-performance`. The app's title bar/version badge should make it obvious
  which branch or fix is under test when multiple PickForge windows are open.
- Don't hand-edit generated output under `src-tauri/gen/`.
- Write tests in the same PR as behavior changes. For bugs, start with a
  failing regression test when practical. For risky refactors, add
  characterization tests first.
- Do not lower coverage thresholds without explicit maintainer approval.

## Architecture

- `crates/pickforge-core/` — UI-agnostic Rust core. Modules: `pty`, `process`,
  `transcript`, `storage`, `targets`, `inspector`, `db`, `android`, `vm_service`.
  Keep platform/process/PTY/db logic here, not in the Tauri binary or the UI.
- `src-tauri/` — the Tauri v2 binary. `src/*_commands.rs` adapt the core to IPC
  (`pty_commands`, `process_commands`, `db_commands`, `device_commands`,
  `fs_commands`, `vm_commands`). A new app-defined command is registered in
  `generate_handler!` only — do **not** add it to `capabilities/default.json`.
  That file grants Tauri core/plugin permissions; app-defined commands are
  reachable without ACL entries, and adding one would switch the app to
  default-deny and break every command not migrated at the same time.
  `tauri.conf.json` is the app manifest.
- `src/` — SolidJS frontend.
  - `screens/` — `Onboarding`, `Settings`, `History`, `RunHistory`, and
    `workbench/` (Workbench, InspectorPanel, ProjectsChatsPanel, FileExplorer).
  - `components/` — `Terminal`, `TerminalHost`, shared `ui`.
  - `lib/` — IPC/client helpers (`pty`, `db`, `device`, `vm`, `process`,
    `agentModels`, `terminal-theme`). Prefer these seams over inlining IPC calls.
  - `stores/` — app state (`workspace`). `router.ts` is the route table.
  - `styles/` — `tokens.css`, `fonts.css`, `global.css`.

### Schema migrations (`crates/pickforge-core/src/db/mod.rs`)

A numbered Rust migration that **backfills or rewrites data** must be
dual-homed: call the same statement from `reconcile_data` as well. `migrate`
sends any database with `user_version <= DRIFT_FINAL` — Drift v1..=10 *and* the
unversioned-Rust `uv == 0` cohort — through `reconcile_schema`/`reconcile_data`
and then stamps `LATEST_VERSION` directly, so `apply_rust_migrations` never runs
and the backfill is skipped forever. Extract one shared helper and call it from
both sites rather than duplicating the SQL. Pure `ALTER TABLE`/schema-shape
migrations need no dual-home — `reconcile_schema` already covers them.

Test both paths. A migration test seeded at `user_version = <previous>` only
proves the numbered arm; add a `uv == 0` full-schema fixture too, and verify it
fails when the `reconcile_data` call is removed. (v16 and v17 both shipped this
bug; v17 was caught in review.)

## Design system & branding

PickForge has a first-class design system — read
[`docs/design-system/`](docs/design-system/README.md) before any UI work, and
keep new UI consistent with it.

- **Tokens only — never raw values.** Use the `--pf-*` CSS custom properties
  (color, spacing, radii, motion). They are defined in
  `node_modules/@pickforge/brand/src/tokens.css` and imported through
  `src/styles/global.css` — there is no `src/styles/tokens.css`. No raw hex,
  font sizes, radii, or durations in components. If a value you need has no
  token, raise it rather than inlining a literal.
- **One ember per composition.** The ember accent is the only accent — reserve it
  for the single most important element (primary CTA, active/selected, live
  status). Everything else is surface / text / hairline / semantic status.
- **Type:** Geist is the default; Geist Mono is the machine voice. Fonts ship in
  `public/fonts/` and are wired in `src/styles/fonts.css`.
- **Motion uses one easing** and every animation honors reduced motion.
- **Embedded terminal:** Claude/Codex must render with correct colors and no stray
  underlines — see [`docs/design-system/terminal.md`](docs/design-system/terminal.md)
  and `src/lib/terminal-theme.ts`.
- **Verify visuals via VRT.** After UI changes run `bun run vrt` and review the
  Playwright snapshots under `tests/vrt/` before committing.
- **State commits before animation.** Never gate a store mutation on
  `animationend`. The entry stays live for the animation's duration, so
  anything reading that state meanwhile acts on a row the user already
  deleted, and an unmount fires `animationcancel` instead — so the mutation
  never lands at all. Write the state first and let the exit animation be
  purely cosmetic, or drop the animation (#357 review).
- **A live region announces content, not labels.** Screen readers fire on an
  `aria-live` element's text changing; swapping its `aria-label` is usually
  silent and also overrides the visible text as that element's accessible
  name. Use a separate always-mounted visually-hidden `role="status"` whose
  text is the message — one that unmounts with the last row can never
  announce that the list emptied (#357 review).
- **A frame you can click must accept text.** When a wrapper takes over an
  input's visible frame (border/background) from its editable element, route
  mousedown on the frame into that element — otherwise part of what reads as the
  input is click-dead, and a click on inert chrome inside it blurs the editor and
  silently defeats the `activeElement === field` caret guards (#342 review).

## Testing

- A TypeScript change is not validated by `bun run test:unit` + `bun run lint`
  alone — neither type-checks. Always include `bunx tsc --noEmit` (or
  `bun run build`) in the validation pass (#329 review: a wrong-arity call
  passed tests and lint, failed only at build).
- A Rust change is not validated by `cargo test` alone — CI runs
  `cargo clippy --workspace --all-targets -- -D warnings`, where any lint is a
  hard build failure. Always run that exact command locally before pushing
  (#339 review: a `.iter().any(|x| *x == s)` collapse passed every local test
  and failed CI on `clippy::manual_contains`).
- When renaming or retiring an agent model id, grep for the version digits in
  free text too (`"opus 4.8"`, alias term arrays, swarm command parsing) — the
  exact-id grep misses natural-language sites — and migrate persisted
  selections (`RETIRED_MODELS` in `src/lib/agentModels.ts`).
- Rust: unit tests live beside their modules in `crates/pickforge-core/`;
  integration tests in `crates/pickforge-core/tests/`.
- Frontend: Playwright VRT specs and baselines live under `tests/vrt/`.
- VRT reuses whatever already serves port 1420 (`reuseExistingServer: !CI`). A
  `bun run tauri dev` / `bun run dev` server from another branch or worktree has
  no `VITE_PICKFORGE_VRT`, so every fixture-backed spec fails on a timeout that
  looks like a layout break. Run VRT against an isolated port (local config on a
  free port, `reuseExistingServer: false`) rather than trusting or killing the
  running server. Committed baselines are CI-rendered Linux PNGs — regenerate
  them with the `update-vrt-baselines` workflow, and never commit local
  `*-chromium-darwin.png` output.
- Any Rust test that mutates process-level home/env state (`HOME`,
  `PICKFORGE_HOME`) must take `test_support::PICKFORGE_HOME_ENV_LOCK` for
  its whole mutation scope and restore every var it touched via an
  `EnvRestore`/`EnvRestore::capture_many` RAII guard — two independent locks,
  or any unguarded mutation of that state in the same test binary, is a
  known flake class where one test's panic poisons the lock and cascades
  failures into every other test asserting on it (#237 review, PR #257 CI).
- Code or tests gated `#[cfg(target_os = "linux")]` must be validated on
  real Linux (a throwaway container is enough) before pushing — macOS runs
  structurally cannot exercise them, and every one of the last three
  macOS-only validation passes over such code shipped a bug straight to CI
  or production (PR #257 graphics tests; PR #259 twice: an inverted
  liveness hint and an unmatched tmux "never created" phrasing).
- Connector capability gating (native chat ready, etc.) must derive only
  from errors of capability-relevant probe steps. Optional/advisory steps
  (model catalog, extension detection) report through their own advisory
  path and never withhold the capability — adding a probe step to the
  shared error list silently disables the connector (#285 review).

Canonical brand assets live in `assets/branding/`.

## Releasing

- Keep [`docs/releases/UNRELEASED.md`](docs/releases/UNRELEASED.md) current on
  PRs with user-facing or release-relevant changes. Track user-facing changes,
  internal/release changes, what was tested, what was not tested yet, and known
  blockers. At release time, copy and polish it into the GitHub release
  description, then reset the draft.
- Bump the version in `src-tauri/tauri.conf.json` and `package.json`, land it on
  `main`, then tag `vX.Y.Z` and push the tag. CI builds installers for every
  platform, signs the updater artifacts, and creates a **draft** release —
  review it, polish the notes, and publish.
- The GitHub release description is the single source of release notes. The
  website (pickforge.dev/pickforge) reads the latest release from the GitHub
  API in the browser, so a normal release needs **no website change**.
- Only touch `landing-page` (`src/pages/products.ts`) when install methods,
  supported platforms, or positioning change.
## Workspace policy

For substantial work, read `../AGENTS.md` (workspace root) and use the `plan-issue` workflow — GitHub Issues are the canonical plan/progress tracker.


<claude-mem-context>
# Memory Context

# [pickforge] recent context, 2026-07-24 5:15pm GMT-3

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 35 obs (17,463t read) | 252,365t work | 93% savings

### Jul 24, 2026
1289 9:46a 🔵 Pi native chat dogfood test blocked by port conflict
1290 9:48a 🔵 Second Pi dogfood attempt failed with permission error on IPv6 bind
1291 " 🔵 Second Pi dogfood cleanup verified; port 1420 now free after IPv6 permission failure
1292 " 🔵 Pi dogfood final report completed documenting IPv6 bind EPERM block
1293 " ⚖️ Pi dogfood test delegated to subagent after two direct execution failures
1294 9:53a 🟣 Pi native chat dogfood test execution for pickforge#270 Phase 0
1297 9:54a 🔵 macOS desktop automation tooling gaps discovered during Pi dogfood test
1295 " 🔵 Pi dogfood subagent spawn retry after 30-second wait timeout
1296 " 🔵 Third consecutive 30-second wait timeout on pi_dogfood_ui subagent
1299 " 🔵 Fourth consecutive subagent wait timeout confirms delegation failure
1301 " 🔵 Fifth timeout in orchestrator-subagent deadlock with no adaptive response
1298 " 🔵 Subagent pi_dogfood_ui confirmed stuck in running state with no output
1300 " 🔵 Swift module cache permission workaround found; PickForge window absent despite successful compilation
1302 9:55a 🔵 PickForge app running but accessibility API blocked by missing TCC permissions
1303 " 🔵 Orchestrator sends encrypted message to stuck subagent after 8 consecutive timeouts
1305 " 🔵 Subagent wait finally completed after encrypted message intervention
1304 " 🔵 No native desktop automation tools available in session tool registry
1306 9:56a 🔵 No third-party macOS automation tools or window managers installed
1307 " 🔵 Orchestrator-subagent communication pattern shifts to rapid successful waits and second encrypted message
1309 " 🔵 Subagent returns to timeout state after brief responsive period
1311 " 🔵 Second consecutive timeout confirms subagent stuck pattern resumed
1308 " 🔵 Pi dogfood test cancelled via supervisor mechanism with relaunch automation
1310 " 🔵 Supervisor exited cleanly but process group cleanup blocked by macOS permissions
1312 " 🔵 Pi dogfood test completed with BLOCKED verdict due to environment permission restrictions
1313 9:57a 🔵 Subagent second launch attempt successfully bound port 1420 on IPv6
1314 " 🔵 Subagent timeout persists despite successful Vite dev server bind
1316 " 🔵 Twentieth consecutive wait timeout confirms persistent post-launch blockage
1318 " 🔵 Fourth encrypted message sent after burst of three rapid timeouts and fifth status check
1315 9:58a 🔵 Launch-2 processes remain running after cleanup attempts; process termination blocked
1317 9:59a 🔵 Fourth agent status check confirms subagent frozen for 5.5+ minutes with null task message
1319 " ✅ Final Pi dogfood test report completed with BLOCKED verdict and comprehensive evidence documentation
1320 10:00a 🔵 Subagent completed with comprehensive BLOCKED report after successfully launching PickForge but failing UI access
1321 10:03a 🔵 Swift module cache permission error blocks Pi dogfood UI access probes
1322 " 🔵 Pi dogfood retry aborted with UI-ACCESS-DENIED verdict
1323 10:04a 🔵 Ruby exec_command bypasses write_file permission rejection for out-of-project paths

Access 252k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>